"use client";

import { useEffect, useRef, useState } from "react";
import type { CVParsed, Preferences, Profile } from "@/lib/api";
import {
  ApiError,
  fetchCVParsed,
  parseCVFromPDF,
  updateCVParsed,
  updateProfile,
} from "@/lib/api";

type Tab = "preferences" | "cv";

interface Props {
  profile: Profile;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{children}</p>
  );
}

function TagInput({
  tags,
  onAdd,
  onRemove,
  placeholder,
  color = "blue",
}: {
  tags: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
  color?: "blue" | "indigo";
}) {
  const [input, setInput] = useState("");

  function commit() {
    const v = input.trim();
    if (v && !tags.includes(v)) onAdd(v);
    setInput("");
  }

  const tagStyle =
    color === "blue"
      ? { background: "rgba(59,130,246,0.12)", color: "var(--accent)", border: "1px solid rgba(59,130,246,0.25)" }
      : { background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); } }}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
        <button
          type="button"
          onClick={commit}
          className="px-3 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          Add
        </button>
      </div>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5" style={tagStyle}>
              {t}
              <button type="button" onClick={() => onRemove(t)} className="hover:opacity-70 leading-none">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
      <button
        type="button"
        aria-label={label}
        aria-pressed={on ? "true" : "false"}
        onClick={onToggle}
        className="relative w-11 h-6 rounded-full transition-colors shrink-0"
        style={{ background: on ? "var(--accent)" : "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
          style={{ background: on ? "white" : "var(--text-muted)", left: on ? "calc(100% - 22px)" : "2px" }}
        />
      </button>
    </div>
  );
}

// ── Preferences tab ───────────────────────────────────────────────────────────

function PreferencesTab({
  initial,
  onSave,
}: {
  initial: Preferences;
  onSave: (p: Preferences) => Promise<void>;
}) {
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(prefs);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Job keywords</Label>
        <TagInput
          tags={prefs.keywords}
          onAdd={(v) => setPrefs((p) => ({ ...p, keywords: [...p.keywords, v] }))}
          onRemove={(v) => setPrefs((p) => ({ ...p, keywords: p.keywords.filter((k) => k !== v) }))}
          placeholder="e.g. Python, Backend, Senior"
          color="blue"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Locations</Label>
        <TagInput
          tags={prefs.locations}
          onAdd={(v) => setPrefs((p) => ({ ...p, locations: [...p.locations, v] }))}
          onRemove={(v) => setPrefs((p) => ({ ...p, locations: p.locations.filter((l) => l !== v) }))}
          placeholder="e.g. Madrid, Barcelona, Remote"
          color="indigo"
        />
      </div>

      <Toggle
        label="Remote only"
        on={prefs.remote_only}
        onToggle={() => setPrefs((p) => ({ ...p, remote_only: !p.remote_only }))}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Max applications per run</Label>
          <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>
            {prefs.max_applications_per_run}
          </span>
        </div>
        <input
          type="range"
          aria-label="Max applications per run"
          min={1}
          max={50}
          value={prefs.max_applications_per_run}
          onChange={(e) => setPrefs((p) => ({ ...p, max_applications_per_run: Number(e.target.value) }))}
          className="w-full accent-blue-500 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: "var(--border)" }}
        />
        <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
          <span>1</span><span>50</span>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm" style={{ color: "var(--accent)" }}>Saved ✓</span>}
      </div>
    </div>
  );
}

// ── CV Summary tab ────────────────────────────────────────────────────────────

const EMPTY_CV: CVParsed = {
  skills: [],
  languages: [],
  experience_years: 0,
  education: [],
  summary: "",
};

