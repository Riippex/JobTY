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

export default function DashboardPage() {
  const {
    profiles,
    activeProfile,
    loading: profilesLoading,
    activateProfile,
    deleteProfile,
  } = useProfiles();

  const { events, isConnected, clearEvents } = useAgentFeed();

  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(
    null
  );
  const [statusLoading, setStatusLoading] = useState(true);

  // Poll agent status every 5s
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

  return (
    <div className="flex h-full" style={{ background: "var(--bg-base)" }}>
      <Sidebar
        profiles={profiles}
        activeProfile={activeProfile}
        agentStatus={currentStatus}
        loading={profilesLoading}
        onActivate={activateProfile}
        onDelete={deleteProfile}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col gap-4 p-6 overflow-y-auto">
        {/* Top row: agent status */}
        <AgentStatus
          events={events}
          status={agentStatus}
          isConnected={isConnected}
          activeProfileName={activeProfile?.name ?? null}
          onStart={handleStart}
          onStop={handleStop}
          onClearEvents={clearEvents}
        />

        {/* Bottom row: job feed */}
        <JobFeed activeProfileName={activeProfile?.name ?? null} />

        {/* Empty state when no profiles */}
        {!profilesLoading && profiles.length === 0 && (
          <div
            className="fixed inset-0 flex items-center justify-center pointer-events-none"
            style={{ left: "240px" }}
          >
            <div className="text-center pointer-events-auto">
              <p className="text-4xl mb-4">🤖</p>
              <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                Welcome to JobTY
              </h2>
              <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--text-secondary)" }}>
                Your AI job agent is ready. Start by creating a profile and uploading your CV.
              </p>
              <a
                href="/setup"
                className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: "var(--accent)", color: "black" }}
              >
                Create your first profile
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
