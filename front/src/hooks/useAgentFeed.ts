"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "@/lib/api";

export type AgentEvent =
  | { event: "applying"; company: string; url: string; ts: number }
  | { event: "scored"; job_id: string; score: number; reason: string; ts?: number }
  | { event: "done"; applied: number; skipped: number; ts?: number }
  | { event: "error"; msg: string; retrying: boolean; ts: number }
  | { event: "job_found"; title: string; company: string; url: string; ts: number }
  | { event: "applied"; company: string; title: string; ts: number }
  | { event: "skipped"; company: string; title: string; reason: string; ts: number };

// Raw envelope from the backend: { type, data, timestamp }
interface WsEnvelope {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

function str(v: unknown): string {
  return v != null ? String(v) : "";
}

function num(v: unknown): number {
  return v != null ? Number(v) : 0;
}

function envelopeToEvent(env: WsEnvelope): AgentEvent | null {
  const d = env.data;
  const ts = env.timestamp;
  switch (env.type) {
    case "applying":
      return { event: "applying", company: str(d["company"]), url: str(d["url"]), ts };
    case "scored":
    case "job_scored":
      return { event: "scored", job_id: str(d["job_id"]), score: num(d["score"]), reason: str(d["reason"]), ts };
    case "done":
      return { event: "done", applied: num(d["applied"]), skipped: num(d["skipped"]) };
    case "error":
      return { event: "error", msg: str(d["msg"] ?? d["message"]), retrying: Boolean(d["retrying"]), ts };
    case "job_found":
      return { event: "job_found", title: str(d["title"]), company: str(d["company"]), url: str(d["url"]), ts };
    case "applied":
      return { event: "applied", company: str(d["company"]), title: str(d["title"]), ts };
    case "skipped":
      return { event: "skipped", company: str(d["company"]), title: str(d["title"]), reason: str(d["reason"]), ts };
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
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState < 2) return; // already open/connecting

    const url = `${WS_URL}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) { ws.close(); return; }
      setIsConnected(true);
      retriesRef.current = 0;
    };

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const raw: unknown = JSON.parse(evt.data as string);
        let agentEvent: AgentEvent | null = null;

        // Backend sends { type, data, timestamp }
        if (raw && typeof raw === "object" && "type" in raw) {
          agentEvent = envelopeToEvent(raw as WsEnvelope);
        } else if (raw && typeof raw === "object" && "event" in raw) {
          // Direct AgentEvent format
          agentEvent = raw as AgentEvent;
        }

        if (agentEvent) {
          setEvents((prev) => {
            const next = [...prev, agentEvent!];
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
      if (unmountedRef.current) return;
      setIsConnected(false);
      wsRef.current = null;

      if (retriesRef.current < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
        retriesRef.current += 1;
        backoffTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, isConnected, clearEvents };
}
