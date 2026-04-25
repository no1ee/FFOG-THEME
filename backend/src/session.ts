import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface ClaudeSessionOptions {
  projectId: string;
  sessionId: string;
  cwd: string;
  binary?: string;
  model?: string;
  systemPreamble?: string;
  transcriptDir: string;
}

export class CancelledError extends Error {
  constructor() {
    super("run cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Owns a single `claude` CLI subprocess pinned to one project.
 *
 * Sanitation guarantees:
 *   - cwd is fixed at construction time and never changed
 *   - sessionId is fixed; we always invoke with --session-id <id>
 *   - prompts are tagged with [project:<id>] before forwarding
 *   - one prompt at a time per session (queued); no interleaving
 *   - kill() spawns a fresh subprocess on next send (no reuse on suspected contamination)
 */
export class ClaudeSession extends EventEmitter {
  readonly projectId: string;
  readonly sessionId: string;
  readonly cwd: string;
  private readonly binary: string;
  private readonly model: string;
  private readonly systemPreamble: string;
  private readonly transcriptPath: string;

  private queue: Array<{
    runId: string;
    prompt: string;
    resolve: (value: string) => void;
    reject: (err: Error) => void;
  }> = [];
  private busy = false;
  private currentRunId: string | null = null;
  private currentChild: ChildProcessWithoutNullStreams | null = null;
  private currentCancelled = false;

  constructor(opts: ClaudeSessionOptions) {
    super();
    this.projectId = opts.projectId;
    this.sessionId = opts.sessionId;
    this.cwd = opts.cwd;
    this.binary = opts.binary ?? "claude";
    this.model = opts.model ?? "claude-opus-4-7";
    this.systemPreamble =
      opts.systemPreamble ??
      "You are pinned to a single project. Never act on or reference any other project. Treat every instruction as scoped to this cwd.";
    fs.mkdirSync(opts.transcriptDir, { recursive: true });
    this.transcriptPath = path.join(
      opts.transcriptDir,
      `${this.projectId}.jsonl`,
    );
  }

  /** Enqueue a prompt. Returns the runId so callers can target cancel(). */
  enqueue(prompt: string): { runId: string; promise: Promise<string> } {
    const runId = randomUUID();
    const promise = new Promise<string>((resolve, reject) => {
      this.queue.push({ runId, prompt, resolve, reject });
      void this.drain();
    });
    return { runId, promise };
  }

  /** Convenience for callers that only care about the final text. */
  send(prompt: string): Promise<string> {
    return this.enqueue(prompt).promise;
  }

  /** Cancel a specific run. If it's running, kill the child; if queued, drop it. */
  cancel(runId: string): boolean {
    if (this.currentRunId === runId && this.currentChild && !this.currentChild.killed) {
      this.currentCancelled = true;
      this.currentChild.kill("SIGTERM");
      return true;
    }
    const idx = this.queue.findIndex((q) => q.runId === runId);
    if (idx !== -1) {
      const [item] = this.queue.splice(idx, 1);
      item.reject(new CancelledError());
      return true;
    }
    return false;
  }

  /** Cancel whatever is currently in flight (if any). Queue is preserved. */
  cancelCurrent(): string | null {
    if (this.currentRunId && this.currentChild && !this.currentChild.killed) {
      const id = this.currentRunId;
      this.currentCancelled = true;
      this.currentChild.kill("SIGTERM");
      return id;
    }
    return null;
  }

  /** Hard-kill: drop the queue and the in-flight run. */
  kill(): void {
    if (this.currentChild && !this.currentChild.killed) {
      this.currentCancelled = true;
      this.currentChild.kill("SIGTERM");
    }
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject(new CancelledError());
    }
    this.busy = false;
  }

  currentRun(): string | null {
    return this.currentRunId;
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    this.currentRunId = next.runId;
    this.currentCancelled = false;
    try {
      const result = await this.runOnce(next.runId, next.prompt);
      next.resolve(result);
    } catch (err) {
      next.reject(err as Error);
    } finally {
      this.busy = false;
      this.currentRunId = null;
      if (this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private runOnce(runId: string, rawPrompt: string): Promise<string> {
    const taggedPrompt = `[project:${this.projectId}] ${rawPrompt}`;
    const args = [
      "-p",
      taggedPrompt,
      "--session-id",
      this.sessionId,
      "--model",
      this.model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--append-system-prompt",
      this.systemPreamble,
    ];

    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.binary, args, {
          cwd: this.cwd,
          env: { ...process.env, FFOG_PROJECT_ID: this.projectId },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        reject(err as Error);
        return;
      }
      this.currentChild = child;
      this.emit("spawn", { sessionId: this.sessionId });
      this.emit("run.start", { runId, prompt: rawPrompt });

      const transcript = fs.createWriteStream(this.transcriptPath, {
        flags: "a",
      });
      transcript.write(
        JSON.stringify({
          ts: Date.now(),
          dir: "in",
          runId,
          prompt: taggedPrompt,
        }) + "\n",
      );

      const finalText: string[] = [];
      let sawDeltas = false;
      let stdoutBuf = "";
      let stderrBuf = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        let nl: number;
        while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
          const line = stdoutBuf.slice(0, nl).trim();
          stdoutBuf = stdoutBuf.slice(nl + 1);
          if (!line) continue;
          let parsed: any = null;
          try {
            parsed = JSON.parse(line);
          } catch {
            // ignore non-json
          }
          transcript.write(
            JSON.stringify({ ts: Date.now(), dir: "out", runId, line: parsed ?? line }) +
              "\n",
          );
          if (parsed && typeof parsed === "object") {
            const delta = extractTextDelta(parsed);
            if (delta) {
              sawDeltas = true;
              this.emit("delta", { runId, text: delta });
            }
            const finalChunk = extractAssistantText(parsed);
            if (finalChunk) {
              finalText.push(finalChunk);
              // Fallback: if the CLI build doesn't emit partial messages, push
              // the assistant message as a single delta so the UI still renders.
              if (!sawDeltas) {
                this.emit("delta", { runId, text: finalChunk });
              }
            }
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        const s = chunk.toString("utf8");
        stderrBuf += s;
        this.emit("stderr", { raw: s });
      });

      child.on("error", (err) => {
        transcript.end();
        this.emit("error", err);
        this.emit("run.end", { runId, ok: false, cancelled: this.currentCancelled });
        reject(err);
      });

      child.on("exit", (code, signal) => {
        transcript.end();
        const cancelled = this.currentCancelled;
        this.currentChild = null;
        this.emit("exit", { code, signal });
        if (cancelled) {
          this.emit("run.end", { runId, ok: false, cancelled: true });
          reject(new CancelledError());
          return;
        }
        if (code === 0) {
          this.emit("run.end", { runId, ok: true, cancelled: false });
          resolve(finalText.join("\n").trim());
        } else {
          this.emit("run.end", { runId, ok: false, cancelled: false });
          reject(
            new Error(
              `claude exited with code=${code} signal=${signal} stderr=${stderrBuf.slice(0, 500)}`,
            ),
          );
        }
      });
    });
  }
}

/**
 * Pull a token-level text delta from a partial-message stream event, if any.
 * The CLI emits, e.g.:
 *   { type: "stream_event", event: { type: "content_block_delta",
 *     delta: { type: "text_delta", text: "..." } } }
 */
function extractTextDelta(msg: any): string | null {
  if (msg.type !== "stream_event") return null;
  const ev = msg.event;
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "content_block_delta") {
    const d = ev.delta;
    if (d?.type === "text_delta" && typeof d.text === "string") return d.text;
  }
  return null;
}

/**
 * Pull the *final* assistant text once a complete assistant message arrives,
 * for transcript / fallback purposes. Partial deltas are handled separately.
 */
function extractAssistantText(msg: any): string | null {
  if (msg.type === "assistant" && msg.message?.content) {
    const parts: string[] = [];
    for (const block of msg.message.content) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return parts.join("\n");
  }
  if (msg.type === "result" && typeof msg.result === "string") {
    return msg.result;
  }
  return null;
}
