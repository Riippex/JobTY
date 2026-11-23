"use client";

import { useCallback, useEffect, useState } from "react";
import { WS_URL, buildWebSocketUrl } from "@/lib/api";
import {
  type AgentEvent,
  type FeedSyncState,
  type WsEnvelope,
  applyFeedEvent,
  applyFeedReconnect,
  clearFeedEvents,
  connectAgentFeedSocket,
  createInitialFeedState,
  envelopeToEvent,
  getProfileJobsRefreshKey,
  getStatusRefreshKey,
} from "@/lib/feedSync";

export type { AgentEvent, WsEnvelope };
export { envelopeToEvent };

export interface UseAgentFeedResult {
  events: AgentEvent[];
  isConnected: boolean;
  clearEvents: () => void;
  jobsRefreshKey: number;
  statusRefreshKey: number;
  reconnectSeq: number;
}

export function useAgentFeed(
  activeProfileName: string | null = null
): UseAgentFeedResult {
  const [feedState, setFeedState] = useState<FeedSyncState>(createInitialFeedState);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    return connectAgentFeedSocket({
      url: buildWebSocketUrl(WS_URL),
      createSocket: (url) => new WebSocket(url),
      onConnectionChange: setIsConnected,
      onReconnect: () => {
        setFeedState((prev) => applyFeedReconnect(prev));
      },
      onEvent: (agentEvent) => {
        setFeedState((prev) => applyFeedEvent(prev, agentEvent));
      },
    });
  }, []);

  const clearEvents = useCallback(() => {
    setFeedState((prev) => clearFeedEvents(prev));
  }, []);

  const jobsRefreshKey = getProfileJobsRefreshKey(feedState, activeProfileName);
  const statusRefreshKey = getStatusRefreshKey(feedState);

  return {
    events: feedState.events,
    isConnected,
    clearEvents,
    jobsRefreshKey,
    statusRefreshKey,
    reconnectSeq: feedState.reconnectSeq,
  };
}
