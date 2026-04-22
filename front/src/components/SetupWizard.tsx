"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Preferences } from "@/lib/api";
import { updateProfile } from "@/lib/api";
import { useProfiles } from "@/hooks/useProfiles";

type Step = 1 | 2 | 3;

const DEFAULT_PREFERENCES: Preferences = {
  keywords: [],
  locations: [],
  remote_only: false,
  max_applications: 10,
};

export default function SetupWizard() {
  const router = useRouter();
  const { createProfile, uploadCV } = useProfiles();

  const [step, setStep] = useState<Step>(1);
  const [profileName, setProfileName] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [keywordInput, setKeywordInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Step 1: Create profile ----
  async function handleStep1() {
    if (!profileName.trim()) {
      setError("Profile name is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createProfile(profileName.trim(), DEFAULT_PREFERENCES);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    } finally {
      setLoading(false);
    }
  }

  // ---- Step 2: Upload CV ----
  async function handleStep2() {
    if (!cvFile) {
      setError("Please select a PDF file");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await uploadCV(profileName.trim(), cvFile);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload CV");
    } finally {
      setLoading(false);
    }
  }

  // ---- Step 3: Preferences ----
  async function handleStep3() {
    setLoading(true);
    setError(null);
    try {
      await updateProfile(profileName.trim(), preferences);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save preferences");
    } finally {
      setLoading(false);
    }
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (kw && !preferences.keywords.includes(kw)) {
      setPreferences((p) => ({ ...p, keywords: [...p.keywords, kw] }));
    }
    setKeywordInput("");
  }

  function removeKeyword(kw: string) {
    setPreferences((p) => ({
      ...p,
      keywords: p.keywords.filter((k) => k !== kw),
    }));
  }

  function addLocation() {
    const loc = locationInput.trim();
    if (loc && !preferences.locations.includes(loc)) {
      setPreferences((p) => ({ ...p, locations: [...p.locations, loc] }));
    }
    setLocationInput("");
  }

  function removeLocation(loc: string) {
    setPreferences((p) => ({
      ...p,
      locations: p.locations.filter((l) => l !== loc),
    }));
  }

  const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      setCvFile(file);
      setError(null);
    } else {
      setError("Only PDF files are accepted");
    }
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setCvFile(file);
        setError(null);
      }
    },
    []
  );

  const steps: { label: string; num: Step }[] = [
    { label: "Profile", num: 1 },
    { label: "Upload CV", num: 2 },
    { label: "Preferences", num: 3 },
  ];

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <span className="text-2xl font-bold" style={{ color: "var(--accent)" }}>
            JobTY
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded text-black font-semibold"
            style={{ background: "var(--accent)" }}
          >
            AI
          </span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {steps.map((s, idx) => (
            <div key={s.num} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors"
                  style={
                    step === s.num
                      ? { background: "var(--accent)", color: "black" }
                      : step > s.num
                      ? { background: "rgba(34,197,94,0.2)", color: "var(--accent)" }
                      : { background: "var(--bg-elevated)", color: "var(--text-muted)" }
                  }
                >
                  {step > s.num ? "✓" : s.num}
                </div>
                <span
                  className="text-xs"
                  style={{
                    color: step === s.num ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {s.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className="w-16 h-px mb-5 mx-1"
                  style={{
                    background: step > s.num ? "var(--accent)" : "var(--border)",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-8"
          style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
        >
          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  Create your profile
                </h1>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                  Choose a name to identify this job-hunting profile
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="profile-name"
                  className="text-sm font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  Profile name
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={profileName}
                  onChange={(e) => {
                    setProfileName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && void handleStep1()}
                  placeholder="e.g. Senior Backend Engineer"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none focus:ring-2 transition-all"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                onClick={() => void handleStep1()}
                disabled={loading || !profileName.trim()}
                className="w-full py-2.5 rounded-lg font-semibold text-sm transition-opacity disabled:opacity-40"
                style={{ background: "var(--accent)", color: "black" }}
              >
                {loading ? "Creating..." : "Continue"}
              </button>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  Upload your CV
                </h1>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                  The AI will parse it to understand your skills and experience
                </p>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl border-2 border-dashed p-10 flex flex-col items-center gap-3 cursor-pointer transition-colors"
                style={{
                  borderColor: dragging ? "var(--accent)" : cvFile ? "rgba(34,197,94,0.5)" : "var(--border)",
                  background: dragging ? "rgba(34,197,94,0.04)" : cvFile ? "rgba(34,197,94,0.04)" : "var(--bg-elevated)",
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {cvFile ? (
                  <>
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                      style={{ background: "rgba(34,197,94,0.15)" }}
                    >
                      ✓
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                        {cvFile.name}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {(cvFile.size / 1024).toFixed(0)} KB — Click to change
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                      style={{ background: "var(--bg-card)" }}
                    >
                      📄
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        Drop your CV here or click to browse
                      </p>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        PDF only, up to 10 MB
                      </p>
                    </div>
                  </>
                )}
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Back
                </button>
                <button
                  onClick={() => void handleStep2()}
                  disabled={loading || !cvFile}
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-opacity disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "black" }}
                >
                  {loading ? "Uploading..." : "Continue"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                  Set your preferences
                </h1>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
                  Tell the agent what kind of jobs to look for
                </p>
              </div>

              {/* Keywords */}
              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Job keywords
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder="e.g. Python, Backend, Senior"
                    className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <button
                    onClick={addKeyword}
                    className="px-3 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                  >
                    Add
                  </button>
                </div>
                {preferences.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {preferences.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5"
                        style={{
                          background: "rgba(34,197,94,0.1)",
                          color: "var(--accent)",
                          border: "1px solid rgba(34,197,94,0.25)",
                        }}
                      >
                        {kw}
                        <button
                          onClick={() => removeKeyword(kw)}
                          className="hover:opacity-70 leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Locations */}
              <div className="space-y-2">
                <label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Locations
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addLocation();
                      }
                    }}
                    placeholder="e.g. Madrid, Barcelona, Remote"
                    className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <button
                    onClick={addLocation}
                    className="px-3 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                  >
                    Add
                  </button>
                </div>
                {preferences.locations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {preferences.locations.map((loc) => (
                      <span
                        key={loc}
                        className="text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5"
                        style={{
                          background: "rgba(99,102,241,0.1)",
                          color: "#818cf8",
                          border: "1px solid rgba(99,102,241,0.25)",
                        }}
                      >
                        {loc}
                        <button
                          onClick={() => removeLocation(loc)}
                          className="hover:opacity-70 leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Remote only toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    Remote only
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    Filter out on-site and hybrid roles
                  </p>
                </div>
                <button
                  onClick={() =>
                    setPreferences((p) => ({ ...p, remote_only: !p.remote_only }))
                  }
                  className="relative w-11 h-6 rounded-full transition-colors"
                  style={{
                    background: preferences.remote_only ? "var(--accent)" : "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                    style={{
                      background: preferences.remote_only ? "black" : "var(--text-muted)",
                      left: preferences.remote_only ? "calc(100% - 22px)" : "2px",
                    }}
                  />
                </button>
              </div>

              {/* Max applications slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    Max applications per run
                  </label>
                  <span
                    className="text-sm font-bold"
                    style={{ color: "var(--accent)" }}
                  >
                    {preferences.max_applications}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={preferences.max_applications}
                  onChange={(e) =>
                    setPreferences((p) => ({
                      ...p,
                      max_applications: Number(e.target.value),
                    }))
                  }
                  className="w-full accent-green-500 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ background: "var(--border)" }}
                />
                <div
                  className="flex justify-between text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span>1 (safe dev)</span>
                  <span>50</span>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                  style={{
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  Back
                </button>
                <button
                  onClick={() => void handleStep3()}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm transition-opacity disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "black" }}
                >
                  {loading ? "Saving..." : "Go to Dashboard"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
