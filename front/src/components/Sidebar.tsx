"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/api";

interface SidebarProps {
  profiles: Profile[];
  activeProfile: Profile | null;
  agentStatus: "idle" | "running" | "stopping" | "error";
  loading: boolean;
  onActivate: (name: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}

export default function Sidebar({
  profiles,
  activeProfile,
  agentStatus,
  loading,
  onActivate,
  onDelete,
}: SidebarProps) {
  const router = useRouter();

  const statusColor: Record<string, string> = {
    idle: "bg-neutral-500",
    running: "bg-green-500",
    stopping: "bg-yellow-500",
    error: "bg-red-500",
  };

  const statusLabel: Record<string, string> = {
    idle: "Idle",
    running: "Running",
    stopping: "Stopping",
    error: "Error",
  };

  return (
    <aside
      className="flex flex-col shrink-0 w-60 border-r"
      style={{
        background: "var(--bg-card)",
        borderColor: "var(--border)",
        height: "100vh",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-5 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-xl font-bold tracking-tight"
          style={{ color: "var(--accent)" }}
        >
          JobTY
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded text-black font-semibold"
          style={{ background: "var(--accent)" }}
        >
          AI
        </span>
      </div>

      {/* Profiles */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p
          className="text-xs font-semibold uppercase tracking-widest mb-3 px-2"
          style={{ color: "var(--text-muted)" }}
        >
          Profiles
        </p>

        {loading && (
          <p className="text-xs px-2" style={{ color: "var(--text-secondary)" }}>
            Loading...
          </p>
        )}

        {!loading && profiles.length === 0 && (
          <p className="text-xs px-2" style={{ color: "var(--text-muted)" }}>
            No profiles yet
          </p>
        )}

        <ul className="space-y-1">
          {profiles.map((profile) => {
            const isActive = profile.name === activeProfile?.name;
            return (
              <li key={profile.name} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => !isActive && onActivate(profile.name)}
                  className="flex-1 min-w-0 text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
                  style={{
                    background: isActive ? "rgba(34,197,94,0.1)" : "transparent",
                    border: isActive ? "1px solid rgba(34,197,94,0.4)" : "1px solid transparent",
                    color: isActive ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  <span className="truncate font-medium">{profile.name}</span>
                  {isActive && (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--accent)" }}
                    />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete profile "${profile.name}"?`)) {
                      void onDelete(profile.name);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 shrink-0 text-xs leading-none px-1.5 py-1 rounded hover:bg-red-500/20 hover:text-red-400 transition-all"
                  style={{ color: "var(--text-muted)" }}
                  title="Delete profile"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Settings + New Profile */}
      <div
        className="px-3 py-3 border-t space-y-2"
        style={{ borderColor: "var(--border)" }}
      >
        <Link
          href="/settings"
          className="w-full text-sm font-medium py-2 px-3 rounded-lg flex items-center gap-2 transition-colors hover:bg-white/5"
          style={{ color: "var(--text-secondary)" }}
        >
          <span>⚙</span>
          <span>Settings</span>
        </Link>
        <button
          type="button"
          onClick={() => router.push("/setup")}
          className="w-full text-sm font-medium py-2 px-3 rounded-lg border border-dashed transition-colors hover:border-green-500/60 hover:text-green-400"
          style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
        >
          + New Profile
        </button>
      </div>

      {/* Agent status indicator */}
      <div
        className="px-5 py-3 border-t flex items-center gap-2"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${statusColor[agentStatus] ?? "bg-neutral-500"} ${agentStatus === "running" ? "animate-pulse" : ""}`}
        />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Agent: {statusLabel[agentStatus] ?? agentStatus}
        </span>
        {activeProfile && (
          <span
            className="text-xs truncate ml-auto"
            style={{ color: "var(--text-muted)" }}
          >
            {activeProfile.name}
          </span>
        )}
      </div>
    </aside>
  );
}
