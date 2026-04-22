"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type Profile,
  type Preferences,
  fetchProfiles,
  createProfile as apiCreateProfile,
  deleteProfile as apiDeleteProfile,
  activateProfile as apiActivateProfile,
  uploadCV as apiUploadCV,
  type CVInfo,
} from "@/lib/api";

export interface UseProfilesResult {
  profiles: Profile[];
  activeProfile: Profile | null;
  loading: boolean;
  error: string | null;
  createProfile: (name: string, preferences: Preferences) => Promise<Profile>;
  activateProfile: (name: string) => Promise<void>;
  deleteProfile: (name: string) => Promise<void>;
  uploadCV: (name: string, file: File) => Promise<CVInfo>;
  refresh: () => Promise<void>;
}

export function useProfiles(): UseProfilesResult {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProfiles();
      setProfiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createProfile = useCallback(
    async (name: string, preferences: Preferences): Promise<Profile> => {
      const created = await apiCreateProfile(name, preferences);
      await load();
      return created;
    },
    [load]
  );

  const activateProfile = useCallback(
    async (name: string): Promise<void> => {
      await apiActivateProfile(name);
      await load();
    },
    [load]
  );

  const deleteProfile = useCallback(
    async (name: string): Promise<void> => {
      await apiDeleteProfile(name);
      await load();
    },
    [load]
  );

  const uploadCV = useCallback(
    async (name: string, file: File): Promise<CVInfo> => {
      const info = await apiUploadCV(name, file);
      await load();
      return info;
    },
    [load]
  );

  const activeProfile = profiles.find((p) => p.is_active) ?? null;

  return {
    profiles,
    activeProfile,
    loading,
    error,
    createProfile,
    activateProfile,
    deleteProfile,
    uploadCV,
    refresh: load,
  };
}
