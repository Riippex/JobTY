"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type Settings,
  fetchSettings,
  updateSettings,
} from "@/lib/api";

const PROVIDERS = ["openai", "groq", "anthropic", "gemini", "ollama"] as const;
const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  groq: "Groq",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama (local)",
};
const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4.1",
  groq: "llama-3.3-70b-versatile",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.5-flash",
  ollama: "llama3",
};

// ── Shared UI primitives ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-6 space-y-5" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
      <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</label>
      {children}
      {hint && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}

function Input({ type = "text", value, onChange, placeholder }: {
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
    />
  );
}

function SaveButton({ onSave, saved }: { onSave: () => Promise<void>; saved: boolean }) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    await onSave();
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-3 pt-2">
      <button
        type="button"
        onClick={() => void handle()}
        disabled={loading}
        className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {loading ? "Saving…" : "Save"}
      </button>
      {saved && <span className="text-sm" style={{ color: "var(--accent)" }}>Saved ✓</span>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [llmSaved, setLlmSaved] = useState(false);
  const [botSaved, setBotSaved] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);

  // Credentials state
  const [linkedinEmail, setLinkedinEmail] = useState("");
  const [linkedinPassword, setLinkedinPassword] = useState("");
  const [indeedEmail, setIndeedEmail] = useState("");
  const [indeedPassword, setIndeedPassword] = useState("");
  const [computrabajoCountry, setComputrabajoCountry] = useState("com.co");

  // LLM state
  const [provider, setProvider] = useState<Settings["llm_provider"]>("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");

  // Bot state
  const [headless, setHeadless] = useState(true);
  const [slowMo, setSlowMo] = useState(0);
  const [timeout, setTimeout_] = useState(30);
  const [maxApps, setMaxApps] = useState(10);
  const [boards, setBoards] = useState<string[]>(["linkedin", "indeed"]);

  useEffect(() => {
    fetchSettings().then((s) => {
      setSettings(s);
      setProvider(s.llm_provider);
      setModel(
        s[`${s.llm_provider}_model` as keyof Settings] as string ||
        DEFAULT_MODELS[s.llm_provider]
      );
      setOllamaUrl(s.ollama_base_url);
      setHeadless(s.playwright_headless);
      setSlowMo(s.playwright_slow_mo);
      setTimeout_(Math.round(s.playwright_timeout / 1000));
      setMaxApps(s.max_applications_per_run);
      setBoards(s.enabled_boards);
      setLinkedinEmail(s.linkedin_email);
      setIndeedEmail(s.indeed_email);
      setComputrabajoCountry(s.computrabajo_country);
    }).catch(console.error);
  }, []);

  function toggleBoard(board: string) {
    setBoards((prev) =>
      prev.includes(board) ? prev.filter((b) => b !== board) : [...prev, board]
    );
  }

  async function saveLLM() {
    const modelKey = `${provider}_model` as keyof Settings;
    const keyKey = `${provider}_api_key` as keyof Settings;
    const updates: Partial<Settings> = {
      llm_provider: provider,
      [modelKey]: model,
      ollama_base_url: ollamaUrl,
    };
    if (apiKey) updates[keyKey] = apiKey as never;
    await updateSettings(updates);
    setApiKey("");
    setLlmSaved(true);
    setTimeout(() => setLlmSaved(false), 2000);
  }

  async function saveCreds() {
    const updates: Partial<Settings> = {
      linkedin_email: linkedinEmail,
      indeed_email: indeedEmail,
      computrabajo_country: computrabajoCountry,
    };
    if (linkedinPassword) updates.linkedin_password = linkedinPassword;
    if (indeedPassword) updates.indeed_password = indeedPassword;
    await updateSettings(updates);
    setLinkedinPassword("");
    setIndeedPassword("");
    setCredsSaved(true);
    setTimeout(() => setCredsSaved(false), 2000);
  }

  async function saveBot() {
    await updateSettings({
      playwright_headless: headless,
      playwright_slow_mo: slowMo,
      playwright_timeout: timeout * 1000,
      max_applications_per_run: maxApps,
      enabled_boards: boards,
    });
    setBotSaved(true);
    setTimeout(() => setBotSaved(false), 2000);
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
        Loading…
      </div>
    );
  }

  const currentMaskedKey = settings[`${provider}_api_key` as keyof Settings] as string;

  return (
    <div className="max-w-2xl mx-auto py-8 px-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          aria-label="Back to dashboard"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </Link>
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>Settings</h1>
      </div>

      {/* LLM Provider */}
      <Section title="LLM Provider">
        <Field label="Provider">
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setProvider(p);
                  setModel(DEFAULT_MODELS[p]);
                  setApiKey("");
                }}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: provider === p ? "var(--accent)" : "var(--bg-elevated)",
                  color: provider === p ? "white" : "var(--text-secondary)",
                  border: `1px solid ${provider === p ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </Field>

        {provider !== "ollama" && (
          <Field
            label="API Key"
            hint={currentMaskedKey ? `Current: ${currentMaskedKey} — leave blank to keep unchanged` : "No key saved yet"}
          >
            <Input
              type="password"
              value={apiKey}
              onChange={setApiKey}
              placeholder="Paste new key to update…"
            />
          </Field>
        )}

        {provider === "ollama" && (
          <Field label="Ollama Base URL" hint="Use host.docker.internal instead of localhost inside Docker">
            <Input value={ollamaUrl} onChange={setOllamaUrl} />
          </Field>
        )}

        <Field label="Model" hint={`Default: ${DEFAULT_MODELS[provider]}`}>
          <Input value={model} onChange={setModel} placeholder={DEFAULT_MODELS[provider]} />
        </Field>

        <SaveButton onSave={saveLLM} saved={llmSaved} />
      </Section>

      {/* Bot Settings */}
      <Section title="Bot Settings">
        <Field label="Job boards">
          <div className="flex gap-4">
            {["linkedin", "indeed", "computrabajo"].map((board) => (
              <label key={board} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={boards.includes(board)}
                  onChange={() => toggleBoard(board)}
                  className="accent-blue-500 w-4 h-4"
                />
                <span className="text-sm capitalize" style={{ color: "var(--text-primary)" }}>{board}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label="Max applications per run" hint={`${maxApps} application${maxApps !== 1 ? "s" : ""} per run`}>
          <input
            type="range"
            min={1}
            max={50}
            value={maxApps}
            onChange={(e) => setMaxApps(Number(e.target.value))}
            aria-label="Max applications per run"
            className="w-full accent-blue-500 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ background: "var(--border)" }}
          />
          <div className="flex justify-between text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            <span>1 (safe dev)</span><span>50</span>
          </div>
        </Field>

        <div className="flex items-center justify-between">
          <Field label="Headless mode" hint="Disable to watch the browser during development">
            <span />
          </Field>
          <button
            type="button"
            onClick={() => setHeadless((h) => !h)}
            aria-label={headless ? "Disable headless mode" : "Enable headless mode"}
            aria-pressed={headless}
            className="relative w-11 h-6 rounded-full transition-colors shrink-0"
            style={{ background: headless ? "var(--accent)" : "var(--bg-elevated)", border: "1px solid var(--border)" }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
              style={{ background: headless ? "white" : "var(--text-muted)", left: headless ? "calc(100% - 22px)" : "2px" }}
            />
          </button>
        </div>

        <Field label={`Slow Mo — ${slowMo}ms`} hint="Delay between browser actions (useful for debugging)">
          <input
            type="range"
            min={0}
            max={500}
            step={50}
            value={slowMo}
            onChange={(e) => setSlowMo(Number(e.target.value))}
            aria-label="Slow Mo delay in milliseconds"
            className="w-full accent-blue-500 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ background: "var(--border)" }}
          />
        </Field>

        <Field label={`Action timeout — ${timeout}s`} hint="Max time to wait for a browser action before failing">
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={timeout}
            onChange={(e) => setTimeout_(Number(e.target.value))}
            aria-label="Action timeout in seconds"
            className="w-full accent-blue-500 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ background: "var(--border)" }}
          />
        </Field>

        <SaveButton onSave={saveBot} saved={botSaved} />
      </Section>

      {/* Credentials */}
      <Section title="Job Board Credentials">
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "var(--hover-bg-strong)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          Stored locally. Passwords are masked in the API. Leave password blank to keep the current one.
        </p>

        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>LinkedIn</p>
          <Field label="Email">
            <Input value={linkedinEmail} onChange={setLinkedinEmail} placeholder="you@email.com" />
          </Field>
          <Field label="Password" hint={settings.linkedin_password ? "Saved — leave blank to keep" : "Not saved"}>
            <Input type="password" value={linkedinPassword} onChange={setLinkedinPassword} placeholder="Paste to update…" />
          </Field>
        </div>

        <div className="space-y-4 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide pt-2" style={{ color: "var(--text-muted)" }}>Indeed</p>
          <Field label="Email">
            <Input value={indeedEmail} onChange={setIndeedEmail} placeholder="you@email.com" />
          </Field>
          <Field label="Password" hint={settings.indeed_password ? "Saved — leave blank to keep" : "Not saved"}>
            <Input type="password" value={indeedPassword} onChange={setIndeedPassword} placeholder="Paste to update…" />
          </Field>
        </div>

        <div className="space-y-4 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide pt-2" style={{ color: "var(--text-muted)" }}>Computrabajo</p>
          <Field label="Country" hint="Domain suffix — e.g. com.co (Colombia), com.mx (México), com.ar (Argentina)">
            <div className="flex flex-wrap gap-2">
              {[
                { code: "com.co", label: "🇨🇴 Colombia" },
                { code: "com.mx", label: "🇲🇽 México" },
                { code: "com.ar", label: "🇦🇷 Argentina" },
                { code: "com.pe", label: "🇵🇪 Perú" },
                { code: "cl",     label: "🇨🇱 Chile" },
              ].map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setComputrabajoCountry(code)}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={{
                    background: computrabajoCountry === code ? "var(--accent)" : "var(--bg-elevated)",
                    color: computrabajoCountry === code ? "white" : "var(--text-secondary)",
                    border: `1px solid ${computrabajoCountry === code ? "var(--accent)" : "var(--border)"}`,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <SaveButton onSave={saveCreds} saved={credsSaved} />
      </Section>
    </div>
  );
}
