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
import { resolve, extname } from "path";

import { probeSqldReachable } from "./sqld-probe.js";

const PORT = process.env.PORT || 8080;
const DATA_DIR = resolve(process.env.API_EXPORT_DIR || "/tmp/staktrakr-api-export");

const MIME_TYPES = {
  ".json": "application/json",
  ".db": "application/x-sqlite3",
  ".html": "text/html",
  ".txt": "text/plain",
};

// Last-resort guards. This process is the api2 origin and is supervised, but a
// restart loop still surfaces as 502s at the Fly proxy, so an unexpected async
// throw must never be allowed to terminate it (STRK-277).
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (ignored, server stays up):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (ignored, server stays up):", err);
});

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
    // probeSqldReachable() is contracted never to reject, but this endpoint is
    // the one path that touches the network on every hit — belt-and-braces so a
    // future regression degrades the response instead of the process.
    let result;
    try {
      result = await probeSqldReachable();
    } catch (err) {
      console.error("sqld probe threw unexpectedly:", err);
      result = { ok: false, error_class: "probe_error", checked_at: new Date().toISOString() };
    }
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
