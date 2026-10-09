import { useEffect, useMemo, useState } from "react";
import { demoActions, demoActors, demoEntities, demoItems } from "./demoData";

const DEMO = "demo";
const PER_PAGE = 20;
const FILTER_KEYS = ["event_id", "created_by", "action", "entity_type", "entity_id", "date_from", "date_to", "failed_only"];
const FILTER_LABELS = {
  event_id: "Event",
  created_by: "Actor",
  action: "Action",
  entity_type: "Entity type",
  entity_id: "Entity ID",
  date_from: "From",
  date_to: "To",
  failed_only: "Failed only",
};
const UNAVAILABLE_TITLES = {
  not_recorded: "History is not recorded yet",
  not_configured: "This source is not configured",
  not_migrated: "No action history here yet",
  unreachable: "Database is unreachable",
  setup: "Viewer setup needed",
  error: "Something went wrong",
};

const ICONS = {
  logo: ["M12 3a9 9 0 1 0 8.5 6", "M21 3v6h-6", "M12 7v5l3 2"],
  activity: ["M3 12h4l3-8 4 16 3-8h4"],
  layers: ["m12 2 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z", "m9 12 2 2 4-4"],
  filter: ["M4 5h16", "M7 12h10", "M10 19h4"],
  search: ["m21 21-4.35-4.35", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"],
  calendar: ["M3 5h18v16H3z", "M16 3v4", "M8 3v4", "M3 10h18"],
  database: ["M12 5c5 0 9-1.34 9-3S17 1 12 1 3 2.34 3 4s4 3 9 3Z", "M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5", "M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  chevron: ["m9 18 6-6-6-6"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  check: ["m20 6-11 11-5-5"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.7 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"],
  copy: ["M8 8h11v13H8z", "M16 8V3H3v13h5"],
  refresh: ["M20 6v5h-5", "M4 18v-5h5", "M18.5 9A7 7 0 0 0 6 5.5L4 8", "M5.5 15A7 7 0 0 0 18 18.5l2-2.5"],
};

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(ICONS[name] || []).map((path, index) => <path d={path} key={index} />)}
    </svg>
  );
}

function loadSource() {
  const query = new URLSearchParams(window.location.search);
  if (query.has("env")) return { env: query.get("env"), service: query.get("service") || "tms", tenant: query.get("tenant") || "" };
  try {
    return JSON.parse(localStorage.getItem("trace.source")) || { env: DEMO, service: "tms", tenant: "" };
  } catch {
    return { env: DEMO, service: "tms", tenant: "" };
  }
}

function loadFilters() {
  const query = new URLSearchParams(window.location.hash.slice(1));
  return FILTER_KEYS.reduce((result, key) => {
    if (query.has(key)) result[key] = key === "failed_only" ? query.get(key) === "true" : query.get(key);
    return result;
  }, {});
}

function loadView() {
  const view = new URLSearchParams(window.location.search).get("view");
  return ["activity", "entities", "actors", "health"].includes(view) ? view : "activity";
}

async function getJson(url) {
  const response = await fetch(url);
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(body?.message || `Request failed (${response.status})`);
    error.state = body?.state || "error";
    throw error;
  }
  return body;
}

function entityTypeOf(item) {
  return item.entity_type || item.entity?.type || null;
}

function entityIdOf(item) {
  return item.entity_id ?? item.entity?.id ?? null;
}

function cleanWords(value) {
  return String(value || "Unknown").toLowerCase().replaceAll("_", " ");
}

function titleWords(value) {
  return cleanWords(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function singular(value) {
  const word = cleanWords(value || "record");
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ses|ches|shes|xes)$/.test(word)) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

function operationOf(action, status) {
  if (Number(status) >= 400) return "failed";
  const last = String(action || "").split("_").at(-1);
  if (["CREATED", "DUPLICATED", "ADDED", "REGISTERED"].includes(last)) return "created";
  if (["DELETED", "REMOVED", "ARCHIVED"].includes(last)) return "deleted";
  return "updated";
}

function relativeTime(iso) {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let value = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [size, unit] of [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]]) {
    if (Math.abs(value) < size) return formatter.format(Math.round(value), unit);
    value /= size;
  }
  return "";
}

