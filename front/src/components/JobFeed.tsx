"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchJobs, type Job, type JobStatus } from "@/lib/api";
import CompanyCard from "./CompanyCard";

type FilterType = "all" | JobStatus;

interface JobFeedProps {
  activeProfileName: string | null;
  refreshKey?: number;
}

interface FeedState {
  requestKey: string | null;
  jobs: Job[];
  error: string | null;
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconPerson() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.866 3.582-7 8-7s8 3.134 8 7" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconSkip() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full text-neutral-400 bg-neutral-500/10">
        Unscored
      </span>
    );
  }

  let colorClass = "text-red-400 bg-red-500/10";
  if (score >= 70) colorClass = "text-green-400 bg-green-500/10";
  else if (score >= 45) colorClass = "text-yellow-400 bg-yellow-500/10";

  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    applied: "text-green-400 bg-green-500/10",
    skipped: "text-orange-400 bg-orange-500/10",
    pending: "text-neutral-400 bg-neutral-500/10",
    error: "text-red-400 bg-red-500/10",
  };

  return (
    <span className={`text-xs capitalize px-2 py-0.5 rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
}

function formatJobsError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      if (err.message === "Not Found" || err.message.startsWith("404 ")) {
        return "Jobs API unavailable (404): could not load job history.";
      }
      return err.message;
    }
    return `Failed to load jobs (${err.status}): ${err.message}`;
  }
  return err instanceof Error ? err.message : "Failed to load jobs";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function JobFeed({ activeProfileName, refreshKey = 0 }: JobFeedProps) {
  const [manualRefresh, setManualRefresh] = useState(0);
  const [state, setState] = useState<FeedState>({
    requestKey: null,
    jobs: [],
    error: null,
  });
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const requestKey = activeProfileName
    ? `${activeProfileName}:${refreshKey}:${manualRefresh}`
    : null;

  useEffect(() => {
    if (!activeProfileName || !requestKey) return;

    let cancelled = false;
    fetchJobs(activeProfileName)
      .then((data) => {
        if (!cancelled) {
          setState({ requestKey, jobs: data, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ requestKey, jobs: [], error: formatJobsError(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProfileName, requestKey]);

  const loading = requestKey !== null && state.requestKey !== requestKey;
  const jobs = requestKey !== null && state.requestKey === requestKey ? state.jobs : [];
  const error = requestKey !== null && state.requestKey === requestKey ? state.error : null;

  const filters: FilterType[] = ["all", "applied", "skipped", "pending", "error"];
  const filtered = filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  if (!activeProfileName) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border py-16 text-center"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <span style={{ color: "var(--text-muted)" }} className="mb-3">
          <IconPerson />
        </span>
        <p className="font-medium" style={{ color: "var(--text-primary)" }}>
          No active profile
        </p>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Select or create a profile to see job activity
        </p>
      </div>
    );
  }

  function filterEmptyIcon() {
    if (filter === "applied") return <IconClipboard />;
    if (filter === "skipped") return <IconSkip />;
    return <IconSearch />;
  }

  return (
    <div
      className="flex flex-col rounded-xl border"
      style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Job Activity
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
          >
            {activeProfileName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setManualRefresh((c) => c + 1)}
          className="text-xs px-2 py-1 rounded transition-colors hover:bg-(--hover-bg-strong)"
          style={{ color: "var(--text-muted)" }}
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div
        className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto"
        style={{ borderColor: "var(--border)" }}
      >
        {filters.map((f) => {
          const count = f === "all" ? jobs.length : jobs.filter((j) => j.status === f).length;
          const isActive = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium capitalize transition-colors whitespace-nowrap"
              style={
                isActive
                  ? { background: "var(--accent-glow)", color: "var(--accent-light)" }
                  : { color: "var(--text-secondary)", background: "transparent" }
              }
            >
              {f} {count > 0 && <span className="opacity-60">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: "480px" }}>
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div
              className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
            />
          </div>
        )}

        {!loading && error && (
          <div className="px-4 py-4 flex items-center justify-between gap-3 text-sm text-red-400">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setManualRefresh((c) => c + 1)}
              className="text-xs px-2.5 py-1 rounded border border-red-500/30 hover:bg-red-500/10 shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <span style={{ color: "var(--text-muted)" }} className="mb-3">
              {filterEmptyIcon()}
            </span>
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>
              {jobs.length === 0 ? "No jobs yet" : `No ${filter} jobs`}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {jobs.length === 0
                ? "Start the agent to begin finding and applying to jobs"
                : "Switch to a different filter to see results"}
            </p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((job) => (
              <li
                key={job.id}
                className="px-4 py-3 hover:bg-(--hover-bg) transition-colors cursor-pointer"
                onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                        {job.title}
                      </p>
                      <ScoreBadge score={job.score} />
                    </div>
                    <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {job.company || "Unknown company"}
                    </p>
                    {job.reason && (
                      <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                        {job.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusBadge status={job.status} />
                    {job.applied_at && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {new Date(job.applied_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>

                {selectedJobId === job.id && (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <CompanyCard company={job.company} jobUrl={job.url} jobTitle={job.title} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
