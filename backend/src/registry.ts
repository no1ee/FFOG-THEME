import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import type {
  Autonomy,
  CheckCategory,
  Project,
  ProjectEvent,
  Suggestion,
  SuggestionStatus,
} from "./types.js";

const DATA_DIR = path.resolve(process.cwd(), "../data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "ffog.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cwd TEXT NOT NULL UNIQUE,
    autonomy TEXT NOT NULL CHECK (autonomy IN ('auto','approval')),
    category TEXT NOT NULL,
    session_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_checked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    ts INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS events_project_ts ON events (project_id, ts);

  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    proposed_prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS suggestions_project_status ON suggestions (project_id, status);
`);

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    cwd: row.cwd,
    autonomy: row.autonomy as Autonomy,
    category: row.category as CheckCategory,
    sessionId: row.session_id,
    createdAt: row.created_at,
    lastCheckedAt: row.last_checked_at,
  };
}

function rowToEvent(row: any): ProjectEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    payload: JSON.parse(row.payload),
    ts: row.ts,
  };
}

function rowToSuggestion(row: any): Suggestion {
  return {
    id: row.id,
    projectId: row.project_id,
    category: row.category as CheckCategory,
    title: row.title,
    rationale: row.rationale,
    proposedPrompt: row.proposed_prompt,
    status: row.status as SuggestionStatus,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export const Registry = {
  listProjects(): Project[] {
    return db
      .prepare("SELECT * FROM projects ORDER BY created_at ASC")
      .all()
      .map(rowToProject);
  },

  getProject(id: string): Project | null {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? rowToProject(row) : null;
  },

  addProject(input: {
    name: string;
    cwd: string;
    autonomy: Autonomy;
    category: CheckCategory;
  }): Project {
    const id = randomUUID();
    const sessionId = randomUUID();
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO projects (id, name, cwd, autonomy, category, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.cwd,
      input.autonomy,
      input.category,
      sessionId,
      createdAt,
    );
    return {
      id,
      name: input.name,
      cwd: input.cwd,
      autonomy: input.autonomy,
      category: input.category,
      sessionId,
      createdAt,
      lastCheckedAt: null,
    };
  },

  updateProject(
    id: string,
    patch: Partial<Pick<Project, "name" | "autonomy" | "category" | "lastCheckedAt">>,
  ): Project | null {
    const existing = this.getProject(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    db.prepare(
      `UPDATE projects
       SET name = ?, autonomy = ?, category = ?, last_checked_at = ?
       WHERE id = ?`,
    ).run(
      merged.name,
      merged.autonomy,
      merged.category,
      merged.lastCheckedAt,
      id,
    );
    return merged;
  },

  removeProject(id: string): boolean {
    const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return result.changes > 0;
  },

  appendEvent(
    projectId: string,
    kind: ProjectEvent["kind"],
    payload: unknown,
  ): ProjectEvent {
    const ts = Date.now();
    const result = db
      .prepare(
        `INSERT INTO events (project_id, kind, payload, ts) VALUES (?, ?, ?, ?)`,
      )
      .run(projectId, kind, JSON.stringify(payload ?? null), ts);
    return {
      id: Number(result.lastInsertRowid),
      projectId,
      kind,
      payload: payload ?? null,
      ts,
    };
  },

  recentEvents(projectId: string, limit = 50): ProjectEvent[] {
    return db
      .prepare(
        `SELECT * FROM events WHERE project_id = ? ORDER BY ts DESC LIMIT ?`,
      )
      .all(projectId, limit)
      .map(rowToEvent)
      .reverse();
  },

  createSuggestion(input: Omit<Suggestion, "id" | "status" | "createdAt" | "resolvedAt">): Suggestion {
    const id = randomUUID();
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO suggestions
       (id, project_id, category, title, rationale, proposed_prompt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id,
      input.projectId,
      input.category,
      input.title,
      input.rationale,
      input.proposedPrompt,
      createdAt,
    );
    return {
      ...input,
      id,
      status: "pending",
      createdAt,
      resolvedAt: null,
    };
  },

  setSuggestionStatus(id: string, status: SuggestionStatus): Suggestion | null {
    const resolvedAt =
      status === "approved" || status === "rejected" || status === "done" || status === "failed"
        ? Date.now()
        : null;
    db.prepare(
      `UPDATE suggestions SET status = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?`,
    ).run(status, resolvedAt, id);
    const row = db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id);
    return row ? rowToSuggestion(row) : null;
  },

  listSuggestions(projectId?: string): Suggestion[] {
    const rows = projectId
      ? db
          .prepare(
            "SELECT * FROM suggestions WHERE project_id = ? ORDER BY created_at DESC",
          )
          .all(projectId)
      : db
          .prepare("SELECT * FROM suggestions ORDER BY created_at DESC")
          .all();
    return rows.map(rowToSuggestion);
  },
};
