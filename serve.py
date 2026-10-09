#!/usr/bin/env python3
"""
Action History viewer: serves the page and reads history straight from each
environment's databases, as configured in .env.

    python3 serve.py            # then open http://127.0.0.1:8090

Pick an environment (development, staging, ...), a service (TMS, ...) and a
tenant in the page. For every combination the page is told whether there is
data, and if not, why: not configured in .env, not recorded by that service yet,
migration not run, or the database is unreachable.

Read-only by construction: every connection is opened with
default_transaction_read_only=on, and only SELECTs are ever sent. Listens on
127.0.0.1 unless --host says otherwise; any other host needs VIEWER_USER and
VIEWER_PASSWORD in .env, and then every request asks for them (HTTP Basic auth).
Needs psycopg2 (python3 -m pip install psycopg2-binary).
"""

import argparse
import base64
import datetime
import decimal
import hmac
import http.server
import json
import os
import re
import sys
import threading
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(HERE, "dist")

# Services whose action history exists, and the table it lives in. Every other
# service in SERVICES is shown as "not recorded yet".
HISTORY_TABLES = {
    "tms": "action_history",
    "user_role_service": "action_history",
}
# The Action filter suggests names seen in this many of the newest rows.
ACTIONS_SCAN_ROWS = 50000
# Where actor names and roles come from.
NAMES_SERVICE = "user_role_service"

CONNECT_TIMEOUT_SECONDS = 5
STATEMENT_TIMEOUT_MS = 15000
MAX_PER_PAGE = 200

try:
    import psycopg2
except ImportError:  # reported on /api/status, so the page can say so
    psycopg2 = None


# --------------------------------------------------------------------- config

def load_env(path: str) -> Dict[str, str]:
    """KEY=VALUE lines; # comments; values may be wrapped in quotes."""
    values: Dict[str, str] = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
                value = value[1:-1]
            values[key.strip()] = value
    return values


def parse_pairs(raw: str) -> List[Tuple[str, str]]:
    pairs = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        key, _, label = item.partition(":")
        pairs.append((key.strip(), (label or key).strip()))
    return pairs


class Config:
    def __init__(self, env: Dict[str, str]):
        self.environments = parse_pairs(env.get("ENVIRONMENTS", "development:Development,staging:Staging"))
        self.services = parse_pairs(env.get("SERVICES", "tms:TMS"))
        self.errors: List[str] = []
        self.databases: Dict[Tuple[str, str], Dict[str, Dict[str, Any]]] = {}
        for env_key, _ in self.environments:
            for service_key, _ in self.services:
                name = f"{env_key}_{service_key}_TENANT_CONFIGS".upper()
                raw = env.get(name, "").strip()
                if not raw:
                    continue
                try:
                    tenants = json.loads(raw)
                    if not isinstance(tenants, dict):
                        raise ValueError("not a JSON object")
                    self.databases[(env_key, service_key)] = tenants
                except ValueError as error:
                    self.errors.append(f"{name} is not valid JSON: {error}")

    def label(self, pairs: List[Tuple[str, str]], key: str) -> str:
        return dict(pairs).get(key, key)

    def tenants(self, env_key: str, service_key: str) -> List[str]:
        return list(self.databases.get((env_key, service_key), {}))

    def public(self) -> Dict[str, Any]:
        """What the page needs to build its dropdowns -- no credentials."""
        environments = []
        for env_key, env_label in self.environments:
            services = []
            for service_key, service_label in self.services:
                services.append({
                    "key": service_key,
                    "label": service_label,
                    "records_history": service_key in HISTORY_TABLES,
                    "configured": (env_key, service_key) in self.databases,
                    "tenants": self.tenants(env_key, service_key),
                })
            environments.append({"key": env_key, "label": env_label, "services": services})
        return {"environments": environments, "errors": self.errors}


# ------------------------------------------------------------------ database

