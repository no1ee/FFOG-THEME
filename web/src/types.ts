export type Autonomy = "auto" | "approval";

export type CheckCategory =
  | "direction"
  | "todos"
  | "gaps"
  | "enhancements"
  | "improvements";

export interface Project {
  id: string;
  name: string;
  cwd: string;
  autonomy: Autonomy;
  category: CheckCategory;
  sessionId: string;
  createdAt: number;
  lastCheckedAt: number | null;
}

export type SuggestionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "done"
  | "failed";

export interface Suggestion {
  id: string;
  projectId: string;
  category: CheckCategory;
  title: string;
  rationale: string;
  proposedPrompt: string;
  status: SuggestionStatus;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ProjectEvent {
  id: number;
  projectId: string;
  kind: string;
  payload: unknown;
  ts: number;
}

export const CATEGORIES: CheckCategory[] = [
  "direction",
  "todos",
  "gaps",
  "enhancements",
  "improvements",
];

export const CATEGORY_LABELS: Record<CheckCategory, string> = {
  direction: "Direction",
  todos: "To-dos",
  gaps: "Gap fillings",
  enhancements: "Enhancements",
  improvements: "Improvements",
};
