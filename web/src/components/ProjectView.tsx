import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectEvent, Suggestion } from "../types";
import { CATEGORY_LABELS } from "../types";
import { api } from "../api";

interface Props {
  project: Project;
  events: ProjectEvent[];
  suggestions: Suggestion[];
}

export function ProjectView({ project, events, suggestions }: Props) {
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const pending = useMemo(
    () => suggestions.filter((s) => s.status === "pending"),
    [suggestions],
  );
  const inFlight = useMemo(
    () => suggestions.filter((s) => s.status === "executing" || s.status === "approved"),
    [suggestions],
  );
  const recent = useMemo(
    () =>
      suggestions
        .filter((s) => s.status === "done" || s.status === "failed" || s.status === "rejected")
        .slice(0, 8),
    [suggestions],
  );

  useEffect(() => {
    setReply(null);
    setPrompt("");
  }, [project.id]);

  async function send() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.sendInstruction(project.id, prompt.trim());
      setReply(r.reply);
      setPrompt("");
    } catch (err: any) {
      setReply(`Error: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (running) return;
    setRunning(true);
    try {
      await api.runCheck(project.id);
    } catch (err: any) {
      alert(`Check failed: ${err.message ?? err}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <div className="text-sm text-ink-400 font-mono mt-1">{project.cwd}</div>
          <div className="text-xs text-ink-400 mt-2">
            session <span className="font-mono">{project.sessionId.slice(0, 8)}</span> · focus{" "}
            <span className="text-ink-200">{CATEGORY_LABELS[project.category]}</span> · autonomy{" "}
            <span className="text-ink-200">{project.autonomy}</span> · last check{" "}
            {project.lastCheckedAt
              ? new Date(project.lastCheckedAt).toLocaleTimeString()
              : "never"}
          </div>
        </div>
        <button
          onClick={runCheck}
          disabled={running}
          className="rounded bg-ink-700 hover:bg-ink-600 px-3 py-2 text-sm disabled:opacity-50"
        >
          {running ? "Checking…" : "Run check now"}
        </button>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300 mb-2">
          Suggestions
        </h2>
        {pending.length === 0 && inFlight.length === 0 && (
          <div className="text-sm text-ink-400">
            No pending suggestions. Run a check or send an instruction below.
          </div>
        )}
        <ul className="space-y-2">
          {[...pending, ...inFlight].map((s) => (
            <SuggestionRow key={s.id} suggestion={s} autonomy={project.autonomy} />
          ))}
        </ul>
        {recent.length > 0 && (
          <details className="mt-4">
            <summary className="text-xs text-ink-400 cursor-pointer">
              Recent ({recent.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {recent.map((s) => (
                <li key={s.id} className="text-xs text-ink-400 flex justify-between">
                  <span className="truncate">{s.title}</span>
                  <span className={statusColor(s.status)}>{s.status}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300 mb-2">
          Talk to this project
        </h2>
        <div className="rounded border border-ink-700 bg-ink-800 p-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Tell Claude what you want done in this project…"
            rows={3}
            className="w-full bg-ink-900 border border-ink-600 rounded px-3 py-2 text-sm font-mono"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={send}
              disabled={busy || !prompt.trim()}
              className="rounded bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white px-4 py-2 text-sm font-medium"
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
          {reply !== null && (
            <pre className="mt-3 text-xs whitespace-pre-wrap text-ink-200 bg-ink-900 border border-ink-700 rounded p-3 max-h-64 overflow-y-auto">
              {reply}
            </pre>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-300 mb-2">
          Activity
        </h2>
        <ul className="space-y-1 text-xs font-mono">
          {events.slice(-30).reverse().map((e) => (
            <li key={e.id} className="text-ink-400">
              <span className="text-ink-500">
                {new Date(e.ts).toLocaleTimeString()}
              </span>{" "}
              <span className="text-ink-200">{e.kind}</span>{" "}
              <span>{summarizePayload(e.payload)}</span>
            </li>
          ))}
          {events.length === 0 && <li className="text-ink-500">No activity yet.</li>}
        </ul>
      </section>
    </main>
  );
}

function SuggestionRow({
  suggestion,
  autonomy,
}: {
  suggestion: Suggestion;
  autonomy: Project["autonomy"];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="rounded border border-ink-700 bg-ink-800 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-medium">{suggestion.title}</div>
          <div className="text-sm text-ink-300 mt-1">{suggestion.rationale}</div>
          <details className="mt-2">
            <summary className="text-xs text-ink-400 cursor-pointer">
              Proposed prompt
            </summary>
            <pre className="text-xs text-ink-200 whitespace-pre-wrap mt-1 bg-ink-900 border border-ink-700 rounded p-2">
              {suggestion.proposedPrompt}
            </pre>
          </details>
        </div>
        <div className="flex flex-col items-end gap-1 min-w-[7rem]">
          <span className={`text-xs ${statusColor(suggestion.status)}`}>
            {suggestion.status}
          </span>
          {suggestion.status === "pending" && autonomy === "approval" && (
            <div className="flex gap-1">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.approve(suggestion.id);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-xs rounded bg-accent-500 hover:bg-accent-600 text-white px-2 py-1 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.reject(suggestion.id);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-xs rounded bg-ink-700 hover:bg-ink-600 px-2 py-1 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function statusColor(s: Suggestion["status"]): string {
  switch (s) {
    case "pending":
      return "text-yellow-300";
    case "approved":
    case "executing":
      return "text-blue-300";
    case "done":
      return "text-green-300";
    case "failed":
      return "text-red-300";
    case "rejected":
      return "text-ink-400";
  }
}

function summarizePayload(p: unknown): string {
  if (!p) return "";
  if (typeof p === "string") return p.slice(0, 120);
  try {
    const json = JSON.stringify(p);
    return json.length > 120 ? json.slice(0, 120) + "…" : json;
  } catch {
    return "";
  }
}
