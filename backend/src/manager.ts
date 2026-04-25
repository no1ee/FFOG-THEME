import { EventEmitter } from "node:events";
import path from "node:path";
import { ClaudeSession } from "./session.js";
import { Registry } from "./registry.js";
import type { Project, ProjectEvent } from "./types.js";

const TRANSCRIPT_DIR = path.resolve(process.cwd(), "../data/sessions");

/**
 * Tracks one ClaudeSession per project. Enforces isolation by construction:
 * the only way to talk to a project's claude process is via this manager,
 * and the manager refuses any cross-project lookups.
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, ClaudeSession>();

  getOrSpawn(project: Project): ClaudeSession {
    const existing = this.sessions.get(project.id);
    if (existing) return existing;

    const session = new ClaudeSession({
      projectId: project.id,
      sessionId: project.sessionId,
      cwd: project.cwd,
      transcriptDir: TRANSCRIPT_DIR,
    });

    session.on("spawn", () =>
      this.recordEvent(project.id, "session.spawn", {
        sessionId: project.sessionId,
      }),
    );
    session.on("exit", (info) =>
      this.recordEvent(project.id, "session.exit", info),
    );
    session.on("error", (err: Error) =>
      this.recordEvent(project.id, "session.error", { message: err.message }),
    );
    session.on("stdout", (info) =>
      this.recordEvent(project.id, "claude.stdout", info),
    );
    session.on("stderr", (info) =>
      this.recordEvent(project.id, "claude.stderr", info),
    );

    this.sessions.set(project.id, session);
    return session;
  }

  killProject(projectId: string): void {
    const s = this.sessions.get(projectId);
    if (s) {
      s.kill();
      this.sessions.delete(projectId);
    }
  }

  send(projectId: string, prompt: string): Promise<string> {
    const project = Registry.getProject(projectId);
    if (!project) {
      return Promise.reject(new Error(`unknown project: ${projectId}`));
    }
    const session = this.getOrSpawn(project);
    this.recordEvent(projectId, "user.instruction", {
      prompt: truncate(prompt, 500),
    });
    return session.send(prompt);
  }

  recordEvent(
    projectId: string,
    kind: ProjectEvent["kind"],
    payload: unknown,
  ): ProjectEvent {
    const event = Registry.appendEvent(projectId, kind, payload);
    this.emit("event", event);
    return event;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export const sessionManager = new SessionManager();
