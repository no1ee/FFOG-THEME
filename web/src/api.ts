import type { Autonomy, CheckCategory, Project, ProjectEvent, Suggestion } from "./types";

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listProjects: () => jfetch<Project[]>("/api/projects"),
  addProject: (input: {
    name: string;
    cwd: string;
    autonomy: Autonomy;
    category: CheckCategory;
  }) =>
    jfetch<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProject: (id: string, patch: Partial<Pick<Project, "name" | "autonomy" | "category">>) =>
    jfetch<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  removeProject: (id: string) =>
    jfetch<{ removed: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),
  events: (id: string) => jfetch<ProjectEvent[]>(`/api/projects/${id}/events`),
  suggestions: (id: string) =>
    jfetch<Suggestion[]>(`/api/projects/${id}/suggestions`),
  sendInstruction: (id: string, prompt: string) =>
    jfetch<{ reply: string }>(`/api/projects/${id}/instruction`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  runCheck: (id: string) =>
    jfetch<{ suggestions: Suggestion[] }>(`/api/projects/${id}/check`, {
      method: "POST",
    }),
  approve: (id: string) =>
    jfetch<Suggestion>(`/api/suggestions/${id}/approve`, { method: "POST" }),
  reject: (id: string) =>
    jfetch<Suggestion>(`/api/suggestions/${id}/reject`, { method: "POST" }),
};

export type WsMessage =
  | { type: "snapshot"; data: { projects: Project[]; suggestions: Suggestion[] } }
  | { type: "event"; data: ProjectEvent }
  | { type: "suggestion"; data: Suggestion }
  | { type: "project.update"; data: Project };

export function connectWs(onMessage: (msg: WsMessage) => void): () => void {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  ws.onmessage = (evt) => {
    try {
      onMessage(JSON.parse(evt.data));
    } catch {
      // ignore
    }
  };
  return () => ws.close();
}
