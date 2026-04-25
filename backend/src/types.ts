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

export type EventKind =
  | "session.spawn"
  | "session.exit"
  | "session.error"
  | "user.instruction"
  | "router.dispatch"
  | "claude.stdout"
  | "claude.stderr"
  | "check.start"
  | "check.result"
  | "suggestion.created"
  | "suggestion.approved"
  | "suggestion.rejected"
  | "suggestion.executed";

export interface ProjectEvent {
  id: number;
  projectId: string;
  kind: EventKind;
  payload: unknown;
  ts: number;
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

export interface ServerToClient {
  type: "snapshot" | "event" | "suggestion" | "project.update";
  data: unknown;
}

export interface ClientToServer {
  type:
    | "project.add"
    | "project.remove"
    | "project.update"
    | "instruction.send"
    | "suggestion.approve"
    | "suggestion.reject"
    | "check.run";
  data: Record<string, unknown>;
}
