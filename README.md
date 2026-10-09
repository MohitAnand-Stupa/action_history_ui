# Trace — Action History

A React audit dashboard for understanding who changed what, when it happened,
which entity was targeted, and what else changed as a side effect. The Python
server reads the configured databases directly and never writes to them.

## Run locally

Install dependencies, then start the complete app with one command:

```bash
cd ~/Desktop/action_history_ui
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. `npm run dev` starts the React/Vite frontend and
the read-only API together. Demo data works without any database.

You can still run either side separately when debugging:

```bash
npm run dev:ui
npm run dev:api
```

For a production-style local run, build once and start the API/static server:

```bash
npm run build
npm start
```

That version opens at `http://127.0.0.1:8090`.

## Entity type support

`entity_type` is a first-class part of the interface:

- the filter is populated from entity types in the newest 50,000 records;
- every activity card shows an explicit entity badge and entity ID;
- selecting a badge opens that entity's complete history;
- the details drawer shows entity type, ID, name, and event separately;
- records that predate entity mapping are labelled **Entity not mapped** rather
  than silently hiding the missing value.

The API exposes `GET /api/entities` for the populated filter and accepts
`entity_type` and `entity_id` on `GET /api/list`.

The sidebar directories are interactive: **Entities** groups recent history by
entity type, while **Actors** uses `GET /api/actors` to show each user role's
name, role, action count, failures, and last activity. Selecting a row opens the
activity feed with the matching filter applied.

## Configuration

`.env` lists the environments, services, tenants, and database credentials:

```text
ENVIRONMENTS=development:Development,staging:Staging,preprod:Preprod,production:Production
SERVICES=tms:TMS,user_role_service:User Role Service,ctms:CTMS,rnr:RNR,order:Order

DEVELOPMENT_TMS_TENANT_CONFIGS={"dev":{"DB_USER":"...","DB_SCHEMA":"dev"}}
STAGING_USER_ROLE_SERVICE_TENANT_CONFIGS={...}
```

- Each `<ENVIRONMENT>_<SERVICE>_TENANT_CONFIGS` value is that service's own
  `TENANT_CONFIGS` JSON for that environment.
- When `USER_ROLE_SERVICE` is configured for an environment, actor names and
  roles are resolved. Otherwise user-role IDs remain visible.
- Restart `npm run dev` after editing `.env`.

## Safety

- PostgreSQL connections use `default_transaction_read_only=on`.
- Only `SELECT` queries are issued.
- The server binds to `127.0.0.1` unless `--host` is given; any other host requires `VIEWER_USER`/`VIEWER_PASSWORD`.
- Only compiled frontend assets are served; `.env` and source/backend files are
  not exposed.
- Request bodies are rendered as text by React. Passwords, tokens, OTPs, and
  keys are expected to be masked before storage.

## Deploy with Docker

The image listens on every interface, so it needs a login: set `VIEWER_USER`
and `VIEWER_PASSWORD` in `.env` or the server refuses to start. The browser
asks for them once per session. Over plain HTTP the password crosses the
network unencrypted, so use a long random one (`openssl rand -base64 18`).

```bash
docker build -t action-history-ui .
docker run -d --name action_history_ui --restart unless-stopped --network host \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/.env:/app/.env:ro" action-history-ui
```

Then open `http://<server-ip>:8090` (the port must be open in the server's
firewall / security group). `--user` runs the container as you, so it can read
your `chmod 600` .env.
