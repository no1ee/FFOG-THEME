import express from "express";
import cors from "cors";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Registry } from "./registry.js";
import { sessionManager } from "./manager.js";
import { scheduler, executeSuggestion } from "./scheduler.js";
import type { Autonomy, CheckCategory } from "./types.js";

const PORT = Number(process.env.FFOG_PORT ?? 5174);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/projects", (_req, res) => {
  res.json(Registry.listProjects());
});

app.post("/api/projects", (req, res) => {
  const { name, cwd, autonomy, category } = req.body ?? {};
  const errors = validateProjectInput({ name, cwd, autonomy, category });
  if (errors.length) {
    res.status(400).json({ errors });
    return;
  }
  const resolvedCwd = path.resolve(cwd);
  if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
    res.status(400).json({ errors: ["cwd does not exist or is not a directory"] });
    return;
  }
  const project = Registry.addProject({
    name,
    cwd: resolvedCwd,
    autonomy,
    category,
  });
  broadcast({ type: "project.update", data: project });
  res.json(project);
});

app.patch("/api/projects/:id", (req, res) => {
  const { name, autonomy, category } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (typeof name === "string") patch.name = name;
  if (autonomy === "auto" || autonomy === "approval") patch.autonomy = autonomy;
  if (isCategory(category)) patch.category = category;
  const updated = Registry.updateProject(req.params.id, patch as any);
  if (!updated) {
    res.status(404).json({ error: "not found" });
    return;
  }
  broadcast({ type: "project.update", data: updated });
  res.json(updated);
});

app.delete("/api/projects/:id", (req, res) => {
  sessionManager.killProject(req.params.id);
  const removed = Registry.removeProject(req.params.id);
  res.json({ removed });
});

app.get("/api/projects/:id/events", (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  res.json(Registry.recentEvents(req.params.id, limit));
});

app.get("/api/projects/:id/suggestions", (req, res) => {
  res.json(Registry.listSuggestions(req.params.id));
});

app.post("/api/projects/:id/instruction", async (req, res) => {
  const { prompt } = req.body ?? {};
  if (typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt required" });
    return;
  }
  try {
    const reply = await sessionManager.send(req.params.id, prompt);
    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.post("/api/projects/:id/check", async (req, res) => {
  try {
    const suggestions = await scheduler.runOnce(req.params.id);
    res.json({ suggestions });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

app.post("/api/suggestions/:id/approve", async (req, res) => {
  const updated = Registry.setSuggestionStatus(req.params.id, "approved");
  if (!updated) {
    res.status(404).json({ error: "not found" });
    return;
  }
  broadcast({ type: "suggestion", data: updated });
  void executeSuggestion(updated);
  res.json(updated);
});

app.post("/api/suggestions/:id/reject", (req, res) => {
  const updated = Registry.setSuggestionStatus(req.params.id, "rejected");
  if (!updated) {
    res.status(404).json({ error: "not found" });
    return;
  }
  broadcast({ type: "suggestion", data: updated });
  res.json(updated);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const clients = new Set<WebSocket>();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: "snapshot",
      data: {
        projects: Registry.listProjects(),
        suggestions: Registry.listSuggestions(),
      },
    }),
  );
  ws.on("close", () => clients.delete(ws));
});

function broadcast(msg: unknown): void {
  const json = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(json);
  }
}

sessionManager.on("event", (event) => {
  broadcast({ type: "event", data: event });
});

scheduler.start();

server.listen(PORT, () => {
  console.log(`[ffog] backend listening on http://localhost:${PORT}`);
});

function validateProjectInput(input: {
  name: unknown;
  cwd: unknown;
  autonomy: unknown;
  category: unknown;
}): string[] {
  const errors: string[] = [];
  if (typeof input.name !== "string" || !input.name.trim())
    errors.push("name required");
  if (typeof input.cwd !== "string" || !input.cwd.trim())
    errors.push("cwd required");
  if (input.autonomy !== "auto" && input.autonomy !== "approval")
    errors.push("autonomy must be auto|approval");
  if (!isCategory(input.category)) errors.push("invalid category");
  return errors;
}

function isCategory(x: unknown): x is CheckCategory {
  return (
    x === "direction" ||
    x === "todos" ||
    x === "gaps" ||
    x === "enhancements" ||
    x === "improvements"
  );
}