function fullTime(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const sameDay = (first, second) => first.toDateString() === second.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function deviceLabel(agent) {
  if (!agent) return "Unknown device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : /okhttp|StupaApp/i.test(agent) ? "Mobile app" : "API client";
  const os = /Windows/.test(agent) ? "Windows" : /Mac/.test(agent) ? "macOS" : /Android/.test(agent) ? "Android" : /iPhone|iPad|iOS/.test(agent) ? "iOS" : /Linux/.test(agent) ? "Linux" : null;
  return os ? `${browser} · ${os}` : browser;
}

function initials(item) {
  const name = item.user?.name || `User ${item.created_by ?? "?"}`;
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function displayActor(item) {
  return item.user?.name || (item.created_by != null ? `User role #${item.created_by}` : "Unknown user");
}

function describeAction(item) {
  const entity = entityTypeOf(item);
  const entityName = item.entity?.name;
  const entityId = entityIdOf(item);
  const op = operationOf(item.action, item.status);
  const verb = op === "failed" ? "attempted" : op;
  const target = entity ? singular(entity) : cleanWords(item.action).split(" ").slice(0, -1).join(" ") || "record";
  const identity = entityName ? `“${entityName}”` : entityId != null ? `#${entityId}` : "";
  return { verb, target, identity };
}

function demoList(filters, page) {
  const normalizedType = String(filters.entity_type || "").toLowerCase();
  const rows = demoItems.filter((item) =>
    (!filters.event_id || String(item.event_id) === String(filters.event_id)) &&
    (!filters.created_by || String(item.created_by) === String(filters.created_by)) &&
    (!filters.action || item.action.includes(String(filters.action).toUpperCase())) &&
    (!normalizedType || String(entityTypeOf(item) || "").toLowerCase() === normalizedType) &&
    (!filters.entity_id || String(entityIdOf(item)) === String(filters.entity_id)) &&
    (!filters.failed_only || item.status >= 400) &&
    (!filters.date_from || item.created_at.slice(0, 10) >= filters.date_from) &&
    (!filters.date_to || item.created_at.slice(0, 10) <= filters.date_to)
  ).sort((first, second) => second.id - first.id);
  const offset = (page - 1) * PER_PAGE;
  return { items: rows.slice(offset, offset + PER_PAGE), total: rows.length };
}

function Sidebar({ view, onView }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-icon"><Icon name="logo" size={22} /></div>
        <div><strong>Trace</strong><span>Action intelligence</span></div>
      </div>
      <nav className="main-nav" aria-label="Primary navigation">
        <span className="nav-kicker">Workspace</span>
        <button className={`nav-item ${view === "activity" ? "active" : ""}`} type="button" onClick={() => onView("activity")}><Icon name="activity" />Activity feed{view === "activity" ? <span className="nav-dot" /> : null}</button>
        <button className={`nav-item ${view === "entities" ? "active" : ""}`} type="button" onClick={() => onView("entities")}><Icon name="layers" />Entities</button>
        <button className={`nav-item ${view === "actors" ? "active" : ""}`} type="button" onClick={() => onView("actors")}><Icon name="users" />Actors</button>
        <span className="nav-kicker nav-second">Governance</span>
        <button className={`nav-item ${view === "health" ? "active" : ""}`} type="button" onClick={() => onView("health")}><Icon name="shield" />Audit health</button>
      </nav>
      <div className="sidebar-card">
        <span className="pulse"><i /></span>
        <div><strong>Read-only mode</strong><p>Your production data is protected. Trace never writes to source databases.</p></div>
      </div>
      <div className="sidebar-user">
        <div className="mini-avatar">SA</div>
        <div><strong>System admin</strong><span>Audit workspace</span></div>
        <button type="button" aria-label="Account menu">•••</button>
      </div>
    </aside>
  );
}

function SourceBar({ config, source, onChange, refreshing, onRefresh }) {
  const environments = [{ key: DEMO, label: "Demo workspace", services: [] }, ...(config?.environments || [])];
  const selectedEnv = environments.find((env) => env.key === source.env);
  const services = source.env === DEMO ? [{ key: "tms", label: "Tournament Management", tenants: [""] }] : (selectedEnv?.services || []);
  const selectedService = services.find((service) => service.key === source.service) || services[0];
  const tenants = source.env === DEMO ? [{ key: "", label: "Demo tenant" }] : (selectedService?.tenants || []).map((tenant) => ({ key: tenant, label: tenant }));

  const changeEnv = (env) => {
    const entry = environments.find((item) => item.key === env);
    const service = env === DEMO ? "tms" : entry?.services?.[0]?.key || "";
    const serviceEntry = entry?.services?.find((item) => item.key === service);
    onChange({ env, service, tenant: env === DEMO ? "" : serviceEntry?.tenants?.[0] || "" });
  };

  const changeService = (service) => {
    const entry = services.find((item) => item.key === service);
    onChange({ ...source, service, tenant: entry?.tenants?.[0] || "" });
  };

  return (
    <header className="source-bar">
      <div className="mobile-brand"><div className="brand-icon"><Icon name="logo" size={20} /></div><strong>Trace</strong></div>
      <div className="source-context">
        <span className={`live-indicator ${source.env === DEMO ? "demo" : ""}`}><i />{source.env === DEMO ? "Demo data" : "Live source"}</span>
        <span className="source-divider" />
        <label>Environment<select value={source.env} onChange={(event) => changeEnv(event.target.value)}>{environments.map((item) => <option value={item.key} key={item.key}>{item.label}{item.key !== DEMO && !item.services.some((service) => service.configured) ? " · not configured" : ""}</option>)}</select></label>
        <label>Service<select value={selectedService?.key || ""} onChange={(event) => changeService(event.target.value)}>{services.map((item) => <option value={item.key} key={item.key}>{item.label}{item.records_history === false ? " · no history" : ""}</option>)}</select></label>
        <label>Tenant<select value={source.tenant} disabled={!tenants.length} onChange={(event) => onChange({ ...source, tenant: event.target.value })}>{tenants.length ? tenants.map((item) => <option value={item.key} key={item.key}>{item.label}</option>) : <option value="">No tenant</option>}</select></label>
      </div>
      <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh history" title="Refresh history"><span className={refreshing ? "spinning" : ""}><Icon name="refresh" /></span></button>
    </header>
  );
}

function StatCard({ icon, tone, label, value, detail }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon name={icon} size={20} /></div>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function FilterPanel({ form, setForm, actions, entities, onApply, onClear, mobileOpen, setMobileOpen }) {
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => { event.preventDefault(); onApply(); setMobileOpen(false); };
  return (
    <aside className={`filter-panel ${mobileOpen ? "mobile-open" : ""}`}>
      <div className="filter-heading"><div><span>REFINE RESULTS</span><h2><Icon name="filter" size={18} />Filters</h2></div><button className="mobile-close" type="button" onClick={() => setMobileOpen(false)}><Icon name="close" /></button></div>
      <form onSubmit={submit}>
        <label className="field full"><span>Action</span><div className="input-wrap"><Icon name="search" size={16} /><input value={form.action || ""} list="action-options" placeholder="Search an action…" onChange={(event) => update("action", event.target.value)} /></div><datalist id="action-options">{actions.map((item) => <option value={item.action} key={item.action}>{item.count} records</option>)}</datalist></label>
        <label className="field full entity-field"><span>Entity type <b>Key field</b></span><select value={form.entity_type || ""} onChange={(event) => update("entity_type", event.target.value)}><option value="">All entity types</option>{entities.map((item) => <option value={item.entity_type} key={item.entity_type}>{titleWords(item.entity_type)} ({item.count})</option>)}</select></label>
        <div className="two-fields">
          <label className="field"><span>Entity ID</span><input inputMode="numeric" value={form.entity_id || ""} placeholder="e.g. 77" onChange={(event) => update("entity_id", event.target.value)} /></label>
          <label className="field"><span>Event ID</span><input inputMode="numeric" value={form.event_id || ""} placeholder="e.g. 2582" onChange={(event) => update("event_id", event.target.value)} /></label>
        </div>
        <label className="field full"><span>Actor / User role ID</span><input inputMode="numeric" value={form.created_by || ""} placeholder="e.g. 42" onChange={(event) => update("created_by", event.target.value)} /></label>
        <div className="field full"><span className="label-text">Date range</span><div className="date-field"><Icon name="calendar" size={16} /><input type="date" value={form.date_from || ""} aria-label="From date" onChange={(event) => update("date_from", event.target.value)} /><i>to</i><input type="date" value={form.date_to || ""} aria-label="To date" onChange={(event) => update("date_to", event.target.value)} /></div></div>
        <label className="toggle-row"><span><strong>Failed attempts only</strong><small>Show responses with 4xx or 5xx status</small></span><input type="checkbox" checked={Boolean(form.failed_only)} onChange={(event) => update("failed_only", event.target.checked)} /><i /></label>
        <div className="filter-actions"><button className="primary-button" type="submit">Apply filters <Icon name="arrow" size={16} /></button><button className="text-button" type="button" onClick={onClear}>Reset all</button></div>
      </form>
    </aside>
  );
}

function ActiveFilters({ filters, onRemove }) {
  const entries = Object.entries(filters);
  if (!entries.length) return null;
  return <div className="active-filters"><span>Active</span>{entries.map(([key, value]) => <button type="button" key={key} onClick={() => onRemove(key)}>{key === "failed_only" ? FILTER_LABELS[key] : `${FILTER_LABELS[key]}: ${titleWords(value)}`}<Icon name="close" size={12} /></button>)}</div>;
}

function EffectRow({ effect, onEntity }) {
  const tone = effect.op === "CREATED" ? "created" : effect.op === "DELETED" ? "deleted" : "updated";
  const id = effect.id ?? null;
  const label = effect.count > 1 ? `${effect.count} ${cleanWords(effect.type)}` : `${singular(effect.type)}${effect.name ? ` · ${effect.name}` : id != null ? ` #${id}` : ""}`;
  return <li><span className={`effect-op ${tone}`}>{effect.soft ? "SOFT DELETED" : effect.op}</span>{id != null ? <button type="button" onClick={() => onEntity(effect.type, id)}>{label}</button> : <strong>{label}</strong>}{effect.fields?.length ? <small>{effect.fields.join(" · ")}</small> : null}</li>;
}

function ActivityCard({ item, onDetails, onEntity, onActor, onEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = item.meta || {};
  const type = entityTypeOf(item);
  const id = entityIdOf(item);
  const action = describeAction(item);
  const operation = operationOf(item.action, item.status);
  const effects = item.effects || [];
  return (
    <article className={`activity-card ${operation}`}>
      <div className="timeline-rail"><span className={`operation-icon ${operation}`}>{operation === "created" ? "+" : operation === "deleted" ? "−" : operation === "failed" ? "!" : "↗"}</span></div>
      <div className="activity-body">
        <div className="activity-topline">
          <div className={`avatar avatar-${(item.created_by || 0) % 4}`}>{initials(item)}</div>
          <div className="activity-title"><p><button type="button" onClick={() => item.created_by != null && onActor(item.created_by)}>{displayActor(item)}</button> <span>{action.verb}</span> <strong>{action.target}</strong>{action.identity ? <> <em>{action.identity}</em></> : null}</p><div className="actor-subline">{item.user?.role || "Platform user"}<i />{relativeTime(item.created_at)}</div></div>
          <time title={fullTime(item.created_at)}>{fullTime(item.created_at)}</time>
        </div>
        <div className="identity-row">
          <button className="action-code" type="button" onClick={() => onDetails(item)}>{item.action}</button>
          {type ? <button className="entity-badge" type="button" onClick={() => id != null && onEntity(type, id)}><Icon name="database" size={13} /><span>Entity</span>{type}{id != null ? <b>#{id}</b> : null}</button> : <span className="entity-badge unmapped"><Icon name="database" size={13} />Entity not mapped</span>}
          {item.event_id ? <button className="meta-pill" type="button" onClick={() => onEvent(item.event_id)}>Event #{item.event_id}</button> : null}
          <span className={`status-pill ${operation === "failed" ? "bad" : "good"}`}><i />{item.status || "—"} {operation === "failed" ? "Failed" : "Success"}</span>
        </div>
        <div className="request-strip">
          <code>{meta.route || "Endpoint not recorded"}</code><span /><small>{meta.source || "unknown source"}</small><small>{deviceLabel(meta.agent)}</small>{meta.ip ? <small>IP {meta.ip}</small> : null}
        </div>
        <div className="activity-actions">
          {effects.length ? <button type="button" onClick={() => setExpanded((value) => !value)}><Icon name="chevron" size={14} /><span>{expanded ? "Hide" : "View"} {effects.length} side effect{effects.length === 1 ? "" : "s"}</span></button> : <span className="no-effects">No side effects recorded</span>}
          <button type="button" onClick={() => onDetails(item)}>View request details <Icon name="arrow" size={14} /></button>
        </div>
        {expanded ? <ul className="effects-list">{effects.map((effect, index) => <EffectRow effect={effect} onEntity={onEntity} key={`${effect.type}-${effect.id ?? index}`} />)}</ul> : null}
      </div>
    </article>
  );
}

function ActivityList({ items, onDetails, onEntity, onActor, onEvent }) {
  if (!items.length) return <div className="empty-state"><div><Icon name="search" size={26} /></div><h3>No matching activity</h3><p>Try removing a filter or widening the date range.</p></div>;
  let previousDay = null;
  return <div className="activity-list">{items.map((item) => {
    const day = dayLabel(item.created_at);
    const heading = day !== previousDay ? <div className="day-heading" key={`${day}-heading`}><span>{day}</span><i /></div> : null;
    previousDay = day;
    return [heading, <ActivityCard item={item} onDetails={onDetails} onEntity={onEntity} onActor={onActor} onEvent={onEvent} key={item.id} />];
  })}</div>;
}

function DirectoryHeader({ eyebrow, title, description, count }) {
  return (
    <div className="directory-header">
      <div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
      <strong>{count.toLocaleString()}<small> total</small></strong>
    </div>
  );
}

function EntityDirectory({ entities, loading, onSelect }) {
  const max = Math.max(...entities.map((item) => item.count), 1);
  return (
    <section className="directory-view">
      <DirectoryHeader eyebrow="ENTITY DIRECTORY" title="Tracked entity types" description="Every database entity represented in recent action history." count={entities.length} />
      {loading ? <div className="directory-loading">Loading entity types…</div> : entities.length ? <div className="entity-grid">{entities.map((item, index) => (
        <button className="entity-card" type="button" key={item.entity_type} onClick={() => onSelect(item.entity_type)}>
          <span className={`directory-icon tone-${index % 4}`}><Icon name="database" size={20} /></span>
          <span className="directory-copy"><strong>{titleWords(item.entity_type)}</strong><code>{item.entity_type}</code><i><b style={{ width: `${Math.max(8, item.count / max * 100)}%` }} /></i></span>
          <span className="directory-count"><strong>{item.count}</strong><small>actions</small></span>
          <Icon name="arrow" size={17} />
        </button>
      ))}</div> : <div className="empty-state"><div><Icon name="database" size={26} /></div><h3>No mapped entities yet</h3><p>Entity types will appear when history records include entity mapping.</p></div>}
    </section>
  );
}

function ActorDirectory({ actors, loading, onSelect }) {
  return (
    <section className="directory-view">
      <DirectoryHeader eyebrow="ACTOR DIRECTORY" title="People and service actors" description="Authenticated user roles that initiated activity in this source." count={actors.length} />
      {loading ? <div className="directory-loading">Loading actors…</div> : actors.length ? <div className="actor-grid">{actors.map((actor) => (
        <button className="actor-card" type="button" key={actor.created_by} onClick={() => onSelect(actor.created_by)}>
          <span className={`directory-avatar avatar-${(actor.created_by || 0) % 4}`}>{initials(actor)}</span>
          <span className="actor-copy"><strong>{displayActor(actor)}</strong><small>{actor.user?.role || "Role name unavailable"} · User role #{actor.created_by}</small><em>Last active {relativeTime(actor.last_seen)}</em></span>
          <span className="actor-metrics"><strong>{actor.count}</strong><small>actions</small>{actor.failed_count ? <em>{actor.failed_count} failed</em> : <em className="clean">All successful</em>}</span>
          <Icon name="arrow" size={17} />
        </button>
      ))}</div> : <div className="empty-state"><div><Icon name="users" size={26} /></div><h3>No actors found</h3><p>Actor identities will appear after authenticated actions are recorded.</p></div>}
    </section>
  );
}

function HealthView({ availability, entities, actors, total }) {
  const checks = [
    { title: "History source", value: availability.state === "available" ? "Connected" : "Needs attention", ok: availability.state === "available", detail: availability.message },
    { title: "Actor attribution", value: actors.length ? "Recording" : "No actors", ok: actors.length > 0, detail: `${actors.length} actor${actors.length === 1 ? "" : "s"} found in recent history.` },
    { title: "Entity mapping", value: entities.length ? "Mapped" : "Not mapped", ok: entities.length > 0, detail: `${entities.length} entity type${entities.length === 1 ? "" : "s"} are discoverable.` },
    { title: "Audit volume", value: `${total.toLocaleString()} actions`, ok: total > 0, detail: "Actions matching the current source and filters." },
  ];
  return <section className="directory-view"><DirectoryHeader eyebrow="GOVERNANCE" title="Audit health" description="A quick check of attribution and entity coverage for this source." count={checks.filter((item) => item.ok).length} /><div className="health-grid">{checks.map((check) => <article className="health-card" key={check.title}><span className={check.ok ? "ok" : "warn"}><Icon name={check.ok ? "check" : "alert"} size={18} /></span><div><small>{check.title}</small><strong>{check.value}</strong><p>{check.detail}</p></div></article>)}</div></section>;
}

function DetailDrawer({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const close = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    document.body.classList.add("drawer-open");
    return () => { document.removeEventListener("keydown", close); document.body.classList.remove("drawer-open"); };
  }, [item, onClose]);
  if (!item) return null;
  const meta = item.meta || {};
  const type = entityTypeOf(item);
  const id = entityIdOf(item);
  const copyRequest = () => navigator.clipboard?.writeText(meta.request_id || "");
  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="Close details" />
      <aside className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header><div><span>REQUEST INSPECTOR</span><h2 id="drawer-title">Activity details</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></header>
        <div className="drawer-content">
          <section className="drawer-hero"><span className={`status-pill ${item.status >= 400 ? "bad" : "good"}`}><i />{item.status >= 400 ? "Failed" : "Successful"}</span><h3>{item.action}</h3><p>{displayActor(item)} · {fullTime(item.created_at)}</p></section>
          <section><h4>Target identity</h4><dl className="detail-grid"><div><dt>Entity type</dt><dd className="entity-value"><Icon name="database" size={14} />{type || "Not mapped"}</dd></div><div><dt>Entity ID</dt><dd>{id != null ? `#${id}` : "—"}</dd></div><div><dt>Entity name</dt><dd>{item.entity?.name || "—"}</dd></div><div><dt>Event ID</dt><dd>{item.event_id ? `#${item.event_id}` : "—"}</dd></div></dl></section>
          <section><h4>Request context</h4><dl className="detail-list"><div><dt>Endpoint</dt><dd><code>{meta.route || "—"}</code></dd></div><div><dt>Request ID</dt><dd><code>{meta.request_id || "—"}</code>{meta.request_id ? <button type="button" onClick={copyRequest} title="Copy request ID"><Icon name="copy" size={14} /></button> : null}</dd></div><div><dt>Actor</dt><dd>{displayActor(item)} {item.user?.name && item.created_by != null ? `(user role #${item.created_by})` : ""}</dd></div><div><dt>IP address</dt><dd>{meta.ip || "—"}</dd></div><div><dt>Client</dt><dd>{deviceLabel(meta.agent)}</dd></div><div><dt>Source</dt><dd>{meta.source || "—"}</dd></div></dl></section>
          <section><h4>Request body</h4><p className="privacy-note"><Icon name="shield" size={14} />Sensitive values are masked before storage.</p><pre>{meta.body ? JSON.stringify(meta.body, null, 2) : "No request body was recorded."}</pre></section>
        </div>
      </aside>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [configReady, setConfigReady] = useState(false);
  const [source, setSource] = useState(loadSource);
  const [filters, setFilters] = useState(loadFilters);
  const [form, setForm] = useState(loadFilters);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState([]);
  const [entities, setEntities] = useState([]);
  const [actors, setActors] = useState([]);
  const [view, setView] = useState(loadView);
  const [availability, setAvailability] = useState({ state: "checking", message: "Connecting to activity source…" });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    getJson("/api/config").then((value) => { setConfig(value); setConfigReady(true); }).catch(() => { setSource({ env: DEMO, service: "tms", tenant: "" }); setConfigReady(true); });
  }, []);

  useEffect(() => {
    if (!configReady) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setAvailability((current) => ({ ...current, state: "checking" }));
      try {
        let note;
        let result;
        if (source.env === DEMO) {
          note = "Exploring with realistic sample activity. Select an environment above to inspect live history.";
          result = demoList(filters, page);
          if (!cancelled) { setActions(demoActions); setEntities(demoEntities); setActors(demoActors); }
        } else {
          const params = new URLSearchParams(source);
          const status = await getJson(`/api/status?${params}`);
          note = [status.message, status.names_hint].filter(Boolean).join(" ");
          const query = new URLSearchParams({ ...source, ...filters, page_num: String(page), per_page: String(PER_PAGE) });
          const [actionData, entityData, actorData, listData] = await Promise.all([
            getJson(`/api/actions?${params}`),
            getJson(`/api/entities?${params}`),
            getJson(`/api/actors?${params}`),
            getJson(`/api/list?${query}`),
          ]);
          result = listData;
          if (!cancelled) { setActions(actionData.items || []); setEntities(entityData.items || []); setActors(actorData.items || []); }
        }
        if (!cancelled) {
          setItems(result.items || []);
          setTotal(result.total || 0);
          setAvailability({ state: "available", message: note });
        }
      } catch (error) {
        if (!cancelled) { setItems([]); setTotal(0); setAvailability({ state: error.state || "error", message: error.message }); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [configReady, source, filters, page, refreshKey]);

  useEffect(() => {
    try { localStorage.setItem("trace.source", JSON.stringify(source)); } catch { /* private browsing */ }
    const query = new URLSearchParams(source);
    if (view !== "activity") query.set("view", view);
    const hash = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== "" && value !== false) hash.set(key, String(value)); });
    const url = `${window.location.pathname}?${query}${hash.size ? `#${hash}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [source, filters, view]);

  const metrics = useMemo(() => {
    const success = items.length ? Math.round(items.filter((item) => item.status < 400).length / items.length * 100) : 0;
    return { success, actors: actors.length, types: entities.length };
  }, [items, actors, entities]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const applyFilters = () => { setFilters(Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "" && value !== false))); setPage(1); };
  const clearFilters = () => { setForm({}); setFilters({}); setPage(1); };
  const updateFilter = (changes) => { const next = { ...filters, ...changes }; Object.keys(next).forEach((key) => (next[key] === "" || next[key] === false) && delete next[key]); setFilters(next); setForm(next); setPage(1); };
  const showEntity = (type, id) => { updateFilter({ entity_type: type, entity_id: String(id), action: "", created_by: "", event_id: "" }); setView("activity"); };
  const showEntityType = (type) => { updateFilter({ entity_type: type, entity_id: "", created_by: "" }); setView("activity"); };
  const showActor = (id) => { updateFilter({ created_by: String(id), entity_type: "", entity_id: "" }); setView("activity"); };

  const headings = {
    activity: ["AUDIT TRAIL", "Action history", "Every change, every actor, every affected entity—clear and accountable."],
    entities: ["DATA MAP", "Entities", "Explore every entity type captured by your audit trail."],
    actors: ["IDENTITY MAP", "Actors", "See who initiated changes and inspect their complete activity."],
    health: ["GOVERNANCE", "Audit health", "Monitor attribution, entity coverage, and source availability."],
  };
  const heading = headings[view];

  return (
    <div className="app-shell">
      <Sidebar view={view} onView={setView} />
      <main className="main-shell">
        <SourceBar config={config} source={source} onChange={(value) => { setSource(value); setPage(1); }} refreshing={loading} onRefresh={() => setRefreshKey((key) => key + 1)} />
        <div className="page-wrap">
          <section className="page-heading"><div><span className="eyebrow">{heading[0]}</span><h1>{heading[1]}</h1><p>{heading[2]}</p></div>{view === "activity" ? <button className="mobile-filter-button" type="button" onClick={() => setFilterOpen(true)}><Icon name="filter" />Filters</button> : null}</section>
          <nav className="mobile-view-tabs" aria-label="Workspace sections"><button type="button" className={view === "activity" ? "active" : ""} onClick={() => setView("activity")}>Activity</button><button type="button" className={view === "entities" ? "active" : ""} onClick={() => setView("entities")}>Entities</button><button type="button" className={view === "actors" ? "active" : ""} onClick={() => setView("actors")}>Actors</button><button type="button" className={view === "health" ? "active" : ""} onClick={() => setView("health")}>Health</button></nav>
          <section className="stats-grid">
            <StatCard icon="activity" tone="violet" label="Matching actions" value={total.toLocaleString()} detail={Object.keys(filters).length ? "Across active filters" : "In the selected source"} />
            <StatCard icon="shield" tone="green" label="Success rate" value={`${metrics.success}%`} detail={`On this page · ${items.length} actions`} />
            <StatCard icon="users" tone="blue" label="Active actors" value={metrics.actors} detail="In recent history" />
            <StatCard icon="database" tone="amber" label="Entity types" value={metrics.types} detail="Mapped in recent history" />
          </section>
          {availability.message && availability.state === "available" ? <div className="source-note"><Icon name="database" size={16} /><span>{availability.message}</span></div> : null}
          {view === "activity" ? <div className="workspace-grid">
            <FilterPanel form={form} setForm={setForm} actions={actions} entities={entities} onApply={applyFilters} onClear={clearFilters} mobileOpen={filterOpen} setMobileOpen={setFilterOpen} />
            <section className="feed" aria-live="polite">
              <div className="feed-header"><div><span>ACTIVITY STREAM</span><h2>{loading ? "Loading history…" : `${total.toLocaleString()} action${total === 1 ? "" : "s"} found`}</h2></div><div className="legend"><span><i className="created" />Created</span><span><i className="updated" />Updated</span><span><i className="deleted" />Deleted</span><span><i className="failed" />Failed</span></div></div>
              <ActiveFilters filters={filters} onRemove={(key) => updateFilter({ [key]: "" })} />
              {availability.state !== "available" && availability.state !== "checking" ? <div className="unavailable"><div><Icon name={availability.state === "unreachable" ? "alert" : "database"} size={26} /></div><h3>{UNAVAILABLE_TITLES[availability.state] || UNAVAILABLE_TITLES.error}</h3><p>{availability.message}</p></div> : loading ? <div className="loading-list">{[1, 2, 3].map((key) => <div className="skeleton-card" key={key}><i /><span><b /><b /><b /></span></div>)}</div> : <ActivityList items={items} onDetails={setSelected} onEntity={showEntity} onActor={showActor} onEvent={(id) => updateFilter({ event_id: String(id) })} />}
              {availability.state === "available" && total > 0 ? <nav className="pagination" aria-label="Pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>← Newer</button><span>Page <b>{page}</b> of {pages}</span><button type="button" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Older →</button></nav> : null}
            </section>
          </div> : view === "entities" ? <EntityDirectory entities={entities} loading={loading} onSelect={showEntityType} /> : view === "actors" ? <ActorDirectory actors={actors} loading={loading} onSelect={showActor} /> : <HealthView availability={availability} entities={entities} actors={actors} total={total} />}
        </div>
      </main>
      {filterOpen ? <button className="filter-backdrop" type="button" onClick={() => setFilterOpen(false)} aria-label="Close filters" /> : null}
      <DetailDrawer item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