function CVSummaryTab({ profileName }: { profileName: string }) {
  const [cv, setCv] = useState<CVParsed>(EMPTY_CV);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notParsed, setNotParsed] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchCVParsed(profileName)
      .then((data) => { setCv(data); setNotParsed(false); })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotParsed(true);
        } else {
          setError(err instanceof Error ? err.message : "Failed to load CV summary");
        }
      })
      .finally(() => setLoading(false));
  }, [profileName]);

  async function handleParse() {
    setParsing(true);
    setError(null);
    try {
      const data = await parseCVFromPDF(profileName);
      setCv(data);
      setNotParsed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parsing failed");
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateCVParsed(profileName, cv);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>Loading…</p>;
  }

  if (notParsed) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          The CV hasn&apos;t been parsed yet. Parse it with the LLM to generate the summary the agent will use to answer application questions.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="button"
          onClick={() => void handleParse()}
          disabled={parsing}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {parsing ? "Parsing…" : "Parse CV with LLM"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "var(--hover-bg-strong)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
        This is what the agent sends to the LLM as context when answering application questions. Edit it to improve accuracy.
      </div>

      <div className="space-y-1.5">
        <Label>Professional summary</Label>
        <textarea
          value={cv.summary}
          onChange={(e) => setCv((c) => ({ ...c, summary: e.target.value }))}
          rows={4}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Skills</Label>
        <TagInput
          tags={cv.skills}
          onAdd={(v) => setCv((c) => ({ ...c, skills: [...c.skills, v] }))}
          onRemove={(v) => setCv((c) => ({ ...c, skills: c.skills.filter((s) => s !== v) }))}
          placeholder="e.g. Python, React, Docker"
          color="blue"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Languages</Label>
        <TagInput
          tags={cv.languages}
          onAdd={(v) => setCv((c) => ({ ...c, languages: [...c.languages, v] }))}
          onRemove={(v) => setCv((c) => ({ ...c, languages: c.languages.filter((l) => l !== v) }))}
          placeholder="e.g. English, Spanish"
          color="indigo"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Education</Label>
        <TagInput
          tags={cv.education}
          onAdd={(v) => setCv((c) => ({ ...c, education: [...c.education, v] }))}
          onRemove={(v) => setCv((c) => ({ ...c, education: c.education.filter((e) => e !== v) }))}
          placeholder="e.g. BSc Computer Science"
          color="blue"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Years of experience</Label>
          <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>{cv.experience_years}</span>
        </div>
        <input
          type="range"
          aria-label="Years of experience"
          min={0}
          max={30}
          value={cv.experience_years}
          onChange={(e) => setCv((c) => ({ ...c, experience_years: Number(e.target.value) }))}
          className="w-full accent-blue-500 h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: "var(--border)" }}
        />
        <div className="flex justify-between text-xs" style={{ color: "var(--text-muted)" }}>
          <span>0</span><span>30</span>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: "var(--accent)", color: "white" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm" style={{ color: "var(--accent)" }}>Saved ✓</span>}
        <button
          type="button"
          onClick={() => void handleParse()}
          disabled={parsing}
          className="ml-auto px-3 py-2 rounded-lg text-xs font-medium transition-opacity disabled:opacity-40"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          {parsing ? "Re-parsing…" : "Re-parse from PDF"}
        </button>
      </div>
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export default function ProfileEditModal({ profile, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>("preferences");
  const overlayRef = useRef<HTMLDivElement>(null);

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose();
  }

  async function handleSavePrefs(prefs: Preferences) {
    await updateProfile(profile.name, prefs);
    await onSaved();
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "preferences", label: "Preferences" },
    { id: "cv", label: "CV Summary" },
  ];

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border flex flex-col"
        style={{
          background: "var(--bg-card)",
          borderColor: "var(--border)",
          maxHeight: "85vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Edit profile
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{profile.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-red-500/15 hover:text-red-400"
            style={{ color: "var(--text-muted)" }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 pb-0 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="px-4 py-2 rounded-t-lg text-sm font-medium transition-colors"
              style={{
                background: tab === t.id ? "var(--bg-elevated)" : "transparent",
                color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "preferences" ? (
            <PreferencesTab
              initial={profile.preferences}
              onSave={handleSavePrefs}
            />
          ) : (
            <CVSummaryTab profileName={profile.name} />
          )}
        </div>
      </div>
    </div>
  );
}
