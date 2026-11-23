export type AgentRunStatus = "idle" | "running" | "stopping" | "stopped" | "error";

export type AgentEvent =
  | {
      event: "status";
      status: AgentRunStatus;
      jobs_applied: number;
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "applying";
      title: string;
      company: string;
      url: string;
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "scored";
      title: string;
      company: string;
      url: string;
      score: number | null;
      recommendation: string;
      reasons: string[];
      concerns: string[];
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "done";
      applied: number;
      skipped: number;
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "error";
      msg: string;
      retrying: boolean;
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "job_found";
      title: string;
      company: string;
      url: string;
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "applied";
      company: string;
      title: string;
      url: string;
      score: number | null;
      profile: string | null;
      timestamp: string;
    }
  | {
      event: "skipped";
      company: string;
      title: string;
      url: string;
      reason: string;
      profile: string | null;
      timestamp: string;
    };

// Raw envelope from the backend: { type, profile?, data, timestamp }
export interface WsEnvelope {
  type: string;
  profile?: string | null;
  data: Record<string, unknown>;
  timestamp: string | number;
}

export interface FeedSyncState {
  events: AgentEvent[];
  eventSeq: number;
  statusSeq: number;
  globalJobsSeq: number;
  profileJobsSeq: Record<string, number>;
  reconnectSeq: number;
}

export type WebSocketLike = Pick<
  WebSocket,
  "readyState" | "onopen" | "onmessage" | "onerror" | "onclose" | "close"
>;

export interface FeedSocketControllerOptions {
  url: string;
  createSocket: (url: string) => WebSocketLike;
  onConnectionChange: (connected: boolean) => void;
  onReconnect: () => void;
  onEvent: (event: AgentEvent) => void;
  maxRetries?: number;
  scheduleTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export const MAX_EVENTS = 200;
export const MAX_RETRIES = 5;

const VALID_RUN_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "running",
  "stopping",
  "stopped",
  "error",
]);