class Databases:
    """One read-only connection per (environment, service, tenant), reused."""

    def __init__(self, config: Config):
        self.config = config
        self._connections: Dict[Tuple[str, str, str], Any] = {}
        self._locks: Dict[Tuple[str, str, str], threading.Lock] = {}
        self._guard = threading.Lock()

    def _connect(self, settings: Dict[str, Any]):
        options = [
            "-c default_transaction_read_only=on",
            f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
        ]
        schema = settings.get("DB_SCHEMA")
        if schema and re.fullmatch(r"\w+", str(schema)):
            options.append(f"-c search_path={schema}")
        connection = psycopg2.connect(
            host=settings.get("DB_HOST"),
            port=settings.get("DB_PORT") or 5432,
            dbname=settings.get("DB_NAME"),
            user=settings.get("DB_USER"),
            password=settings.get("DB_PASS"),
            connect_timeout=CONNECT_TIMEOUT_SECONDS,
            options=" ".join(options),
            application_name="action_history_viewer",
        )
        connection.autocommit = True
        return connection

    def query(self, env_key: str, service_key: str, tenant: str, sql: str, params=()) -> List[tuple]:
        settings = self.config.databases.get((env_key, service_key), {}).get(tenant)
        if settings is None:
            raise LookupError("not configured")
        key = (env_key, service_key, tenant)
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            for attempt in (1, 2):
                connection = self._connections.get(key)
                try:
                    if connection is None or connection.closed:
                        connection = self._connections[key] = self._connect(settings)
                    with connection.cursor() as cursor:
                        cursor.execute(sql, params)
                        return cursor.fetchall()
                except psycopg2.OperationalError:
                    # A dropped connection: reconnect once, then give up.
                    self._connections.pop(key, None)
                    if attempt == 2:
                        raise
        return []


# ---------------------------------------------------------------------- api

class ApiError(Exception):
    def __init__(self, status: int, message: str, state: str = "error"):
        super().__init__(message)
        self.status = status
        self.message = message
        self.state = state


def _int(params: Dict[str, str], key: str) -> Optional[int]:
    value = params.get(key, "").strip()
    if not value:
        return None
    if not re.fullmatch(r"-?\d+", value):
        raise ApiError(400, f"{key} must be a number")
    return int(value)


def _date(params: Dict[str, str], key: str) -> Optional[datetime.date]:
    value = params.get(key, "").strip()
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(value[:10])
    except ValueError:
        raise ApiError(400, f"{key} must be a date (YYYY-MM-DD)")


def _entity(entity_type: Optional[str], entity_id: Optional[int], name: Any) -> Optional[Dict[str, Any]]:
    """{type, id, name}, as tms's action_history_service._entity() builds it."""
    if not entity_type:
        return None
    entity = {"type": entity_type, "id": entity_id, "name": name}
    return {k: v for k, v in entity.items() if v is not None}


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


