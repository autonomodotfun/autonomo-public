// Gloam for the CLI's --private: starts Gloam's own MCP server on this machine and calls its paid-fetch tool.
//
// The Gloam key never comes near Autonomo's code. Gloam's server reads it, with its own spending limits, from
// ~/.gloam/agent.env (see autonomo.fun/docs/sdk#pay-privately-with-gloam). This file only speaks the MCP stdio
// protocol to that server: one JSON-RPC message per line. It is written out here instead of using an MCP client
// library so `npx autonomo-sdk` stays a small download.

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { GloamFetchPaid, GloamResult } from "./index.js";

/** A running Gloam server. */
export type GloamSession = {
  /** Pays for one request from the private balance, or presents a payment made earlier (`paymentHeader`). */
  fetchPaid: (args: Parameters<GloamFetchPaid>[0] | { url: string; paymentHeader: string; prefer: "gloam-cashout" }) => Promise<GloamResult>;
  close: () => Promise<void>;
};

export type GloamServer = { command: string; args: string[] };

/** `npx -y @gloamtrade/mcp`. On Windows npx is a script, so it's started through cmd. */
export const defaultGloamServer = (): GloamServer =>
  process.platform === "win32" ? { command: "cmd", args: ["/c", "npx", "-y", "@gloamtrade/mcp"] } : { command: "npx", args: ["-y", "@gloamtrade/mcp"] };

// The first run downloads Gloam's server, and a private payment builds its proofs on this machine.
const START_MS = 120_000;
const PAY_MS = 300_000;

/** What Gloam's server is started with: everything it may need, but never Autonomo's own wallet key or settings. */
export function gloamEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !/^AUTONOMO_/i.test(e[0])));
}

export async function startGloam(
  env: Record<string, string | undefined>,
  server: GloamServer = defaultGloamServer(),
  version = "0",
  timeouts = { start: START_MS, pay: PAY_MS },
): Promise<GloamSession> {
  let child: ChildProcess;
  try {
    child = spawn(server.command, server.args, { env: gloamEnv(env), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } catch (e) {
    throw new Error(`Gloam's server couldn't be started: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The tail of what the server printed, for when it stops before answering.
  let tail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-400);
  });

  let nextId = 1;
  let stopped: string | null = null;
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (e: Error) => void }>();
  const stop = (why: string) => {
    stopped ??= why;
    for (const w of waiting.values()) w.reject(new Error(stopped));
    waiting.clear();
  };
  child.on("error", (e) => stop(`Gloam's server couldn't be started: ${e.message}`));
  child.on("exit", (code) => stop(`Gloam's server stopped${code === null ? "" : ` (exit ${code})`}${tail.trim() ? `: ${tail.trim().split(/\r?\n/).at(-1)}` : "."}`));
  // A write to a server that has gone must not crash the CLI: the exit handler reports it.
  child.stdin?.on("error", () => {});

  const send = (message: object) => child.stdin?.write(`${JSON.stringify(message)}\n`);
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let m: { id?: number; method?: string; result?: unknown; error?: { message?: string } };
    try {
      m = JSON.parse(line);
    } catch {
      return; // Not protocol: a stray log line.
    }
    if (m.method !== undefined) {
      // A request from the server: answer pings, decline anything else. Notifications need no answer.
      if (m.id !== undefined) send(m.method === "ping" ? { jsonrpc: "2.0", id: m.id, result: {} } : { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Not supported" } });
      return;
    }
    const w = m.id !== undefined ? waiting.get(m.id) : undefined;
    if (!w) return;
    waiting.delete(m.id!);
    if (m.error) w.reject(new Error(`Gloam: ${m.error.message ?? "request failed"}`));
    else w.resolve(m.result);
  });

  const request = <T>(method: string, params: object, ms: number, what: string) =>
    new Promise<T>((resolve, reject) => {
      if (stopped) return reject(new Error(stopped));
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`${what} took over ${Math.round(ms / 1000)} seconds.`));
      }, ms);
      waiting.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.stdin?.end(); // An MCP server exits when its input closes.
    const waited = await Promise.race([gone.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000).unref())]);
    if (waited) return;
    // Still there: stop it, and on Windows everything cmd started with it.
    if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    else child.kill();
  };

  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "autonomo-cli", version } }, timeouts.start, "Starting Gloam's server");
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
  } catch (e) {
    await close();
    throw e;
  }

  return {
    close,
    fetchPaid: async (args) => {
      const out = await request<{ content?: Array<{ type?: string; text?: string }>; isError?: boolean }>(
        "tools/call",
        { name: "gloam_fetch_paid", arguments: args },
        timeouts.pay,
        "The private payment",
      );
      const text = out.content?.find((c) => typeof c.text === "string")?.text ?? "";
      try {
        return JSON.parse(text) as GloamResult;
      } catch {
        // Gloam answers errors, such as a missing key or an empty balance, in plain words.
        return { status: "error", message: text.slice(0, 500) || "Gloam gave no answer." };
      }
    },
  };
}
