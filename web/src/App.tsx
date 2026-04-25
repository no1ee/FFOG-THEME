import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ProjectView } from "./components/ProjectView";
import type { Project, ProjectEvent, Suggestion } from "./types";
import { api, connectWs } from "./api";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [events, setEvents] = useState<Record<string, ProjectEvent[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void api.listProjects().then((list) => {
      setProjects(list);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
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
        setEvents((curr) => {
          const list = curr[msg.data.projectId] ?? [];
          return {
            ...curr,
            [msg.data.projectId]: [...list, msg.data].slice(-200),
          };
        });
        if (msg.data.kind === "suggestion.created") {
          // refetch list of suggestions for this project
          void api.suggestions(msg.data.projectId).then((list) => {
            setSuggestions((curr) => {
              const others = curr.filter((s) => s.projectId !== msg.data.projectId);
              return [...list, ...others];
            });
          });
        }
      }
    });
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrate events for the selected project on first selection
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

  return (
    <div className="flex h-full">
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
  );
}
