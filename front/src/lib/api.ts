export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ---- Profiles ----

export interface Preferences {
  keywords: string[];
  locations: string[];
  remote_only: boolean;
  max_applications: number;
}

export interface Profile {
  name: string;
  preferences: Preferences;
  active: boolean;
  created_at?: string;
}

export interface CVInfo {
  filename: string;
  parsed: boolean;
  skills: string[];
  uploaded_at?: string;
}

export function fetchProfiles(): Promise<Profile[]> {
  return apiFetch<Profile[]>("/profiles");
}

export function fetchProfile(name: string): Promise<Profile> {
  return apiFetch<Profile>(`/profiles/${encodeURIComponent(name)}`);
}

export function createProfile(
  name: string,
  preferences: Preferences
): Promise<Profile> {
  return apiFetch<Profile>("/profiles", {
    method: "POST",
    body: JSON.stringify({ name, preferences }),
  });
}

export function updateProfile(
  name: string,
  preferences: Preferences
): Promise<Profile> {
  return apiFetch<Profile>(`/profiles/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: JSON.stringify({ preferences }),
  });
}

export function deleteProfile(name: string): Promise<void> {
  return apiFetch<void>(`/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export function activateProfile(name: string): Promise<Profile> {
  return apiFetch<Profile>(
    `/profiles/${encodeURIComponent(name)}/activate`,
    { method: "PUT" }
  );
}

export async function uploadCV(name: string, file: File): Promise<CVInfo> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(
    `${API_URL}/profiles/${encodeURIComponent(name)}/cv`,
    { method: "POST", body: form }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }

  return res.json() as Promise<CVInfo>;
}

export function fetchCV(name: string): Promise<CVInfo> {
  return apiFetch<CVInfo>(`/profiles/${encodeURIComponent(name)}/cv`);
}

// ---- Agent ----

export interface AgentStatusResponse {
  status: "idle" | "running" | "stopping" | "error";
  current_job: string | null;
  jobs_applied: number;
  errors: number;
  started_at: string | null;
  profile: string | null;
}

export function fetchAgentStatus(): Promise<AgentStatusResponse> {
  return apiFetch<AgentStatusResponse>("/agent/status");
}

export function startAgent(profile_name: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/agent/start", {
    method: "POST",
    body: JSON.stringify({ profile_name }),
  });
}

export function stopAgent(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/agent/stop", { method: "POST" });
}

// ---- Jobs (optional endpoint) ----

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string;
  score: number;
  status: "applied" | "skipped" | "pending" | "error";
  applied_at: string | null;
  reason: string;
}

export function fetchJobs(profileName: string): Promise<Job[]> {
  return apiFetch<Job[]>(`/jobs?profile=${encodeURIComponent(profileName)}`);
}
