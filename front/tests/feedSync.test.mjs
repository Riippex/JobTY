import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const feedSyncPath = path.resolve(__dirname, "../src/lib/feedSync.ts");
const source = readFileSync(feedSyncPath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const feedSync = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`
);

const {
  MAX_EVENTS,
  applyFeedConnect,
  applyFeedEvent,
  buildWebSocketUrl,
  clearFeedEvents,
  connectAgentFeedSocket,
  createInitialFeedState,
  envelopeToEvent,
  getProfileJobsRefreshKey,
  getStatusRefreshKey,
} = feedSync;

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.closed = false;
  }

  open() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  receive(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  drop() {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

/**
 * Mirrors DashboardPage + useAgentFeed + JobFeed refresh wiring:
 * whenever the active profile's jobsRefreshKey changes, /jobs is re-queried
 * automatically without any manual Refresh call.
 */
function createDashboardHarness(activeProfile, backendJobsByProfile) {
  let state = createInitialFeedState();
  let connected = false;
  const sockets = [];
  const pendingTimers = [];
  let loadedJobs = [...(backendJobsByProfile[activeProfile] ?? [])];
  let fetchCount = 1; // initial mount fetch
  let lastSeenRefreshKey = getProfileJobsRefreshKey(state, activeProfile);

  function syncJobFeed() {
    const nextKey = getProfileJobsRefreshKey(state, activeProfile);
    if (nextKey !== lastSeenRefreshKey) {
      lastSeenRefreshKey = nextKey;
      fetchCount += 1;
      loadedJobs = [...(backendJobsByProfile[activeProfile] ?? [])];
    }
  }

  const dispose = connectAgentFeedSocket({
    url: buildWebSocketUrl("ws://localhost:8000/ws"),
    createSocket: (url) => {
      const ws = new FakeWebSocket(url);
      sockets.push(ws);
      return ws;
    },
    onConnectionChange: (isConn) => {
      connected = isConn;
    },
    onConnect: () => {
      state = applyFeedConnect(state);
      syncJobFeed();
    },
    onEvent: (ev) => {
      state = applyFeedEvent(state, ev);
      syncJobFeed();
    },
    scheduleTimer: (fn, delayMs) => {
      const handle = { fn, delayMs, cancelled: false };
      pendingTimers.push(handle);
      return handle;
    },
    cancelTimer: (handle) => {
      handle.cancelled = true;
    },
  });

  return {
    get state() {
      return state;
    },
    get connected() {
      return connected;
    },
    get sockets() {
      return sockets;
    },
    get loadedJobs() {
      return loadedJobs;
    },
    get fetchCount() {
      return fetchCount;
    },
    flushNextTimer() {
      const next = pendingTimers.find((t) => !t.cancelled);
      assert.ok(next, "Expected a scheduled reconnect timer");
      next.cancelled = true;
      next.fn();
    },
    dispose,
  };
}

test("buildWebSocketUrl normalizes base URL to a single /ws suffix", () => {
  const cases = [
    ["ws://localhost:8000", "ws://localhost:8000/ws"],
    ["ws://localhost:8000/", "ws://localhost:8000/ws"],
    ["ws://localhost:8000/ws", "ws://localhost:8000/ws"],
    ["ws://localhost:8000/ws/", "ws://localhost:8000/ws"],
    ["ws://localhost:8000/ws/ws", "ws://localhost:8000/ws"],
    ["https://example.com/api", "wss://example.com/api/ws"],
    ["http://localhost:8000/ws", "ws://localhost:8000/ws"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(buildWebSocketUrl(input), expected, `Failed for ${input}`);
  }
});

test("envelopeToEvent preserves ISO timestamps, profile context, status events, and nullable score", () => {
  const scored = envelopeToEvent({
    type: "job_scored",
    profile: "alice",
    data: {
      title: "Backend Engineer",
      company: "Acme",
      url: "https://example.com/1",
      score: null,
      recommendation: "maybe",
      reasons: [],
      concerns: ["Missing CV"],
    },
    timestamp: "2026-11-23T22:00:00+00:00",
  });
  assert.equal(scored.event, "scored");
  assert.equal(scored.score, null);
  assert.equal(scored.profile, "alice");
  assert.equal(scored.timestamp, "2026-11-23T22:00:00+00:00");

  const statusEv = envelopeToEvent({
    type: "status",
    data: { status: "stopped", jobs_applied: 3, profile: "alice" },
    timestamp: "2026-11-23T22:05:00+00:00",
  });
  assert.equal(statusEv.event, "status");
  assert.equal(statusEv.status, "stopped");
  assert.equal(statusEv.jobs_applied, 3);
  assert.equal(statusEv.profile, "alice");
});

test("Scenario 1: 201st applied event refreshes history even though event buffer stays capped at 200", () => {
  const backendStore = { alice: [] };
  const harness = createDashboardHarness("alice", backendStore);
  harness.sockets[0].open();
  const baseKey = getProfileJobsRefreshKey(harness.state, "alice");

  for (let i = 1; i <= MAX_EVENTS; i += 1) {
    backendStore.alice.push({ id: i, title: `Job ${i}`, status: "applied" });
    harness.sockets[0].receive({
      type: "applied",
      profile: "alice",
      data: {
        title: `Job ${i}`,
        company: "Acme",
        url: `https://example.com/jobs/${i}`,
        score: 85,
        profile: "alice",
      },
      timestamp: `2026-11-23T22:00:${String(i % 60).padStart(2, "0")}+00:00`,
    });
  }

  assert.equal(harness.state.events.length, MAX_EVENTS);
  assert.equal(getProfileJobsRefreshKey(harness.state, "alice"), baseKey + MAX_EVENTS);
  const fetchesAt200 = harness.fetchCount;
  assert.equal(harness.loadedJobs.length, MAX_EVENTS);

  // 201st applied event evicts oldest item from the 200-item buffer,
  // yet MUST still advance the refresh signal and refetch /jobs.
  backendStore.alice.push({ id: 201, title: "Job 201", status: "applied" });
  harness.sockets[0].receive({
    type: "applied",
    profile: "alice",
    data: {
      title: "Job 201",
      company: "Acme",
      url: "https://example.com/jobs/201",
      score: 91,
      profile: "alice",
    },
    timestamp: "2026-11-23T22:10:00+00:00",
  });

  assert.equal(harness.state.events.length, MAX_EVENTS);
  assert.equal(
    getProfileJobsRefreshKey(harness.state, "alice"),
    baseKey + MAX_EVENTS + 1
  );
  assert.equal(harness.fetchCount, fetchesAt200 + 1);
  assert.equal(harness.loadedJobs.length, 201);
  assert.equal(harness.loadedJobs.at(-1).title, "Job 201");

  harness.dispose();
});

