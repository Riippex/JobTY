"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

interface CompanyResearch {
  company: string;
  summary: string;
  culture: string[];
  tech_stack: string[];
  red_flags: string[];
  glassdoor_rating?: number;
  size?: string;
  industry?: string;
}

interface CompanyCardProps {
  company: string;
  jobUrl?: string;
  jobTitle?: string;
}

export default function CompanyCard({
  company,
  jobUrl,
  jobTitle,
}: CompanyCardProps) {
  const [research, setResearch] = useState<CompanyResearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!company) return;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ company });
    if (jobUrl) params.set("job_url", jobUrl);

    fetch(`${API_URL}/companies/research?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<CompanyResearch>;
      })
      .then(setResearch)
      .catch((err: unknown) => {
        // 404 = researcher not implemented yet, show basic info
        if (err instanceof Error && err.message === "404") {
          setResearch({
            company,
            summary: "Company research not yet available.",
            culture: [],
            tech_stack: [],
            red_flags: [],
          });
        } else {
          setError("Could not load company research");
        }
      })
      .finally(() => setLoading(false));
  }, [company, jobUrl]);

  if (loading) {
    return (
      <div
        className="rounded-lg border p-3 flex items-center gap-2"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        <div
          className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin shrink-0"
          style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
        />
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Loading company research...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-lg border p-3 text-xs text-red-400"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        {error}
      </div>
    );
  }

  if (!research) return null;

  return (
    <div
      className="rounded-lg border p-4 space-y-3"
      style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {research.company}
          </h3>
          {jobTitle && (
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              {jobTitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {research.glassdoor_rating !== undefined && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 font-medium">
              ★ {research.glassdoor_rating.toFixed(1)}
            </span>
          )}
          {research.size && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
            >
              {research.size}
            </span>
          )}
          {jobUrl && (
            <a
              href={jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-0.5 rounded-full transition-colors hover:text-green-400"
              style={{ color: "var(--text-muted)", background: "var(--bg-card)" }}
            >
              View job →
            </a>
          )}
        </div>
      </div>

      {/* Summary */}
      {research.summary && research.summary !== "Company research not yet available." && (
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {research.summary}
        </p>
      )}

      {/* Tech stack */}
      {research.tech_stack.length > 0 && (
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            Tech Stack
          </p>
          <div className="flex flex-wrap gap-1">
            {research.tech_stack.map((tech) => (
              <span
                key={tech}
                className="text-xs px-2 py-0.5 rounded-md"
                style={{
                  background: "rgba(34,197,94,0.08)",
                  color: "var(--accent)",
                  border: "1px solid rgba(34,197,94,0.2)",
                }}
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Culture */}
      {research.culture.length > 0 && (
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            Culture
          </p>
          <div className="flex flex-wrap gap-1">
            {research.culture.map((item) => (
              <span
                key={item}
                className="text-xs px-2 py-0.5 rounded-md"
                style={{
                  background: "rgba(99,102,241,0.08)",
                  color: "#818cf8",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Red flags */}
      {research.red_flags.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1.5 text-red-400">
            Red Flags
          </p>
          <ul className="space-y-1">
            {research.red_flags.map((flag) => (
              <li key={flag} className="text-xs flex items-start gap-1.5 text-red-400">
                <span className="mt-0.5 shrink-0">!</span>
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
