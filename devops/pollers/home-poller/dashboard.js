#!/usr/bin/env node
/**
 * StakTrakr Home Poller Dashboard
 * =================================
 * Lightweight HTTP dashboard — no external dependencies beyond @libsql/client
 * (already in package.json). Shows: system stats, network bandwidth, service
 * health, poller run history, provider CRUD editor, and failure queue.
 *
 * Usage:  node dashboard.js
 * Port:   3010 (configurable via DASHBOARD_PORT env)
 *
 * @see STAK-349 — Provider Editor Dashboard: Full Turso CRUD UI
 */

import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import {
  initProviderSchema,
  getProviders,
  getAllCoins,
  upsertCoin,
  upsertVendor,
  updateVendorUrl,
  toggleVendor,
  deleteCoin,
  deleteVendor,
  updateVendorFields,
  getVendorHints,
  updateVendorHints,
  getVendorScrapeStatus,
  getFailureStats,
  getFailureTrend,
  getRunStats,
  getCoverageStats,
  getSpotCoverage,
  getMissingItems,
  exportProvidersJson,
  batchToggleVendor,
  batchDeleteVendor,
  getVendorSummary,
  loadProviders,
  getLastScanFailures,
  clearChronicFailure,
  clearAllChronicFailures,
  getProvidersByVendor,
} from "./provider-db.js";
import {
  getFeedIndex,
  parseHintsProductId,
  mergeHintsProductId,
} from "./price-extract-mintbuilder-feed.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Load .env if not already in environment.
//
// MUST run before any const below reads process.env. The container exports its
// config directly, but the LXC/bare-metal install (setup-lxc.sh) ships a .env
// beside the script instead — and every env-derived constant here is evaluated
// at module load. Declaring them above this call silently ignores the .env
// value and falls back to the default (STRK-323).
(function loadEnv() {
  const envFile = new URL(".env", import.meta.url).pathname;
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^[\x27\x22]|[\x27\x22]$/g, "");
  }
})();

const PORT = parseInt(process.env.DASHBOARD_PORT || "3010", 10);
const LOG_FILE = process.env.POLLER_LOG || "/data/logs/retail-poller.log";
const LOG_LINES = 300;
const IFACE = process.env.NET_IFACE || "eth0";
// Resolve the data root the same way every other poller script does, so the
// dashboard reads and writes the file export-providers-json.js actually
// produces (DATA_DIR/retail/providers.json). Deriving this from
// import.meta.url pointed at /app/data — the image layer — instead of the
// /data volume the compose file mounts, which silently broke both the
// sqld-down read fallback and POST /providers/export (STRK-323).
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, "../../data"));
const PROVIDERS_FILE = join(DATA_DIR, "retail", "providers.json");

// ---------------------------------------------------------------------------
// sqld client
/**
 * Create a libsql client using SQLD_URL/SQLD_AUTH_TOKEN when present, otherwise TURSO_DATABASE_URL/TURSO_AUTH_TOKEN.
 * @returns {object|null} A libsql client connected to the configured SQL endpoint, or `null` if no connection URL is set.
 */

function getSqldClient() {
  const useSqld = Boolean(process.env.SQLD_URL);
  const url = useSqld ? process.env.SQLD_URL : process.env.TURSO_DATABASE_URL;
  const authToken = useSqld ? process.env.SQLD_AUTH_TOKEN : process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;
  try {
    return createClient({ url, ...(authToken ? { authToken } : {}) });
  } catch (err) {
    console.error("[dashboard] getSqldClient failed:", err?.message || err);
    return null;
  }
}

/**
 * Check Turso Cloud DR backup connectivity (separate from primary sqld).
 * Uses TURSO_BACKUP_URL + TURSO_BACKUP_TOKEN env vars.
 * Returns { up: boolean, error?: string }
 */
async function checkTursoBackup() {
  const url = process.env.TURSO_BACKUP_URL;
  const authToken = process.env.TURSO_BACKUP_TOKEN;
  if (!url) return { up: false, error: "TURSO_BACKUP_URL not set" };
  try {
    const client = createClient({ url, ...(authToken ? { authToken } : {}) });
    await client.execute("SELECT 1");
    await client.close();
    return { up: true };
  } catch (err) {
    return { up: false, error: err.message };
  }
}

