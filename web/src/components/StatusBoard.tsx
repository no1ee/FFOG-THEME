import { useEffect, useRef, useState } from "react";
import type { BoardEntry } from "../App";

interface Props {
  entries: BoardEntry[];
  onSelect: (projectId: string) => void;
}

/**
 * Live status board — one row per project, latest event for that project only.
 * Older rows for the same project are replaced (not stacked). Most recent on top.
 * Each row briefly highlights when it updates; hover hints which is freshest.
 */
export function StatusBoard({ entries, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const lastTsByProject = useRef<Record<string, number>>({});

  useEffect(() => {
    let changed: string | null = null;
    for (const e of entries) {
      const prev = lastTsByProject.current[e.projectId];
      if (prev !== e.ts) {
        lastTsByProject.current[e.projectId] = e.ts;
        if (prev !== undefined) changed = e.projectId;
      }
    }
    if (changed) {
      setHighlightId(changed);
      const id = changed;
      const t = setTimeout(() => {
        setHighlightId((curr) => (curr === id ? null : curr));
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [entries]);

  return (
    <section className="border-b border-ink-700 bg-ink-800/80 backdrop-blur">
      <header
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-500 animate-pulse" />
          <span className="text-sm font-semibold uppercase tracking-wider text-ink-200">
            Status board
          </span>
          <span className="text-xs text-ink-400">
            {entries.length} project{entries.length === 1 ? "" : "s"}
          </span>
        </div>
        <span className="text-ink-300 text-xs">{collapsed ? "▾ expand" : "▴ collapse"}</span>
      </header>
      {!collapsed && (
        <div className="max-h-44 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="px-4 py-3 text-xs text-ink-500">
              No project activity yet — add a project and run a check.
            </div>
          ) : (
            <ul className="divide-y divide-ink-700/60 font-mono text-xs">
              {entries.map((e) => (
                <li
                  key={e.projectId}
                  onClick={() => onSelect(e.projectId)}
                  className={`grid grid-cols-[10rem_8rem_1fr_5rem] gap-3 px-4 py-1.5 cursor-pointer transition-colors ${
                    highlightId === e.projectId
                      ? "bg-accent-500/20"
                      : "hover:bg-ink-700/40"
                  }`}
                  title={`Last update for ${e.projectName}`}
                >
                  <span className="truncate text-ink-100 font-semibold">
                    {e.projectName}
                  </span>
                  <span className={`uppercase tracking-wide ${kindColor(e.kind)}`}>
                    {e.kind}
                  </span>
                  <span className="truncate text-ink-300">{e.summary || "—"}</span>
                  <span className="text-ink-500 text-right">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function kindColor(kind: string): string {
  if (kind.startsWith("session.error") || kind === "failed") return "text-red-300";
  if (kind === "done" || kind === "run.end") return "text-green-300";
  if (kind === "cancelled" || kind === "suggestion.rejected") return "text-ink-400";
  if (kind.startsWith("suggestion") || kind === "check.result") return "text-yellow-300";
  if (kind === "run.start" || kind === "user.instruction") return "text-blue-300";
  return "text-ink-300";
}
