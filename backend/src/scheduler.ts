import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Registry } from "./registry.js";
import { router, type ProjectSignals } from "./router.js";
import { sessionManager } from "./manager.js";
import type { Project, Suggestion } from "./types.js";

const execFileP = promisify(execFile);

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(projectId: string): Promise<Suggestion[]> {
    const project = Registry.getProject(projectId);
    if (!project) throw new Error(`unknown project: ${projectId}`);
    return this.checkProject(project);
  }

  private async tick(): Promise<void> {
    const projects = Registry.listProjects();
    for (const project of projects) {
      if (this.running.has(project.id)) continue;
      this.running.add(project.id);
      this.checkProject(project)
        .catch((err) =>
          sessionManager.recordEvent(project.id, "session.error", {
            stage: "check",
            message: err.message,
          }),
        )
        .finally(() => this.running.delete(project.id));
    }
  }

  private async checkProject(project: Project): Promise<Suggestion[]> {
    sessionManager.recordEvent(project.id, "check.start", {
      category: project.category,
    });
    const signals = await collectSignals(project);
    const suggestions = await router.suggestFor(project, signals);
    Registry.updateProject(project.id, { lastCheckedAt: Date.now() });
    sessionManager.recordEvent(project.id, "check.result", {
      count: suggestions.length,
    });
    for (const s of suggestions) {
      sessionManager.recordEvent(project.id, "suggestion.created", {
        id: s.id,
        title: s.title,
      });
      if (project.autonomy === "auto") {
        void executeSuggestion(s);
      }
    }
    return suggestions;
  }
}

async function collectSignals(project: Project): Promise<ProjectSignals> {
  const [gitStatus, gitLog, todoMatches] = await Promise.all([
    safeRun("git", ["status", "--short"], project.cwd),
    safeRun("git", ["log", "-n", "10", "--oneline"], project.cwd),
    safeRun(
      "grep",
      ["-RInE", "(TODO|FIXME|XXX)", "--include=*.{ts,tsx,js,jsx,py,go,rs,md}", "."],
      project.cwd,
    ),
  ]);
  const recent = Registry.recentEvents(project.id, 20)
    .filter((e) => e.kind === "user.instruction")
    .slice(-5)
    .map((e) => {
      const p = e.payload as { prompt?: string } | null;
      return p?.prompt ?? "";
    })
    .filter(Boolean);
  return {
    gitStatus: gitStatus.slice(0, 4000),
    gitLog: gitLog.slice(0, 2000),
    todoMatches: todoMatches.slice(0, 4000),
    recentInstructions: recent,
  };
}

async function safeRun(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<string> {
  try {
    const { stdout } = await execFileP(cmd, args, {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    return err?.stdout ?? "";
  }
}

export async function executeSuggestion(s: Suggestion): Promise<void> {
  Registry.setSuggestionStatus(s.id, "executing");
  sessionManager.recordEvent(s.projectId, "suggestion.executed", {
    id: s.id,
    title: s.title,
  });
  try {
    await sessionManager.send(s.projectId, s.proposedPrompt);
    Registry.setSuggestionStatus(s.id, "done");
  } catch (err: any) {
    Registry.setSuggestionStatus(s.id, "failed");
    sessionManager.recordEvent(s.projectId, "session.error", {
      stage: "execute",
      suggestionId: s.id,
      message: err?.message ?? String(err),
    });
  }
}

export const scheduler = new Scheduler();