test("Scenario 2: application saved between initial /jobs fetch and first WebSocket open appears on first open", () => {
  const backendStore = {
    alice: [{ id: 1, title: "Initial Job", status: "applied" }],
  };
  const harness = createDashboardHarness("alice", backendStore);

  // Initial /jobs fetch already completed before the WebSocket opened
  assert.equal(harness.connected, false);
  assert.equal(harness.fetchCount, 1);
  assert.equal(harness.loadedJobs.length, 1);

  // A job is persisted during the window before the first WS onopen (event missed)
  backendStore.alice.push({
    id: 2,
    title: "Saved Before First WS Open",
    status: "applied",
  });

  // First successful WS open must advance the refresh signal and re-query /jobs
  harness.sockets[0].open();

  assert.equal(harness.connected, true);
  assert.equal(harness.state.connectionSeq, 1);
  assert.equal(getProfileJobsRefreshKey(harness.state, "alice"), 1);
  assert.equal(getStatusRefreshKey(harness.state), 1);
  assert.equal(harness.fetchCount, 2);
  assert.equal(harness.loadedJobs.length, 2);
  assert.equal(harness.loadedJobs[1].title, "Saved Before First WS Open");

  harness.dispose();
});

test("Scenario 3: application saved during WebSocket disconnect appears automatically on reconnect without Refresh", () => {
  const backendStore = {
    alice: [{ id: 1, title: "Initial Job", status: "applied" }],
  };
  const harness = createDashboardHarness("alice", backendStore);

  harness.sockets[0].open();
  assert.equal(harness.connected, true);
  assert.equal(harness.state.connectionSeq, 1);
  const fetchesAfterFirstOpen = harness.fetchCount;

  // Socket drops; a new application is persisted while disconnected (no WS event emitted)
  harness.sockets[0].drop();
  assert.equal(harness.connected, false);
  backendStore.alice.push({
    id: 2,
    title: "Saved While Offline",
    status: "applied",
  });

  // Reconnect succeeds with ZERO new WebSocket messages arriving
  harness.flushNextTimer();
  assert.equal(harness.sockets.length, 2);
  harness.sockets[1].open();

  assert.equal(harness.connected, true);
  assert.equal(harness.state.connectionSeq, 2);
  assert.equal(getProfileJobsRefreshKey(harness.state, "alice"), 2);
  assert.equal(getStatusRefreshKey(harness.state), 2);
  assert.equal(harness.fetchCount, fetchesAfterFirstOpen + 1);
  assert.equal(harness.loadedJobs.length, 2);
  assert.equal(harness.loadedJobs[1].title, "Saved While Offline");

  harness.dispose();
});

