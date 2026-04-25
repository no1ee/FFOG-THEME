import { useState } from "react";
import type { Autonomy, CheckCategory, Project } from "../types";
import { CATEGORIES, CATEGORY_LABELS } from "../types";

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<Project, "autonomy" | "category">>) => void;
  onAdd: (input: { name: string; cwd: string; autonomy: Autonomy; category: CheckCategory }) => void;
  onRemove: (id: string) => void;
}

export function Sidebar({ projects, selectedId, onSelect, onUpdate, onAdd, onRemove }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  return (
    <aside
      className={`flex flex-col border-r border-ink-700 bg-ink-800 transition-all ${
        collapsed ? "w-12" : "w-80"
      }`}
    >
      <div className="flex items-center justify-between p-3 border-b border-ink-700">
        {!collapsed && <span className="font-semibold tracking-wide">Projects</span>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-ink-300 hover:text-ink-100 px-2"
          aria-label="toggle sidebar"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="p-3 border-b border-ink-700">
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="w-full rounded bg-accent-500 hover:bg-accent-600 text-white py-2 text-sm font-medium"
            >
              {showAdd ? "Cancel" : "+ Add project"}
            </button>
            {showAdd && (
              <AddForm
                onSubmit={(input) => {
                  onAdd(input);
                  setShowAdd(false);
                }}
              />
            )}
          </div>

          <ul className="flex-1 overflow-y-auto">
            {projects.map((p) => (
              <li
                key={p.id}
                className={`px-3 py-3 border-b border-ink-700 cursor-pointer ${
                  selectedId === p.id ? "bg-ink-700" : "hover:bg-ink-700/50"
                }`}
                onClick={() => onSelect(p.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium truncate">{p.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove ${p.name}?`)) onRemove(p.id);
                    }}
                    className="text-ink-400 hover:text-red-400 text-xs"
                    aria-label="remove"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-xs text-ink-400 truncate">{p.cwd}</div>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs text-ink-300">
                    <span className="block mb-0.5">Focus</span>
                    <select
                      value={p.category}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdate(p.id, { category: e.target.value as CheckCategory })
                      }
                      className="w-full bg-ink-900 border border-ink-600 rounded px-1 py-1 text-ink-100"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-ink-300">
                    <span className="block mb-0.5">Autonomy</span>
                    <select
                      value={p.autonomy}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdate(p.id, { autonomy: e.target.value as Autonomy })
                      }
                      className="w-full bg-ink-900 border border-ink-600 rounded px-1 py-1 text-ink-100"
                    >
                      <option value="approval">Ask first</option>
                      <option value="auto">Auto-act</option>
                    </select>
                  </label>
                </div>
              </li>
            ))}
            {projects.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-400">
                No projects yet. Add one above.
              </li>
            )}
          </ul>
        </>
      )}
    </aside>
  );
}

function AddForm({
  onSubmit,
}: {
  onSubmit: (input: {
    name: string;
    cwd: string;
    autonomy: Autonomy;
    category: CheckCategory;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [autonomy, setAutonomy] = useState<Autonomy>("approval");
  const [category, setCategory] = useState<CheckCategory>("direction");
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !cwd.trim()) return;
        onSubmit({ name: name.trim(), cwd: cwd.trim(), autonomy, category });
        setName("");
        setCwd("");
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="w-full bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm"
      />
      <input
        value={cwd}
        onChange={(e) => setCwd(e.target.value)}
        placeholder="Absolute path to project"
        className="w-full bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm font-mono"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CheckCategory)}
          className="bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          value={autonomy}
          onChange={(e) => setAutonomy(e.target.value as Autonomy)}
          className="bg-ink-900 border border-ink-600 rounded px-2 py-1 text-sm"
        >
          <option value="approval">Ask first</option>
          <option value="auto">Auto-act</option>
        </select>
      </div>
      <button
        type="submit"
        className="w-full rounded bg-ink-600 hover:bg-ink-500 text-ink-50 py-1.5 text-sm"
      >
        Create
      </button>
    </form>
  );
}