class Api:
    def __init__(self, config: Config, databases: Databases):
        self.config = config
        self.db = databases

    def _selection(self, params: Dict[str, str]) -> Tuple[str, str, str, str]:
        env_key, service_key, tenant = params.get("env", ""), params.get("service", ""), params.get("tenant", "")
        env_label = self.config.label(self.config.environments, env_key)
        service_label = self.config.label(self.config.services, service_key)
        where = f"{service_label} on {env_label}"

        if psycopg2 is None:
            raise ApiError(503, "psycopg2 is not installed. Run: python3 -m pip install psycopg2-binary", "setup")
        if service_key not in HISTORY_TABLES:
            raise ApiError(404, f"{service_label} doesn't record action history yet. Today only "
                           f"{', '.join(self.config.label(self.config.services, s) for s in HISTORY_TABLES)} does.",
                           "not_recorded")
        if (env_key, service_key) not in self.config.databases:
            raise ApiError(404, f"No database is configured for {where}. Add "
                           f"{env_key.upper()}_{service_key.upper()}_TENANT_CONFIGS to action_history_ui/.env.",
                           "not_configured")
        if tenant not in self.config.tenants(env_key, service_key):
            raise ApiError(404, f"Tenant '{tenant}' isn't configured for {where}.", "not_configured")
        return env_key, service_key, tenant, where

    def status(self, params: Dict[str, str]) -> Dict[str, Any]:
        env_key, service_key, tenant, where = self._selection(params)
        table = HISTORY_TABLES[service_key]
        try:
            [(exists,)] = self.db.query(env_key, service_key, tenant, "SELECT to_regclass(%s) IS NOT NULL", (table,))
        except Exception as error:  # noqa: BLE001 -- shown to the person running the viewer
            raise ApiError(502, f"Couldn't connect to the {where} database ({tenant}): {str(error).strip()}", "unreachable")
        if not exists:
            raise ApiError(404, f"{where} ({tenant}) has no {table} table yet -- the action history "
                           f"migration hasn't run there.", "not_migrated")
        names = (env_key, NAMES_SERVICE) in self.config.databases and \
            tenant in self.config.tenants(env_key, NAMES_SERVICE)
        return {
            "state": "available",
            "message": f"Reading {table} from {where} ({tenant}).",
            "names": names,
            "names_hint": None if names else (
                f"Showing user-role ids: add {env_key.upper()}_{NAMES_SERVICE.upper()}_TENANT_CONFIGS "
                f"to .env to see names and roles."),
        }

    def actions(self, params: Dict[str, str]) -> Dict[str, Any]:
        """Every action name recorded recently, most frequent first, for the Action filter.

        Reads only the newest rows (primary key order), so it stays fast however big the table gets.
        """
        env_key, service_key, tenant, where = self._selection(params)
        table = HISTORY_TABLES[service_key]
        try:
            rows = self.db.query(
                env_key, service_key, tenant,
                f"SELECT action, count(*) FROM (SELECT action FROM {table} ORDER BY id DESC LIMIT %s) recent "
                f"GROUP BY action ORDER BY count(*) DESC, action LIMIT 500",
                (ACTIONS_SCAN_ROWS,),
            )
        except Exception as error:  # noqa: BLE001
            raise ApiError(502, f"Reading {where} ({tenant}) failed: {str(error).strip()}", "unreachable")
        return {"items": [{"action": action, "count": count} for action, count in rows]}

    def entities(self, params: Dict[str, str]) -> Dict[str, Any]:
        """Entity types seen in recent history, for the entity filter.

        This deliberately uses the same bounded recent-row scan as actions so a
        large audit table cannot make opening the filter unexpectedly expensive.
        """
        env_key, service_key, tenant, where = self._selection(params)
        table = HISTORY_TABLES[service_key]
        try:
            rows = self.db.query(
                env_key, service_key, tenant,
                f"SELECT entity_type, count(*) FROM (SELECT entity_type FROM {table} "
                f"ORDER BY id DESC LIMIT %s) recent WHERE entity_type IS NOT NULL "
                f"AND entity_type <> '' GROUP BY entity_type ORDER BY count(*) DESC, entity_type LIMIT 500",
                (ACTIONS_SCAN_ROWS,),
            )
        except Exception as error:  # noqa: BLE001
            raise ApiError(502, f"Reading {where} ({tenant}) failed: {str(error).strip()}", "unreachable")
        return {"items": [{"entity_type": entity_type, "count": count} for entity_type, count in rows]}

    def actors(self, params: Dict[str, str]) -> Dict[str, Any]:
        """Actors present in recent history, enriched with names and roles."""
        env_key, service_key, tenant, where = self._selection(params)
        table = HISTORY_TABLES[service_key]
        try:
            rows = self.db.query(
                env_key, service_key, tenant,
                f"SELECT created_by, count(*), max(created_at), "
                f"count(*) FILTER (WHERE status >= 400) FROM ("
                f"SELECT created_by, created_at, status FROM {table} ORDER BY id DESC LIMIT %s"
                f") recent WHERE created_by IS NOT NULL GROUP BY created_by "
                f"ORDER BY count(*) DESC, created_by LIMIT 500",
                (ACTIONS_SCAN_ROWS,),
            )
        except Exception as error:  # noqa: BLE001
            raise ApiError(502, f"Reading {where} ({tenant}) failed: {str(error).strip()}", "unreachable")
        items = [{
            "created_by": created_by,
            "count": count,
            "last_seen": _jsonable(last_seen),
            "failed_count": failed_count,
        } for created_by, count, last_seen, failed_count in rows]
        self._add_users(env_key, tenant, items)
        return {"items": items}

    def list(self, params: Dict[str, str]) -> Dict[str, Any]:
        env_key, service_key, tenant, where = self._selection(params)
        table = HISTORY_TABLES[service_key]
        page_num = max(1, _int(params, "page_num") or 1)
        per_page = min(MAX_PER_PAGE, max(1, _int(params, "per_page") or 50))

        clauses, args = [], []
        for key in ("event_id", "created_by"):
            value = _int(params, key)
            if value is not None:
                clauses.append(f"{key} = %s")
                args.append(value)
        action = params.get("action", "").strip()
        if action:
            # Part of a name matches too: "slot" finds ASSIGN_MATCH_SLOTS and SWAP_MATCH_SLOTS.
            clauses.append("action LIKE %s ESCAPE '\\'")
            args.append("%" + re.sub(r"([\\%_])", r"\\\1", action.upper()) + "%")
        entity_type, entity_id = params.get("entity_type", "").strip(), _int(params, "entity_id")
        if entity_type:
            clauses.append("entity_type = %s")
            args.append(entity_type)
            if entity_id is not None:
                clauses.append("entity_id = %s")
                args.append(entity_id)
        if params.get("failed_only") in ("true", "1"):
            clauses.append("status >= 400")
        date_from, date_to = _date(params, "date_from"), _date(params, "date_to")
        if date_from:
            clauses.append("created_at >= %s")
            args.append(date_from)
        if date_to:
            clauses.append("created_at < %s")
            args.append(date_to + datetime.timedelta(days=1))
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        try:
            [(total,)] = self.db.query(env_key, service_key, tenant, f"SELECT count(*) FROM {table} {where_sql}", args)
            rows = self.db.query(
                env_key, service_key, tenant,
                f"SELECT id, created_at, created_by, action, entity_type, entity_id, event_id, status, meta "
                f"FROM {table} {where_sql} ORDER BY id DESC LIMIT %s OFFSET %s",
                args + [per_page, (page_num - 1) * per_page],
            )
        except Exception as error:  # noqa: BLE001
            raise ApiError(502, f"Reading {where} ({tenant}) failed: {str(error).strip()}", "unreachable")

        items = [self._serialize(row) for row in rows]
        self._add_users(env_key, tenant, items)
        return {"items": items, "total": total, "page_num": page_num, "per_page": per_page}

    @staticmethod
    def _serialize(row: tuple) -> Dict[str, Any]:
        """Same shape as tms src/service/action_history_service.serialize()."""
        row_id, created_at, created_by, action, entity_type, entity_id, event_id, status, meta = row
        meta = dict(meta or {})
        return {
            "id": row_id,
            "created_at": _jsonable(created_at),
            "created_by": created_by,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "event_id": event_id,
            "status": status,
            "entity": _entity(entity_type, entity_id, meta.pop("entity_name", None)),
            "effects": meta.pop("effects", []),
            "meta": meta,
        }

    def _add_users(self, env_key: str, tenant: str, items: List[Dict[str, Any]]) -> None:
        """Names and roles from user_role_service, the way its field-map and
        role-name-map endpoints compute them. Best effort: ids still show if this fails."""
        ids = sorted({item["created_by"] for item in items if item.get("created_by") is not None})
        if not ids or tenant not in self.config.tenants(env_key, NAMES_SERVICE):
            return
        try:
            names = dict(self.db.query(env_key, NAMES_SERVICE, tenant, """
                SELECT urf.user_role_id, max(urf.value)
                FROM user_role_fields urf
                JOIN role_fields rf ON rf.id = urf.role_field_id
                JOIN fields f ON f.id = rf.field_id
                WHERE urf.user_role_id = ANY(%s) AND f.name = 'Full Name'
                  AND urf.is_deleted IS FALSE AND rf.is_deleted IS FALSE
                GROUP BY urf.user_role_id""", (ids,)))
            roles = dict(self.db.query(env_key, NAMES_SERVICE, tenant, """
                SELECT ur.id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                WHERE ur.id = ANY(%s) AND ur.is_deleted IS FALSE""", (ids,)))
        except Exception:  # noqa: BLE001 -- names are a nicety
            return
        for item in items:
            user_role_id = item.get("created_by")
            if user_role_id is not None:
                item["user"] = {"user_role_id": user_role_id, "name": names.get(user_role_id), "role": roles.get(user_role_id)}


