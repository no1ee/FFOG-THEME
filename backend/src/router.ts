import path from "node:path";
import { ClaudeSession } from "./session.js";
import { Registry } from "./registry.js";
import type { CheckCategory, Project, Suggestion } from "./types.js";

const TRANSCRIPT_DIR = path.resolve(process.cwd(), "../data/sessions");
const ROUTER_SESSION_ID = "ffog-router-0001";
const ROUTER_CWD = path.resolve(process.cwd(), "../data");

/**
 * The "router" is a single Opus 4.7 session whose only job is to evaluate a
 * project's state and return a small JSON list of suggestions. It never edits
 * a project's files itself — that is the responsibility of the per-project
 * worker session. The router runs in its own cwd (the data dir) so it cannot
 * accidentally read or write a project's working tree.
 */
class Router {
  private session = new ClaudeSession({
    projectId: "__router__",
    sessionId: ROUTER_SESSION_ID,
    cwd: ROUTER_CWD,
    transcriptDir: TRANSCRIPT_DIR,
    systemPreamble:
      "You are the FFOG router. You analyze project state summaries and produce JSON suggestions only. You never read or edit files outside the data directory. You never reference a project other than the one explicitly passed in the current message.",
  });

  async suggestFor(project: Project, signals: ProjectSignals): Promise<Suggestion[]> {
    const prompt = buildRouterPrompt(project, signals);
    const reply = await this.session.send(prompt);
    const parsed = parseSuggestions(reply);
    return parsed.map((s) =>
      Registry.createSuggestion({
        projectId: project.id,
        category: project.category,
        title: s.title,
        rationale: s.rationale,
        proposedPrompt: s.proposedPrompt,
      }),
    );
  }
}

export interface ProjectSignals {
  gitStatus: string;
  gitLog: string;
  todoMatches: string;
  recentInstructions: string[];
}

function buildRouterPrompt(project: Project, signals: ProjectSignals): string {
  return [
    `Project: ${project.name} (id=${project.id})`,
    `Category focus: ${categoryHint(project.category)}`,
    `Autonomy: ${project.autonomy}`,
    "",
    "## git status",
    signals.gitStatus || "(clean or unavailable)",
    "",
    "## recent commits",
    signals.gitLog || "(none)",
    "",
    "## TODO/FIXME hits",
    signals.todoMatches || "(none)",
    "",
    "## recent user instructions",
    signals.recentInstructions.length
      ? signals.recentInstructions.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none)",
    "",
    "Return ONLY a JSON array of 0-3 suggestions, no prose. Schema:",
    `[{"title": "...", "rationale": "...", "proposedPrompt": "..."}]`,
    "Each proposedPrompt must be self-contained: a complete instruction the project's worker session can execute without further context.",
  ].join("\n");
}

function categoryHint(category: CheckCategory): string {
  switch (category) {
    case "direction":
      return "high-level direction and next milestone";
    case "todos":
      return "outstanding TODOs and unfinished work";
    case "gaps":
      return "missing tests, missing docs, missing error handling";
    case "enhancements":
      return "user-visible improvements and new capabilities";
    case "improvements":
      return "internal refactors, perf, and code quality";
  }
}

function parseSuggestions(reply: string): Array<{
  title: string;
  rationale: string;
  proposedPrompt: string;
}> {
  const trimmed = reply.trim();
  const jsonStart = trimmed.indexOf("[");
  const jsonEnd = trimmed.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x) =>
          x &&
          typeof x.title === "string" &&
          typeof x.rationale === "string" &&
          typeof x.proposedPrompt === "string",
      )
      .slice(0, 3);
  } catch {
    return [];
  }
}

export const router = new Router();
