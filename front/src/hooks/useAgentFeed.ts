"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentRunStatus, WS_URL, buildWebSocketUrl } from "@/lib/api";

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

const VALID_RUN_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "running",
  "stopping",
  "stopped",
  "error",
]);

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
  const fromData = env.data["profile"];
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

const MAX_RETRIES = 5;
const MAX_EVENTS = 200;

export interface UseAgentFeedResult {
  events: AgentEvent[];
  isConnected: boolean;
  clearEvents: () => void;
}

export function useAgentFeed(): UseAgentFeedResult {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const backoffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      if (wsRef.current && wsRef.current.readyState < 2) return; // already open/connecting

      const url = buildWebSocketUrl(WS_URL);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) {
          ws.close();
          return;
        }
        setIsConnected(true);
        retriesRef.current = 0;
      };

      ws.onmessage = (evt: MessageEvent) => {
        try {
          const raw: unknown = JSON.parse(evt.data as string);
          let agentEvent: AgentEvent | null = null;

          // Backend sends { type, profile, data, timestamp }
          if (raw && typeof raw === "object" && "type" in raw) {
            agentEvent = envelopeToEvent(raw as WsEnvelope);
          } else if (raw && typeof raw === "object" && "event" in raw) {
            // Direct AgentEvent format
            agentEvent = raw as AgentEvent;
          }

          if (agentEvent) {
            setEvents((prev) => {
              const next = [...prev, agentEvent];
              return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        // onerror always fires before onclose — let onclose handle reconnect
      };

      ws.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        wsRef.current = null;

        if (retriesRef.current < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
          retriesRef.current += 1;
          backoffTimerRef.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, isConnected, clearEvents };
}
