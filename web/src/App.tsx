import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ProjectView } from "./components/ProjectView";
import { StatusBoard } from "./components/StatusBoard";
import type { Project, ProjectEvent, Suggestion } from "./types";
import { api, connectWs } from "./api";

export interface ActiveRun {
  runId: string;
  prompt: string;
  text: string;
  startedAt: number;
  done: boolean;
  ok?: boolean;
  cancelled?: boolean;
}

export interface BoardEntry {
  projectId: string;
  projectName: string;
  kind: string;
  summary: string;
  ts: number;
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [events, setEvents] = useState<Record<string, ProjectEvent[]>>({});
  const [activeRuns, setActiveRuns] = useState<Record<string, ActiveRun>>({});
  const [boardByProject, setBoardByProject] = useState<Record<string, BoardEntry>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void api.listProjects().then((list) => {
      setProjects(list);
      if (list.length > 0) {
        setSelectedId((curr) => curr ?? list[0].id);
      }
    });
    const close = connectWs((msg) => {
      if (msg.type === "snapshot") {
        setProjects(msg.data.projects);
        setSuggestions(msg.data.suggestions);
      } else if (msg.type === "project.update") {
        setProjects((curr) => {
          const idx = curr.findIndex((p) => p.id === msg.data.id);
          if (idx === -1) return [...curr, msg.data];
          const next = [...curr];
          next[idx] = msg.data;
          return next;
        });
      } else if (msg.type === "suggestion") {
        setSuggestions((curr) => {
          const idx = curr.findIndex((s) => s.id === msg.data.id);
          if (idx === -1) return [msg.data, ...curr];
          const next = [...curr];
          next[idx] = msg.data;
          return next;
        });
      } else if (msg.type === "event") {
        const ev = msg.data;
        setEvents((curr) => {
          const list = curr[ev.projectId] ?? [];
          return { ...curr, [ev.projectId]: [...list, ev].slice(-200) };
        });
        setBoardByProject((curr) => ({
          ...curr,
          [ev.projectId]: {
            projectId: ev.projectId,
            projectName: "", // resolved at render time
            kind: ev.kind,
            summary: summarizePayload(ev.payload),
            ts: ev.ts,
          },
        }));
        if (ev.kind === "suggestion.created") {
          void api.suggestions(ev.projectId).then((list) => {
            setSuggestions((curr) => {
              const others = curr.filter((s) => s.projectId !== ev.projectId);
              return [...list, ...others];
            });
          });
        }
      } else if (msg.type === "stream") {
        const s = msg.data;
        if (s.type === "run.start") {
          setActiveRuns((curr) => ({
            ...curr,
            [s.projectId]: {
              runId: s.runId,
              prompt: s.prompt,
              text: "",
              startedAt: s.ts,
              done: false,
            },
          }));
        } else if (s.type === "delta") {
          setActiveRuns((curr) => {
            const cur = curr[s.projectId];
            if (!cur || cur.runId !== s.runId) return curr;
            return {
              ...curr,
              [s.projectId]: { ...cur, text: cur.text + s.text },
            };
          });
        } else if (s.type === "run.end") {
          setActiveRuns((curr) => {
            const cur = curr[s.projectId];
            if (!cur || cur.runId !== s.runId) return curr;
            return {
              ...curr,
              [s.projectId]: { ...cur, done: true, ok: s.ok, cancelled: s.cancelled },
            };
          });
          setBoardByProject((curr) => ({
            ...curr,
            [s.projectId]: {
              projectId: s.projectId,
              projectName: "",
              kind: s.cancelled ? "cancelled" : s.ok ? "done" : "failed",
              summary: s.cancelled ? "user cancelled" : s.ok ? "completed" : "failed",
              ts: s.ts,
            },
          }));
        }
      }
    });
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    if (events[selectedId]) return;
    void api.events(selectedId).then((list) => {
      setEvents((curr) => ({ ...curr, [selectedId]: list }));
    });
    void api.suggestions(selectedId).then((list) => {
      setSuggestions((curr) => {
        const others = curr.filter((s) => s.projectId !== selectedId);
        return [...list, ...others];
      });
    });
  }, [selectedId, events]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  );
  const selectedEvents = selectedId ? events[selectedId] ?? [] : [];
  const selectedSuggestions = useMemo(
    () => (selectedId ? suggestions.filter((s) => s.projectId === selectedId) : []),
    [suggestions, selectedId],
  );
  const activeRun = selectedId ? activeRuns[selectedId] ?? null : null;

  const boardEntries = useMemo(() => {
    const projectName = (id: string) =>
      projects.find((p) => p.id === id)?.name ?? "(removed)";
    return Object.values(boardByProject)
      .map((e) => ({ ...e, projectName: projectName(e.projectId) }))
      .sort((a, b) => b.ts - a.ts);
  }, [boardByProject, projects]);

  return (
    <div className="flex flex-col h-full">
      <StatusBoard
        entries={boardEntries}
        onSelect={(id) => setSelectedId(id)}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          projects={projects}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={async (input) => {
            try {
              const p = await api.addProject(input);
              setSelectedId(p.id);
            } catch (err: any) {
              alert(`Failed to add: ${err.message ?? err}`);
            }
          }}
          onUpdate={async (id, patch) => {
            try {
              await api.updateProject(id, patch);
            } catch (err: any) {
              alert(`Failed to update: ${err.message ?? err}`);
            }
          }}
          onRemove={async (id) => {
            try {
              await api.removeProject(id);
              setProjects((curr) => curr.filter((p) => p.id !== id));
              if (selectedId === id) setSelectedId(null);
            } catch (err: any) {
              alert(`Failed to remove: ${err.message ?? err}`);
            }
          }}
        />
        {selected ? (
          <ProjectView
            project={selected}
            events={selectedEvents}
            suggestions={selectedSuggestions}
            activeRun={activeRun}
          />
        ) : (
          <main className="flex-1 flex items-center justify-center text-ink-400">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">FFOG Concierge</h2>
              <p className="text-sm">Select or add a project from the sidebar.</p>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function summarizePayload(p: unknown): string {
  if (!p) return "";
  if (typeof p === "string") return p.slice(0, 120);
  if (typeof p === "object") {
    const obj = p as Record<string, unknown>;
    if (typeof obj.prompt === "string") return obj.prompt.slice(0, 120);
    if (typeof obj.title === "string") return obj.title.slice(0, 120);
    if (typeof obj.message === "string") return obj.message.slice(0, 120);
  }
  try {
    const json = JSON.stringify(p);
    return json.length > 120 ? json.slice(0, 120) + "…" : json;
  } catch {
    return "";
  }
}