async function fetchRunsFromTurso() {
  const client = getSqldClient();
  if (!client) return null;
  try {
    const result = await client.execute({
      sql: `
        SELECT run_id, poller_id, started_at, finished_at, status,
               total, captured, failures, fbp_filled, error
        FROM poller_runs
        ORDER BY started_at DESC
        LIMIT 30
      `,
      args: [],
    });
    await client.close();
    return result.rows;
  } catch (err) {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function fetchFlyioRuns(client) {
  if (!client) return null;
  try {
    const result = await client.execute({
      sql: `
        SELECT poller_id, started_at, finished_at, status,
               total, captured, failures, error
        FROM poller_runs
        WHERE poller_id LIKE 'fly-%'
        ORDER BY started_at DESC
        LIMIT 10
      `,
      args: [],
    });
    return result.rows;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// System data collectors
// ---------------------------------------------------------------------------

function getNetStats() {
  try {
    const raw = readFileSync("/proc/net/dev", "utf8");
    const line = raw.split("\n").find((l) => l.trim().startsWith(IFACE + ":"));
    if (!line) return null;
    const cols = line.trim().split(/\s+/);
    return {
      rx_bytes: parseInt(cols[1], 10),
      rx_packets: parseInt(cols[2], 10),
      tx_bytes: parseInt(cols[9], 10),
      tx_packets: parseInt(cols[10], 10),
    };
  } catch {
    return null;
  }
}

function fmtBytes(n) {
  if (n == null) return "?";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + " KB";
  return n + " B";
}

function getCpuMem() {
  try {
    const load = readFileSync("/proc/loadavg", "utf8").trim().split(" ");
    const memRaw = readFileSync("/proc/meminfo", "utf8");
    const total = parseInt(memRaw.match(/MemTotal:\s+(\d+)/)[1], 10);
    const avail = parseInt(memRaw.match(/MemAvailable:\s+(\d+)/)[1], 10);
    const usedPct = (((total - avail) / total) * 100).toFixed(1);
    return { load1: load[0], load5: load[1], load15: load[2], memUsedPct: usedPct };
  } catch {
    return null;
  }
}

function getUptime() {
  try {
    const secs = parseFloat(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  } catch {
    return "?";
  }
}

const LOCK_FILES = [{ name: "Retail Poller", path: "/tmp/retail-poller.lock" }];

function getLockStatus() {
  return LOCK_FILES.map(({ name, path }) => {
    if (!existsSync(path)) return { name, path, locked: false, age: null };
    try {
      const stat = execSync(`stat -c %Y "${path}" 2>/dev/null || stat -f %m "${path}"`, {
        timeout: 2000,
      })
        .toString()
        .trim();
      const mtime = parseInt(stat, 10);
      const ageSec = Math.floor(Date.now() / 1000) - mtime;
      return { name, path, locked: true, age: ageSec };
    } catch {
      return { name, path, locked: true, age: null };
    }
  });
}

function getSupervisordStatus() {
  try {
    const out = execSync("supervisorctl status 2>/dev/null", { timeout: 3000 }).toString();
    return out
      .trim()
      .split("\n")
      .map((line) => {
        const m = line.match(/^(\S+)\s+(\S+)\s+(.*)/);
        if (!m) return { name: line, state: "UNKNOWN", detail: "" };
        return { name: m[1], state: m[2], detail: m[3] };
      });
  } catch {
    return [];
  }
}

function getSystemdStatus() {
  // No systemd inside Docker — redis, rabbitmq, tinyproxy run in separate containers
  return [];
}

function getDockerContainers() {
  try {
    const raw = execSync(
      'curl -sf --unix-socket /var/run/docker.sock "http://localhost/containers/json?all=true" 2>/dev/null || echo "[]"',
      { timeout: 5000 }
    )
      .toString()
      .trim();
    const all = JSON.parse(raw);
    return all
      .filter((c) => (c.Names?.[0] || "").match(/staktrakr|firecrawl|tailscale|tinyproxy/i))
      .map((c) => ({
        name: (c.Names?.[0] || "?").replace(/^\//, ""),
        image: (c.Image || "?").split(":")[0].split("/").pop(),
        state: c.State || "unknown",
        status: c.Status || "?",
      }));
  } catch {
    return [];
  }
}

function readLog() {
  if (!existsSync(LOG_FILE)) return [];
  try {
    const content = readFileSync(LOG_FILE, "utf8");
    const lines = content.split("\n").filter(Boolean);
    return lines.slice(-LOG_LINES);
  } catch {
    return ["(log unreadable)"];
  }
}

function getFlyioHealth() {
  try {
    const raw = readFileSync("/tmp/flyio-health.json", "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function stateColor(state) {
  if (state === "RUNNING") return "#22c55e";
  if (state === "STOPPED" || state === "FATAL" || state === "EXITED") return "#ef4444";
  return "#f59e0b";
}

function statusColor(status) {
  if (status === "ok") return "#22c55e";
  if (status === "error") return "#ef4444";
  if (status === "running") return "#38bdf8";
  return "#f59e0b";
}

function pollerBadgeColor(pollerId) {
  const colorMap = {
    home: "#34d399", // green — home retail
    "home-spot": "#818cf8", // indigo — home spot
    api: "#fb923c", // orange — fly retail
    "fly-spot": "#38bdf8", // sky blue — fly spot
    // Future names (STAK-367)
    "home-retail": "#34d399",
    "home-goldback": "#a3e635",
    "fly-retail": "#fb923c",
    "fly-goldback": "#fbbf24",
  };
  return colorMap[pollerId] || "#94a3b8";
}

/** Map current poller_id to display label (bridges old→new naming) */
function pollerDisplayName(pollerId) {
  const nameMap = {
    home: "home-retail",
    api: "fly-retail",
  };
  return nameMap[pollerId] || pollerId;
}

function fmtDateTime(iso) {
  if (!iso) return "\u2014";
  return iso
    .replace("T", " ")
    .replace(/\.\d+Z$/, "")
    .replace("Z", " UTC");
}

function fmtDuration(startedAt, finishedAt) {
  if (!finishedAt) return "running\u2026";
  const ms = new Date(finishedAt) - new Date(startedAt);
  if (ms < 0) return "?";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function logLineClass(line) {
  if (line.includes("\u2713")) return "log-ok";
  if (line.includes("\u26A0")) return "log-warn";
  if (line.includes("WARN:")) return "log-warn";
  if (line.includes("ERROR") || line.includes("error")) return "log-error";
  if (line.includes("Starting") || line.includes("Done.")) return "log-info";
  if (line.includes("FBP") || line.includes("\u21A9")) return "log-fbp";
  return "log-default";
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s) {
  return escHtml(s);
}

// RETAIL catalog metals — the provider_coins.metal vocabulary. Palladium is
// absent here on purpose (no palladium retail coins), and copper is absent for
// the same reason: Phase 1a is spot-only. Do not "complete" this list from the
// spot set — they are different vocabularies (STRK-303).
const METAL_COLORS = {
  silver: "#94a3b8",
  gold: "#fbbf24",
  goldback: "#a3e635",
  platinum: "#e2e8f0",
};

/**
 * SPOT metals, keyed by the lowercase ISO code the v2 API publishes.
 * Separate from METAL_COLORS above, which is the retail catalog vocabulary.
 * @constant {string[]}
 */
const SPOT_ISO_ORDER = ["xau", "xag", "xpt", "xpd", "xcu"];

/** Display names for the spot ISO codes. @constant {Record<string,string>} */
const SPOT_ISO_NAMES = {
  xau: "Gold",
  xag: "Silver",
  xpt: "Platinum",
  xpd: "Palladium",
  xcu: "Copper",
};

/** Chart colours for the spot ISO codes. @constant {Record<string,string>} */
const SPOT_ISO_COLORS = {
  xau: "#fbbf24",
  xag: "#c0c0c0",
  xpt: "#a78bfa",
  xpd: "#f97316",
  xcu: "#b87333",
};

/** Number of tracked spot metals — the run-log denominator. @constant {number} */
const SPOT_METAL_COUNT = SPOT_ISO_ORDER.length;

function metalBadge(metal) {
  const color = METAL_COLORS[metal] || "#94a3b8";
  return `<span class="badge" style="background:${color};color:#0f172a">${escHtml(metal)}</span>`;
}

// ---------------------------------------------------------------------------
// Shared CSS
// ---------------------------------------------------------------------------

const SHARED_CSS = `
  :root {
    --bg: #0f172a; --surface: #1e293b; --border: #334155;
    --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8;
    --green: #22c55e; --red: #ef4444; --amber: #f59e0b;
    --surface2: #253348;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; white-space: nowrap; }
  .err-text { color: #f87171; font-size: 11px; }
  .no-data { color: var(--muted); font-style: italic; font-size: 12px; padding: 8px 0; }
  .msg { padding: 10px; border-radius: 4px; margin-bottom: 16px; display: none; }
  .msg-ok { background: #14532d; color: #86efac; display: block; }
  .msg-err { background: #7f1d1d; color: #fca5a5; display: block; }
  button { cursor: pointer; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; font-weight: 600; }
  input[type=text], input[type=number], select, textarea {
    background: #0f172a; border: 1px solid var(--border); color: var(--text);
    padding: 4px 6px; border-radius: 4px; font-size: 13px;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 4px 6px; color: var(--muted); font-weight: 600; border-bottom: 2px solid var(--border); font-size: 10px; text-transform: uppercase; }
  td { padding: 4px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: rgba(56, 189, 248, 0.03); }
  .btn-sm { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: var(--border); color: var(--text); border: none; cursor: pointer; display: inline-block; text-decoration: none; }
  .btn-sm:hover { background: var(--accent); color: #000; text-decoration: none; }
  .btn-sm.danger { background: var(--red); color: #fff; }
  .btn-sm.danger:hover { background: #dc2626; }
  .btn-sm.primary { background: var(--accent); color: #000; }
  .status { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; color: #fff; }
  .status-ok { background: var(--green); }
  .status-running { background: var(--accent); }
  .status-failed { background: var(--red); }
  .poller-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; text-transform: uppercase; color: #fff; }
  .poller-tag-hr { background: #7c3aed; }
  .poller-tag-hs { background: #06b6d4; }
  .poller-tag-fs { background: #0ea5e9; }
  .mini-bar { width: 60px; height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 4px; }
  .mini-bar div { height: 100%; border-radius: 2px; }
  .container { max-width: 1440px; margin: 0 auto; padding: 12px 16px; }
  .row { display: grid; gap: 12px; margin-bottom: 12px; }
  .row-2 { grid-template-columns: 1fr 1fr; }
  .row-3-1 { grid-template-columns: 3fr 1fr; }
  .full { grid-template-columns: 1fr; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
  .card-title { font-size: 10px; text-transform: uppercase; font-weight: 700; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
  @media (max-width: 900px) { .row-2, .row-3-1 { grid-template-columns: 1fr; } }
`;

// ---------------------------------------------------------------------------
// Nav bar
// ---------------------------------------------------------------------------

function renderNav(activePage, failureCount) {
  const badge =
    failureCount > 0
      ? `<span style="display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;color:#fff;background:var(--red);margin-left:4px;">${failureCount}</span>`
      : "";
  const links = [
    { href: "/", label: "Dashboard", id: "home" },
    { href: "/providers", label: "Providers", id: "providers" },
    { href: "/failures", label: `Failures${badge}`, id: "failures" },
    { href: "/api-health", label: "v2 API", id: "api-health" },
  ];
  const navLinks = links
    .map(
      (l) =>
        `<a href="${l.href}" style="font-size:12px;padding:5px 12px;border-radius:4px;color:${l.id === activePage ? "var(--text)" : "var(--muted)"};${l.id === activePage ? "background:var(--surface2);font-weight:700;" : ""}">${l.label}</a>`
    )
    .join("");
  return `<header style="background:var(--surface);border-bottom:1px solid var(--border);padding:8px 16px;display:flex;justify-content:space-between;align-items:center;">
    <h1 style="font-size:15px;font-weight:600;color:var(--accent);">StakTrakr Poller</h1>
    <nav style="display:flex;gap:4px;align-items:center;">${navLinks}</nav>
    <span style="color:var(--muted);font-size:11px;">${new Date().toUTCString()}</span>
  </header>`;
}

// ---------------------------------------------------------------------------
// Main dashboard page (GET /)
// ---------------------------------------------------------------------------

/** Compact poller tag (HR/HS/FS) */
function pollerTag(pollerId) {
  const map = {
    home: "HR",
    "home-retail": "HR",
    "home-spot": "HS",
    api: "FR",
    "fly-retail": "FR",
    "fly-spot": "FS",
  };
  const cls = {
    home: "hr",
    "home-retail": "hr",
    "home-spot": "hs",
    api: "hr",
    "fly-retail": "hr",
    "fly-spot": "fs",
  };
  const tag = map[pollerId] || pollerId?.slice(0, 2).toUpperCase() || "??";
  return `<span class="poller-tag poller-tag-${cls[pollerId] || "hr"}">${tag}</span>`;
}

function renderCompactRunsTable(runs) {
  if (!runs || runs.length === 0) {
    return '<p class="no-data">No runs yet.</p>';
  }
  const rows = runs
    .slice(0, 12)
    .map((r) => {
      const captured = r.captured ?? 0;
      const total = r.total ?? 0;
      const rate = total > 0 ? Math.round((captured / total) * 100) : 0;
      const barColor = rate >= 80 ? "var(--green)" : rate >= 50 ? "var(--amber)" : "var(--red)";
      const time = (r.started_at || "").slice(11, 16);
      const dur = fmtDuration(r.started_at, r.finished_at);
      const isSpot = r.poller_id?.includes("spot");
      const resultCell = isSpot
        ? `<small>${captured || SPOT_METAL_COUNT}/${SPOT_METAL_COUNT}</small>`
        : total > 0
          ? `<div class="mini-bar"><div style="width:${rate}%;background:${barColor}"></div></div>${captured}`
          : `${captured}/${total}`;
      const statusCls =
        r.status === "ok"
          ? "status-ok"
          : r.status === "running"
            ? "status-running"
            : "status-failed";
      const statusLabel = r.status === "running" ? "run" : r.status;
      return `<tr>
      <td>${pollerTag(r.poller_id)}</td>
      <td>${escHtml(time)}</td>
      <td>${escHtml(dur)}</td>
      <td><span class="status ${statusCls}">${escHtml(statusLabel)}</span></td>
      <td>${resultCell}</td>
    </tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Type</th><th>Time</th><th>Dur</th><th>Status</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderKpiStrip(retailStats, spotCov, failureCount, coverageStats) {
  function kpi(label, value, sub, color) {
    return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 12px;text-align:center;flex:1;min-width:95px;">
      <div style="font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:600;letter-spacing:0.5px;">${label}</div>
      <div style="font-size:20px;font-weight:700;margin-top:2px;color:${color};">${value}</div>
      ${sub ? `<div style="font-size:9px;color:var(--muted);">${sub}</div>` : ""}
    </div>`;
  }
  const runs = retailStats ? retailStats.totalRuns : 0;
  const success = retailStats ? retailStats.successRate : 0;
  const dur = retailStats
    ? retailStats.avgDurationSec > 60
      ? `${Math.floor(retailStats.avgDurationSec / 60)}m${retailStats.avgDurationSec % 60}s`
      : `${retailStats.avgDurationSec}s`
    : "?";
  const capture = retailStats ? retailStats.avgCaptureRate : 0;
  const spotPct = spotCov
    ? Math.round((spotCov.coveredIntervals / Math.max(spotCov.totalIntervals, 1)) * 100)
    : 0;
  const spotLabel = spotCov ? `${spotCov.coveredIntervals}/${spotCov.totalIntervals}` : "?";
  const covNow = coverageStats?.hours?.[0]?.pct ?? 0;
  const covCovered = coverageStats?.hours?.[0]?.covered ?? 0;
  const covTotal = coverageStats?.totalEnabled ?? 0;

  return `<div style="display:flex;gap:8px;flex-wrap:wrap;">
    ${kpi("Retail Runs", runs, "home | 24h", "var(--accent)")}
    ${kpi("Success", success + "%", runs > 0 ? `${Math.round((runs * success) / 100)}/${runs} ok` : "", success >= 90 ? "var(--green)" : success >= 70 ? "var(--amber)" : "var(--red)")}
    ${kpi("Duration", dur, "avg retail", "var(--accent)")}
    ${kpi("Capture", capture + "%", retailStats ? `${Math.round((capture * 166) / 100)}/166` : "", capture >= 90 ? "var(--green)" : capture >= 70 ? "var(--amber)" : "var(--red)")}
    ${kpi("Spot", spotPct + "%", spotLabel, spotPct >= 90 ? "var(--green)" : spotPct >= 70 ? "var(--amber)" : "var(--red)")}
    ${kpi("Failures", failureCount, "chronic 24+/7d", failureCount > 0 ? "var(--red)" : "var(--green)")}
    ${kpi("Coverage", covNow + "%", `${covCovered}/${covTotal} now`, covNow >= 80 ? "var(--green)" : covNow >= 50 ? "var(--amber)" : "var(--red)")}
  </div>`;
}

function renderAttentionSidebar(failures) {
  if (!failures || failures.length === 0) {
    return `<div class="card"><div class="card-title">Needs Attention</div>
      <p style="color:var(--green);font-size:12px;padding:8px 0;">All clear - no chronic failures.</p></div>`;
  }
  const items = failures
    .slice(0, 6)
    .map(
      (f) =>
        `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--surface2);border-radius:4px;margin-bottom:4px;font-size:11px;border-left:3px solid var(--red);">
      <div><span style="font-weight:600;">${escHtml(f.coinName)}</span><br><span style="color:var(--muted);font-size:10px;">${escHtml(f.vendorId)}</span></div>
      <div style="display:flex;gap:4px;">
        <a class="btn-sm" href="/providers#${escAttr(f.coinSlug)}">Edit</a>
        <button class="btn-sm primary btn-retry" data-coin="${escAttr(f.coinSlug)}" data-vendor="${escAttr(f.vendorId)}">Retry</button>
      </div>
    </div>`
    )
    .join("");
  return `<div class="card"><div class="card-title">Needs Attention</div>${items}
    <div style="margin-top:6px;text-align:center;"><a href="/failures" style="font-size:11px;">View all failures &rarr;</a></div></div>`;
}

/**
 * Build the compact status-bar HTML — one colored dot + label per subsystem,
 * including the STRK-187 publish-freshness indicator (api2-fresh-but-published-
 * stale renders PUSH STALE vs STALE) — from an aggregated health snapshot.
 * @param {object} data - aggregated health snapshot (flyio/poller/sqld fields)
 * @returns {string} status-bar HTML
 */
function renderStatusBar(data) {
  const { cpu, uptime, lockStatus, flyioHealth, tursoUp, failureCount, retailStats, spotCoverage } =
    data;
  const items = [];
  const dot = (color) =>
    `<span style="width:7px;height:7px;border-radius:50%;background:var(--${color});display:inline-block;margin-right:5px;"></span>`;

  // VM
  const memPct = cpu ? parseFloat(cpu.memUsedPct) : 0;
  items.push(
    dot(memPct < 80 ? "green" : memPct < 90 ? "amber" : "red") +
      `VM: ${cpu ? cpu.memUsedPct + "%" : "?"} mem, ${uptime || "?"}`
  );

  // Retail
  const success = retailStats?.successRate ?? 0;
  items.push(
    dot(success >= 90 ? "green" : success >= 70 ? "amber" : "red") + `Retail: ${success}%`
  );

  // Spot
  const spotPct = spotCoverage
    ? Math.round((spotCoverage.coveredIntervals / Math.max(spotCoverage.totalIntervals, 1)) * 100)
    : 0;
  items.push(
    dot(spotPct >= 90 ? "green" : spotPct >= 70 ? "amber" : "red") + `Spot: ${spotPct}% cov`
  );

  // Failures
  items.push(dot(failureCount > 0 ? "red" : "green") + `${failureCount} chronic failures`);

  // Fly.io
  const flyOk = flyioHealth?.http_ok;
  items.push(
    dot(flyOk ? "green" : flyOk === false ? "red" : "amber") +
      `Fly.io: ${flyOk ? "OK" : flyOk === false ? "DOWN" : "?"}`
  );

  // Fly→sqld (Tailscale subnet route to home sqld; STRK-6 + STRK-7)
  const sqldOk = flyioHealth?.sqld_reachable_ok;
  let sqldLabel;
  if (sqldOk === true) {
    sqldLabel = "OK";
  } else if (sqldOk === false) {
    const ago = fmtAgo(flyioHealth?.sqld_reachable_last_success);
    sqldLabel = ago ? `FAIL (${ago})` : "FAIL";
  } else {
    sqldLabel = "?";
  }
  items.push(dot(sqldOk ? "green" : sqldOk === false ? "red" : "amber") + `Fly→sqld: ${sqldLabel}`);

  // Publish freshness (api.staktrakr.com manifest generated_at age; STRK-187).
  // api2 fresh while published stale = push broken; both stale = publish broken.
  const pubFresh = flyioHealth?.published_fresh_ok;
  const api2Fresh = flyioHealth?.api2_fresh_ok;
  let pubLabel;
  if (pubFresh === true) {
    pubLabel = `OK (${flyioHealth.published_age_min}m)`;
  } else if (pubFresh === false) {
    const pubAge = flyioHealth?.published_age_min ?? "?";
    pubLabel = api2Fresh ? `PUSH STALE (${pubAge}m)` : `STALE (${pubAge}m)`;
  } else {
    pubLabel = "?";
  }
  items.push(
    dot(pubFresh ? "green" : pubFresh === false ? "red" : "amber") + `Publish: ${pubLabel}`
  );

  // Lock
  const anyLocked = (lockStatus || []).some((l) => l.locked);
  items.push(dot(anyLocked ? "amber" : "green") + `Lock: ${anyLocked ? "BUSY" : "free"}`);

  // Turso
  items.push(dot(tursoUp ? "green" : "red") + `Turso: ${tursoUp ? "OK" : "DOWN"}`);

  return `<div style="background:var(--surface2);border-bottom:1px solid var(--border);padding:5px 16px;display:flex;gap:16px;align-items:center;font-size:11px;overflow-x:auto;">
    ${items.map((i) => `<div style="display:flex;align-items:center;white-space:nowrap;">${i}</div>`).join("")}
  </div>`;
}

/**
 * Build the infrastructure detail row HTML — per-service label + color,
 * including the STRK-187 publish-freshness item (PUSH STALE when api2 is fresh
 * but the published manifest is stale, STALE when both are) — from an
 * aggregated health snapshot.
 * @param {object} data - aggregated health snapshot (flyio/poller/sqld fields)
 * @returns {string} infra-row HTML
 */
function renderInfraRow(data) {
  const { cpu, uptime, net, lockStatus, flyioHealth, tursoUp, dockerContainers, supervisord } =
    data;
  const netRx = net ? fmtBytes(net.rx_bytes) : "?";
  const flyOk = flyioHealth?.http_ok;
  const sqldOk = flyioHealth?.sqld_reachable_ok;
  const sqldAgo = sqldOk === false ? fmtAgo(flyioHealth?.sqld_reachable_last_success) : "";
  let sqldLabel, sqldColor;
  if (sqldOk === true) {
    sqldLabel = "OK";
    sqldColor = "var(--green)";
  } else if (sqldOk === false) {
    sqldLabel = sqldAgo ? `FAIL (${sqldAgo})` : "FAIL";
    sqldColor = "var(--red)";
  } else {
    sqldLabel = "?";
    sqldColor = "var(--amber)";
  }
  const pubFresh = flyioHealth?.published_fresh_ok;
  let pubLabel, pubColor;
  if (pubFresh === true) {
    pubLabel = `OK (${flyioHealth.published_age_min}m)`;
    pubColor = "var(--green)";
  } else if (pubFresh === false) {
    const pubAge = flyioHealth?.published_age_min ?? "?";
    pubLabel = flyioHealth?.api2_fresh_ok ? `PUSH STALE (${pubAge}m)` : `STALE (${pubAge}m)`;
    pubColor = "var(--red)";
  } else {
    pubLabel = "?";
    pubColor = "var(--amber)";
  }
  const anyLocked = (lockStatus || []).some((l) => l.locked);
  const containerCount = (dockerContainers || []).filter((c) => c.state === "running").length;
  const serviceCount = (supervisord || []).filter((s) => s.state === "RUNNING").length;

  function item(label, value, color) {
    return `<div style="display:flex;justify-content:space-between;padding:3px 6px;font-size:11px;"><span style="color:var(--muted)">${label}</span><span style="color:${color || "var(--text)"}">${value}</span></div>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px;">
    ${item("VM", `${uptime || "?"} | ${cpu ? cpu.memUsedPct + "%" : "?"}`, "var(--green)")}
    ${item("Load", cpu ? `${cpu.load1}/${cpu.load5}` : "?")}
    ${item("Net", `${netRx} rx`)}
    ${
      anyLocked
        ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;font-size:11px;"><span style="color:var(--muted)">Lock</span><span style="display:flex;align-items:center;gap:6px;"><span style="color:var(--amber)">BUSY</span>${lockStatus
            .filter((l) => l.locked)
            .map(
              (l) =>
                `<button class="btn-sm danger btn-clear-lock" data-path="${escAttr(l.path)}">Clear</button>`
            )
            .join("")}</span></div>`
        : item("Lock", "Free", "var(--green)")
    }
    ${item("Fly API", flyOk ? "OK" : flyOk === false ? "DOWN" : "?", flyOk ? "var(--green)" : "var(--red)")}
    ${item("Fly→sqld", sqldLabel, sqldColor)}
    ${item("Publish", pubLabel, pubColor)}
    ${item("Turso", tursoUp ? "OK" : "DOWN", tursoUp ? "var(--green)" : "var(--red)")}
    ${item("Containers", `${containerCount} up`, "var(--green)")}
    ${item("Services", `${serviceCount} up`, "var(--green)")}
  </div>`;
}

// renderMissingItems kept for backward compat but simplified
function renderMissingItems(items) {
  if (!items || items.length === 0) {
    return '<p style="color:var(--green);font-size:12px;padding:8px 0;">All items have prices this hour.</p>';
  }
  return `<p style="color:var(--muted);font-size:12px;margin-bottom:8px;">${items.length} items missing prices this hour.</p>`;
}

// Legacy coverage rendering — replaced by Chart.js in new dashboard
function renderCoverageCards_LEGACY(cov, spotCov) {
  if (!cov || !cov.hours || cov.hours.length === 0) return "";

  // ── Style values (from playground Compact preset + user tweaks) ─────
  const P = 8,
    G = 24,
    R = 6,
    VS = 33,
    LS = 10,
    TS = 11,
    BH = 80,
    CP = 8,
    SG = 12;

  function covCard(label, value, sub, color) {
    return (
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' +
      R +
      "px;padding:" +
      P +
      'px;text-align:center;">' +
      '<div style="color:var(--muted);font-size:' +
      LS +
      'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">' +
      label +
      "</div>" +
      '<div style="color:' +
      color +
      ";font-size:" +
      VS +
      "px;font-weight:700;font-family:'Cascadia Code','Fira Code',monospace;\">" +
      value +
      (sub
        ? '<span style="font-size:' +
          Math.round(VS * 0.58) +
          'px;color:var(--muted)">' +
          sub +
          "</span>"
        : "") +
      "</div>" +
      "</div>"
    );
  }

  // ── Retail section ──────────────────────────────────────────────────
  const latest = cov.hours[0];
  const last24 = cov.hours.slice(0, 24);
  const avg =
    last24.length > 0
      ? Math.min(100, Math.round(last24.reduce((s, h) => s + h.pct, 0) / last24.length))
      : 0;
  const covColor =
    latest.pct >= 90 ? "var(--green)" : latest.pct >= 70 ? "var(--amber)" : "var(--red)";
  const avgColor = avg >= 90 ? "var(--green)" : avg >= 70 ? "var(--amber)" : "var(--red)";
  const missingCount = Math.max(0, cov.totalEnabled - latest.covered);

  const retailStatCards =
    "" +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:' +
    G +
    "px;margin-bottom:" +
    G +
    'px;">' +
    covCard("Coverage (latest hour)", latest.pct + "%", "", covColor) +
    covCard("Avg Coverage (24h)", avg + "%", "", avgColor) +
    covCard(
      "Items Covered",
      Math.min(latest.covered, cov.totalEnabled),
      "/" + cov.totalEnabled,
      "var(--accent)"
    ) +
    covCard("Missing Items", missingCount, "", missingCount > 0 ? "var(--red)" : "var(--green)") +
    "</div>";

  // Use all available hours (up to 48h)
  const allHours = cov.hours.slice(0, 48).reverse();
  const retailBars = allHours
    .map((h, i) => {
      // Use per-hour effectiveTotal (how many vendors existed at that hour)
      // so adding new items doesn't retroactively penalize historical bars.
      const denom = h.effectiveTotal || cov.totalEnabled;
      const adjPct = denom > 0 ? Math.min(100, Math.round((h.covered / denom) * 100)) : 0;
      const barH = Math.max(2, Math.round(adjPct * 0.5));
      const c = adjPct >= 90 ? "#22c55e" : adjPct >= 70 ? "#f59e0b" : "#ef4444";
      const hLabel = h.hour.slice(11, 16);
      return (
        '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;" title="' +
        hLabel +
        ": " +
        h.covered +
        "/" +
        denom +
        " (" +
        adjPct +
        '%)">' +
        '<div style="height:' +
        barH +
        "px;background:" +
        c +
        ';border-radius:2px;"></div>' +
        '<div style="text-align:center;overflow:hidden;height:28px;display:flex;align-items:flex-start;justify-content:center;"><span style="font-size:7px;color:var(--muted);white-space:nowrap;writing-mode:vertical-lr;transform:rotate(180deg);">' +
        hLabel +
        "</span></div>" +
        "</div>"
      );
    })
    .join("");

  const retailBarCard =
    "" +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' +
    R +
    "px;padding:" +
    CP +
    "px " +
    CP +
    "px " +
    Math.round(CP * 0.5) +
    'px;">' +
    '<div style="color:var(--muted);font-size:' +
    LS +
    'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">Retail Coverage Trend (' +
    allHours.length +
    "h)</div>" +
    '<div style="display:flex;gap:1px;align-items:flex-end;height:' +
    BH +
    'px;">' +
    retailBars +
    "</div>" +
    "</div>";

  // ── Spot section ────────────────────────────────────────────────────
  let spotSection = "";

  if (spotCov) {
    const spotPct =
      spotCov.totalIntervals > 0
        ? Math.round((spotCov.coveredIntervals / spotCov.totalIntervals) * 100)
        : 0;
    const spotColor =
      spotPct >= 90 ? "var(--green)" : spotPct >= 70 ? "var(--amber)" : "var(--red)";

    // Build poller breakdown data for 4th card
    const pollerEntries = Object.entries(spotCov.byPoller || {});
    const pollerColors = { "home-spot": "#818cf8", "fly-spot": "#38bdf8", backfill: "#f59e0b" };
    const pollers = pollerEntries.map(([id, cnt]) => {
      const pPct =
        spotCov.totalIntervals > 0 ? Math.round((cnt / spotCov.totalIntervals) * 100) : 0;
      return { name: id, count: cnt, pct: pPct, color: pollerColors[id] || "#94a3b8" };
    });
    const maxPct = Math.max(...pollers.map((p) => p.pct), 1);

    // Combined sources %
    const combinedPct = pollers.reduce((s, p) => s + p.pct, 0);
    const combinedColor =
      combinedPct >= 90 ? "var(--green)" : combinedPct >= 70 ? "var(--amber)" : "var(--red)";

    // Card 4: Source Breakdown with mini horizontal bars
    const breakdownCard =
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' +
      R +
      "px;padding:" +
      P +
      'px;text-align:center;">' +
      '<div style="color:var(--muted);font-size:' +
      LS +
      'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">Source Breakdown</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;">' +
      pollers
        .map(
          (p) =>
            '<div style="display:flex;align-items:center;gap:6px;">' +
            '<div style="width:8px;height:8px;border-radius:50%;background:' +
            p.color +
            ';flex-shrink:0;"></div>' +
            '<span style="font-size:10px;color:var(--muted);min-width:64px;text-align:left;">' +
            p.name +
            "</span>" +
            '<div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">' +
            '<div style="height:100%;width:' +
            (maxPct > 0 ? Math.round((p.pct / maxPct) * 100) : 0) +
            "%;background:" +
            p.color +
            ';border-radius:3px;"></div>' +
            "</div>" +
            '<span style="font-size:10px;min-width:28px;text-align:right;font-family:monospace;color:' +
            p.color +
            ';">' +
            p.pct +
            "%</span>" +
            "</div>"
        )
        .join("") +
      "</div>" +
      "</div>";

    const spotStatCards =
      "" +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:' +
      G +
      "px;margin-bottom:" +
      G +
      'px;">' +
      covCard("Spot Coverage (" + spotCov.hours + "h)", spotPct + "%", "", spotColor) +
      covCard(
        "Intervals Hit",
        spotCov.coveredIntervals,
        "/" + spotCov.totalIntervals,
        "var(--accent)"
      ) +
      covCard("Combined Sources", combinedPct + "%", "", combinedColor) +
      breakdownCard +
      "</div>";

    // Spot bars — generate placeholders for ALL expected 15-min slots
    const spotIntervals = spotCov.intervals || [];
    const spotMap = new Map(spotIntervals.map((q) => [q.quarter, q]));

    const allQuarters = [];
    const now = new Date();
    const hoursBack = spotCov.hours || 6;
    const start = new Date(now.getTime() - hoursBack * 3600000);
    start.setMinutes(Math.floor(start.getMinutes() / 15) * 15, 0, 0);
    for (let t = new Date(start); t <= now; t = new Date(t.getTime() + 15 * 60000)) {
      const iso = t.toISOString();
      const q =
        iso.slice(0, 13) + ":" + String(Math.floor(t.getUTCMinutes() / 15) * 15).padStart(2, "0");
      allQuarters.push(q);
    }

    const spotBars = allQuarters
      .map((q, i) => {
        const data = spotMap.get(q);
        const label = q.slice(11);
        if (!data) {
          return (
            '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;" title="' +
            label +
            ': no data">' +
            '<div style="height:2px;background:#334155;border-radius:2px;"></div>' +
            '<div style="text-align:center;overflow:hidden;height:28px;display:flex;align-items:flex-start;justify-content:center;"><span style="font-size:7px;color:#475569;white-space:nowrap;writing-mode:vertical-lr;transform:rotate(180deg);">' +
            label +
            "</span></div>" +
            "</div>"
          );
        }
        const full = data.metals >= 4;
        const c = full ? "#22c55e" : data.metals >= 2 ? "#f59e0b" : "#ef4444";
        const barH = full ? 28 : Math.max(6, data.metals * 7);
        const srcLabel = data.sources > 1 ? data.sources + " sources" : "1 source";
        return (
          '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;" title="' +
          label +
          ": " +
          data.metals +
          "/4 metals, " +
          srcLabel +
          '">' +
          '<div style="height:' +
          barH +
          "px;background:" +
          c +
          ';border-radius:2px;"></div>' +
          '<div style="text-align:center;overflow:hidden;height:28px;display:flex;align-items:flex-start;justify-content:center;"><span style="font-size:7px;color:var(--muted);white-space:nowrap;writing-mode:vertical-lr;transform:rotate(180deg);">' +
          label +
          "</span></div>" +
          "</div>"
        );
      })
      .join("");

    const spotBarCard =
      "" +
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' +
      R +
      "px;padding:" +
      CP +
      "px " +
      CP +
      "px " +
      Math.round(CP * 0.5) +
      'px;">' +
      '<div style="color:var(--muted);font-size:' +
      LS +
      'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">Spot Price Trend (15-min intervals, ' +
      hoursBack +
      "h)</div>" +
      '<div style="display:flex;gap:1px;align-items:flex-end;height:' +
      BH +
      'px;">' +
      spotBars +
      "</div>" +
      "</div>";

    spotSection =
      "" +
      '<div style="margin-bottom:' +
      SG +
      'px;">' +
      '<h3 style="font-size:' +
      TS +
      'px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px;">Spot Price Coverage</h3>' +
      spotStatCards +
      spotBarCard +
      "</div>";
  }

  // ── Assemble ────────────────────────────────────────────────────────
  return (
    '<div style="margin-bottom:' +
    SG +
    'px;">' +
    '<h3 style="font-size:' +
    TS +
    'px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px;">Retail Price Coverage</h3>' +
    retailStatCards +
    retailBarCard +
    "</div>" +
    spotSection
  );
}

// Legacy SVG trend chart — replaced by Chart.js
function renderFailureTrendChart_LEGACY(trend) {
  if (!trend || trend.length === 0) {
    return '<p style="color:var(--muted);font-size:13px;padding:8px 0;">No failure data available.</p>';
  }

  const maxF = Math.max(...trend.map((d) => d.failures), 1);
  const chartW = 500,
    chartH = 140,
    barGap = 8;
  const barW = Math.min(50, (chartW - barGap * (trend.length + 1)) / trend.length);
  const startX = (chartW - (barW + barGap) * trend.length + barGap) / 2;

  let bars = "";
  trend.forEach((d, i) => {
    const barH = Math.max(2, (d.failures / maxF) * (chartH - 30));
    const x = startX + i * (barW + barGap);
    const y = chartH - 20 - barH;
    const color = d.failures >= 20 ? "#ef4444" : d.failures >= 10 ? "#f59e0b" : "#22c55e";
    const dayLabel = d.day.slice(5); // MM-DD
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="3"/>`;
    bars += `<text x="${x + barW / 2}" y="${chartH - 6}" text-anchor="middle" fill="#94a3b8" font-size="10">${dayLabel}</text>`;
    bars += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="#e2e8f0" font-size="10">${d.failures}</text>`;
  });

  return `<svg width="${chartW}" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}" style="max-width:100%;height:auto;">
    <line x1="0" y1="${chartH - 20}" x2="${chartW}" y2="${chartH - 20}" stroke="#334155" stroke-width="1"/>
    ${bars}
  </svg>
  <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--muted);">
    <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px;"></span>&lt; 10 failures</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px;margin-right:4px;"></span>10-19</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px;"></span>20+</span>
  </div>`;
}

function renderMainPage(data) {
  const {
    net,
    cpu,
    uptime,
    supervisord,
    logLines,
    tursoRuns,
    tursoUp,
    flyioHealth,
    runStats,
    failureCount,
    coverageStats,
    spotCoverage,
    failureTrend,
    flyRuns,
    dockerContainers,
    lockStatus,
    chronicFailures,
  } = data;

  const logHtml = logLines
    .map((l) => `<div class="${logLineClass(l)}">${escHtml(l)}</div>`)
    .join("");

  // Prepare Chart.js data as JSON for client-side rendering
  const covHours = coverageStats?.hours?.slice(0, 48)?.reverse() || [];
  const chartData = JSON.stringify({
    coverage: covHours.map((h) => ({ x: h.hour, y: h.pct })),
    // We don't have real spot price data on the dashboard server, use coverage as proxy
    spotIntervals: (spotCoverage?.intervals || []).map((q) => ({ x: q.quarter, y: q.metals * 25 })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>StakTrakr Poller Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"><\/script>
<style>
  ${SHARED_CSS}
  .chart-wrap { position: relative; height: 180px; }
  .log-compact { background: #0c1221; border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-family: 'SF Mono', monospace; font-size: 10px; line-height: 1.5; max-height: 200px; overflow-y: auto; color: var(--muted); }
  .log-ok    { color: #86efac; font-weight: 600; }
  .log-warn  { color: #fde68a; }
  .log-error { color: #f87171; font-weight: 600; }
  .log-info  { color: var(--accent); }
  .log-fbp   { color: #c084fc; }
  .log-default { color: var(--muted); }
</style>
</head>
<body>
<div id="toast" style="display:none;position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:6px;font-size:13px;z-index:200;"></div>
${renderNav("home", failureCount)}
${renderStatusBar({ cpu, uptime, lockStatus, flyioHealth, tursoUp, failureCount, retailStats: runStats, spotCoverage })}

<div class="container">
  <!-- KPI strip -->
  <div class="row full">
    ${renderKpiStrip(runStats, spotCoverage, failureCount, coverageStats)}
  </div>

  <!-- Chart + Attention -->
  <div class="row row-3-1">
    <div class="card">
      <div class="card-title">Retail Coverage — 48h</div>
      <div class="chart-wrap"><canvas id="mainChart"></canvas></div>
    </div>
    ${renderAttentionSidebar(chronicFailures)}
  </div>

  <!-- Runs table + Log -->
  <div class="row row-2">
    <div class="card">
      <div class="card-title">Recent Runs</div>
      ${renderCompactRunsTable(tursoRuns)}
    </div>
    <div class="card">
      <div class="card-title">Scraper Log</div>
      <div class="log-compact" id="log">${logHtml}</div>
      <div class="card-title" style="margin-top:12px;">Infrastructure</div>
      ${renderInfraRow({ cpu, uptime, net, lockStatus, flyioHealth, tursoUp, dockerContainers, supervisord })}
    </div>
  </div>
</div>

<script>
// Chart.js — Retail Coverage over 48h
(function() {
  var chartData = ${chartData};
  var ctx = document.getElementById('mainChart');
  if (!ctx || !chartData.coverage.length) return;
  new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Coverage %',
        data: chartData.coverage,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.06)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 10 }, usePointStyle: true, pointStyle: 'line', padding: 8 } },
        tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, titleColor: '#e2e8f0', bodyColor: '#94a3b8' }
      },
      scales: {
        x: {
          type: 'time',
          time: { tooltipFormat: 'MMM dd HH:mm', displayFormats: { hour: 'HH:mm' } },
          ticks: { color: '#475569', font: { size: 9 }, maxTicksLimit: 12 },
          grid: { color: '#1e293b' },
        },
        y: {
          min: 0, max: 100,
          title: { display: true, text: '%', color: '#38bdf8', font: { size: 9 } },
          ticks: { color: '#38bdf8', font: { size: 9 } },
          grid: { color: '#1e293b' },
        }
      }
    }
  });
})();

// Retry button handler
document.querySelectorAll('.btn-retry').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var coin = this.dataset.coin;
    var vendor = this.dataset.vendor;
    this.disabled = true;
    this.textContent = '...';
    fetch('/api/retry', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ coinSlug: coin, vendorId: vendor })
    }).then(function(r) { return r.json(); }).then(function(j) {
      btn.textContent = j.ok ? 'Queued' : 'Err';
      btn.style.background = j.ok ? '#166534' : '#7f1d1d';
    }).catch(function() { btn.textContent = 'Err'; btn.disabled = false; });
  });
});

// Minimal toast for dashboard page (showToast lives in providers page scope)
function dashToast(text, ok) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.style.display = 'block';
  t.style.background = ok ? '#14532d' : '#7f1d1d';
  t.style.color = ok ? '#86efac' : '#fca5a5';
  t.textContent = text;
  setTimeout(function() { t.style.display = 'none'; }, 3000);
}

// Clear lock button handler
document.querySelectorAll('.btn-clear-lock').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const path = this.dataset.path;
    if (!confirm('Clear stale lock file ' + path + '?')) return;
    this.disabled = true;
    this.textContent = '...';
    fetch('/api/clear-lock', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ path: path })
    }).then(function(r) { return r.json(); }).then(function(j) {
      dashToast(j.message || (j.ok ? 'Lock cleared' : 'Failed'), j.ok);
      if (j.ok) { setTimeout(function() { location.reload(); }, 1000); }
      else { btn.disabled = false; btn.textContent = 'Clear'; }
    }).catch(function() { dashToast('Request failed', false); btn.disabled = false; btn.textContent = 'Clear'; });
  });
});

var log = document.getElementById('log');
if (log) log.scrollTop = log.scrollHeight;
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Provider editor page (GET /providers)
// ---------------------------------------------------------------------------

// Vendors fed by a first-party price API instead of page scraping (STRK-321).
// Presentation-only: drives the "Direct API" badge in the By Vendor view. Row
// URLs stay the human product pages (they feed matching + published Buy
// links); the API key lives only in the container env, never in row data.
const API_FED_VENDOR_IDS = new Set(["mintbuilder"]);

// The source value price-extract writes for a direct feed hit (STRK-321). Any
// other value on an API-fed row means that item fell back to page scraping.
const FEED_SOURCE = "mintbuilder-api";

// How long a feed probe is reused before /providers re-checks. The dashboard is
// a long-running process, so getFeedIndex must be bounded or the health line
// would freeze at whatever the first page load saw (STRK-324).
const FEED_HEALTH_MAX_AGE_MS = 60_000;

/**
 * Summarize feed reachability for the By Vendor header. Never throws — a feed
 * problem must not take the provider editor down with it.
 *
 * @returns {Promise<{ok: boolean, label: string, detail: string}|null>}
 */
async function probeFeedHealth() {
  try {
    const state = await getFeedIndex({ maxAgeMs: FEED_HEALTH_MAX_AGE_MS });
    if (state.ok) {
      return {
        ok: true,
        label: `feed OK — ${state.byId.size} products`,
        detail: `Checked ${new Date(state.fetchedAt).toLocaleTimeString()}. Live probe from the dashboard, not the last poller run.`,
      };
    }
    const reasons = {
      no_key: "MB_API_KEY not set — every item page-scrapes",
      bad_key: "API key rejected (HTTP 401) — every item page-scrapes",
      fetch_failed: "feed unreachable — every item page-scrapes",
      bad_payload: "feed returned an unexpected payload — every item page-scrapes",
    };
    return {
      ok: false,
      label: reasons[state.reason] || `feed unavailable (${state.reason})`,
      detail: "Live probe from the dashboard. The poller falls back to page scraping.",
    };
  } catch (err) {
    console.error("[dashboard] feed health probe failed:", err?.message || err);
    return null;
  }
}

function renderProvidersPage(providers, scrapeStatus, failureCount, readOnly, vendorGroups) {
  const coins = providers.coins || {};
  const coinEntries = Object.entries(coins);
  const totalCoins = coinEntries.length;

  // Build vendor-centric view HTML
  const vendorViewHtml = (vendorGroups || [])
    .map((vg) => {
      const isApiFed = API_FED_VENDOR_IDS.has(vg.vendorId);
      const okCount = vg.items.filter((i) => {
        const key = `${i.coinSlug}:${vg.vendorId}`;
        const st = scrapeStatus?.get(key);
        return st && !st.isFailed && st.price != null;
      }).length;
      const failCount = vg.items.filter((i) => {
        const key = `${i.coinSlug}:${vg.vendorId}`;
        const st = scrapeStatus?.get(key);
        return st?.isFailed;
      }).length;
      const statsText = `${vg.items.length} items | ${okCount} ok${failCount > 0 ? ` | <span style="color:var(--red);">${failCount} failing</span>` : ""}`;

      const itemRows = vg.items
        .map((item) => {
          const key = `${item.coinSlug}:${vg.vendorId}`;
          const st = scrapeStatus?.get(key);
          let dot =
            '<span style="width:8px;height:8px;border-radius:50%;background:#475569;display:inline-block;"></span>';
          let priceText = "";
          if (st) {
            if (st.isFailed) {
              dot =
                '<span style="width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;"></span>';
              priceText = `<span style="color:var(--red);font-size:11px;">failed</span>`;
            } else if (st.price != null) {
              dot =
                '<span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;"></span>';
              priceText = `<span style="color:var(--green);font-size:11px;">$${st.price}</span>`;
            }
          }
          // API-fed rows get a pin input and a per-row match indicator so an
          // operator can see, without reading logs, whether this item actually
          // came from the feed or quietly fell back to page scraping.
          let apiCells = "";
          if (isApiFed) {
            const pinnedId = parseHintsProductId(item.hints, () => {}) || "";
            let matchBadge =
              '<span style="font-size:10px;color:var(--muted);" title="No price recorded for this item yet.">—</span>';
            if (st && st.source) {
              matchBadge =
                st.source === FEED_SOURCE
                  ? '<span style="font-size:10px;color:var(--green);" title="Last price came from the direct API feed.">feed</span>'
                  : `<span style="font-size:10px;color:var(--muted);" title="Last price came from a page scrape (source: ${escAttr(st.source)}). Expected for items the feed cannot confirm in stock, or when the key is unset.">scrape</span>`;
            }
            apiCells = `
        <input type="text" class="vendor-productid-byvendor" data-coin="${escAttr(item.coinSlug)}" data-vendor="${escAttr(vg.vendorId)}" value="${escAttr(pinnedId)}" style="width:100%;font-size:11px;" placeholder="feed id (optional)" title="Pin this row to an exact feed product ID. Leave blank to match by URL. Saved into the hints JSON without touching its other keys." ${readOnly ? "disabled" : ""}>
        ${matchBadge}`;
          }
          const gridCols = isApiFed ? "auto 1fr 2fr 90px auto 1fr auto" : "auto 1fr 2fr 1fr auto";
          return `<div style="display:grid;grid-template-columns:${gridCols};gap:8px;align-items:center;padding:5px 8px 5px 24px;border-bottom:1px solid var(--border);font-size:12px;">
        ${dot}
        <span style="font-weight:600;">${escHtml(item.coinName)} ${metalBadge(item.metal)}</span>
        <input type="text" class="vendor-url-byvendor" data-coin="${escAttr(item.coinSlug)}" data-vendor="${escAttr(vg.vendorId)}" value="${escAttr(item.url || "")}" style="width:100%;font-size:11px;" placeholder="https://..." ${readOnly ? "disabled" : ""}>${apiCells}
        ${priceText}
        <button class="btn-sm vendor-toggle-byvendor" data-coin="${escAttr(item.coinSlug)}" data-vendor="${escAttr(vg.vendorId)}" data-enabled="${item.enabled !== false ? "1" : "0"}" style="background:${item.enabled !== false ? "var(--green)" : "var(--red)"};color:#fff;font-size:10px;min-width:32px;" ${readOnly ? "disabled" : ""}>${item.enabled !== false ? "On" : "Off"}</button>
      </div>`;
        })
        .join("");

      // Placeholder only — the probe is fetched client-side after render. It
      // must never sit on the HTML response path: a hanging feed endpoint
      // costs two 15s attempts plus a 2s retry delay, which would stall the
      // whole provider editor for ~32s on the first load after each cache
      // expiry (STRK-324).
      const feedHealthHtml = isApiFed
        ? `<div class="vendor-feed-health" data-vendor="${escAttr(vg.vendorId)}" style="padding:4px 12px 6px;font-size:11px;color:var(--muted);">checking feed…</div>`
        : "";

      return `<div style="margin-bottom:12px;" class="vendor-section" data-vendor="${escAttr(vg.vendorId)}">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--surface2);border-radius:6px;cursor:pointer;margin-bottom:4px;" class="vendor-section-header">
        <span style="font-weight:600;font-size:13px;">${escHtml(vg.vendorName)}${
          isApiFed
            ? ' <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.5px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;color:var(--muted);vertical-align:middle;" title="Prices come from this vendor&#39;s direct API feed (one call per run). Product URLs below still drive feed matching and Buy links — add/remove items exactly like scraped vendors.">Direct API</span>'
            : ""
        }</span>
        <span style="font-size:11px;color:var(--muted);">${statsText}</span>
      </div>
      ${feedHealthHtml}
      <div class="vendor-section-body" style="display:none;">${itemRows}</div>
    </div>`;
    })
    .join("");

  // Build vendorsByMetal map for bulk operations
  const vendorsByMetal = {};
  for (const [slug, coin] of coinEntries) {
    const metal = coin.metal || "silver";
    if (!vendorsByMetal[metal]) vendorsByMetal[metal] = new Set();
    for (const p of coin.providers || []) {
      vendorsByMetal[metal].add(p.id);
    }
  }
  // Convert sets to sorted arrays
  for (const m of Object.keys(vendorsByMetal)) {
    vendorsByMetal[m] = [...vendorsByMetal[m]].sort();
  }

  const coinSections = coinEntries
    .map(([slug, coin]) => {
      const vendorCount = (coin.providers || []).length;
      const metal = coin.metal || "silver";

      const vendorRows = (coin.providers || [])
        .map((p, i) => {
          const key = `${slug}:${p.id}`;
          const status = scrapeStatus ? scrapeStatus.get(key) : null;
          let dot = '<span class="dot dot-gray" title="No data"></span>';
          let hoverText = "No data";
          if (status) {
            if (status.isFailed) {
              dot = `<span class="dot dot-red" title="Failed \u2014 ${escAttr(status.scrapedAt)}"></span>`;
              hoverText = `Failed \u2014 ${status.scrapedAt}`;
            } else if (status.price != null) {
              dot = `<span class="dot dot-green" title="$${status.price} \u2014 ${escAttr(status.scrapedAt)}"></span>`;
              hoverText = `$${status.price} \u2014 ${status.scrapedAt}`;
            }
          }

          return `<tr class="vendor-row" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}">
        <td>${dot}</td>
        <td><input type="checkbox" class="vendor-toggle" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" ${p.enabled !== false ? "checked" : ""} ${readOnly ? "disabled" : ""}></td>
        <td><code>${escHtml(p.id)}</code></td>
        <td><input type="text" class="vendor-url" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" value="${escAttr(p.url || "")}" style="width:100%" ${readOnly ? "disabled" : ""}></td>
        <td style="white-space:nowrap">
          <button class="btn-expand" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" title="Edit selector/hints" ${readOnly ? "disabled" : ""}>&#9881;</button>
          <button class="btn-del-vendor" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" data-name="${escAttr(p.id)}" data-coinname="${escAttr(coin.name)}" ${readOnly ? "disabled" : ""} style="background:#7f1d1d;color:#fca5a5;">&#10005;</button>
        </td>
      </tr>
      <tr class="vendor-detail" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" style="display:none;">
        <td colspan="5" style="background:#0f172a;padding:8px 16px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <label style="font-size:11px;color:var(--muted);">Selector<br><input type="text" class="vendor-selector" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" value="${escAttr(p.selector || "")}" style="width:100%" ${readOnly ? "disabled" : ""}></label>
            <label style="font-size:11px;color:var(--muted);">Hints (JSON)<br><textarea class="vendor-hints" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" rows="2" style="width:100%;font-family:monospace;font-size:11px;" ${readOnly ? "disabled" : ""}>${escHtml(p.hints || "")}</textarea></label>
          </div>
          <button class="btn-save-fields" data-coin="${escAttr(slug)}" data-vendor="${escAttr(p.id)}" style="margin-top:6px;background:#166534;color:#86efac;" ${readOnly ? "disabled" : ""}>Save Selector/Hints</button>
        </td>
      </tr>`;
        })
        .join("");

      return `<div class="coin-section" data-slug="${escAttr(slug)}" data-name="${escAttr(coin.name.toLowerCase())}" data-metal="${escAttr(metal)}">
      <div class="coin-header" data-slug="${escAttr(slug)}">
        <span class="coin-toggle">\u25B6</span>
        <strong>${escHtml(coin.name)}</strong>
        <code style="color:var(--muted);margin:0 8px;">${escHtml(slug)}</code>
        ${metalBadge(metal)}
        <span style="color:var(--muted);font-size:12px;margin-left:8px;">${metal === "goldback" ? (coin.weight_oz || 1) + "/1000 oz gold" : (coin.weight_oz || 1) + " oz"} \u00B7 ${vendorCount} vendor${vendorCount !== 1 ? "s" : ""}</span>
        ${
          readOnly
            ? ""
            : `<span style="margin-left:auto;display:flex;gap:4px;">
          <button class="btn-edit-coin" data-slug="${escAttr(slug)}" style="background:#1e3a5f;color:var(--accent);font-size:11px;">Edit</button>
          <button class="btn-del-coin" data-slug="${escAttr(slug)}" data-name="${escAttr(coin.name)}" data-vendors="${vendorCount}" style="background:#7f1d1d;color:#fca5a5;font-size:11px;">Delete</button>
        </span>`
        }
      </div>
      <div class="coin-body" style="display:none;">
        <table>
          <thead><tr><th style="width:30px"></th><th style="width:30px">On</th><th>Vendor</th><th>URL</th><th style="width:80px"></th></tr></thead>
          <tbody>${vendorRows}</tbody>
        </table>
        ${readOnly ? "" : `<button class="btn-add-vendor" data-coin="${escAttr(slug)}" data-coinname="${escAttr(coin.name)}" style="margin:8px 0;background:#1e3a5f;color:var(--accent);">+ Add provider to ${escHtml(slug)}</button>`}
      </div>
    </div>`;
    })
    .join("");

  const readOnlyBanner = readOnly
    ? `<div style="background:#7f1d1d;color:#fca5a5;padding:12px;border-radius:6px;margin-bottom:16px;font-weight:600;">\u26A0 Turso offline \u2014 showing cached data (read-only). Editing is disabled.</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Provider Editor \u2014 StakTrakr</title>
<style>
  ${SHARED_CSS}
  .toolbar { display: flex; gap: 12px; align-items: center; padding: 16px 20px; flex-wrap: wrap; }
  .toolbar input[type=text] { width: 280px; padding: 6px 10px; }
  #bulk-bar { background: #161b22; border: 1px solid #2d6a4f; border-radius: 6px; padding: 8px 12px; margin: 8px 0 0; display: flex; align-items: center; gap: 8px; width: 100%; }
  #bulk-vendor { background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 4px; padding: 4px 8px; font-size: 13px; }
  .btn-bulk { background: #1a3a2a; color: #95d5b2; border: 1px solid #2d6a4f; border-radius: 4px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
  .btn-bulk:hover { background: #2d6a4f; }
  .btn-danger-sm { background: #3b1219; color: #fca5a5; border-color: #7f1d1d; }
  .btn-danger-sm:hover { background: #7f1d1d; }
  .filter-btn { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--muted); }
  .filter-btn.active { background: var(--accent); color: #0f172a; border-color: var(--accent); }
  .coin-section { margin: 0 20px 2px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .coin-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--surface); cursor: pointer; user-select: none; }
  .coin-header:hover { background: #253349; }
  .coin-toggle { color: var(--muted); font-size: 10px; transition: transform 0.15s; }
  .coin-toggle.open { transform: rotate(90deg); }
  .coin-body { background: var(--bg); padding: 8px 14px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
  .dot-green { background: var(--green); }
  .dot-red { background: var(--red); }
  .dot-gray { background: #475569; }
  .vendor-row:hover { background: rgba(56,189,248,0.05); }
  .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 100; justify-content: center; align-items: center; }
  .modal-overlay.active { display: flex; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; max-width: 500px; width: 90%; }
  .modal h3 { color: var(--text); margin-bottom: 16px; }
  .modal .field { margin-bottom: 12px; }
  .modal .field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  .modal .field input, .modal .field select { width: 100%; padding: 6px 8px; }
  .modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  .btn-primary { background: #166534; color: #86efac; padding: 6px 16px; }
  .btn-cancel { background: var(--border); color: var(--text); padding: 6px 16px; }
  .btn-danger { background: #7f1d1d; color: #fca5a5; padding: 6px 16px; }
  .inline-err { color: #f87171; font-size: 11px; margin-top: 2px; }
  .count-display { color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
${renderNav("providers", failureCount)}
<div style="padding:16px 20px;">
  ${readOnlyBanner}
  <div style="display:flex;gap:2px;border-bottom:2px solid var(--border);margin-bottom:12px;">
    <button class="tab-btn active" data-provider-tab="coins" style="background:none;border:none;color:var(--accent);font-size:12px;font-weight:600;padding:8px 16px;cursor:pointer;border-bottom:2px solid var(--accent);margin-bottom:-2px;text-transform:uppercase;letter-spacing:0.5px;">By Coin</button>
    <button class="tab-btn" data-provider-tab="vendors" style="background:none;border:none;color:var(--muted);font-size:12px;font-weight:600;padding:8px 16px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;text-transform:uppercase;letter-spacing:0.5px;">By Vendor</button>
  </div>
  <div id="provider-tab-coins">
  <div class="toolbar">
    <input type="text" id="search" placeholder="Search coins by name, slug, or metal...">
    <button class="filter-btn active" data-metal="all">All</button>
    <button class="filter-btn" data-metal="silver">Silver</button>
    <button class="filter-btn" data-metal="gold">Gold</button>
    <button class="filter-btn" data-metal="goldback">Goldback</button>
    <button class="filter-btn" data-metal="platinum">Platinum</button>
    </div>
    <div id="bulk-bar" style="display:none;">
      <span style="color:var(--muted);font-size:12px;font-weight:600;">Bulk:</span>
      <select id="bulk-vendor"><option value="">Select vendor...</option></select>
      <button class="btn-bulk" onclick="bulkAction('enable')">Enable All</button>
      <button class="btn-bulk" onclick="bulkAction('disable')">Disable All</button>
      <button class="btn-bulk btn-danger-sm" onclick="bulkAction('remove')">Remove All</button>
    </div>
  <div style="display:flex;align-items:center;gap:12px;flex:1;">
    <span class="count-display" id="coin-count">Showing ${totalCoins} of ${totalCoins} coins</span>
    <span style="margin-left:auto;display:flex;gap:8px;">
      ${readOnly ? "" : '<button id="btn-add-coin" class="btn-primary">+ Add New Coin</button>'}
      ${readOnly ? "" : '<button id="btn-export" style="background:#1e3a5f;color:var(--accent);">Export to API</button>'}
    </span>
  </div>
${coinSections}
</div><!-- /provider-tab-coins -->

<div id="provider-tab-vendors" style="display:none;">
${vendorViewHtml}
</div><!-- /provider-tab-vendors -->
</div><!-- /padding wrapper -->

<!-- Confirmation Modal -->
<div class="modal-overlay" id="confirm-modal">
  <div class="modal">
    <h3 id="confirm-title">Confirm</h3>
    <p id="confirm-message"></p>
    <div class="actions">
      <button class="btn-cancel" id="confirm-cancel">Cancel</button>
      <button class="btn-danger" id="confirm-ok">Confirm</button>
    </div>
  </div>
</div>

<!-- Add Coin Modal -->
<div class="modal-overlay" id="coin-modal">
  <div class="modal">
    <h3 id="coin-modal-title">Add New Coin</h3>
    <div class="field"><label>Slug (kebab-case)</label><input type="text" id="coin-slug" placeholder="e.g. american-silver-eagle"><div class="inline-err" id="err-slug"></div></div>
    <div class="field"><label>Name</label><input type="text" id="coin-name" placeholder="e.g. American Silver Eagle"><div class="inline-err" id="err-name"></div></div>
    <div class="field"><label>Metal</label><select id="coin-metal"><option value="silver">Silver</option><option value="gold">Gold</option><option value="goldback">Goldback</option><option value="platinum">Platinum</option></select></div>
    <div class="field"><label>Weight (oz)</label><input type="number" id="coin-weight" value="1" step="0.001" min="0.001"></div>
    <div class="field"><label><input type="checkbox" id="coin-enabled" checked> Enabled</label></div>
    <div class="inline-err" id="err-coin-general"></div>
    <div class="actions">
      <button class="btn-cancel" id="coin-cancel">Cancel</button>
      <button class="btn-primary" id="coin-save">Save Coin</button>
    </div>
  </div>
</div>

<!-- Add Vendor Modal -->
<div class="modal-overlay" id="vendor-modal">
  <div class="modal">
    <h3>Add Vendor to <span id="vendor-modal-coin"></span></h3>
    <input type="hidden" id="vendor-coin-slug">
    <div class="field"><label>Vendor ID</label><input type="text" id="vendor-id" placeholder="e.g. apmex"><div class="inline-err" id="err-vendor-id"></div></div>
    <div class="field"><label>Vendor Name</label><input type="text" id="vendor-name" placeholder="e.g. APMEX"></div>
    <div class="field"><label>URL</label><input type="text" id="vendor-url" placeholder="https://..."><div class="inline-err" id="err-vendor-url"></div></div>
    <div class="field"><label><input type="checkbox" id="vendor-enabled" checked> Enabled</label></div>
    <div class="field"><label>Selector (optional)</label><input type="text" id="vendor-selector"></div>
    <div class="field"><label>Hints JSON (optional)</label><textarea id="vendor-hints" rows="2" style="width:100%;font-family:monospace;"></textarea><div class="inline-err" id="err-vendor-hints"></div></div>
    <div class="inline-err" id="err-vendor-general"></div>
    <div class="actions">
      <button class="btn-cancel" id="vendor-cancel">Cancel</button>
      <button class="btn-primary" id="vendor-save">Save Vendor</button>
    </div>
  </div>
</div>

<div id="toast" style="display:none;position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:6px;font-size:13px;z-index:200;"></div>

<script>
// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(text, ok) {
  const t = document.getElementById('toast');
  t.style.display = 'block';
  t.style.background = ok ? '#14532d' : '#7f1d1d';
  t.style.color = ok ? '#86efac' : '#fca5a5';
  t.textContent = text;
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

// ── Search & Filter ──────────────────────────────────────────────────────────
const searchInput = document.getElementById('search');
const sections = document.querySelectorAll('.coin-section');
const countDisplay = document.getElementById('coin-count');
const totalCoins = ${totalCoins};
let activeFilter = 'all';
const vendorsByMetal = ${JSON.stringify(vendorsByMetal)};

function applyFilter() {
  const q = searchInput.value.toLowerCase().trim();
  let visible = 0;
  sections.forEach(s => {
    const name = s.dataset.name;
    const slug = s.dataset.slug;
    const metal = s.dataset.metal;
    const matchesMetal = activeFilter === 'all' || metal === activeFilter;
    const matchesSearch = !q || name.includes(q) || slug.includes(q) || metal.includes(q);
    const show = matchesMetal && matchesSearch;
    s.style.display = show ? '' : 'none';
    if (show) visible++;
    // Auto-expand when searching
    if (show && q.length > 0) {
      s.querySelector('.coin-body').style.display = '';
      s.querySelector('.coin-toggle').classList.add('open');
    } else if (q.length === 0) {
      s.querySelector('.coin-body').style.display = 'none';
      s.querySelector('.coin-toggle').classList.remove('open');
    }
  });
  countDisplay.textContent = 'Showing ' + visible + ' of ' + totalCoins + ' coins';
}

searchInput.addEventListener('input', applyFilter);

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.metal;
    applyFilter();
    updateBulkBar();
  });
});

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const sel = document.getElementById('bulk-vendor');
  if (activeFilter === 'all') { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  sel.innerHTML = '<option value="">Select vendor...</option>';
  const vendors = vendorsByMetal[activeFilter] || [];
  vendors.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
}

async function bulkAction(action) {
  const vendorId = document.getElementById('bulk-vendor').value;
  if (!vendorId) { showToast('Select a vendor first', false); return; }
  const metal = activeFilter;

  // Get counts from vendor summary
  let count = '?';
  try {
    const summaryRes = await fetch('/providers/vendor-summary');
    const summary = await summaryRes.json();
    if (summary[vendorId] && summary[vendorId].byMetal && summary[vendorId].byMetal[metal]) {
      count = summary[vendorId].byMetal[metal].total;
    }
  } catch {}

  const titles = { enable: 'Enable Vendor', disable: 'Disable Vendor', remove: 'Remove Vendor' };
  const messages = {
    enable: 'Enable "' + vendorId + '" on ' + count + ' ' + metal + ' items?',
    disable: 'Disable "' + vendorId + '" on ' + count + ' ' + metal + ' items?',
    remove: 'Permanently remove "' + vendorId + '" from ' + count + ' ' + metal + ' items? This cannot be undone.'
  };

  document.getElementById('confirm-title').textContent = titles[action];
  document.getElementById('confirm-message').textContent = messages[action];
  const okBtn = document.getElementById('confirm-ok');
  okBtn.className = action === 'remove' ? 'btn-danger' : 'btn-primary';
  document.getElementById('confirm-modal').style.display = 'flex';

  document.getElementById('confirm-cancel').onclick = () => { document.getElementById('confirm-modal').style.display = 'none'; };
  okBtn.onclick = async () => {
    document.getElementById('confirm-modal').style.display = 'none';
    const endpoint = action === 'remove' ? '/providers/bulk-delete' : '/providers/bulk-toggle';
    const body = action === 'remove'
      ? { vendorId, metal }
      : { vendorId, metal, enabled: action === 'enable' };
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      showToast(data.message, data.ok);
      if (data.ok) setTimeout(() => location.reload(), 800);
    } catch (err) { showToast('Error: ' + err.message, false); }
  };
}

updateBulkBar();

// ── Accordion ────────────────────────────────────────────────────────────────
document.querySelectorAll('.coin-header').forEach(h => {
  h.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    const body = h.nextElementSibling;
    const toggle = h.querySelector('.coin-toggle');
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    toggle.classList.toggle('open', !isOpen);
  });
});

// ── Vendor toggle (immediate) ────────────────────────────────────────────────
document.querySelectorAll('.vendor-toggle').forEach(cb => {
  cb.addEventListener('change', async () => {
    const r = await fetch('/providers/toggle', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ coinSlug: cb.dataset.coin, vendorId: cb.dataset.vendor, enabled: cb.checked })
    });
    const j = await r.json();
    showToast(j.message, r.ok);
    if (!r.ok) cb.checked = !cb.checked;
  });
});

// ── Vendor URL blur-to-save ──────────────────────────────────────────────────
document.querySelectorAll('.vendor-url').forEach(input => {
  const orig = input.value;
  input.addEventListener('blur', async () => {
    if (input.value === orig) return;
    if (input.value && !input.value.startsWith('https://')) {
      showToast('URL must start with https://', false);
      return;
    }
    const r = await fetch('/providers/update-url', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ coinSlug: input.dataset.coin, vendorId: input.dataset.vendor, url: input.value })
    });
    const j = await r.json();
    showToast(j.message, r.ok);
  });
});

// ── Expand vendor details ────────────────────────────────────────────────────
document.querySelectorAll('.btn-expand').forEach(btn => {
  btn.addEventListener('click', () => {
    const detail = document.querySelector('.vendor-detail[data-coin="'+btn.dataset.coin+'"][data-vendor="'+btn.dataset.vendor+'"]');
    detail.style.display = detail.style.display === 'none' ? '' : 'none';
  });
});

// ── Save selector/hints ──────────────────────────────────────────────────────
document.querySelectorAll('.btn-save-fields').forEach(btn => {
  btn.addEventListener('click', async () => {
    const coin = btn.dataset.coin, vendor = btn.dataset.vendor;
    const selector = document.querySelector('.vendor-selector[data-coin="'+coin+'"][data-vendor="'+vendor+'"]').value;
    const hints = document.querySelector('.vendor-hints[data-coin="'+coin+'"][data-vendor="'+vendor+'"]').value;
    if (hints && hints.trim()) {
      try { JSON.parse(hints); } catch { showToast('Hints must be valid JSON', false); return; }
    }
    const r = await fetch('/providers/vendor-fields', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ coinSlug: coin, vendorId: vendor, selector, hints })
    });
    const j = await r.json();
    showToast(j.message, r.ok);
  });
});

