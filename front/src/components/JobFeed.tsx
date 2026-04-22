"use client";

import { useCallback, useEffect, useState } from "react";
import type { Job } from "@/lib/api";
import { fetchJobs } from "@/lib/api";
import CompanyCard from "./CompanyCard";

type FilterType = "all" | "applied" | "skipped" | "pending" | "error";

interface JobFeedProps {
  activeProfileName: string | null;
}

function ScoreBadge({ score }: { score: number }) {
  let colorClass = "text-red-400 bg-red-500/10";
  if (score >= 70) colorClass = "text-green-400 bg-green-500/10";
  else if (score >= 45) colorClass = "text-yellow-400 bg-yellow-500/10";

  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colorClass}`}>
      {score}
    </span>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const styles: Record<Job["status"], string> = {
    applied: "text-green-400 bg-green-500/10",
    skipped: "text-orange-400 bg-orange-500/10",
    pending: "text-neutral-400 bg-neutral-500/10",
    error: "text-red-400 bg-red-500/10",
  };

  return (
    <span
      className={`text-xs capitalize px-2 py-0.5 rounded-full ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default function JobFeed({ activeProfileName }: JobFeedProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const load = useCallback(async () => {
    if (!activeProfileName) {
      setJobs([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJobs(activeProfileName);
      setJobs(data);
    } catch (err) {
      // 404 is expected if /jobs endpoint isn't implemented yet
      if (err instanceof Error && err.message.startsWith("404")) {
        setJobs([]);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      }
    } finally {
      setLoading(false);
    }
  }, [activeProfileName]);

  useEffect(() => {
    void load();
  }, [load]);

  const filters: FilterType[] = ["all", "applied", "skipped", "pending", "error"];

  const filtered =
    filter === "all" ? jobs : jobs.filter((j) => j.status === filter);

  if (!activeProfileName) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border py-16 text-center"
        style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
      >
        <p className="text-2xl mb-3">👤</p>
        <p className="font-medium" style={{ color: "var(--text-primary)" }}>
          No active profile
        </p>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Select or create a profile to see job activity
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col rounded-xl border"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
      }}
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
          onClick={() => void load()}
          className="text-xs px-2 py-1 rounded transition-colors hover:bg-neutral-700"
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
          const count =
            f === "all"
              ? jobs.length
              : jobs.filter((j) => j.status === f).length;
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium capitalize transition-colors whitespace-nowrap"
              style={
                isActive
                  ? { background: "rgba(34,197,94,0.15)", color: "var(--accent)" }
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
          <div className="px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <p className="text-2xl mb-3">
              {filter === "applied" ? "📋" : filter === "skipped" ? "⏭" : "🔍"}
            </p>
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>
              {jobs.length === 0 ? "No jobs yet" : `No ${filter} jobs`}
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {jobs.length === 0
                ? "Start the agent to begin finding and applying to jobs"
                : `Switch to a different filter to see results`}
            </p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((job) => (
              <li
                key={job.id}
                className="px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
                onClick={() =>
                  setSelectedJob(selectedJob?.id === job.id ? null : job)
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {job.title}
                      </p>
                      <ScoreBadge score={job.score} />
                    </div>
                    <p
                      className="text-xs mt-0.5 truncate"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {job.company}
                    </p>
                    {job.reason && (
                      <p
                        className="text-xs mt-1 line-clamp-2"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {job.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusBadge status={job.status} />
                    {job.applied_at && (
                      <span
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {new Date(job.applied_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded company card */}
                {selectedJob?.id === job.id && (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <CompanyCard
                      company={job.company}
                      jobUrl={job.url}
                      jobTitle={job.title}
                    />
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