# --------------------------------------------------------------------- http

class Handler(http.server.SimpleHTTPRequestHandler):
    api: Api = None  # set in main()
    credentials: Optional[Tuple[str, str]] = None  # (user, password) when a login is required

    def __init__(self, *args, **kwargs):
        static_root = BUILD_DIR if os.path.isfile(os.path.join(BUILD_DIR, "index.html")) else HERE
        self.static_root = static_root
        super().__init__(*args, directory=static_root, **kwargs)

    def do_HEAD(self):
        # SimpleHTTPRequestHandler would answer HEAD for any file, outside the allowlist below.
        self.send_error(405)

    def _authorized(self) -> bool:
        if self.credentials is None:
            return True
        scheme, _, encoded = (self.headers.get("Authorization") or "").partition(" ")
        if scheme.lower() == "basic":
            try:
                user, _, password = base64.b64decode(encoded, validate=True).decode().partition(":")
            except ValueError:
                user, password = "", ""
            # Compare both, always, so a wrong user name takes as long as a wrong password.
            user_ok = hmac.compare_digest(user.encode(), self.credentials[0].encode())
            password_ok = hmac.compare_digest(password.encode(), self.credentials[1].encode())
            if user_ok and password_ok:
                return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Action History", charset="UTF-8"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    def do_GET(self):
        if not self._authorized():
            return
        url = urlsplit(self.path)
        if not url.path.startswith("/api/"):
            # Only the compiled React application is public. This keeps .env and
            # every backend/source file unreachable however the path is spelled.
            allowed = url.path in ("/", "/index.html") or (
                self.static_root == BUILD_DIR and url.path.startswith("/assets/")
            )
            if not allowed:
                self.send_error(404)
                return
            self.path = "/index.html" if url.path == "/" else url.path
            super().do_GET()
            return
        params = {key: values[0] for key, values in parse_qs(url.query).items()}
        try:
            if url.path == "/api/config":
                payload = self.api.config.public()
            elif url.path == "/api/status":
                payload = self.api.status(params)
            elif url.path == "/api/actions":
                payload = self.api.actions(params)
            elif url.path == "/api/entities":
                payload = self.api.entities(params)
            elif url.path == "/api/actors":
                payload = self.api.actors(params)
            elif url.path == "/api/list":
                payload = self.api.list(params)
            else:
                raise ApiError(404, "Unknown endpoint")
            self._json(200, payload)
        except ApiError as error:
            self._json(error.status, {"state": error.state, "message": error.message})

    def _json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, default=_jsonable).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):  # quieter: only API calls and errors
        if self.path.startswith("/api/") or (args and str(args[1])[:1] in "45"):
            super().log_message(fmt, *args)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--host", default="127.0.0.1",
                        help="address to listen on; anything but 127.0.0.1 needs VIEWER_USER/VIEWER_PASSWORD")
    parser.add_argument("--env-file", default=os.path.join(HERE, ".env"))
    args = parser.parse_args()

    env = load_env(args.env_file)
    config = Config(env)
    user, password = env.get("VIEWER_USER", "").strip(), env.get("VIEWER_PASSWORD", "")
    if user and password:
        Handler.credentials = (user, password)
    elif args.host not in ("127.0.0.1", "localhost", "::1"):
        sys.exit(f"Refusing to listen on {args.host} without a login: set VIEWER_USER and "
                 f"VIEWER_PASSWORD in {args.env_file}.")
    Handler.api = Api(config, Databases(config))
    for error in config.errors:
        print(f"warning: {error}")
    configured = ", ".join(f"{e}/{s}" for e, s in config.databases) or "nothing (demo data only)"
    print(f"Action History viewer: http://{args.host}:{args.port}"
          + (" (login required)" if Handler.credentials else ""))
    if not os.path.isfile(os.path.join(BUILD_DIR, "index.html")):
        print("UI build not found: run 'npm install && npm run build' first, or use 'npm run dev'.")
    print(f"Configured: {configured}")
    server = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