// ── Confirmation modal ───────────────────────────────────────────────────────
let confirmCallback = null;
const confirmModal = document.getElementById('confirm-modal');
document.getElementById('confirm-cancel').addEventListener('click', () => { confirmModal.classList.remove('active'); confirmCallback = null; });
document.getElementById('confirm-ok').addEventListener('click', () => { confirmModal.classList.remove('active'); if (confirmCallback) confirmCallback(); confirmCallback = null; });

function showConfirm(title, message, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = cb;
  confirmModal.classList.add('active');
}

// ── Delete vendor ────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-del-vendor').forEach(btn => {
  btn.addEventListener('click', () => {
    showConfirm('Remove Vendor', 'Remove ' + btn.dataset.name + ' from ' + btn.dataset.coinname + '?', async () => {
      const r = await fetch('/providers/vendor', {
        method: 'DELETE',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ coinSlug: btn.dataset.coin, vendorId: btn.dataset.vendor })
      });
      const j = await r.json();
      showToast(j.message, r.ok);
      if (r.ok) {
        document.querySelector('.vendor-row[data-coin="'+btn.dataset.coin+'"][data-vendor="'+btn.dataset.vendor+'"]').remove();
        const detail = document.querySelector('.vendor-detail[data-coin="'+btn.dataset.coin+'"][data-vendor="'+btn.dataset.vendor+'"]');
        if (detail) detail.remove();
      }
    });
  });
});

