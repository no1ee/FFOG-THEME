import { EventEmitter } from "node:events";
import path from "node:path";
import { ClaudeSession } from "./session.js";
import { Registry } from "./registry.js";
import type { Project, ProjectEvent } from "./types.js";

const TRANSCRIPT_DIR = path.resolve(process.cwd(), "../data/sessions");

export type StreamMessage =
  | { type: "run.start"; projectId: string; runId: string; prompt: string; ts: number }
  | { type: "delta"; projectId: string; runId: string; text: string; ts: number }
  | {
      type: "run.end";
      projectId: string;
      runId: string;
      ok: boolean;
      cancelled: boolean;
      ts: number;
    };

/**
 * Tracks one ClaudeSession per project. Enforces isolation by construction:
 * the only way to talk to a project's claude process is via this manager,
 * and the manager refuses any cross-project lookups.
 *
 * Two emitter channels:
 *   "event"  → persisted in SQLite, used for the activity log
 *   "stream" → live-only (deltas, run.start, run.end), broadcast via WS but
 *              never written to the event log to avoid noise
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
    session.on("stderr", (info) =>
      this.recordEvent(project.id, "claude.stderr", info),
    );

    session.on("run.start", (info: { runId: string; prompt: string }) => {
      const ts = Date.now();
      this.emit("stream", {
        type: "run.start",
        projectId: project.id,
        runId: info.runId,
        prompt: info.prompt,
        ts,
      } satisfies StreamMessage);
      this.recordEvent(project.id, "run.start", {
        runId: info.runId,
        prompt: truncate(info.prompt, 200),
      });
    });

    session.on("delta", (info: { runId: string; text: string }) => {
      this.emit("stream", {
        type: "delta",
        projectId: project.id,
        runId: info.runId,
        text: info.text,
        ts: Date.now(),
      } satisfies StreamMessage);
    });

    session.on(
      "run.end",
      (info: { runId: string; ok: boolean; cancelled: boolean }) => {
        const ts = Date.now();
        this.emit("stream", {
          type: "run.end",
          projectId: project.id,
          runId: info.runId,
          ok: info.ok,
          cancelled: info.cancelled,
          ts,
        } satisfies StreamMessage);
        this.recordEvent(project.id, "run.end", info);
      },
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

  cancelCurrent(projectId: string): string | null {
    const s = this.sessions.get(projectId);
    if (!s) return null;
    return s.cancelCurrent();
  }

  cancelRun(projectId: string, runId: string): boolean {
    const s = this.sessions.get(projectId);
    if (!s) return false;
    return s.cancel(runId);
  }

  send(projectId: string, prompt: string): { runId: string; promise: Promise<string> } {
    const project = Registry.getProject(projectId);
    if (!project) {
      const err = new Error(`unknown project: ${projectId}`);
      return { runId: "", promise: Promise.reject(err) };
    }
    const session = this.getOrSpawn(project);
    this.recordEvent(projectId, "user.instruction", {
      prompt: truncate(prompt, 500),
    });
    return session.enqueue(prompt);
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
