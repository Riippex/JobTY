"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/hooks/useAgentFeed";
import type { AgentStatusResponse } from "@/lib/api";

interface AgentStatusProps {
  events: AgentEvent[];
  status: AgentStatusResponse | null;
  isConnected: boolean;
  activeProfileName: string | null;
  onStart: (profileName: string) => Promise<void>;
  onStop: () => Promise<void>;
  onClearEvents: () => void;
}

function eventColor(event: AgentEvent["event"]): string {
  switch (event) {
    case "job_found":
      return "text-neutral-400";
    case "applying":
      return "text-blue-400";
    case "scored":
      return "text-yellow-400";
    case "applied":
      return "text-green-400";
    case "skipped":
      return "text-orange-400";
    case "error":
      return "text-red-400";
    case "done":
      return "text-green-300";
    default:
      return "text-neutral-400";
  }
}

function eventLabel(ev: AgentEvent): string {
  switch (ev.event) {
    case "job_found":
      return `Found: ${ev.title} at ${ev.company}`;
    case "applying":
      return `Applying to ${ev.company}`;
    case "scored":
      const reasonText = ev.reasons && ev.reasons.length > 0 ? ` — ${ev.reasons[0]}` : "";
      return `Score ${ev.score}/100 (${ev.recommendation.toUpperCase()}): ${ev.title} at ${ev.company}${reasonText}`;
    case "applied":
      return `Applied: ${ev.title} at ${ev.company}`;
    case "skipped":
      return `Skipped ${ev.company}: ${ev.reason}`;
    case "error":
      return `Error: ${ev.msg}${ev.retrying ? " (retrying)" : ""}`;
    case "done":
      return `Done — ${ev.applied} applied, ${ev.skipped} skipped`;
    default:
      return JSON.stringify(ev);
  }
}

function formatTime(ts: number): string {
  return new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AgentStatus({
  events,
  status,
  isConnected,
  activeProfileName,
  onStart,
  onStop,
  onClearEvents,
}: AgentStatusProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events]);

  const agentStatus = status?.status ?? "idle";
  const isRunning = agentStatus === "running";
  const isStopping = agentStatus === "stopping";

  const appliedCount =
    events.filter((e) => e.event === "applied").length;

  async function handleToggle() {
    setActionLoading(true);
    setActionError(null);
    try {
      if (isRunning || isStopping) {
        await onStop();
      } else {
        if (!activeProfileName) {
          setActionError("No active profile selected");
          return;
        }
        await onStart(activeProfileName);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  const statusBadgeStyle: Record<string, string> = {
    idle: "bg-neutral-800 text-neutral-400",
    running: "bg-green-500/20 text-green-400",
    stopping: "bg-yellow-500/20 text-yellow-400",
    error: "bg-red-500/20 text-red-400",
  };

  return (
    <div
      className="flex flex-col rounded-xl border"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        minHeight: 0,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Agent
          </h2>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusBadgeStyle[agentStatus] ?? "bg-neutral-800 text-neutral-400"}`}
          >
            {agentStatus}
          </span>
          <span
            className={`text-xs flex items-center gap-1 ${isConnected ? "text-green-400" : "text-neutral-500"}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-400" : "bg-neutral-500"}`}
            />
            {isConnected ? "WS connected" : "WS disconnected"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {appliedCount > 0 && (
            <span className="text-xs text-green-400 font-medium">
              {appliedCount} applied
            </span>
          )}
          {events.length > 0 && (
            <button
              onClick={onClearEvents}
              className="text-xs px-2 py-1 rounded transition-colors hover:bg-(--hover-bg-strong)"
              style={{ color: "var(--text-muted)" }}
            >
              Clear
            </button>
          )}
          <button
            onClick={() => void handleToggle()}
            disabled={actionLoading || (!activeProfileName && !isRunning)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            style={
              isRunning || isStopping
                ? { background: "rgba(239,68,68,0.15)", color: "#f87171" }
                : {
                    background: "var(--accent-glow)",
                    color: "var(--accent-light)",
                  }
            }
          >
            {actionLoading
              ? "..."
              : isRunning
              ? "Stop"
              : isStopping
              ? "Stopping..."
              : "Start"}
          </button>
        </div>
      </div>

      {/* Current job */}
      {status?.current_job && (
        <div
          className="px-4 py-2 border-b text-xs"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          Processing: <span style={{ color: "var(--text-primary)" }}>{status.current_job}</span>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div className="mx-4 mt-2 px-3 py-2 rounded-lg text-xs text-red-300 border border-red-500/30 bg-red-500/10">
          {actionError}
        </div>
      )}

      {/* Accumulated errors from status polling */}
      {status && status.errors.length > 0 && (
        <div className="mx-4 mt-2 rounded-lg border border-red-500/30 bg-red-500/8 overflow-hidden">
          <p className="px-3 py-1.5 text-xs font-semibold text-red-400 border-b border-red-500/20">
            {status.errors.length} error{status.errors.length !== 1 ? "s" : ""}
          </p>
          <ul className="px-3 py-2 space-y-1">
            {status.errors.map((e, i) => (
              <li key={i} className="text-xs text-red-300 break-all leading-relaxed">
                · {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Event feed */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1 font-mono text-xs"
        style={{ minHeight: "200px", maxHeight: "320px" }}
      >
        {events.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }} className="text-center py-8">
            {isRunning
              ? "Waiting for events..."
              : "Start the agent to see live activity here"}
          </p>
        ) : (
          events.map((ev, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded px-1.5 -mx-1.5 ${
                ev.event === "error"
                  ? "bg-red-500/10 border border-red-500/20 py-1 my-0.5"
                  : ev.event === "applied"
                  ? "bg-green-500/8"
                  : ""
              } ${eventColor(ev.event)}`}
            >
              <span className="shrink-0 mt-0.5 opacity-70">
                {"ts" in ev && ev.ts ? formatTime(ev.ts as number) : "       "}
              </span>
              <span className="shrink-0 w-3 text-center font-bold">
                {ev.event === "applied"
                  ? "✓"
                  : ev.event === "skipped"
                  ? "›"
                  : ev.event === "error"
                  ? "✗"
                  : ev.event === "done"
                  ? "■"
                  : ev.event === "scored"
                  ? "★"
                  : ev.event === "job_found"
                  ? "◎"
                  : "·"}
              </span>
              <span className="break-all leading-relaxed">{eventLabel(ev)}</span>
            </div>
          ))
        )}
      </div>

      {/* Stats footer */}
      {status && (
        <div
          className="flex items-center gap-4 px-4 py-2 border-t text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <span>Applied: <strong style={{ color: "var(--text-secondary)" }}>{status.jobs_applied}</strong></span>
          <span>
            Errors:{" "}
            <strong className={status.errors.length > 0 ? "text-red-400" : ""}>
              {status.errors.length}
            </strong>
          </span>
          {status.started_at && (
            <span className="ml-auto">
              Started {new Date(status.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