// ── Delete coin ──────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-del-coin').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm('Delete Coin', 'Delete ' + btn.dataset.name + ' and all ' + btn.dataset.vendors + ' vendors? This cannot be undone.', async () => {
      const r = await fetch('/providers/coin', {
        method: 'DELETE',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ slug: btn.dataset.slug })
      });
      const j = await r.json();
      showToast(j.message, r.ok);
      if (r.ok) {
        document.querySelector('.coin-section[data-slug="'+btn.dataset.slug+'"]').remove();
      }
    });
  });
});

// ── Add coin modal ───────────────────────────────────────────────────────────
const coinModal = document.getElementById('coin-modal');
const btnAddCoin = document.getElementById('btn-add-coin');
if (btnAddCoin) btnAddCoin.addEventListener('click', () => {
  document.getElementById('coin-slug').value = '';
  document.getElementById('coin-name').value = '';
  document.getElementById('coin-metal').value = 'silver';
  document.getElementById('coin-weight').value = '1';
  document.getElementById('coin-enabled').checked = true;
  ['err-slug','err-name','err-coin-general'].forEach(id => document.getElementById(id).textContent = '');
  coinModal.classList.add('active');
});
document.getElementById('coin-cancel').addEventListener('click', () => coinModal.classList.remove('active'));
document.getElementById('coin-save').addEventListener('click', async () => {
  const slug = document.getElementById('coin-slug').value.trim();
  const name = document.getElementById('coin-name').value.trim();
  const metal = document.getElementById('coin-metal').value;
  const weight = parseFloat(document.getElementById('coin-weight').value) || 1;
  const enabled = document.getElementById('coin-enabled').checked;

  ['err-slug','err-name','err-coin-general'].forEach(id => document.getElementById(id).textContent = '');
  let valid = true;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) { document.getElementById('err-slug').textContent = 'Must be lowercase kebab-case (a-z, 0-9, -)'; valid = false; }
  if (!name) { document.getElementById('err-name').textContent = 'Name is required'; valid = false; }
  if (!valid) return;

  const r = await fetch('/providers/coin', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ slug, name, metal, weight_oz: weight, enabled })
  });
  const j = await r.json();
  if (r.ok) { coinModal.classList.remove('active'); showToast(j.message, true); setTimeout(() => location.reload(), 500); }
  else { document.getElementById('err-coin-general').textContent = j.message; }
});