export function buildWebSocketUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const withWsScheme = trimmed
    .replace(/^https:\/\//i, "wss://")
    .replace(/^http:\/\//i, "ws://");
  const withoutTrailingWs = withWsScheme.replace(/(?:\/ws)+$/i, "");
  return `${withoutTrailingWs}/ws`;
}

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTimestamp(raw: unknown): string {
  if (typeof raw === "string" && raw.trim()) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

function extractProfile(env: WsEnvelope): string | null {
  if (typeof env.profile === "string" && env.profile.trim()) return env.profile;
  const fromData = env.data?.["profile"];
  if (typeof fromData === "string" && fromData.trim()) return fromData;
  return null;
}

export function envelopeToEvent(env: WsEnvelope): AgentEvent | null {
  const d = env.data ?? {};
  const timestamp = normalizeTimestamp(env.timestamp);
  const profile = extractProfile(env);

  switch (env.type) {
    case "status": {
      const rawStatus = str(d["status"]);
      const status: AgentRunStatus = VALID_RUN_STATUSES.has(rawStatus)
        ? (rawStatus as AgentRunStatus)
        : "idle";
      return {
        event: "status",
        status,
        jobs_applied: num(d["jobs_applied"]),
        profile,
        timestamp,
      };
    }
    case "applying":
      return {
        event: "applying",
        title: str(d["title"]),
        company: str(d["company"]),
        url: str(d["url"]),
        profile,
        timestamp,
      };
    case "scored":
    case "job_scored":
      return {
        event: "scored",
        title: str(d["title"]),
        company: str(d["company"]),
        url: str(d["url"]),
        score: nullableNum(d["score"]),
        recommendation: str(d["recommendation"]),
        reasons: Array.isArray(d["reasons"]) ? d["reasons"].map(String) : [],
        concerns: Array.isArray(d["concerns"]) ? d["concerns"].map(String) : [],
        profile,
        timestamp,
      };
    case "done":
      return {
        event: "done",
        applied: num(d["applied"]),
        skipped: num(d["skipped"]),
        profile,
        timestamp,
      };
    case "error":
      return {
        event: "error",
        msg: str(d["msg"] ?? d["message"]),
        retrying: Boolean(d["retrying"]),
        profile,
        timestamp,
      };
    case "job_found":
      return {
        event: "job_found",
        title: str(d["title"]),
        company: str(d["company"]),
        url: str(d["url"]),
        profile,
        timestamp,
      };
    case "applied":
      return {
        event: "applied",
        company: str(d["company"]),
        title: str(d["title"]),
        url: str(d["url"]),
        score: nullableNum(d["score"]),
        profile,
        timestamp,
      };
    case "skipped":
      return {
        event: "skipped",
        company: str(d["company"]),
        title: str(d["title"]),
        url: str(d["url"]),
        reason: str(d["reason"]),
        profile,
        timestamp,
      };
    default:
      if (d["event"]) return d as unknown as AgentEvent;
      return null;
  }
}

export function parseRawFeedMessage(rawPayload: unknown): AgentEvent | null {
  if (typeof rawPayload !== "string") return null;
  try {
    const raw: unknown = JSON.parse(rawPayload);
    if (raw && typeof raw === "object" && "type" in raw) {
      return envelopeToEvent(raw as WsEnvelope);
    }
    if (raw && typeof raw === "object" && "event" in raw) {
      return raw as AgentEvent;
    }
  } catch {
    // Ignore malformed messages
  }
  return null;
}

export function createInitialFeedState(): FeedSyncState {
  return {
    events: [],
    eventSeq: 0,
    statusSeq: 0,
    globalJobsSeq: 0,
    profileJobsSeq: {},
    reconnectSeq: 0,
  };
}

export function isJobsRefreshEvent(ev: AgentEvent): boolean {
  return (
    ev.event === "applied" ||
    ev.event === "scored" ||
    ev.event === "done" ||
    (ev.event === "status" && (ev.status === "stopped" || ev.status === "error"))
  );
}

export function applyFeedEvent(
  state: FeedSyncState,
  ev: AgentEvent,
  maxEvents: number = MAX_EVENTS
): FeedSyncState {
  const appended = [...state.events, ev];
  const nextEvents =
    appended.length > maxEvents ? appended.slice(-maxEvents) : appended;

  let globalJobsSeq = state.globalJobsSeq;
  let profileJobsSeq = state.profileJobsSeq;

  if (isJobsRefreshEvent(ev)) {
    if (ev.profile === null) {
      globalJobsSeq += 1;
    } else {
      profileJobsSeq = {
        ...state.profileJobsSeq,
        [ev.profile]: (state.profileJobsSeq[ev.profile] ?? 0) + 1,
      };
    }
  }

  return {
    events: nextEvents,
    eventSeq: state.eventSeq + 1,
    statusSeq: ev.event === "status" ? state.statusSeq + 1 : state.statusSeq,
    globalJobsSeq,
    profileJobsSeq,
    reconnectSeq: state.reconnectSeq,
  };
}

export function applyFeedReconnect(state: FeedSyncState): FeedSyncState {
  return {
    ...state,
    reconnectSeq: state.reconnectSeq + 1,
  };
}

export function clearFeedEvents(state: FeedSyncState): FeedSyncState {
  if (state.events.length === 0) return state;
  return {
    ...state,
    events: [],
  };
}

export function getProfileJobsRefreshKey(
  state: FeedSyncState,
  activeProfileName: string | null
): number {
  if (!activeProfileName) return 0;
  return (
    (state.profileJobsSeq[activeProfileName] ?? 0) +
    state.globalJobsSeq +
    state.reconnectSeq
  );
}

export function getStatusRefreshKey(state: FeedSyncState): number {
  return state.statusSeq + state.reconnectSeq;
}

export function connectAgentFeedSocket(
  options: FeedSocketControllerOptions
): () => void {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const scheduleTimer = options.scheduleTimer ?? setTimeout;
  const cancelTimer = options.cancelTimer ?? clearTimeout;

  let disposed = false;
  let hasConnectedOnce = false;
  let retries = 0;
  let ws: WebSocketLike | null = null;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (disposed) return;
    if (ws && ws.readyState < 2) return;

    const socket = options.createSocket(options.url);
    ws = socket;

    socket.onopen = () => {
      if (disposed) {
        socket.close();
        return;
      }
      const isReconnect = hasConnectedOnce || retries > 0;
      hasConnectedOnce = true;
      retries = 0;
      options.onConnectionChange(true);
      if (isReconnect) {
        options.onReconnect();
      }
    };

    socket.onmessage = (evt) => {
      if (disposed) return;
      const agentEvent = parseRawFeedMessage(evt.data);
      if (agentEvent) {
        options.onEvent(agentEvent);
      }
    };

    socket.onerror = () => {
      // onerror always fires before onclose — let onclose handle reconnect
    };

    socket.onclose = () => {
      if (disposed) return;
      options.onConnectionChange(false);
      if (ws === socket) {
        ws = null;
      }

      if (retries < maxRetries) {
        const delay = Math.min(1000 * 2 ** retries, 30000);
        retries += 1;
        backoffTimer = scheduleTimer(connect, delay);
      }
    };
  }

  connect();

  return () => {
    disposed = true;
    if (backoffTimer !== null) {
      cancelTimer(backoffTimer);
      backoffTimer = null;
    }
    ws?.close();
    ws = null;
  };
}
