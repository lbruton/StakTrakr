#!/usr/bin/env node
/**
 * Simple HTTP server for StakTrakrApi data (redundancy endpoint)
 * Serves static files from /tmp/staktrakr-api-export.
 *
 * Also exposes GET /health/sqld-reachable — runs `SELECT 1` against sqld
 * via the same libSQL client the publisher uses. Detects when the
 * Tailscale subnet route to home sqld is broken even though Fly.io
 * itself is up (STRK-6 + STRK-7).
 */

import { createServer } from "http";
import { readFile, stat } from "fs/promises";
import { join, resolve, extname } from "path";

const PORT = process.env.PORT || 8080;
const DATA_DIR = resolve(process.env.API_EXPORT_DIR || "/tmp/staktrakr-api-export");
const SQLD_PROBE_TIMEOUT_MS = 5000;

const MIME_TYPES = {
  ".json": "application/json",
  ".db": "application/x-sqlite3",
  ".html": "text/html",
  ".txt": "text/plain",
};

let sqldClient = null;

async function probeSqldReachable() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  let timeoutId;
  try {
    if (!sqldClient) {
      const { createSqldClient } = await import("./sqld-client.js");
      sqldClient = createSqldClient();
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("sqld probe timeout")), SQLD_PROBE_TIMEOUT_MS);
    });

    await Promise.race([sqldClient.execute("SELECT 1 AS ok"), timeoutPromise]);
    return { ok: true, latency_ms: Date.now() - startedAt, checked_at: checkedAt };
  } catch (err) {
    // Drop the cached client so the next probe attempts a fresh connection,
    // recovering from a stuck pool after a Tailscale-route flap.
    const clientToClose = sqldClient;
    sqldClient = null;
    clientToClose?.close().catch(() => {});
    const msg = String(err?.message || err);
    let errorClass = "query_error";
    if (msg.includes("timeout")) errorClass = "timeout";
    else if (msg.includes("ECONNREFUSED")) errorClass = "connection_refused";
    else if (msg.includes("EHOSTUNREACH") || msg.includes("ENETUNREACH"))
      errorClass = "host_unreachable";
    else if (msg.includes("ENOTFOUND")) errorClass = "dns_error";
    return {
      ok: false,
      error_class: errorClass,
      latency_ms: Date.now() - startedAt,
      checked_at: checkedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

const server = createServer(async (req, res) => {
  // CORS headers for API access
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("Method Not Allowed");
    return;
  }

  // Remove query string and decode URI
  let url;
  try {
    url = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  // Active sqld reachability probe — runs SELECT 1 against the libSQL
  // client. Always returns 200; the boolean result lives in `ok`. The
  // probe completing at all signals Fly.io itself is up.
  if (url === "/health/sqld-reachable") {
    const result = await probeSqldReachable();
    const body = JSON.stringify(result);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.end(body);
    return;
  }

  // Security: prevent directory traversal and absolute path escape
  const filePath = resolve(DATA_DIR, url.replace(/^\/+/, ""));
  if (!filePath.startsWith(DATA_DIR + "/") && filePath !== DATA_DIR) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  try {
    const stats = await stat(filePath);

    if (!stats.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await readFile(filePath);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
      "Cache-Control": "public, max-age=300", // 5 min cache
    });
    res.end(content);
  } catch (err) {
    if (err.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not Found");
    } else {
      console.error("Error serving", url, err);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`StakTrakrApi HTTP server listening on 0.0.0.0:${PORT}`);
  console.log(`Serving files from ${DATA_DIR}`);
});
