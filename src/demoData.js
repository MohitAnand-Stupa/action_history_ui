const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

const people = {
  mohit: { user_role_id: 42, name: "Mohit Anand", role: "Admin" },
  rahul: { user_role_id: 51, name: "Rahul Sharma", role: "Organizer" },
  priya: { user_role_id: 77, name: "Priya Verma", role: "Player" },
};

const agents = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15",
  android: "okhttp/4.12.0 StupaApp/5.2 (Android 14)",
};

const row = (value) => ({ status: 200, entity: null, effects: [], ...value });

export const demoItems = [
  row({
    id: 1204,
    created_at: minutesAgo(4),
    created_by: 42,
    user: people.mohit,
    action: "STAGE_DELETED",
    event_id: 2582,
    entity_type: "stages",
    entity_id: 77,
    entity: { type: "stages", id: 77, name: "Group A" },
    effects: [
      { type: "stages", op: "DELETED", count: 1, id: 77, name: "Group A", soft: true },
      { type: "event_categories", op: "UPDATED", count: 1, id: 310, name: "Men Singles", fields: ["meta"] },
      { type: "participants", op: "UPDATED", count: 24, ids: [9001, 9002], fields: ["is_elite", "is_excluded"] },
      { type: "stage_participants", op: "DELETED", count: 24, soft: true },
      { type: "standings", op: "DELETED", count: 3 },
      { type: "rule_settings", op: "DELETED", count: 1, id: 55 },
    ],
    meta: { route: "PUT /stage/v1/update_stage", request_id: "a1b2c3d4e5f6", ip: "49.36.12.8", agent: agents.chrome, source: "web", body: { is_deleted: true } },
  }),
  row({
    id: 1198,
    created_at: minutesAgo(11),
    created_by: 42,
    user: people.mohit,
    action: "EVENT_UPDATED",
    event_id: 2582,
    entity_type: "events",
    entity_id: 2582,
    entity: { type: "events", id: 2582, name: "State Open 2026" },
    effects: [{ type: "events", op: "UPDATED", count: 1, id: 2582, name: "State Open 2026", fields: ["name", "event_start_date"] }],
    meta: { route: "PUT /event/v1/update_event", request_id: "9f8e7d6c5b4a", ip: "49.36.12.8", agent: agents.chrome, source: "web", body: { name: "State Open 2026", event_start_date: "2026-11-02T00:00:00" } },
  }),
  row({
    id: 1190,
    created_at: minutesAgo(26),
    created_by: 51,
    user: people.rahul,
    action: "FIXTURES_DELETED",
    event_id: 2582,
    status: 400,
    entity_type: "stages",
    entity_id: 77,
    entity: { type: "stages", id: 77, name: "Group A" },
    meta: { route: "POST /fixture/v1/delete_fixtures", request_id: "0c1d2e3f4a5b", ip: "157.48.20.11", agent: agents.safari, source: "web" },
  }),
  row({
    id: 1186,
    created_at: minutesAgo(30),
    created_by: 51,
    user: people.rahul,
    action: "AUTO_ASSIGN_MATCH_SLOTS",
    event_id: 2582,
    entity_type: "matches",
    entity: { type: "matches" },
    effects: [{ type: "matches", op: "UPDATED", count: 3, ids: [1501, 1502, 1503], fields: ["court_id", "start_time"] }],
    meta: { route: "POST /planner/v1/auto_assign_match_slots", request_id: "51075107aaaa", ip: "157.48.20.11", agent: agents.safari, source: "web", body: { event_id: 2582, date: "2026-10-10" } },
  }),
  row({
    id: 1182,
    created_at: minutesAgo(35),
    created_by: 51,
    user: people.rahul,
    action: "UPSERT_STAGE_PARTICIPANTS",
    event_id: 2582,
    entity_type: "stage_participants",
    entity: { type: "stage_participants" },
    effects: [
      { type: "stage_participants", op: "CREATED", count: 2, ids: [801, 802] },
      { type: "stages", op: "UPDATED", count: 1, id: 77, name: "Group A", fields: ["expected_participants"] },
    ],
    meta: { route: "POST /stage/v1/upsert_stage_participants", request_id: "c0ffee000001", ip: "157.48.20.11", agent: agents.safari, source: "web", body: { stage_id: 77, participants: "<list of 2>", _truncated: true } },
  }),
  row({
    id: 1176,
    created_at: minutesAgo(48),
    created_by: 77,
    user: people.priya,
    action: "REGISTER_EVENT_PARTICIPANTS",
    event_id: 2582,
    entity_type: "participants",
    entity: { type: "participants" },
    effects: [
      { type: "participants", op: "CREATED", count: 2, ids: [9101, 9102] },
      { type: "participant_parents", op: "CREATED", count: 2 },
    ],
    meta: { route: "POST /registration/v1/register_event_participants", request_id: "77aa88bb99cc", ip: "106.51.3.42", agent: agents.android, source: "app", body: { event_id: 2582, category_id: 12, participants: "<list of 2>", _truncated: true } },
  }),
  row({
    id: 1150,
    created_at: minutesAgo(95),
    created_by: 51,
    user: people.rahul,
    action: "STAGE_CREATED",
    event_id: 2582,
    entity_type: "stages",
    entity_id: 77,
    entity: { type: "stages", id: 77, name: "Group A" },
    effects: [
      { type: "stages", op: "CREATED", count: 1, id: 77, name: "Group A" },
      { type: "rule_settings", op: "CREATED", count: 1, id: 55 },
    ],
    meta: { route: "POST /stage/v1/create_stage", request_id: "5e5e5e5e5e5e", ip: "157.48.20.11", agent: agents.safari, source: "web", body: { event_category_id: 310, name: "Group A", order: 1 } },
  }),
  row({
    id: 1102,
    created_at: minutesAgo(60 * 26),
    created_by: 42,
    user: people.mohit,
    action: "EVENT_CREATED",
    event_id: 2582,
    entity_type: "events",
    entity_id: 2582,
    entity: { type: "events", id: 2582, name: "State Open" },
    effects: [
      { type: "events", op: "CREATED", count: 1, id: 2582, name: "State Open" },
      { type: "event_categories", op: "CREATED", count: 4, ids: [310, 311, 312, 313] },
    ],
    meta: { route: "POST /event/v1/create_event", request_id: "abcabcabcabc", ip: "49.36.12.8", agent: agents.chrome, source: "web", body: { name: "State Open", sport_id: 1 } },
  }),
];

export const demoActions = Object.entries(
  demoItems.reduce((counts, item) => ({ ...counts, [item.action]: (counts[item.action] || 0) + 1 }), {}),
).map(([action, count]) => ({ action, count }));

export const demoEntities = Object.entries(
  demoItems.reduce((counts, item) => {
    const type = item.entity_type || item.entity?.type;
    return type ? { ...counts, [type]: (counts[type] || 0) + 1 } : counts;
  }, {}),
).map(([entity_type, count]) => ({ entity_type, count }));

export const demoActors = Object.values(demoItems.reduce((actors, item) => {
  if (item.created_by == null) return actors;
  const current = actors[item.created_by] || {
    created_by: item.created_by,
    user: item.user,
    count: 0,
    failed_count: 0,
    last_seen: item.created_at,
  };
  current.count += 1;
  current.failed_count += item.status >= 400 ? 1 : 0;
  if (item.created_at > current.last_seen) current.last_seen = item.created_at;
  actors[item.created_by] = current;
  return actors;
}, {})).sort((first, second) => second.count - first.count);