// ── Edit coin ────────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-edit-coin').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const section = document.querySelector('.coin-section[data-slug="'+btn.dataset.slug+'"]');
    const slug = btn.dataset.slug;
    // Pre-fill modal with existing data — fetch from server
    fetch('/providers/coin-data?slug=' + encodeURIComponent(slug))
      .then(r => r.json())
      .then(data => {
        document.getElementById('coin-modal-title').textContent = 'Edit Coin';
        document.getElementById('coin-slug').value = data.slug;
        document.getElementById('coin-slug').disabled = true; // can't change PK
        document.getElementById('coin-name').value = data.name;
        document.getElementById('coin-metal').value = data.metal;
        document.getElementById('coin-weight').value = data.weight_oz;
        document.getElementById('coin-enabled').checked = data.enabled;
        coinModal.classList.add('active');
      });
  });
});

// ── Add vendor modal ─────────────────────────────────────────────────────────
const vendorModal = document.getElementById('vendor-modal');
document.querySelectorAll('.btn-add-vendor').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('vendor-modal-coin').textContent = btn.dataset.coinname;
    document.getElementById('vendor-coin-slug').value = btn.dataset.coin;
    document.getElementById('vendor-id').value = '';
    document.getElementById('vendor-name').value = '';
    document.getElementById('vendor-url').value = '';
    document.getElementById('vendor-enabled').checked = true;
    document.getElementById('vendor-selector').value = '';
    document.getElementById('vendor-hints').value = '';
    ['err-vendor-id','err-vendor-url','err-vendor-hints','err-vendor-general'].forEach(id => document.getElementById(id).textContent = '');
    vendorModal.classList.add('active');
  });
});
document.getElementById('vendor-cancel').addEventListener('click', () => vendorModal.classList.remove('active'));
document.getElementById('vendor-save').addEventListener('click', async () => {
  const coinSlug = document.getElementById('vendor-coin-slug').value;
  const vendorId = document.getElementById('vendor-id').value.trim();
  const vendorName = document.getElementById('vendor-name').value.trim() || vendorId;
  const url = document.getElementById('vendor-url').value.trim();
  const enabled = document.getElementById('vendor-enabled').checked;
  const selector = document.getElementById('vendor-selector').value.trim();
  const hints = document.getElementById('vendor-hints').value.trim();

  ['err-vendor-id','err-vendor-url','err-vendor-hints','err-vendor-general'].forEach(id => document.getElementById(id).textContent = '');
  let valid = true;
  if (!vendorId) { document.getElementById('err-vendor-id').textContent = 'Vendor ID is required'; valid = false; }
  if (url && !url.startsWith('https://')) { document.getElementById('err-vendor-url').textContent = 'URL must start with https://'; valid = false; }
  if (hints) { try { JSON.parse(hints); } catch { document.getElementById('err-vendor-hints').textContent = 'Must be valid JSON'; valid = false; } }
  if (!valid) return;

  const r = await fetch('/providers/vendor', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ coinSlug, vendorId, vendorName, url, enabled, selector, hints })
  });
  const j = await r.json();
  if (r.ok) { vendorModal.classList.remove('active'); showToast(j.message, true); setTimeout(() => location.reload(), 500); }
  else { document.getElementById('err-vendor-general').textContent = j.message; }
});

// ── Export to API ────────────────────────────────────────────────────────────
const btnExport = document.getElementById('btn-export');
if (btnExport) btnExport.addEventListener('click', async () => {
  btnExport.disabled = true;
  btnExport.textContent = 'Publishing to API...';
  try {
    const r = await fetch('/providers/export', { method: 'POST' });
    const j = await r.json();
    btnExport.disabled = false;
    btnExport.textContent = 'Export to API';
    showToast(j.message, j.published !== false);
  } catch (err) {
    btnExport.disabled = false;
    btnExport.textContent = 'Export to API';
    showToast('Network error: ' + err.message, false);
  }
});

// ── Provider tab switching (By Coin / By Vendor) ─────────────────────────
document.querySelectorAll('[data-provider-tab]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('[data-provider-tab]').forEach(function(b) {
      b.style.color = 'var(--muted)';
      b.style.borderBottomColor = 'transparent';
      b.classList.remove('active');
    });
    this.style.color = 'var(--accent)';
    this.style.borderBottomColor = 'var(--accent)';
    this.classList.add('active');
    var tab = this.dataset.providerTab;
    document.getElementById('provider-tab-coins').style.display = tab === 'coins' ? '' : 'none';
    document.getElementById('provider-tab-vendors').style.display = tab === 'vendors' ? '' : 'none';
  });
});

// ── Vendor section expand/collapse ───────────────────────────────────────
document.querySelectorAll('.vendor-section-header').forEach(function(header) {
  header.addEventListener('click', function() {
    // Look the body up by class rather than nextElementSibling: API-fed
    // vendors render a feed health line between the header and the rows, and
    // a positional lookup silently toggles whatever happens to sit next.
    var section = this.closest('.vendor-section');
    var body = section && section.querySelector('.vendor-section-body');
    if (!body) return;
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });
});

// ── By Vendor tab: URL blur-to-save ──────────────────────────────────────
document.querySelectorAll('.vendor-url-byvendor').forEach(function(input) {
  var orig = input.value;
  input.addEventListener('blur', async function() {
    if (input.value === orig) return;
    if (input.value && !input.value.startsWith('https://')) {
      showToast('URL must start with https://', false);
      return;
    }
    const r = await fetch('/providers/update-url', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ coinSlug: input.dataset.coin, vendorId: input.dataset.vendor, url: input.value })
    });
    const j = await r.json();
    showToast(j.message, r.ok);
    if (r.ok) orig = input.value;
  });
});

// ── By Vendor tab: API feed product ID pin ───────────────────────────────
// Blank clears the pin and falls back to URL matching. Saves on blur, matching
// the URL input beside it. The server merges into the hints JSON.
document.querySelectorAll('.vendor-productid-byvendor').forEach(function(input) {
  var orig = input.value;
  input.addEventListener('blur', async function() {
    if (input.value === orig) return;
    try {
      const r = await fetch('/providers/vendor-product-id', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ coinSlug: input.dataset.coin, vendorId: input.dataset.vendor, productId: input.value })
      });
      const j = await r.json();
      showToast(j.message, r.ok);
      if (r.ok) orig = input.value;
      else input.value = orig;
    } catch {
      // Without this the rejection is unhandled: no toast, and the field keeps
      // an edit the server never received — which reads as saved on next blur.
      showToast('Request failed — product ID not saved', false);
      input.value = orig;
    }
  });
});

// ── By Vendor tab: feed health, fetched after render ─────────────────────
// Deliberately not part of the page HTML — see GET /providers/feed-health.
document.querySelectorAll('.vendor-feed-health').forEach(async function(el) {
  try {
    const r = await fetch('/providers/feed-health');
    const j = await r.json();
    el.textContent = j.label;
    el.style.color = j.ok ? 'var(--green)' : 'var(--red)';
    if (j.detail) el.title = j.detail;
  } catch {
    el.textContent = 'feed status unavailable';
    el.style.color = 'var(--muted)';
  }
});

// ── By Vendor tab: toggle enabled/disabled ───────────────────────────────
document.querySelectorAll('.vendor-toggle-byvendor').forEach(function(btn) {
  btn.addEventListener('click', async function() {
    var isEnabled = btn.dataset.enabled === '1';
    var newState = !isEnabled;
    const r = await fetch('/providers/toggle', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ coinSlug: btn.dataset.coin, vendorId: btn.dataset.vendor, enabled: newState })
    });
    const j = await r.json();
    showToast(j.message, r.ok);
    if (r.ok) {
      btn.dataset.enabled = newState ? '1' : '0';
      btn.textContent = newState ? 'On' : 'Off';
      btn.style.background = newState ? 'var(--green)' : 'var(--red)';
    }
  });
});
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// v2 API Health page (GET /api-health)
// ---------------------------------------------------------------------------

const V2_BASE = "https://api.staktrakr.com/data/v2";

async function fetchV2Endpoints() {
  const endpoints = [
    { key: "manifest", path: "/manifest.json", label: "Manifest" },
    { key: "spot_latest", path: "/spot/latest.json", label: "Spot Latest" },
    { key: "spot_7d", path: "/spot/history/7d.json", label: "Spot 7d History" },
    { key: "retail_latest", path: "/retail/latest.json", label: "Retail Latest" },
    { key: "vendors", path: "/retail/vendors/index.json", label: "Vendor Index" },
    { key: "goldback", path: "/goldback/latest.json", label: "Goldback Latest" },
  ];

  const results = {};
  await Promise.all(
    endpoints.map(async (ep) => {
      try {
        const resp = await fetch(V2_BASE + ep.path, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
          results[ep.key] = { label: ep.label, status: resp.status, ok: false, data: null };
          return;
        }
        const json = await resp.json();
        const ageSec = json.generated_at
          ? Math.round((Date.now() - new Date(json.generated_at).getTime()) / 1000)
          : null;
        results[ep.key] = {
          label: ep.label,
          status: 200,
          ok: true,
          data: json,
          ageSec,
          staleAfter: json.stale_after,
        };
      } catch (err) {
        results[ep.key] = { label: ep.label, status: 0, ok: false, error: err.message, data: null };
      }
    })
  );

  // Fetch a sample of per-coin endpoints
  if (results.retail_latest?.ok) {
    const coins = results.retail_latest.data.data.coins;
    const slugs = Object.keys(coins).slice(0, 5);
    const coinResults = {};
    await Promise.all(
      slugs.map(async (slug) => {
        try {
          const resp = await fetch(`${V2_BASE}/retail/${slug}/latest.json`, {
            signal: AbortSignal.timeout(10_000),
          });
          coinResults[slug] = { ok: resp.ok, status: resp.status };
          if (resp.ok) {
            const json = await resp.json();
            coinResults[slug].vendorCount = Object.keys(json.data.vendors || {}).length;
          }
        } catch {
          coinResults[slug] = { ok: false, status: 0 };
        }
      })
    );
    results.perCoinSample = coinResults;
  }

  // Fetch all per-vendor endpoints for matrix
  if (results.vendors?.ok) {
    const vendorList = results.vendors.data.data;
    const vendorIds = Array.isArray(vendorList)
      ? vendorList.map((v) => v.id)
      : Object.keys(vendorList);
    const vendorData = {};
    await Promise.all(
      vendorIds.map(async (vid) => {
        try {
          const resp = await fetch(`${V2_BASE}/retail/vendors/${vid}.json`, {
            signal: AbortSignal.timeout(10_000),
          });
          if (resp.ok) {
            const json = await resp.json();
            vendorData[vid] = json.data;
          }
        } catch {
          /* skip */
        }
      })
    );
    results.vendorDetails = vendorData;
  }

  return results;
}

