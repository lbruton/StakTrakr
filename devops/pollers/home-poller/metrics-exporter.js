#!/usr/bin/env node
/**
 * StakTrakr Prometheus Metrics Exporter
 * =======================================
 * Exposes /metrics on port 9100 in Prometheus text format.
 * Scraped by Prometheus every 15s, visualized in Grafana.
 *
 * Sources:
 *   - /proc (CPU, memory, network, uptime)
 *   - supervisorctl (service health inside container)
 *   - sqld poller_runs (last run stats per poller)
 *   - sqld provider_failures (failure queue stats)
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createClient } from "@libsql/client";

const PORT = parseInt(process.env.METRICS_PORT || "9100", 10);
const IFACE = process.env.NET_IFACE || "ens18";

// Load .env
(function loadEnv() {
  const envFile = new URL(".env", import.meta.url).pathname;
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
})();

/**
 * Returns a configured sqld client, or null if no DB URL env is set.
 * @returns {import('@libsql/client').Client|null}
 */
function getSqldClient() {
  const useSqld = Boolean(process.env.SQLD_URL);
  const url = useSqld ? process.env.SQLD_URL : process.env.TURSO_DATABASE_URL;
  const authToken = useSqld ? process.env.SQLD_AUTH_TOKEN : process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;
  try {
    return createClient({ url, ...(authToken ? { authToken } : {}) });
  } catch (err) {
    console.error("[metrics] getSqldClient failed:", err?.message || err);
    return null;
  }
}

// ── System collectors ────────────────────────────────────────────────────────

function collectSystem() {
  const metrics = [];

  try {
    const secs = parseFloat(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
    metrics.push(`poller_uptime_seconds ${secs}`);
  } catch {
    metrics.push("poller_uptime_seconds 0");
  }

  try {
    const [l1, l5, l15] = readFileSync("/proc/loadavg", "utf8").trim().split(" ");
    metrics.push(`poller_cpu_load1 ${l1}`);
    metrics.push(`poller_cpu_load5 ${l5}`);
    metrics.push(`poller_cpu_load15 ${l15}`);
  } catch {}

  try {
    const mem = readFileSync("/proc/meminfo", "utf8");
    const total = parseInt(mem.match(/MemTotal:\s+(\d+)/)[1], 10);
    const avail = parseInt(mem.match(/MemAvailable:\s+(\d+)/)[1], 10);
    metrics.push(`poller_mem_used_pct ${(((total - avail) / total) * 100).toFixed(2)}`);
    metrics.push(`poller_mem_total_bytes ${total * 1024}`);
    metrics.push(`poller_mem_avail_bytes ${avail * 1024}`);
  } catch {}

  try {
    const raw = readFileSync("/proc/net/dev", "utf8");
    const line = raw.split("\n").find((l) => l.trim().startsWith(IFACE + ":"));
    if (line) {
      const cols = line.trim().split(/\s+/);
      metrics.push(`poller_net_rx_bytes{iface="${IFACE}"} ${cols[1]}`);
      metrics.push(`poller_net_tx_bytes{iface="${IFACE}"} ${cols[9]}`);
    }
  } catch {}

  return metrics;
}

// ── Service health ───────────────────────────────────────────────────────────

function collectServices() {
  const metrics = [];

  try {
    const out = execSync(
      "/usr/bin/supervisorctl -c /etc/supervisor/supervisord.conf status 2>/dev/null",
      { timeout: 3000 }
    ).toString();
    for (const line of out.trim().split("\n")) {
      const m = line.match(/^(\S+)\s+(\S+)/);
      if (m) {
        metrics.push(
          `poller_service_up{service="${m[1]}",manager="supervisord"} ${m[2] === "RUNNING" ? 1 : 0}`
        );
      }
    }
  } catch {}

  // No systemd inside Docker — redis, rabbitmq, tinyproxy run in separate containers

  return metrics;
}

// ── sqld metrics ─────────────────────────────────────────────────────────────

async function collectTurso() {
  const metrics = [];
  const client = getSqldClient();
  if (!client) {
    metrics.push("poller_turso_up 0");
    return metrics;
  }

  let tursoUp = false;
  try {
    await client.execute("SELECT 1");
    tursoUp = true;
    metrics.push("poller_turso_up 1");

    const runs = await client.execute(`
      SELECT poller_id, captured, failures, total, started_at, finished_at
      FROM poller_runs
      WHERE (poller_id, started_at) IN (
        SELECT poller_id, MAX(started_at) FROM poller_runs GROUP BY poller_id
      )
    `);

    for (const r of runs.rows) {
      const pid = r.poller_id;
      const captured = r.captured ?? 0;
      const failures = r.failures ?? 0;
      const total = r.total ?? 0;
      const rate = total > 0 ? captured / total : 0;
      let durationSecs = 0;
      if (r.started_at && r.finished_at) {
        durationSecs = (new Date(r.finished_at) - new Date(r.started_at)) / 1000;
      }
      metrics.push(`poller_run_captured{poller_id="${pid}"} ${captured}`);
      metrics.push(`poller_run_failures{poller_id="${pid}"} ${failures}`);
      metrics.push(`poller_run_total{poller_id="${pid}"} ${total}`);
      metrics.push(`poller_run_capture_rate{poller_id="${pid}"} ${rate.toFixed(4)}`);
      metrics.push(`poller_run_duration_seconds{poller_id="${pid}"} ${durationSecs.toFixed(1)}`);
    }

    const pfail = await client.execute(`
      SELECT coin_slug, vendor_id, COUNT(*) as cnt
      FROM provider_failures
      WHERE failed_at > datetime('now', '-10 days')
      GROUP BY coin_slug, vendor_id
    `);
    for (const r of pfail.rows) {
      metrics.push(
        `poller_provider_failures_total{coin_slug="${r.coin_slug}",vendor_id="${r.vendor_id}"} ${r.cnt}`
      );
    }

    const fcount = await client.execute(`
      SELECT COUNT(*) as cnt FROM (
        SELECT vendor_id FROM provider_failures
        WHERE failed_at > datetime('now', '-10 days')
        GROUP BY coin_slug, vendor_id, url
        HAVING COUNT(*) >= 3
      )
    `);
    metrics.push(`poller_failing_providers_count ${fcount.rows[0]?.cnt ?? 0}`);

    await client.close();
  } catch (err) {
    try {
      await client.close();
    } catch {}
    if (!tursoUp) metrics.push("poller_turso_up 0");
    console.error("[metrics] Turso error:", err.message);
  }

  return metrics;
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  if (req.url !== "/metrics") {
    res.writeHead(404);
    res.end("Not found — use /metrics");
    return;
  }

  const [system, services, turso] = await Promise.all([
    Promise.resolve(collectSystem()),
    Promise.resolve(collectServices()),
    collectTurso(),
  ]);

  const body = [...system, ...services, ...turso].join("\n") + "\n";
  res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  res.end(body);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[metrics-exporter] Listening on http://0.0.0.0:${PORT}/metrics`);
});
