"use client";

import { useEffect, useState } from "react";
import { useProfiles } from "@/hooks/useProfiles";
import { useAgentFeed } from "@/hooks/useAgentFeed";
import {
  fetchAgentStatus,
  startAgent,
  stopAgent,
  type AgentStatusResponse,
} from "@/lib/api";
import Sidebar from "@/components/Sidebar";
import AgentStatus from "@/components/AgentStatus";
import JobFeed from "@/components/JobFeed";
import ProfileEditModal from "@/components/ProfileEditModal";
import type { Profile } from "@/lib/api";

// ── SVG icons ────────────────────────────────────────────────────────────────

function IconRobot() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <circle cx="36" cy="44" r="26" fill="var(--accent-glow)" />
      {/* Head */}
      <rect x="18" y="14" width="36" height="26" rx="7"
        fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.5" />
      {/* Antenna */}
      <line x1="36" y1="14" x2="36" y2="7" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.7" />
      <circle cx="36" cy="5" r="3.5" fill="var(--accent)" opacity="0.9" />
      {/* Eyes */}
      <rect x="22" y="20" width="10" height="7" rx="2.5" fill="var(--accent)" opacity="0.85" />
      <rect x="40" y="20" width="10" height="7" rx="2.5" fill="var(--accent)" opacity="0.85" />
      {/* Mouth */}
      <rect x="25" y="32" width="22" height="3" rx="1.5" fill="var(--accent)" opacity="0.2" />
      {/* Body */}
      <rect x="14" y="42" width="44" height="24" rx="8"
        fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.4" />
      {/* Chest panel */}
      <rect x="22" y="48" width="28" height="12" rx="4"
        fill="var(--accent-glow)" stroke="var(--accent)" strokeWidth="1" strokeOpacity="0.3" />
      {/* Status light */}
      <circle cx="36" cy="54" r="3.5" fill="var(--accent)" opacity="0.85" />
      {/* Arms */}
      <rect x="4" y="44" width="10" height="7" rx="3.5"
        fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.35" />
      <rect x="58" y="44" width="10" height="7" rx="3.5"
        fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.35" />
    </svg>
  );
}

function IconUserStep() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.866 3.582-7 8-7s8 3.134 8 7" />
    </svg>
  );
}

function IconDocumentStep() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function IconSparkStep() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

// ── Welcome screen ────────────────────────────────────────────────────────────

const STEPS = [
  {
    icon: <IconUserStep />,
    title: "Create a profile",
    desc: "Set your job title, location, and preferences",
  },
  {
    icon: <IconDocumentStep />,
    title: "Upload your CV",
    desc: "AI parses your skills and experience automatically",
  },
  {
    icon: <IconSparkStep />,
    title: "Start the agent",
    desc: "Sit back while it finds and applies to jobs for you",
  },
];

function WelcomeScreen() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center text-center max-w-sm w-full">
        <IconRobot />

        <h2 className="text-2xl font-bold mt-6 mb-2 gradient-text">
          Welcome to JobTY
        </h2>
        <p className="text-sm mb-10 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Your AI job agent is ready. Create a profile to get started.
        </p>

        <div className="grid grid-cols-3 gap-3 w-full mb-10">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-2.5 p-4 rounded-xl border"
              style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--accent-glow)", border: "1px solid rgba(59,130,246,0.2)" }}
              >
                {step.icon}
              </div>
              <p className="text-xs font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>
                {step.title}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {step.desc}
              </p>
            </div>
          ))}
        </div>

        <a
          href="/setup"
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-85"
          style={{ background: "var(--gradient-brand)" }}
        >
          Create your first profile →
        </a>
      </div>
    </div>
  );
}

// ── Dashboard page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    profiles,
    activeProfile,
    loading: profilesLoading,
    activateProfile,
    deleteProfile,
    refresh,
  } = useProfiles();

  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  const { events, isConnected, clearEvents } = useAgentFeed();

  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function pollStatus() {
      try {
        const s = await fetchAgentStatus();
        if (!cancelled) setAgentStatus(s);
      } catch {
        // Backend may not be running during dev
      } finally {
        if (!cancelled) setStatusLoading(false);
      }
    }

    void pollStatus();
    const interval = setInterval(() => void pollStatus(), 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleStart(profileName: string) {
    await startAgent(profileName);
    const s = await fetchAgentStatus();
    setAgentStatus(s);
  }

  async function handleStop() {
    await stopAgent();
    const s = await fetchAgentStatus();
    setAgentStatus(s);
  }

  const currentStatus = agentStatus?.status ?? "idle";
  const showWelcome = !profilesLoading && profiles.length === 0;

  // Suppress unused warning — statusLoading used for future skeleton state
  void statusLoading;

  return (
    <div className="flex h-full" style={{ background: "var(--bg-base)" }}>
      <Sidebar
        profiles={profiles}
        activeProfile={activeProfile}
        agentStatus={currentStatus}
        loading={profilesLoading}
        onActivate={activateProfile}
        onDelete={deleteProfile}
        onEdit={setEditingProfile}
      />

      <main className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto">
        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <>
            <AgentStatus
              events={events}
              status={agentStatus}
              isConnected={isConnected}
              activeProfileName={activeProfile?.name ?? null}
              onStart={handleStart}
              onStop={handleStop}
              onClearEvents={clearEvents}
            />
            <JobFeed activeProfileName={activeProfile?.name ?? null} />
          </>
        )}
      </main>

      {editingProfile && (
        <ProfileEditModal
          profile={editingProfile}
          onClose={() => setEditingProfile(null)}
          onSaved={async () => { await refresh(); }}
        />
      )}
    </div>
  );
}