function renderApiHealthPage(v2, failureCount, vendorMetalAvgs) {
  const now = new Date().toUTCString();

  // Endpoint health table
  const epRows = ["manifest", "spot_latest", "spot_7d", "retail_latest", "vendors", "goldback"]
    .map((key) => {
      const ep = v2[key];
      if (!ep) return "";
      const statusColor = ep.ok ? "var(--green)" : "var(--red)";
      const ageStr =
        ep.ageSec != null
          ? ep.ageSec < 60
            ? `${ep.ageSec}s`
            : ep.ageSec < 3600
              ? `${Math.round(ep.ageSec / 60)}m`
              : `${Math.round(ep.ageSec / 3600)}h`
          : "--";
      const staleStr = ep.staleAfter ? `${Math.round(ep.staleAfter / 60)}m` : "--";
      const isStale = ep.ageSec != null && ep.staleAfter && ep.ageSec > ep.staleAfter;
      const freshColor = isStale ? "var(--red)" : ep.ok ? "var(--green)" : "var(--muted)";
      return `<tr>
      <td>${escHtml(ep.label)}</td>
      <td><span class="status ${ep.ok ? "status-ok" : "status-failed"}">${ep.status || "ERR"}</span></td>
      <td style="color:${freshColor}">${ageStr}</td>
      <td>${staleStr}</td>
      <td>${isStale ? '<span style="color:var(--red);font-weight:700;">STALE</span>' : ep.ok ? '<span style="color:var(--green);">Fresh</span>' : '<span style="color:var(--red);">Down</span>'}</td>
    </tr>`;
    })
    .join("");

  // Spot prices table
  let spotHtml = '<p class="no-data">Spot data unavailable</p>';
  if (v2.spot_latest?.ok) {
    const spot = v2.spot_latest.data.data;
    const metalNames = SPOT_ISO_NAMES;
    const metalColors = SPOT_ISO_COLORS;
    const spotRows = Object.entries(spot)
      .map(([metal, d]) => {
        const change = d.change_24h_pct;
        const changeColor =
          change > 0 ? "var(--green)" : change < 0 ? "var(--red)" : "var(--muted)";
        const changeStr = change != null ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "--";
        return `<tr>
        <td><span style="color:${metalColors[metal] || "var(--text)"};font-weight:600;">${metalNames[metal] || metal.toUpperCase()}</span> <span style="color:var(--muted);font-size:10px;">${metal.toUpperCase()}</span></td>
        <td style="font-weight:700;font-family:monospace;">$${Number(d.price).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="color:${changeColor}">${changeStr}</td>
      </tr>`;
      })
      .join("");
    spotHtml = `<table><thead><tr><th>Metal</th><th>Price</th><th>24h</th></tr></thead><tbody>${spotRows}</tbody></table>`;
  }

  // Retail summary — per-coin table
  let retailHtml = '<p class="no-data">Retail data unavailable</p>';
  if (v2.retail_latest?.ok) {
    const coins = v2.retail_latest.data.data.coins;
    const retailRows = Object.entries(coins)
      .map(([slug, c]) => {
        const metalColor =
          { xau: "#fbbf24", xag: "#c0c0c0", xpt: "#a78bfa", goldback: "#a3e635" }[c.metal] ||
          "#94a3b8";
        return `<tr>
        <td>${escHtml(c.name)}</td>
        <td><span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;background:${metalColor};color:#0f172a;">${escHtml(c.metal)}</span></td>
        <td style="font-family:monospace;font-weight:600;">$${Number(c.median).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="color:var(--muted);font-family:monospace;">$${Number(c.low).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
        <td style="color:var(--muted);font-family:monospace;">$${Number(c.high).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
        <td style="text-align:center;">${c.vendor_count}</td>
      </tr>`;
      })
      .join("");
    retailHtml = `<table><thead><tr><th>Coin</th><th>Metal</th><th>Median</th><th>Low</th><th>High</th><th>Vendors</th></tr></thead><tbody>${retailRows}</tbody></table>`;
  }

  // Per-vendor × metal price matrix
  let matrixHtml = "";
  if (v2.vendorDetails && v2.retail_latest?.ok) {
    const coinsMeta = v2.retail_latest.data.data.coins; // slug → { metal, name, ... }
    const metals = ["xau", "xag", "xpt"];
    const metalNames = { xau: "Gold", xag: "Silver", xpt: "Platinum", xpd: "Palladium" };
    const metalColors = { xau: "#fbbf24", xag: "#c0c0c0", xpt: "#a78bfa", xpd: "#f97316" };
    // Map coin_slug metal fields (some use "gold"/"silver" vs "xau"/"xag")
    const metalNorm = {
      gold: "xau",
      silver: "xag",
      platinum: "xpt",
      palladium: "xpd",
      xau: "xau",
      xag: "xag",
      xpt: "xpt",
      xpd: "xpd",
    };

    // Reverse map: xau → gold, xag → silver, xpt → platinum
    const isoToName = { xau: "gold", xag: "silver", xpt: "platinum", xpd: "palladium" };

    // Build vendor rows from vendorDetails
    const vendorIds = Object.keys(v2.vendorDetails).sort();
    const matrixRows = vendorIds
      .map((vid) => {
        const vd = v2.vendorDetails[vid];
        if (!vd || !vd.coins) return "";
        const vendorName = vd.vendor?.name || vid;

        // Aggregate current prices by metal
        const byMetal = {};
        for (const [slug, cd] of Object.entries(vd.coins)) {
          const coinMetal = metalNorm[(coinsMeta[slug]?.metal || "").toLowerCase()] || null;
          if (!coinMetal || coinMetal === "xpd") continue; // skip goldback and palladium (no retail data)
          if (!byMetal[coinMetal]) byMetal[coinMetal] = [];
          if (cd.price != null && cd.price > 0) byMetal[coinMetal].push(cd.price);
        }

        const cells = metals
          .map((m) => {
            const prices = byMetal[m] || [];
            // Turso uses the provider_coins metal name (gold/silver/platinum), try both
            const avgData =
              (vendorMetalAvgs || {})[`${vid}:${isoToName[m]}`] ||
              (vendorMetalAvgs || {})[`${vid}:${m}`] ||
              {};
            if (!prices.length && !avgData.avg24h) {
              return `<td colspan="4" class="matrix-cell" style="color:var(--border);">\u2014</td>`;
            }
            const latest = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
            const fmtPrice = (v) =>
              v != null
                ? `$${Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "\u2014";
            return `<td class="matrix-cell">${fmtPrice(latest)}</td>
                <td class="matrix-cell">${fmtPrice(avgData.avg24h)}</td>
                <td class="matrix-cell">${fmtPrice(avgData.avg7d)}</td>
                <td class="matrix-cell">${fmtPrice(avgData.avg30d)}</td>`;
          })
          .join("");

        return `<tr><td style="font-weight:600;font-size:11px;white-space:nowrap;">${escHtml(vendorName)}</td>${cells}</tr>`;
      })
      .filter(Boolean)
      .join("");

    const metalHeaders = metals
      .map(
        (m) =>
          `<th colspan="4" style="text-align:center;color:${metalColors[m]};border-bottom:2px solid ${metalColors[m]}30;">${metalNames[m]}</th>`
      )
      .join("");
    const subHeaders = metals
      .map(
        () =>
          `<th class="matrix-cell">Latest</th><th class="matrix-cell">24h</th><th class="matrix-cell">7d</th><th class="matrix-cell">30d</th>`
      )
      .join("");

    matrixHtml = `<div class="row full" style="margin-top:12px;">
      <div class="card">
        <div class="card-title">Vendor \u00D7 Metal Price Matrix \u2014 Averages</div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr><th rowspan="2" style="vertical-align:bottom;">Vendor</th>${metalHeaders}</tr>
              <tr>${subHeaders}</tr>
            </thead>
            <tbody>${matrixRows}</tbody>
          </table>
        </div>
        <p style="color:var(--muted);font-size:10px;margin-top:8px;">Latest = mean of current vendor prices for that metal. 24h/7d/30d = historical averages from Turso DB.</p>
      </div>
    </div>`;
  }

  // Per-coin sample endpoints
  let sampleHtml = "";
  if (v2.perCoinSample) {
    const sRows = Object.entries(v2.perCoinSample)
      .map(([slug, s]) => {
        return `<tr>
        <td><code>${escHtml(slug)}</code></td>
        <td><span class="status ${s.ok ? "status-ok" : "status-failed"}">${s.status}</span></td>
        <td>${s.vendorCount != null ? s.vendorCount + " vendors" : "--"}</td>
      </tr>`;
      })
      .join("");
    sampleHtml = `<div class="card-title" style="margin-top:12px;">Per-Coin Endpoint Sample (5 of ${Object.keys(v2.retail_latest?.data?.data?.coins || {}).length})</div>
      <table><thead><tr><th>Slug</th><th>Status</th><th>Vendors</th></tr></thead><tbody>${sRows}</tbody></table>`;
  }

  // Goldback status
  let goldbackHtml = '<span style="color:var(--red);">Endpoint 404 — scraper needs deploy</span>';
  if (v2.goldback?.ok) {
    const gb = v2.goldback.data.data;
    goldbackHtml = `<span style="color:var(--green);font-weight:600;">$${gb.g1_usd}</span> <span style="color:var(--muted);font-size:11px;">(${gb.t ? gb.t.slice(0, 16).replace("T", " ") + " UTC" : "—"})</span>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="120">
<title>v2 API Health \u2014 StakTrakr</title>
<style>
  ${SHARED_CSS}
  .matrix-cell { text-align: center; font-size: 10px; font-family: monospace; }
  code { background: var(--surface2); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
</style>
</head>
<body>
${renderNav("api-health", failureCount)}
<div class="container">

  <!-- Endpoint Health -->
  <div class="row row-2">
    <div class="card">
      <div class="card-title">v2 Endpoint Health</div>
      <table>
        <thead><tr><th>Endpoint</th><th>Status</th><th>Age</th><th>Stale After</th><th>Freshness</th></tr></thead>
        <tbody>${epRows}</tbody>
      </table>
      ${sampleHtml}
    </div>

    <div class="card">
      <div class="card-title">Spot Prices — Live</div>
      ${spotHtml}
      <div class="card-title" style="margin-top:16px;">Goldback G1 Rate</div>
      <div style="padding:8px 0;">${goldbackHtml}</div>
    </div>
  </div>

  <!-- Retail Summary -->
  <div class="row full">
    <div class="card">
      <div class="card-title">Retail Prices — All Coins (${Object.keys(v2.retail_latest?.data?.data?.coins || {}).length} items)</div>
      <div style="max-height:600px;overflow-y:auto;">
        ${retailHtml}
      </div>
    </div>
  </div>

  ${matrixHtml}

  <!-- 7-Day Spot History — All Metals -->
  ${
    v2.spot_7d?.ok
      ? SPOT_ISO_ORDER.map((key) => ({
          key,
          name: SPOT_ISO_NAMES[key],
          color: SPOT_ISO_COLORS[key],
        }))
          .map((m) => {
            const rows = v2.spot_7d.data.data[m.key] || [];
            if (!rows.length) return "";
            return `<div class="row full">
    <div class="card">
      <div class="card-title"><span style="color:${m.color};">${m.name} Spot</span> \u2014 7 Day OHLCA</div>
      <table>
        <thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Avg</th><th>Samples</th></tr></thead>
        <tbody>${rows
          .map(
            (d) => `<tr>
          <td>${escHtml((d.t || "").slice(0, 10))}</td>
          <td style="font-family:monospace;">$${Number(d.open).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
          <td style="font-family:monospace;color:var(--green);">$${Number(d.high).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
          <td style="font-family:monospace;color:var(--red);">$${Number(d.low).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
          <td style="font-family:monospace;font-weight:600;">$${Number(d.close).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
          <td style="font-family:monospace;">$${Number(d.avg).toLocaleString("en", { minimumFractionDigits: 2 })}</td>
          <td style="text-align:center;">${d.n}</td>
        </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>
  </div>`;
          })
          .join("")
      : ""
  }

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Failure queue page (GET /failures)
// ---------------------------------------------------------------------------

function renderFailuresPage(lastScanFailures, chronicFailures, failureCount, failureTrend) {
  const now = new Date().toUTCString();

  // Last scan failures
  const scanRows =
    !lastScanFailures || lastScanFailures.length === 0
      ? `<p style="color:var(--green);font-size:12px;padding:12px 0;">No failures in the last scan.</p>`
      : lastScanFailures
          .map((f) => {
            const time = (f.failedAt || "").slice(11, 19);
            return `<div style="display:grid;grid-template-columns:2fr 1fr 3fr 1fr auto;gap:8px;align-items:center;padding:8px 10px;background:var(--surface2);border-radius:4px;margin-bottom:4px;font-size:12px;border-left:3px solid var(--red);">
        <div><span style="font-weight:600;">${escHtml(f.coinName)}</span><br><span style="color:var(--muted);font-size:10px;">${escHtml(f.vendorId)}</span></div>
        <div>${metalBadge(f.metal)}</div>
        <div style="color:#f87171;font-size:11px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escAttr(f.error || "")}">${escHtml(f.error || "")}</div>
        <div style="font-size:11px;color:var(--muted);">${escHtml(time)}</div>
        <div style="display:flex;gap:4px;">
          <button class="btn-sm btn-edit-failure" data-coin="${escAttr(f.coinSlug)}" data-vendor="${escAttr(f.vendorId)}" data-coinname="${escAttr(f.coinName)}" data-url="${escAttr(f.url || "")}">Edit</button>
          <button class="btn-sm primary btn-retry" data-coin="${escAttr(f.coinSlug)}" data-vendor="${escAttr(f.vendorId)}">Retry</button>
        </div>
      </div>`;
          })
          .join("");

  // Chronic failures
  const chronicRows =
    !chronicFailures || chronicFailures.length === 0
      ? `<p style="color:var(--green);font-size:12px;padding:12px 0;">No chronic failures.</p>`
      : chronicFailures
          .map((f) => {
            const age = f.lastFailure
              ? Math.round((Date.now() - new Date(f.lastFailure)) / 1000)
              : null;
            const ageStr =
              age != null
                ? age < 3600
                  ? `${Math.round(age / 60)}m ago`
                  : `${Math.round(age / 3600)}h ago`
                : "?";
            const countColor = f.failureCount >= 48 ? "var(--red)" : "var(--amber)";
            return `<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;align-items:center;padding:6px 10px;background:var(--surface2);border-radius:4px;margin-bottom:3px;font-size:12px;border-left:3px solid var(--red);">
        <div><span style="font-weight:600;">${escHtml(f.coinName)}</span> <span style="color:var(--muted)">/ ${escHtml(f.vendorId)}</span></div>
        <div style="color:${countColor};font-weight:700;">${f.failureCount} fails</div>
        <div style="color:var(--muted);font-size:11px;" title="${escAttr(f.lastError || "")}">${escHtml((f.lastError || "").slice(0, 30))}</div>
        <div style="color:var(--muted);font-size:11px;">Last: ${ageStr}</div>
        <div style="display:flex;gap:4px;">
          <button class="btn-sm btn-edit-failure" data-coin="${escAttr(f.coinSlug)}" data-vendor="${escAttr(f.vendorId)}" data-coinname="${escAttr(f.coinName)}" data-url="${escAttr(f.url || "")}">Edit</button>
          <button class="btn-sm btn-clear-chronic" data-coin="${escAttr(f.coinSlug)}" data-vendor="${escAttr(f.vendorId)}">Clear</button>
        </div>
      </div>`;
          })
          .join("");

  // Trend data for Chart.js
  const trendJson = JSON.stringify(
    (failureTrend || []).map((d) => ({ day: d.day, failures: d.failures }))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>Failures \u2014 StakTrakr</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js"><\/script>
<style>
  ${SHARED_CSS}
</style>
</head>
<body>
${renderNav("failures", failureCount)}
<div class="container">
  <div id="toast" style="display:none;position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:6px;font-size:13px;z-index:200;"></div>

  <!-- Last Scan Failures -->
  <div class="row full">
    <div class="card">
      <div class="card-title">
        <span>Last Scan Failures (${lastScanFailures?.length || 0} of 166)</span>
        <div style="display:flex;gap:6px;">
          ${lastScanFailures?.length > 0 ? '<button class="btn-sm primary" id="btn-retry-all">Retry All Failed</button>' : ""}
        </div>
      </div>
      ${scanRows}
    </div>
  </div>

  <!-- Chronic Failures -->
  <div class="row full">
    <div class="card">
      <div class="card-title">
        <span>Chronic Failures \u2014 24+ in 7 days</span>
        <div style="display:flex;gap:6px;">
          ${chronicFailures?.length > 0 ? '<button class="btn-sm danger" id="btn-clear-all">Clear All</button>' : ""}
        </div>
      </div>
      ${chronicRows}
    </div>
  </div>

  <!-- Failure Trend Chart -->
  <div class="row full">
    <div class="card">
      <div class="card-title">Failure Trend \u2014 7 Days</div>
      <div style="position:relative;height:180px;"><canvas id="failureTrendChart"></canvas></div>
    </div>
  </div>

</div>

<!-- Edit URL Modal (inline on failures page) -->
<div id="edit-failure-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100;justify-content:center;align-items:center;">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:24px;max-width:560px;width:90%;">
    <h3 style="color:var(--text);margin-bottom:4px;" id="edit-failure-title">Edit Vendor URL</h3>
    <p style="color:var(--muted);font-size:11px;margin-bottom:16px;" id="edit-failure-subtitle"></p>
    <div style="margin-bottom:12px;">
      <label style="display:block;font-size:12px;color:var(--muted);margin-bottom:4px;">URL</label>
      <input type="text" id="edit-failure-url" style="width:100%;padding:8px 10px;font-size:13px;" placeholder="https://...">
      <div id="edit-failure-err" style="color:#f87171;font-size:11px;margin-top:2px;"></div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="edit-failure-cancel" style="background:var(--border);color:var(--text);padding:6px 16px;">Cancel</button>
      <button id="edit-failure-save" style="background:#166534;color:#86efac;padding:6px 16px;">Save URL</button>
    </div>
  </div>
</div>
<script>
function showToast(text, ok) {
  var t = document.getElementById('toast');
  t.style.display = 'block';
  t.style.background = ok ? '#14532d' : '#7f1d1d';
  t.style.color = ok ? '#86efac' : '#fca5a5';
  t.textContent = text;
  setTimeout(function() { t.style.display = 'none'; }, 3000);
}

// ── Edit URL modal (inline on failures page) ─────────────────────────────
(function() {
  var modal = document.getElementById('edit-failure-modal');
  var urlInput = document.getElementById('edit-failure-url');
  var errEl = document.getElementById('edit-failure-err');
  var titleEl = document.getElementById('edit-failure-title');
  var subtitleEl = document.getElementById('edit-failure-subtitle');
  var currentCoin = '', currentVendor = '';

  document.querySelectorAll('.btn-edit-failure').forEach(function(btn) {
    btn.addEventListener('click', function() {
      currentCoin = btn.dataset.coin;
      currentVendor = btn.dataset.vendor;
      titleEl.textContent = 'Edit URL — ' + (btn.dataset.coinname || currentCoin);
      subtitleEl.textContent = 'Vendor: ' + currentVendor;
      urlInput.value = btn.dataset.url || '';
      errEl.textContent = '';
      modal.style.display = 'flex';
      urlInput.focus();
    });
  });

  document.getElementById('edit-failure-cancel').addEventListener('click', function() {
    modal.style.display = 'none';
  });
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.style.display = 'none';
  });

  document.getElementById('edit-failure-save').addEventListener('click', async function() {
    var url = urlInput.value.trim();
    errEl.textContent = '';
    if (url && !url.startsWith('https://')) {
      errEl.textContent = 'URL must start with https://';
      return;
    }
    try {
      var r = await fetch('/providers/update-url', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ coinSlug: currentCoin, vendorId: currentVendor, url: url })
      });
      var j = await r.json();
      showToast(j.message, r.ok);
      if (r.ok) {
        modal.style.display = 'none';
        // Update the data-url on the button so re-opening shows the new URL
        var editBtn = document.querySelector('.btn-edit-failure[data-coin="' + currentCoin + '"][data-vendor="' + currentVendor + '"]');
        if (editBtn) editBtn.dataset.url = url;
      } else {
        errEl.textContent = j.message || 'Save failed';
      }
    } catch (err) {
      errEl.textContent = 'Network error: ' + err.message;
    }
  });
})();

// Retry button
document.querySelectorAll('.btn-retry').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var coin = this.dataset.coin, vendor = this.dataset.vendor;
    this.disabled = true; this.textContent = '...';
    fetch('/api/retry', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ coinSlug: coin, vendorId: vendor })
    }).then(function(r) { return r.json(); }).then(function(j) {
      btn.textContent = j.ok ? 'Queued' : 'Err';
      showToast(j.message || (j.ok ? 'Queued' : 'Failed'), j.ok);
    }).catch(function() { btn.textContent = 'Err'; btn.disabled = false; });
  });
});

// Retry all
var retryAllBtn = document.getElementById('btn-retry-all');
if (retryAllBtn) retryAllBtn.addEventListener('click', function() {
  document.querySelectorAll('.btn-retry').forEach(function(btn) { btn.click(); });
});

// Clear chronic
document.querySelectorAll('.btn-clear-chronic').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var coin = this.dataset.coin, vendor = this.dataset.vendor;
    this.disabled = true; this.textContent = '...';
    fetch('/api/clear-chronic', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ coinSlug: coin, vendorId: vendor })
    }).then(function(r) { return r.json(); }).then(function(j) {
      if (j.ok) btn.closest('div[style*="grid"]').style.opacity = '0.3';
      showToast(j.message || (j.ok ? 'Cleared' : 'Failed'), j.ok);
    }).catch(function() { btn.textContent = 'Err'; btn.disabled = false; });
  });
});

// Clear all chronic
var clearAllBtn = document.getElementById('btn-clear-all');
if (clearAllBtn) clearAllBtn.addEventListener('click', function() {
  if (!confirm('Clear ALL chronic failure records? This cannot be undone.')) return;
  clearAllBtn.disabled = true; clearAllBtn.textContent = '...';
  fetch('/api/clear-chronic-all', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(j) {
      showToast(j.message || (j.ok ? 'Cleared' : 'Failed'), j.ok);
      if (j.ok) setTimeout(function() { location.reload(); }, 1000);
    }).catch(function() { clearAllBtn.textContent = 'Err'; clearAllBtn.disabled = false; });
});

// Failure trend chart
(function() {
  var trend = ${trendJson};
  if (!trend.length) return;
  var ctx = document.getElementById('failureTrendChart');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trend.map(function(d) { return d.day.slice(5); }),
      datasets: [{
        label: 'Failures',
        data: trend.map(function(d) { return d.failures; }),
        backgroundColor: trend.map(function(d) {
          return d.failures >= 20 ? 'rgba(239,68,68,0.7)' : d.failures >= 10 ? 'rgba(245,158,11,0.7)' : 'rgba(34,197,94,0.7)';
        }),
        borderRadius: 3, borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, titleColor: '#e2e8f0', bodyColor: '#94a3b8' } },
      scales: {
        x: { ticks: { color: '#475569', font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: '#475569', font: { size: 10 } }, grid: { color: '#1e293b' }, beginAtZero: true }
      }
    }
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server + Route handlers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/** Get failure count for nav badge (non-blocking) */
async function getFailureCount(client) {
  if (!client) return 0;
  try {
    const stats = await getFailureStats(client);
    return stats.length;
  } catch {
    return 0;
  }
}

/**
 * Route incoming HTTP requests for the dashboard and send the corresponding HTTP responses.
 *
 * Handles provider management, diagnostics, retries, exports, health and failures endpoints,
 * and renders the main dashboard HTML. It sets permissive iframe/CORS headers and ends the
 * response for each supported route.
 *
 * Supported routes include:
 * - GET /providers, GET /providers/coin-data
 * - POST /providers/coin, DELETE /providers/coin
 * - POST /providers/vendor, DELETE /providers/vendor
 * - POST /providers/update-url, POST /providers/toggle
 * - POST /providers/vendor-fields, POST /providers/bulk-toggle
 * - POST /providers/bulk-delete, GET /providers/vendor-summary
 * - POST /providers/export
 * - GET /api-health, GET /failures
 * - POST /api/diagnose, POST /api/browserbase
 * - POST /api/retry
 * - POST /api/clear-chronic, POST /api/clear-chronic-all
 * - POST /api/clear-lock
 *
 * All request handling uses the provided Node.js `req` and `res` objects and writes JSON
 * or HTML responses as appropriate.
 */
async function handleRequest(req, res) {
  // Allow iframe embedding from spec-workflow dashboard
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Frame-Options", "ALLOWALL");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");

  const url = req.url.split("?")[0];
  const query = new URLSearchParams(req.url.split("?")[1] || "");

  // ── GET /providers ──────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/providers") {
    let client = null;
    let readOnly = false;
    let providers, scrapeStatus, failureCount, vendorGroups;
    try {
      client = getSqldClient();
      await initProviderSchema(client);
      // The feed probe is deliberately absent here — see GET
      // /providers/feed-health. Awaiting it would put an external vendor
      // endpoint on this page's critical path.
      [providers, scrapeStatus, failureCount, vendorGroups] = await Promise.all([
        getProviders(client),
        getVendorScrapeStatus(client).catch(() => null),
        getFailureCount(client),
        getProvidersByVendor(client).catch(() => []),
      ]);
    } catch {
      readOnly = true;
      try {
        providers = JSON.parse(readFileSync(PROVIDERS_FILE, "utf8"));
      } catch {
        providers = { coins: {} };
      }
      scrapeStatus = null;
      failureCount = 0;
      vendorGroups = [];
    } finally {
      if (client)
        try {
          await client.close();
        } catch {
          /* ignore */
        }
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderProvidersPage(providers, scrapeStatus, failureCount, readOnly, vendorGroups));
    return;
  }

  // ── GET /providers/coin-data ────────────────────────────────────────────
  if (req.method === "GET" && url === "/providers/coin-data") {
    const slug = query.get("slug");
    try {
      const client = getSqldClient();
      const coins = await getAllCoins(client);
      const coin = coins.find((c) => c.slug === slug);
      if (!coin) throw new Error("Coin not found");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(coin));
    } catch (err) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/coin ───────────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/coin") {
    try {
      const data = JSON.parse(await readBody(req));
      if (!data.slug || !/^[a-z0-9-]+$/.test(data.slug)) throw new Error("Invalid slug format");
      if (!data.name) throw new Error("Name is required");
      if (!["silver", "gold", "goldback", "platinum"].includes(data.metal))
        throw new Error("Invalid metal");
      const client = getSqldClient();
      await upsertCoin(client, data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Coin '${data.slug}' saved.` }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── DELETE /providers/coin ─────────────────────────────────────────────
  if (req.method === "DELETE" && url === "/providers/coin") {
    try {
      const { slug } = JSON.parse(await readBody(req));
      if (!slug) throw new Error("Slug required");
      const client = getSqldClient();
      await deleteCoin(client, slug);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Deleted coin '${slug}' and all its vendors.` }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/vendor ─────────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/vendor") {
    try {
      const data = JSON.parse(await readBody(req));
      if (!data.coinSlug || !data.vendorId) throw new Error("coinSlug and vendorId required");
      if (data.url && !data.url.startsWith("https://"))
        throw new Error("URL must start with https://");
      if (data.hints && data.hints.trim()) {
        try {
          JSON.parse(data.hints);
        } catch {
          throw new Error("Hints must be valid JSON");
        }
      }
      const client = getSqldClient();
      await upsertVendor(client, {
        coin_slug: data.coinSlug,
        vendor_id: data.vendorId,
        vendor_name: data.vendorName || data.vendorId,
        url: data.url || null,
        enabled: data.enabled !== false,
        selector: data.selector || null,
        hints: data.hints || null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          message: `Vendor '${data.vendorId}' saved to '${data.coinSlug}'.`,
        })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── DELETE /providers/vendor ────────────────────────────────────────────
  if (req.method === "DELETE" && url === "/providers/vendor") {
    try {
      const { coinSlug, vendorId } = JSON.parse(await readBody(req));
      if (!coinSlug || !vendorId) throw new Error("coinSlug and vendorId required");
      const client = getSqldClient();
      await deleteVendor(client, coinSlug, vendorId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Removed '${vendorId}' from '${coinSlug}'.` }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/update-url ─────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/update-url") {
    try {
      const data = JSON.parse(await readBody(req));
      const coinSlug = data.coinSlug || data.coinId;
      const vendorId = data.vendorId || data.providerId;
      const newUrl = data.url;
      if (newUrl && !newUrl.startsWith("https://")) throw new Error("URL must start with https://");
      const client = getSqldClient();
      await updateVendorUrl(client, coinSlug, vendorId, newUrl);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Updated ${vendorId}/${coinSlug} URL.` }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/toggle ─────────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/toggle") {
    try {
      const data = JSON.parse(await readBody(req));
      const coinSlug = data.coinSlug || data.coinId;
      const vendorId = data.vendorId || data.providerId;
      const enabled = data.enabled !== false;
      const client = getSqldClient();
      await toggleVendor(client, coinSlug, vendorId, enabled);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          message: `${enabled ? "Enabled" : "Disabled"} ${vendorId}/${coinSlug}.`,
        })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/vendor-fields ──────────────────────────────────────
  if (req.method === "POST" && url === "/providers/vendor-fields") {
    try {
      const { coinSlug, vendorId, selector, hints } = JSON.parse(await readBody(req));
      if (!coinSlug || !vendorId) throw new Error("coinSlug and vendorId required");
      if (hints && hints.trim()) {
        try {
          JSON.parse(hints);
        } catch {
          throw new Error("Hints must be valid JSON");
        }
      }
      const client = getSqldClient();
      await updateVendorFields(client, coinSlug, vendorId, {
        selector: selector || null,
        hints: hints || null,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ ok: true, message: `Updated selector/hints for ${vendorId}/${coinSlug}.` })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── GET /providers/feed-health ─────────────────────────────────────────
  // Served separately from the provider page on purpose: this calls an
  // external vendor endpoint, and buildFeedState allows two 15s attempts plus
  // a 2s retry delay. On the page's critical path a hanging feed would stall
  // the whole provider editor for ~32s after each cache expiry (STRK-324).
  if (req.method === "GET" && url === "/providers/feed-health") {
    const health = await probeFeedHealth();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health || { ok: false, label: "feed status unavailable", detail: "" }));
    return;
  }

  // ── POST /providers/vendor-product-id ──────────────────────────────────
  // Sets or clears the {"mbProductId"} feed pin for one row. Read-modify-write
  // on hints so unrelated keys survive, and hints-only so the selector is not
  // collaterally nulled the way updateVendorFields would (STRK-324).
  if (req.method === "POST" && url === "/providers/vendor-product-id") {
    let client = null;
    try {
      const { coinSlug, vendorId, productId } = JSON.parse(await readBody(req));
      if (!coinSlug || !vendorId) throw new Error("coinSlug and vendorId required");
      client = getSqldClient();
      const currentHints = await getVendorHints(client, coinSlug, vendorId);
      const nextHints = mergeHintsProductId(currentHints, productId);
      await updateVendorHints(client, coinSlug, vendorId, nextHints);
      const cleared = !nextHints || !parseHintsProductId(nextHints, () => {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          message: cleared
            ? `Cleared the feed product ID for ${vendorId}/${coinSlug}.`
            : `Pinned ${vendorId}/${coinSlug} to feed product ${parseHintsProductId(nextHints, () => {})}.`,
        })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    } finally {
      if (client)
        try {
          await client.close();
        } catch {
          /* ignore */
        }
    }
    return;
  }

  // ── POST /providers/bulk-toggle ─────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/bulk-toggle") {
    try {
      const { vendorId, metal, enabled } = JSON.parse(await readBody(req));
      if (!vendorId || !metal || enabled === undefined)
        throw new Error("vendorId, metal, and enabled required");
      const client = getSqldClient();
      const result = await batchToggleVendor(client, { vendorId, metal, enabled });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          rowsAffected: result.rowsAffected,
          message: `${enabled ? "Enabled" : "Disabled"} ${vendorId} on ${result.rowsAffected} ${metal} items.`,
        })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/bulk-delete ──────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/bulk-delete") {
    try {
      const { vendorId, metal } = JSON.parse(await readBody(req));
      if (!vendorId || !metal) throw new Error("vendorId and metal required");
      const client = getSqldClient();
      const result = await batchDeleteVendor(client, { vendorId, metal });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          rowsAffected: result.rowsAffected,
          message: `Removed ${vendorId} from ${result.rowsAffected} ${metal} items.`,
        })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── GET /providers/vendor-summary ────────────────────────────────────────
  if (req.method === "GET" && url === "/providers/vendor-summary") {
    try {
      const client = getSqldClient();
      const summary = await getVendorSummary(client);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(summary));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /providers/export ─────────────────────────────────────────────
  // Exports providers.json locally, then triggers Fly.io publish via Machines API
  if (req.method === "POST" && url === "/providers/export") {
    try {
      const client = getSqldClient();
      const json = await exportProvidersJson(client);
      writeFileSync(PROVIDERS_FILE, json, "utf8");
      const bytes = Buffer.byteLength(json, "utf8");
      const timestamp = new Date().toISOString();

      // Trigger Fly.io publish via Machines API
      let published = false;
      let publishMsg = "skipped (no Fly config)";
      const flyToken = process.env.FLY_API_TOKEN;
      const flyMachineId = process.env.FLY_MACHINE_ID;
      if (flyToken && flyMachineId) {
        try {
          const execRes = await fetch(
            `https://api.machines.dev/v1/apps/staktrakr/machines/${flyMachineId}/exec`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${flyToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                command: [
                  "/bin/bash",
                  "-c",
                  "git config --global user.name 'StakTrakr Poller' && " +
                    "git config --global user.email 'poller@staktrakr.local' && " +
                    "/app/run-publish.sh",
                ],
                timeout: 60,
              }),
            }
          );
          const result = await execRes.json();
          published = result.exit_code === 0;
          publishMsg = published
            ? "published"
            : `failed: ${(result.stderr || "unknown").slice(0, 200)}`;
        } catch (pubErr) {
          publishMsg = `error: ${pubErr.message}`;
        }
      }

      const msg = published
        ? `Exported ${fmtBytes(bytes)} → published to API at ${timestamp}`
        : `Exported ${fmtBytes(bytes)} at ${timestamp} (publish ${publishMsg})`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, published, message: msg }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: `Export failed: ${err.message}` }));
    }
    return;
  }

  // ── GET /api-health ────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api-health") {
    let failureCount = 0;
    let vendorMetalAvgs = {};
    try {
      const client = getSqldClient();
      const [fc, avgResult] = await Promise.all([
        getFailureCount(client),
        client.execute(`
          SELECT pv.vendor_id, pc.metal,
                 AVG(CASE WHEN ps.scraped_at >= datetime('now', '-1 day') THEN ps.price END) AS avg_24h,
                 AVG(CASE WHEN ps.scraped_at >= datetime('now', '-7 days') THEN ps.price END) AS avg_7d,
                 AVG(CASE WHEN ps.scraped_at >= datetime('now', '-30 days') THEN ps.price END) AS avg_30d
          FROM price_snapshots ps
          JOIN provider_coins pc ON pc.slug = ps.coin_slug
          JOIN provider_vendors pv ON pv.coin_slug = ps.coin_slug AND pv.vendor_id = ps.vendor
          WHERE ps.is_failed = 0 AND ps.price IS NOT NULL AND ps.price > 0
            AND ps.scraped_at >= datetime('now', '-30 days')
          GROUP BY pv.vendor_id, pc.metal
          ORDER BY pv.vendor_id, pc.metal
        `),
      ]);
      failureCount = fc;
      for (const row of avgResult.rows) {
        const key = `${row.vendor_id}:${row.metal}`;
        vendorMetalAvgs[key] = {
          avg24h: row.avg_24h != null ? parseFloat(Number(row.avg_24h).toFixed(2)) : null,
          avg7d: row.avg_7d != null ? parseFloat(Number(row.avg_7d).toFixed(2)) : null,
          avg30d: row.avg_30d != null ? parseFloat(Number(row.avg_30d).toFixed(2)) : null,
        };
      }
    } catch {
      /* ignore */
    }
    const v2 = await fetchV2Endpoints();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderApiHealthPage(v2, failureCount, vendorMetalAvgs));
    return;
  }

  // ── GET /failures ──────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/failures") {
    let lastScanFailures = [],
      chronicFailures = [],
      failureCount = 0,
      failureTrend = [];
    try {
      const client = getSqldClient();
      [lastScanFailures, chronicFailures, failureTrend] = await Promise.all([
        getLastScanFailures(client),
        getFailureStats(client),
        getFailureTrend(client),
      ]);
      failureCount = chronicFailures.length;
    } catch {
      /* empty */
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderFailuresPage(lastScanFailures, chronicFailures, failureCount, failureTrend));
    return;
  }

  // ── POST /api/diagnose — AI diagnosis of a failing vendor URL ───────────
  // Multi-step pipeline: Firecrawl → Playwright fallback → Gemini analysis
  if (req.method === "POST" && url === "/api/diagnose") {
    const body = JSON.parse(await readBody(req));
    const { coinSlug, vendorId, url: vendorUrl } = body;
    if (!vendorUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No URL provided" }));
      return;
    }

    try {
      const steps = [];

      // ── Step 1: Firecrawl scrape ──────────────────────────────────────
      let scrapeContent = "";
      let firecrawlOk = false;
      try {
        const fcResp = await fetch("http://localhost:3002/v1/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: vendorUrl, formats: ["markdown"] }),
          signal: AbortSignal.timeout(30000),
        });
        if (fcResp.ok) {
          const fcData = await fcResp.json();
          scrapeContent = (fcData.data?.markdown || "").slice(0, 12000);
          const loadingCount = (scrapeContent.match(/loading/gi) || []).length;
          const contentLen = scrapeContent.replace(/\s+/g, "").length;
          firecrawlOk = contentLen > 500 && loadingCount < 5;
          steps.push(
            "FIRECRAWL: " +
              (firecrawlOk ? "OK" : "THIN/JS-BLOCKED") +
              " (" +
              contentLen +
              " chars, " +
              loadingCount +
              " 'loading' refs)"
          );
        } else {
          steps.push("FIRECRAWL: HTTP " + fcResp.status);
        }
      } catch (fcErr) {
        steps.push("FIRECRAWL: FAILED — " + fcErr.message);
      }

      // ── Step 2: Playwright fallback (if firecrawl was thin) ───────────
      let playwrightContent = "";
      let playwrightOk = false;
      if (!firecrawlOk) {
        try {
          const { chromium } = await import("playwright");
          const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
          const page = await browser.newPage();
          await page.goto(vendorUrl, { waitUntil: "networkidle", timeout: 30000 });
          await page.waitForTimeout(3000); // extra wait for lazy-loaded prices

          // Get text content + price-specific DOM queries
          const textContent = await page.evaluate(() => document.body.innerText);
          const priceElements = await page.evaluate(() => {
            const selectors = [
              "[class*='price']",
              "[id*='price']",
              "[data-price]",
              "[itemprop='price']",
              ".product-price",
              ".price-current",
              ".our-price",
              ".sale-price",
              ".regular-price",
              "[class*='Price']",
              "[class*='cost']",
            ];
            const results = [];
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              for (const el of els) {
                const text = el.textContent.trim();
                if (text && text.length < 100) {
                  results.push({ selector: sel, text, tag: el.tagName, classes: el.className });
                }
              }
            }
            return results.slice(0, 20);
          });

          // Check for JSON-LD structured data
          const jsonLd = await page.evaluate(() => {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            const results = [];
            for (const s of scripts) {
              try {
                const data = JSON.parse(s.textContent);
                if (
                  data["@type"] === "Product" ||
                  data["@type"] === "Offer" ||
                  JSON.stringify(data).includes("price")
                ) {
                  results.push(data);
                }
              } catch {}
            }
            return results;
          });

          await browser.close();

          playwrightContent = [
            "=== PAGE TEXT (first 4000 chars) ===",
            (textContent || "").slice(0, 4000),
            "",
            "=== PRICE DOM ELEMENTS FOUND ===",
            JSON.stringify(priceElements, null, 2),
            "",
            "=== JSON-LD STRUCTURED DATA ===",
            jsonLd.length > 0 ? JSON.stringify(jsonLd, null, 2) : "(none found)",
          ].join("\n");

          playwrightOk = priceElements.length > 0 || jsonLd.length > 0;
          steps.push(
            "PLAYWRIGHT: " +
              (playwrightOk ? "FOUND price elements" : "rendered but no price elements") +
              " (" +
              priceElements.length +
              " price DOM nodes, " +
              jsonLd.length +
              " JSON-LD blocks)"
          );
        } catch (pwErr) {
          steps.push("PLAYWRIGHT: FAILED — " + pwErr.message);
        }
      } else {
        steps.push("PLAYWRIGHT: skipped (firecrawl content sufficient)");
      }

      // ── Step 3: Gemini analysis ───────────────────────────────────────
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "GEMINI_API_KEY not configured" }));
        return;
      }

      const bestContent = playwrightContent || scrapeContent || "(no content obtained)";
      const contentSource = playwrightContent ? "Playwright (JS-rendered)" : "Firecrawl (markdown)";

      const diagPrompt = [
        "You are diagnosing why a retail price scraper fails to extract a price from a vendor page.",
        "",
        "Coin: " + coinSlug,
        "Vendor: " + vendorId,
        "URL: " + vendorUrl,
        "Content source: " + contentSource,
        "",
        "Below is the page content. Your job:",
        "1. Find the retail/sale price for this specific product",
        "2. Identify the EXACT CSS selector to extract the price",
        "3. Check for anti-bot indicators",
        "4. Suggest a concrete fix with selector and hints",
        "",
        "If price DOM elements are listed, use those to identify the best selector.",
        "If JSON-LD data is present, note that as the preferred extraction method.",
        "",
        "RESPOND IN THIS EXACT FORMAT:",
        "PRICE_FOUND: yes|no",
        "PRICE_VALUE: $XX.XX (if found)",
        "EXTRACTION_METHOD: css_selector | xpath | json_ld | meta_tag | regex | vision",
        "SELECTOR: the exact CSS selector or extraction path (e.g. .product-price .price-current)",
        "HINTS: suggested JSON hints for the vision pipeline",
        "ANTI_BOT: none | cloudflare | captcha | js_required | other",
        "SUGGESTED_FIX: one-paragraph explanation of what to change in the scraper config",
        "CONFIDENCE: high | medium | low",
        "",
        "--- PAGE CONTENT (" + contentSource + ") ---",
        bestContent.slice(0, 10000),
      ].join("\n");

      const geminiResp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
          geminiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: diagPrompt }] }],
            generationConfig: { maxOutputTokens: 1500, temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Gemini API error: " + errText.slice(0, 200), steps }));
        return;
      }

      const geminiData = await geminiResp.json();
      const aiResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "(no response)";

      steps.push("GEMINI: analyzed " + bestContent.length + " chars from " + contentSource);

      // Log diagnosis to file for later review
      const logEntry = {
        ts: new Date().toISOString(),
        coinSlug,
        vendorId,
        url: vendorUrl,
        pipeline: steps,
        engine: "gemini-2.5-flash",
        scrapeLength: scrapeContent.length,
        playwrightLength: playwrightContent.length,
        result: aiResult,
      };
      try {
        const logFile = "/data/logs/diagnose.jsonl";
        const { appendFileSync } = await import("node:fs");
        appendFileSync(logFile, JSON.stringify(logEntry) + "\n");
      } catch {
        /* non-critical — don't fail the request */
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          result:
            "=== DIAGNOSIS PIPELINE ===\n" +
            steps.join("\n") +
            "\n\n=== AI ANALYSIS (Gemini 2.5 Flash) ===\n" +
            aiResult,
          engine: "gemini-2.5-flash",
          pipeline: steps,
          scrapeLength: scrapeContent.length,
          playwrightLength: playwrightContent.length,
        })
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /api/browserbase — Launch Browserbase session for URL ─────────
  if (req.method === "POST" && url === "/api/browserbase") {
    const body = JSON.parse(await readBody(req));
    const { url: vendorUrl, coinSlug, vendorId } = body;
    if (!vendorUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No URL provided" }));
      return;
    }

    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJ_ID;
    if (!apiKey || !projectId) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "BROWSERBASE_API_KEY or BROWSERBASE_PROJ_ID not configured" })
      );
      return;
    }

    try {
      // Create a Browserbase session
      const resp = await fetch("https://api.browserbase.com/v1/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bb-api-key": apiKey,
        },
        body: JSON.stringify({
          projectId,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        res.writeHead(resp.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Browserbase API: " + errText }));
        return;
      }

      const session = await resp.json();
      const liveUrl = `https://www.browserbase.com/sessions/${session.id}`;

      // Auto-navigate the session to the vendor URL via CDP
      try {
        const { chromium } = await import("playwright-core");
        const browser = await chromium.connectOverCDP(session.connectUrl);
        const defaultContext = browser.contexts()[0];
        const page = defaultContext?.pages()[0] || (await defaultContext?.newPage());
        if (page) {
          await page
            .goto(vendorUrl, { waitUntil: "domcontentloaded", timeout: 20000 })
            .catch(() => {});
        }
        // Don't close — leave the session open for the user to inspect
      } catch (navErr) {
        // Non-fatal — session still usable, just won't be pre-navigated
        console.error("[browserbase] auto-navigate failed:", navErr.message);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessionId: session.id,
          liveUrl,
          connectUrl: session.connectUrl,
          vendorUrl,
          coinSlug,
          vendorId,
          message: `Browserbase session created. Navigate to: ${vendorUrl}`,
        })
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /api/retry — Queue a single-coin re-scrape ────────────────────
  if (req.method === "POST" && url === "/api/retry") {
    try {
      const { coinSlug, vendorId } = JSON.parse(await readBody(req));
      if (!coinSlug || !vendorId) throw new Error("coinSlug and vendorId required");

      // Validate inputs — only allow alphanumeric, hyphens, underscores, dots
      const SAFE_ID = /^[a-zA-Z0-9._-]+$/;
      if (!SAFE_ID.test(coinSlug) || !SAFE_ID.test(vendorId)) {
        throw new Error(
          "Invalid coinSlug or vendorId — only alphanumeric, hyphens, underscores, dots allowed"
        );
      }

      // Check if poller is currently running
      const lockPath = "/tmp/retail-poller.lock";
      const isLocked = existsSync(lockPath);

      if (isLocked) {
        // Queue for after the current run (5 min after lock clears)
        const queueFile = "/tmp/retry-queue.json";
        let queue = [];
        try {
          queue = JSON.parse(readFileSync(queueFile, "utf8"));
        } catch {
          /* empty */
        }
        const exists = queue.some((q) => q.coinSlug === coinSlug && q.vendorId === vendorId);
        if (!exists) {
          queue.push({ coinSlug, vendorId, queuedAt: new Date().toISOString() });
          writeFileSync(queueFile, JSON.stringify(queue, null, 2));
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            queued: true,
            message: `Queued ${vendorId}/${coinSlug} for retry after current run completes.`,
          })
        );
      } else {
        // Trigger immediate single-item scrape via child process
        // Pass user input via env vars — never interpolate into shell strings
        const script = `
          import('./price-extract.js').then(async m => {
            const { createClient } = await import('@libsql/client');
            const useSqld = Boolean(process.env.SQLD_URL);
            const url = useSqld ? process.env.SQLD_URL : process.env.TURSO_DATABASE_URL;
            const authToken = useSqld ? process.env.SQLD_AUTH_TOKEN : process.env.TURSO_AUTH_TOKEN;
            if (!url) { console.error('SQLD_URL (or legacy TURSO_DATABASE_URL) must be set'); process.exit(1); }
            let client;
            try {
              client = createClient({ url, ...(authToken ? { authToken } : {}) });
            } catch (err) {
              console.error('retry-script createClient failed:', err?.message || err);
              process.exit(1);
            }
            const { getAllCoins, getProvidersByCoin } = await import('./provider-db.js');
            const slug = process.env.RETRY_COIN_SLUG;
            const vid = process.env.RETRY_VENDOR_ID;
            const [coins, vendors] = await Promise.all([
              getAllCoins(client),
              getProvidersByCoin(client, slug),
            ]);
            const coin = coins.find(c => c.slug === slug);
            const vendor = vendors.find(v => v.id === vid);
            if (!coin) { console.log('Coin not found'); process.exit(1); }
            if (!vendor || !vendor.url) { console.log('Vendor not found or no URL'); process.exit(1); }
            console.log('Retrying: ' + slug + '/' + vid + ' at ' + vendor.url);
            const result = await m.extractPrice(vendor.url, slug, vid, vendor, { coin });
            console.log('Result:', JSON.stringify(result));
            await client.close();
          }).catch(e => { console.error(e); process.exit(1); });
        `;
        const child = spawn("node", ["-e", script], {
          cwd: "/app",
          detached: true,
          stdio: "ignore",
          env: { ...process.env, RETRY_COIN_SLUG: coinSlug, RETRY_VENDOR_ID: vendorId },
        });
        child.unref();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            queued: false,
            message: `Triggered immediate retry for ${vendorId}/${coinSlug}.`,
          })
        );
      }
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /api/clear-chronic — Clear chronic failure record ─────────────
  if (req.method === "POST" && url === "/api/clear-chronic") {
    try {
      const { coinSlug, vendorId } = JSON.parse(await readBody(req));
      if (!coinSlug || !vendorId) throw new Error("coinSlug and vendorId required");
      const client = getSqldClient();
      const result = await clearChronicFailure(client, coinSlug, vendorId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          rowsAffected: result.rowsAffected,
          message: `Cleared ${result.rowsAffected} failure records for ${vendorId}/${coinSlug}.`,
        })
      );
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /api/clear-chronic-all — Clear ALL chronic failures ───────────
  if (req.method === "POST" && url === "/api/clear-chronic-all") {
    try {
      const client = getSqldClient();
      const result = await clearAllChronicFailures(client);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          rowsAffected: result.rowsAffected,
          message: `Cleared ${result.rowsAffected} failure records.`,
        })
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /api/clear-lock — Remove a stale poller lock file ─────────────
  if (req.method === "POST" && url === "/api/clear-lock") {
    try {
      const { path: lockPath } = JSON.parse(await readBody(req));
      const allowed = LOCK_FILES.map((l) => l.path);
      if (!lockPath || !allowed.includes(lockPath)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Invalid lock path" }));
        return;
      }
      if (!existsSync(lockPath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ ok: true, message: "Lock file does not exist (already cleared)" })
        );
        return;
      }
      const { unlinkSync } = await import("node:fs");
      unlinkSync(lockPath);
      console.log(`[dashboard] Lock cleared: ${lockPath}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Cleared ${lockPath}` }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── GET / (main dashboard) ─────────────────────────────────────────────
  if (req.method !== "GET" || (url !== "/" && url !== "/dashboard" && url !== "")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const client = getSqldClient();
  const [
    tursoResult,
    runStats,
    failureCount,
    chronicFailures,
    net,
    cpu,
    uptime,
    supervisord,
    logLines,
    flyioHealth,
    coverageStats,
    spotCoverage,
    dockerContainers,
    lockStatus,
  ] = await Promise.all([
    fetchRunsFromTurso()
      .then((rows) => ({ rows, error: null }))
      .catch((err) => ({ rows: null, error: err.message })),
    client ? getRunStats(client, ["home", "home-retail"]).catch(() => null) : Promise.resolve(null),
    client ? getFailureCount(client) : Promise.resolve(0),
    client ? getFailureStats(client).catch(() => []) : Promise.resolve([]),
    Promise.resolve(getNetStats()),
    Promise.resolve(getCpuMem()),
    Promise.resolve(getUptime()),
    Promise.resolve(getSupervisordStatus()),
    Promise.resolve(readLog()),
    Promise.resolve(getFlyioHealth()),
    client ? getCoverageStats(client, 48).catch(() => null) : Promise.resolve(null),
    client ? getSpotCoverage(client, 48).catch(() => null) : Promise.resolve(null),
    Promise.resolve(getDockerContainers()),
    Promise.resolve(getLockStatus()),
  ]);

  const html = renderMainPage({
    net,
    cpu,
    uptime,
    supervisord,
    logLines,
    flyioHealth,
    tursoRuns: tursoResult.rows,
    tursoUp: !tursoResult.error,
    runStats,
    failureCount,
    chronicFailures,
    coverageStats,
    spotCoverage,
    dockerContainers,
    lockStatus,
  });

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[dashboard] request error:", err);
    res.writeHead(500);
    res.end("Internal error");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[dashboard] Listening on http://0.0.0.0:${PORT}`);
});

// ── HTTPS server (self-signed cert for iframe embedding) ──
const HTTPS_PORT = Number(process.env.DASHBOARD_HTTPS_PORT || 3011);
try {
  const httpsOpts = {
    key: readFileSync("/app/tls-key.pem"),
    cert: readFileSync("/app/tls-cert.pem"),
  };
  const httpsServer = createHttpsServer(httpsOpts, (req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[dashboard] HTTPS request error:", err);
      res.writeHead(500);
      res.end("Internal error");
    });
  });
  httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
    console.log(`[dashboard] HTTPS listening on https://0.0.0.0:${HTTPS_PORT}`);
  });
} catch (e) {
  console.warn("[dashboard] HTTPS disabled — cert not found:", e.message);
}
