import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
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

export interface ClaudeStreamEvent {
  raw: string;
  parsed: unknown;
}

/**
 * Owns a single `claude` CLI subprocess pinned to one project.
 *
 * Sanitation guarantees:
 *   - cwd is fixed at construction time and never changed
 *   - sessionId is fixed; we always invoke with --session-id <id> --resume
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
    prompt: string;
    resolve: (value: string) => void;
    reject: (err: Error) => void;
  }> = [];
  private busy = false;
  private currentChild: ChildProcessWithoutNullStreams | null = null;

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

  send(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ prompt, resolve, reject });
      void this.drain();
    });
  }

  kill(): void {
    if (this.currentChild && !this.currentChild.killed) {
      this.currentChild.kill("SIGTERM");
    }
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.reject(new Error("session killed"));
    }
    this.busy = false;
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    try {
      const result = await this.runOnce(next.prompt);
      next.resolve(result);
    } catch (err) {
      next.reject(err as Error);
    } finally {
      this.busy = false;
      if (this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private runOnce(rawPrompt: string): Promise<string> {
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

      const transcript = fs.createWriteStream(this.transcriptPath, {
        flags: "a",
      });
      transcript.write(
        JSON.stringify({
          ts: Date.now(),
          dir: "in",
          prompt: taggedPrompt,
        }) + "\n",
      );

      const finalText: string[] = [];
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
            JSON.stringify({ ts: Date.now(), dir: "out", line: parsed ?? line }) +
              "\n",
          );
          this.emit("stdout", { raw: line, parsed });
          if (parsed && typeof parsed === "object") {
            const text = extractAssistantText(parsed);
            if (text) finalText.push(text);
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
        reject(err);
      });

      child.on("exit", (code, signal) => {
        transcript.end();
        this.currentChild = null;
        this.emit("exit", { code, signal });
        if (code === 0) {
          resolve(finalText.join("\n").trim());
        } else {
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