test("Scenario 3b: failed initial connection followed by successful retry also refreshes history", () => {
  const backendStore = { alice: [] };
  const harness = createDashboardHarness("alice", backendStore);

  // First connect attempt fails before onopen
  harness.sockets[0].drop();
  backendStore.alice.push({
    id: 10,
    title: "Saved During Startup Retry",
    status: "applied",
  });

  harness.flushNextTimer();
  harness.sockets[1].open();

  assert.equal(harness.state.connectionSeq, 1);
  assert.equal(harness.fetchCount, 2);
  assert.equal(harness.loadedJobs.length, 1);
  assert.equal(harness.loadedJobs[0].title, "Saved During Startup Retry");

  harness.dispose();
});

test("Scenario 4: events for another profile do not refresh the active profile's history", () => {
  const backendStore = {
    alice: [{ id: 1, title: "Alice Role", status: "applied" }],
    bob: [],
  };
  const harness = createDashboardHarness("alice", backendStore);
  harness.sockets[0].open();

  const initialKey = getProfileJobsRefreshKey(harness.state, "alice");
  const initialFetches = harness.fetchCount;

  const bobEvents = [
    {
      type: "applied",
      profile: "bob",
      data: { title: "Bob Role 1", company: "OtherCo", url: "https://example.com/b1", score: 88 },
      timestamp: "2026-11-23T22:01:00+00:00",
    },
    {
      type: "job_scored",
      profile: "bob",
      data: { title: "Bob Role 2", company: "OtherCo", url: "https://example.com/b2", score: 74, recommendation: "maybe", reasons: [], concerns: [] },
      timestamp: "2026-11-23T22:02:00+00:00",
    },
    {
      type: "done",
      profile: "bob",
      data: { applied: 1, skipped: 0 },
      timestamp: "2026-11-23T22:03:00+00:00",
    },
    {
      type: "status",
      profile: "bob",
      data: { status: "stopped", jobs_applied: 1 },
      timestamp: "2026-11-23T22:04:00+00:00",
    },
  ];

  for (const ev of bobEvents) {
    harness.sockets[0].receive(ev);
  }

  assert.equal(getProfileJobsRefreshKey(harness.state, "alice"), initialKey);
  assert.equal(harness.fetchCount, initialFetches);
  assert.equal(getProfileJobsRefreshKey(harness.state, "bob"), initialKey + 4);

  harness.dispose();
});

test("Scenario 5: Object.prototype property names (constructor, toString, __proto__) stay numeric and isolated", () => {
  const specialNames = ["constructor", "toString", "__proto__", "hasOwnProperty"];
  let state = createInitialFeedState();

  for (const name of specialNames) {
    const initialKey = getProfileJobsRefreshKey(state, name);
    assert.equal(typeof initialKey, "number");
    assert.equal(initialKey, 0);
  }

  state = applyFeedEvent(state, {
    event: "applied",
    title: "Role A",
    company: "Acme",
    url: "https://example.com/a",
    score: 90,
    profile: "constructor",
    timestamp: "2026-11-23T22:00:00+00:00",
  });

  state = applyFeedEvent(state, {
    event: "applied",
    title: "Role B",
    company: "Beta",
    url: "https://example.com/b",
    score: 80,
    profile: "toString",
    timestamp: "2026-11-23T22:01:00+00:00",
  });

  state = applyFeedEvent(state, {
    event: "applied",
    title: "Role C",
    company: "Gamma",
    url: "https://example.com/c",
    score: 85,
    profile: "constructor",
    timestamp: "2026-11-23T22:02:00+00:00",
  });

  assert.strictEqual(getProfileJobsRefreshKey(state, "constructor"), 2);
  assert.strictEqual(getProfileJobsRefreshKey(state, "toString"), 1);
  assert.strictEqual(getProfileJobsRefreshKey(state, "__proto__"), 0);
  assert.strictEqual(getProfileJobsRefreshKey(state, "hasOwnProperty"), 0);
});

test("clearFeedEvents clears visual buffer without resetting monotonic refresh counters", () => {
  let state = createInitialFeedState();
  state = applyFeedEvent(state, {
    event: "applied",
    title: "Role",
    company: "Acme",
    url: "https://example.com/1",
    score: 90,
    profile: "alice",
    timestamp: "2026-11-23T22:00:00+00:00",
  });
  state = applyFeedConnect(state);

  const cleared = clearFeedEvents(state);
  assert.equal(cleared.events.length, 0);
  assert.equal(getProfileJobsRefreshKey(cleared, "alice"), 2);
  assert.equal(getStatusRefreshKey(cleared), 1);
});
