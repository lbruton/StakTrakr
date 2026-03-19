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
import { createClient } from "@libsql/client";
import {
  initProviderSchema, getProviders, getAllCoins, upsertCoin, upsertVendor,
  updateVendorUrl, toggleVendor, deleteCoin, deleteVendor, updateVendorFields,
  getVendorScrapeStatus, getFailureStats, getFailureTrend, getRunStats, getCoverageStats, getSpotCoverage, getMissingItems, exportProvidersJson,
  batchToggleVendor, batchDeleteVendor, getVendorSummary,
  loadProviders,
} from "./provider-db.js";

const PORT = parseInt(process.env.DASHBOARD_PORT || "3010", 10);
const LOG_FILE = process.env.POLLER_LOG || "/data/logs/retail-poller.log";
const LOG_LINES = 300;
const IFACE = process.env.NET_IFACE || "eth0";
const PROVIDERS_FILE = new URL("data/retail/providers.json", import.meta.url).pathname;
const DATA_DIR = new URL("data/", import.meta.url).pathname;

// Load .env if not already in environment
(function loadEnv() {
  const envFile = new URL(".env", import.meta.url).pathname;
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^[\x27\x22]|[\x27\x22]$/g, "");
  }
})();

// ---------------------------------------------------------------------------
// Turso client
// ---------------------------------------------------------------------------

function getTursoClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) return null;
  return createClient({ url, ...(authToken ? { authToken } : {}) });
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
  const client = getTursoClient();
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
    try { await client.close(); } catch { /* ignore */ }
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

const LOCK_FILES = [
  { name: "Retail Poller", path: "/tmp/retail-poller.lock" },
];

function getLockStatus() {
  return LOCK_FILES.map(({ name, path }) => {
    if (!existsSync(path)) return { name, path, locked: false, age: null };
    try {
      const stat = execSync(`stat -c %Y "${path}" 2>/dev/null || stat -f %m "${path}"`, { timeout: 2000 }).toString().trim();
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
    return out.trim().split("\n").map((line) => {
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
    ).toString().trim();
    const all = JSON.parse(raw);
    return all
      .filter(c => (c.Names?.[0] || "").match(/staktrakr|firecrawl|tailscale|tinyproxy/i))
      .map(c => ({
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
    'home':      '#34d399', // green — home retail
    'home-spot': '#818cf8', // indigo — home spot
    'api':       '#fb923c', // orange — fly retail
    'fly-spot':  '#38bdf8', // sky blue — fly spot
    // Future names (STAK-367)
    'home-retail':   '#34d399',
    'home-goldback': '#a3e635',
    'fly-retail':    '#fb923c',
    'fly-goldback':  '#fbbf24',
  };
  return colorMap[pollerId] || '#94a3b8';
}

/** Map current poller_id to display label (bridges old→new naming) */
function pollerDisplayName(pollerId) {
  const nameMap = {
    'home': 'home-retail',
    'api':  'fly-retail',
  };
  return nameMap[pollerId] || pollerId;
}

function fmtDateTime(iso) {
  if (!iso) return "\u2014";
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", " UTC");
}

function fmtDuration(startedAt, finishedAt) {
  if (!finishedAt) return "running\u2026";
  const ms = new Date(finishedAt) - new Date(startedAt);
  if (ms < 0) return "?";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
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
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(s) {
  return escHtml(s);
}

const METAL_COLORS = { silver: "#94a3b8", gold: "#fbbf24", goldback: "#a3e635", platinum: "#e2e8f0" };

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
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; }
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
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 6px 8px; color: var(--muted); font-weight: 600; border-bottom: 2px solid var(--border); font-size: 11px; text-transform: uppercase; }
  td { padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
`;

// ---------------------------------------------------------------------------
// Nav bar
// ---------------------------------------------------------------------------

function renderNav(activePage, failureCount) {
  const badge = failureCount > 0 ? ` <span class="badge" style="background:var(--red)">${failureCount}</span>` : "";
  const links = [
    { href: "/", label: "Dashboard", id: "home" },
    { href: "/providers", label: "Provider Editor", id: "providers" },
    { href: "/failures", label: `Failure Queue${badge}`, id: "failures" },
  ];
  const navLinks = links.map(l =>
    `<a href="${l.href}" style="color:${l.id === activePage ? 'var(--text)' : 'var(--accent)'};font-size:13px;font-weight:${l.id === activePage ? '700' : '400'}">${l.label}</a>`
  ).join("");
  return `<header style="background:var(--surface);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;justify-content:space-between;align-items:center;">
    <h1 style="font-size:18px;font-weight:600;color:var(--accent);">StakTrakr Poller Dashboard</h1>
    <nav style="display:flex;gap:16px;align-items:center;">${navLinks}</nav>
    <span style="color:var(--muted);font-size:12px;">${new Date().toUTCString()}</span>
  </header>`;
}

// ---------------------------------------------------------------------------
// Main dashboard page (GET /)
// ---------------------------------------------------------------------------

function renderRunsTable(runs) {
  if (!runs || runs.length === 0) {
    return '<p class="no-data">No runs recorded yet \u2014 will appear after next hourly scrape.</p>';
  }

  const rows = runs.map((r) => {
    const total = r.total ?? 0;
    const captured = r.captured ?? 0;
    const failures = r.failures ?? 0;
    const fbp = r.fbp_filled ?? 0;
    const rate = total > 0 ? Math.round((captured / total) * 100) : 0;
    const captureRate = (captured + failures) > 0 ? captured / (captured + failures) : 1;
    const barColor = rate >= 80 ? "#22c55e" : rate >= 50 ? "#f59e0b" : "#ef4444";
    const warningClass = captureRate < 0.5 && r.status === "ok" ? ' class="warning-row"' : "";

    const tooltip = `Captured: ${captured} / Total: ${total} / Failures: ${failures} / FBP: ${fbp}`;
    const progressCell = total > 0
      ? `<div class="mini-bar" title="${escAttr(tooltip)}"><div style="width:${rate}%;background:${barColor}"></div></div>
         <small>${captured}/${total}${fbp > 0 ? ` +${fbp} fbp` : ""}</small>`
      : `<small style="color:var(--muted)">\u2014</small>`;

    const errorCell = r.error
      ? `<span class="err-text" title="${escAttr(r.error)}">${escHtml(r.error.length > 60 ? r.error.slice(0, 57) + "..." : r.error)}</span>`
      : "";

    return `<tr${warningClass}>
      <td><span class="badge" style="background:${pollerBadgeColor(r.poller_id)}">${escHtml(pollerDisplayName(r.poller_id))}</span></td>
      <td>${escHtml(fmtDateTime(r.started_at))}</td>
      <td>${escHtml(fmtDuration(r.started_at, r.finished_at))}</td>
      <td><span class="badge" style="background:${statusColor(r.status)}">${escHtml(r.status)}</span></td>
      <td>${progressCell}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${errorCell}</td>
    </tr>`;
  }).join("");

  return `<table>
    <thead>
      <tr>
        <th>Poller</th><th>Started (UTC)</th><th>Duration</th><th>Status</th><th>Prices</th><th>Error</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderStatsCards(stats) {
  if (!stats) return "";
  const cards = [
    { label: "Runs (24h)", value: stats.totalRuns },
    { label: "Success Rate", value: `${stats.successRate}%` },
    { label: "Avg Capture Rate", value: `${stats.avgCaptureRate}%` },
    { label: "Avg Duration", value: stats.avgDurationSec > 60 ? `${Math.floor(stats.avgDurationSec / 60)}m ${stats.avgDurationSec % 60}s` : `${stats.avgDurationSec}s` },
  ];
  return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
    ${cards.map(c => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
      <div style="color:var(--muted);font-size:11px;text-transform:uppercase;margin-bottom:4px;">${c.label}</div>
      <div style="color:var(--accent);font-size:24px;font-weight:700;">${c.value}</div>
    </div>`).join("")}
  </div>`;
}

function renderFlyioCard(h, flyRuns, tursoUp, tursoBackup) {
  // HTTP health (from check-flyio.sh JSON file)
  let httpLine = "";
  if (h) {
    const age = h.checked_at
      ? Math.round((Date.now() - new Date(h.checked_at)) / 1000)
      : null;
    const ageStr = age != null ? (age < 60 ? `${age}s ago` : `${Math.round(age/60)}m ago`) : "?";
    const httpColor = h.http_ok ? "#22c55e" : "#ef4444";
    httpLine = `
      <div class="stat-row"><span>API endpoint</span>
        <span class="stat-val" style="color:${httpColor}">${h.http_ok ? `OK (${h.http_code})` : `FAIL (${h.http_code || "no resp"})`}</span></div>
      <div class="stat-row"><span>Last checked</span>
        <span class="stat-val">${ageStr}</span></div>`;
  } else {
    httpLine = `<div class="stat-row"><span>API endpoint</span>
      <span class="stat-val" style="color:#a1a1aa">Awaiting first check</span></div>`;
  }

  // Database connectivity — local sqld (primary) + Turso Cloud (DR backup)
  const sqldColor = tursoUp ? "#22c55e" : "#ef4444";
  const sqldLabel = tursoUp ? "OK" : "OFFLINE";
  const backupColor = tursoBackup?.up ? "#22c55e" : (tursoBackup?.error === "TURSO_BACKUP_URL not set" ? "#a1a1aa" : "#ef4444");
  const backupLabel = tursoBackup?.up ? "OK" : (tursoBackup?.error === "TURSO_BACKUP_URL not set" ? "NOT SET" : "OFFLINE");

  // Fly.io last-hour summary
  let runsHtml = "";
  if (flyRuns && flyRuns.length > 0) {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const recent = flyRuns.filter(r => r.started_at > oneHourAgo);
    const retailRuns = recent.filter(r => r.poller_id?.includes("retail"));
    const spotRuns = recent.filter(r => r.poller_id?.includes("spot"));
    const lastRetail = retailRuns[0];
    const retailStatus = lastRetail
      ? `${lastRetail.captured ?? 0}/${lastRetail.total ?? 0} prices`
      : "no run";
    const retailColor = lastRetail?.status === "done" ? "#22c55e" : (lastRetail ? "#3b82f6" : "#a1a1aa");
    const spotCount = spotRuns.filter(r => r.status === "done").length;
    const spotTotal = 2; // expected 2 spot runs/hour from fly
    const spotColor = spotCount >= spotTotal ? "#22c55e" : (spotCount > 0 ? "#eab308" : "#ef4444");

    runsHtml = `
      <div style="margin-top:8px">
        <div class="stat-row"><span>Retail (last hour)</span>
          <span class="stat-val" style="color:${retailColor}">${retailStatus}</span></div>
        <div class="stat-row"><span>Spot (last hour)</span>
          <span class="stat-val" style="color:${spotColor}">${spotCount}/${spotTotal} runs</span></div>
      </div>`;
  } else {
    runsHtml = `<p class="no-data" style="margin-top:8px">No Fly.io runs in Turso yet.</p>`;
  }

  return `<div class="card">
    <h2>Fly.io Container</h2>
    <div class="stat-row"><span>Local DB (sqld)</span>
      <span class="stat-val" style="color:${sqldColor}">${sqldLabel}</span></div>
    <div class="stat-row"><span>Turso DR Backup</span>
      <span class="stat-val" style="color:${backupColor}">${backupLabel}</span></div>
    ${httpLine}
    ${runsHtml}
  </div>`;
}


function renderMissingItems(items) {
  if (!items || items.length === 0) {
    return '<p style="color:var(--green);font-size:13px;padding:8px 0;">\u2714 All enabled items have successful prices this hour.</p>';
  }

  const rows = items.map((item) => {
    const urlShort = item.url ? (item.url.length > 60 ? item.url.slice(0, 57) + "..." : item.url) : "no URL";
    const metalColor = ({ silver: "#94a3b8", gold: "#fbbf24", goldback: "#a3e635", platinum: "#e2e8f0" })[item.metal] || "#94a3b8";

    return `<tr>
      <td><span class="badge" style="background:${metalColor};color:#0f172a">${escHtml(item.metal)}</span></td>
      <td><strong>${escHtml(item.coinName)}</strong><br><code style="color:var(--muted);font-size:11px;">${escHtml(item.coinSlug)}:${escHtml(item.vendor)}</code></td>
      <td><a href="${escAttr(item.url || "#")}" target="_blank" title="${escAttr(item.url || "")}" style="font-size:12px;">${escHtml(urlShort)}</a></td>
      <td style="white-space:nowrap;">
        <button class="btn-diagnose" data-coin="${escAttr(item.coinSlug)}" data-vendor="${escAttr(item.vendor)}" data-url="${escAttr(item.url || "")}"
          style="background:#1e3a5f;color:var(--accent);font-size:11px;padding:4px 10px;margin-right:4px;"
          title="Run Claude Code diagnosis on the home poller VM">\uD83E\uDD16 Diagnose</button>
        <button class="btn-browserbase" data-coin="${escAttr(item.coinSlug)}" data-vendor="${escAttr(item.vendor)}" data-url="${escAttr(item.url || "")}"
          style="background:#312e81;color:#a5b4fc;font-size:11px;padding:4px 10px;"
          title="Open in Browserbase for visual inspection">\uD83C\uDF10 Browserbase</button>
      </td>
    </tr>`;
  }).join("");

  return `<table>
    <thead><tr><th>Metal</th><th>Item</th><th>URL</th><th style="width:200px;">Actions</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderCoverageCards(cov, spotCov) {
  if (!cov || !cov.hours || cov.hours.length === 0) return '';

  // ── Style values (from playground Compact preset + user tweaks) ─────
  const P = 8, G = 24, R = 6, VS = 33, LS = 10, TS = 11, BH = 80, CP = 8, SG = 12;

  function covCard(label, value, sub, color) {
    return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' + R + 'px;padding:' + P + 'px;text-align:center;">'
      + '<div style="color:var(--muted);font-size:' + LS + 'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">' + label + '</div>'
      + '<div style="color:' + color + ';font-size:' + VS + 'px;font-weight:700;font-family:\'Cascadia Code\',\'Fira Code\',monospace;">' + value + (sub ? '<span style="font-size:' + Math.round(VS * 0.58) + 'px;color:var(--muted)">' + sub + '</span>' : '') + '</div>'
      + '</div>';
  }

  // ── Retail section ──────────────────────────────────────────────────
  const latest = cov.hours[0];
  const last24 = cov.hours.slice(0, 24);
  const avg = last24.length > 0
    ? Math.min(100, Math.round(last24.reduce((s, h) => s + h.pct, 0) / last24.length))
    : 0;
  const covColor = latest.pct >= 90 ? 'var(--green)' : latest.pct >= 70 ? 'var(--amber)' : 'var(--red)';
  const avgColor = avg >= 90 ? 'var(--green)' : avg >= 70 ? 'var(--amber)' : 'var(--red)';
  const missingCount = Math.max(0, cov.totalEnabled - latest.covered);

  const retailStatCards = ''
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:' + G + 'px;margin-bottom:' + G + 'px;">'
    + covCard('Coverage (latest hour)', latest.pct + '%', '', covColor)
    + covCard('Avg Coverage (24h)', avg + '%', '', avgColor)
    + covCard('Items Covered', Math.min(latest.covered, cov.totalEnabled), '/' + cov.totalEnabled, 'var(--accent)')
    + covCard('Missing Items', missingCount, '', missingCount > 0 ? 'var(--red)' : 'var(--green)')
    + '</div>';

  // Use all available hours (up to 48h)
  const allHours = cov.hours.slice(0, 48).reverse();
  const retailBars = allHours.map((h, i) => {
    // Use per-hour effectiveTotal (how many vendors existed at that hour)
    // so adding new items doesn't retroactively penalize historical bars.
    const denom = h.effectiveTotal || cov.totalEnabled;
    const adjPct = denom > 0 ? Math.min(100, Math.round((h.covered / denom) * 100)) : 0;
    const barH = Math.max(2, Math.round(adjPct * 0.5));
    const c = adjPct >= 90 ? '#22c55e' : adjPct >= 70 ? '#f59e0b' : '#ef4444';
    const hLabel = h.hour.slice(11, 16);
    return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;" title="' + hLabel + ': ' + h.covered + '/' + denom + ' (' + adjPct + '%)">'
      + '<div style="height:' + barH + 'px;background:' + c + ';border-radius:2px;"></div>'
      + '<div style="text-align:center;overflow:hidden;height:28px;display:flex;align-items:flex-start;justify-content:center;"><span style="font-size:7px;color:var(--muted);white-space:nowrap;writing-mode:vertical-lr;transform:rotate(180deg);">' + hLabel + '</span></div>'
      + '</div>';
  }).join('');

  const retailBarCard = ''
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' + R + 'px;padding:' + CP + 'px ' + CP + 'px ' + Math.round(CP * 0.5) + 'px;">'
    + '<div style="color:var(--muted);font-size:' + LS + 'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">Retail Coverage Trend (' + allHours.length + 'h)</div>'
    + '<div style="display:flex;gap:1px;align-items:flex-end;height:' + BH + 'px;">' + retailBars + '</div>'
    + '</div>';

  // ── Spot section ────────────────────────────────────────────────────
  let spotSection = '';

  if (spotCov) {
    const spotPct = spotCov.totalIntervals > 0
      ? Math.round((spotCov.coveredIntervals / spotCov.totalIntervals) * 100) : 0;
    const spotColor = spotPct >= 90 ? 'var(--green)' : spotPct >= 70 ? 'var(--amber)' : 'var(--red)';

    // Build poller breakdown data for 4th card
    const pollerEntries = Object.entries(spotCov.byPoller || {});
    const pollerColors = { 'home-spot': '#818cf8', 'fly-spot': '#38bdf8', 'backfill': '#f59e0b' };
    const pollers = pollerEntries.map(([id, cnt]) => {
      const pPct = spotCov.totalIntervals > 0 ? Math.round(cnt / spotCov.totalIntervals * 100) : 0;
      return { name: id, count: cnt, pct: pPct, color: pollerColors[id] || '#94a3b8' };
    });
    const maxPct = Math.max(...pollers.map(p => p.pct), 1);

    // Combined sources %
    const combinedPct = pollers.reduce((s, p) => s + p.pct, 0);
    const combinedColor = combinedPct >= 90 ? 'var(--green)' : combinedPct >= 70 ? 'var(--amber)' : 'var(--red)';

    // Card 4: Source Breakdown with mini horizontal bars
    const breakdownCard = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' + R + 'px;padding:' + P + 'px;text-align:center;">'
      + '<div style="color:var(--muted);font-size:' + LS + 'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;">Source Breakdown</div>'
      + '<div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;">'
      + pollers.map(p => '<div style="display:flex;align-items:center;gap:6px;">'
        + '<div style="width:8px;height:8px;border-radius:50%;background:' + p.color + ';flex-shrink:0;"></div>'
        + '<span style="font-size:10px;color:var(--muted);min-width:64px;text-align:left;">' + p.name + '</span>'
        + '<div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden;">'
        + '<div style="height:100%;width:' + (maxPct > 0 ? Math.round(p.pct / maxPct * 100) : 0) + '%;background:' + p.color + ';border-radius:3px;"></div>'
        + '</div>'
        + '<span style="font-size:10px;min-width:28px;text-align:right;font-family:monospace;color:' + p.color + ';">' + p.pct + '%</span>'
        + '</div>').join('')
      + '</div>'
      + '</div>';

    const spotStatCards = ''
      + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:' + G + 'px;margin-bottom:' + G + 'px;">'
      + covCard('Spot Coverage (' + spotCov.hours + 'h)', spotPct + '%', '', spotColor)
      + covCard('Intervals Hit', spotCov.coveredIntervals, '/' + spotCov.totalIntervals, 'var(--accent)')
      + covCard('Combined Sources', combinedPct + '%', '', combinedColor)
      + breakdownCard
      + '</div>';

    // Spot bars — generate placeholders for ALL expected 15-min slots
    const spotIntervals = spotCov.intervals || [];
    const spotMap = new Map(spotIntervals.map(q => [q.quarter, q]));

    const allQuarters = [];
    const now = new Date();
    const hoursBack = spotCov.hours || 6;
    const start = new Date(now.getTime() - hoursBack * 3600000);
    start.setMinutes(Math.floor(start.getMinutes() / 15) * 15, 0, 0);
    for (let t = new Date(start); t <= now; t = new Date(t.getTime() + 15 * 60000)) {
      const iso = t.toISOString();
      const q = iso.slice(0, 13) + ':' + String(Math.floor(t.getUTCMinutes() / 15) * 15).padStart(2, '0');
      allQuarters.push(q);
    }

    const spotBars = allQuarters.map((q, i) => {
      const data = spotMap.get(q);
      const label = q.slice(11);
      if (!data) {
        return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;" title="' + label + ': no data">'
          + '<div style="height:2px;background:#334155;border-radius:2px;"></div>'
          + '<div style="text-align:center;overflow:hidden;height:28px;display:flex;align-items:flex-start;justify-content:center;"><span style="font-size:7px;color:#475569;white-space:nowrap;writing-mode:vertical-lr;transform:rotate(180deg);">' + label + '</span></div>'
          + '</div>';
      }
      const full = data.metals >= 4;
      const c = full ? '#22c55e' : data.metals >= 2 ? '#f59e0b' : '#ef4444';
      const barH = full ? 28 : Math.max(6, data.metals * 7);
      const srcLabel = data.sources > 1 ? data.sources + ' sources' : '1 source';
      return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;" title="' + label + ': ' + data.metals + '/4 metals, ' + srcLabel + '">'
        + '<div style="height:' + barH + 'px;background:' + c + ';border-radius:2px;"></div>'
        + '<div style="text-align:center;overflow:hidden;height:28px;display:flex;align-items:flex-start;justify-content:center;"><span style="font-size:7px;color:var(--muted);white-space:nowrap;writing-mode:vertical-lr;transform:rotate(180deg);">' + label + '</span></div>'
        + '</div>';
    }).join('');

    const spotBarCard = ''
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:' + R + 'px;padding:' + CP + 'px ' + CP + 'px ' + Math.round(CP * 0.5) + 'px;">'
      + '<div style="color:var(--muted);font-size:' + LS + 'px;text-transform:uppercase;letter-spacing:.03em;margin-bottom:8px;">Spot Price Trend (15-min intervals, ' + hoursBack + 'h)</div>'
      + '<div style="display:flex;gap:1px;align-items:flex-end;height:' + BH + 'px;">' + spotBars + '</div>'
      + '</div>';

    spotSection = ''
      + '<div style="margin-bottom:' + SG + 'px;">'
      + '<h3 style="font-size:' + TS + 'px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px;">Spot Price Coverage</h3>'
      + spotStatCards
      + spotBarCard
      + '</div>';
  }

  // ── Assemble ────────────────────────────────────────────────────────
  return '<div style="margin-bottom:' + SG + 'px;">'
    + '<h3 style="font-size:' + TS + 'px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 8px;">Retail Price Coverage</h3>'
    + retailStatCards
    + retailBarCard
    + '</div>'
    + spotSection;
}

function renderFailureTrendChart(trend) {
  if (!trend || trend.length === 0) {
    return '<p style="color:var(--muted);font-size:13px;padding:8px 0;">No failure data available.</p>';
  }

  const maxF = Math.max(...trend.map(d => d.failures), 1);
  const chartW = 500, chartH = 140, barGap = 8;
  const barW = Math.min(50, (chartW - barGap * (trend.length + 1)) / trend.length);
  const startX = (chartW - (barW + barGap) * trend.length + barGap) / 2;

  let bars = '';
  trend.forEach((d, i) => {
    const barH = Math.max(2, (d.failures / maxF) * (chartH - 30));
    const x = startX + i * (barW + barGap);
    const y = chartH - 20 - barH;
    const color = d.failures >= 20 ? '#ef4444' : d.failures >= 10 ? '#f59e0b' : '#22c55e';
    const dayLabel = d.day.slice(5); // MM-DD
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="3"/>`;
    bars += `<text x="${x + barW/2}" y="${chartH - 6}" text-anchor="middle" fill="#94a3b8" font-size="10">${dayLabel}</text>`;
    bars += `<text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" fill="#e2e8f0" font-size="10">${d.failures}</text>`;
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
  const { net, cpu, uptime, supervisord, systemd, logLines, tursoRuns, tursoError, tursoUp, tursoBackup, flyioHealth, runStats, failureCount, coverageStats, spotCoverage, failureTrend, flyRuns, dockerContainers, lockStatus } = data;

  const supRows = supervisord.map((s) => `
    <tr>
      <td>${s.name}</td>
      <td><span class="badge" style="background:${stateColor(s.state)}">${s.state}</span></td>
      <td class="detail">${s.detail}</td>
    </tr>`).join("");

  const dockerRows = (dockerContainers || []).map((c) => {
    const stColor = c.state === "running" ? "#22c55e" : c.state === "exited" ? "#ef4444" : "#f59e0b";
    return `<tr>
      <td>${escHtml(c.name)}</td>
      <td><span class="badge" style="background:${stColor}">${c.state}</span></td>
      <td class="detail">${escHtml(c.status)}</td>
    </tr>`;
  }).join("");

  const logHtml = logLines.map((l) =>
    `<div class="${logLineClass(l)}">${escHtml(l)}</div>`
  ).join("");

  const netRx = net ? fmtBytes(net.rx_bytes) : "?";
  const netTx = net ? fmtBytes(net.tx_bytes) : "?";
  const tursoNote = tursoError
    ? `<span class="err-text">(Turso unreachable: ${escHtml(tursoError)})</span>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>StakTrakr Poller Dashboard</title>
<style>
  ${SHARED_CSS}
  header h1 { font-size: 18px; font-weight: 600; color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px,1fr)); gap: 16px; padding: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 12px; }
  .stat-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 1px solid var(--border); }
  .stat-row:last-child { border-bottom: none; }
  .stat-val { font-weight: 600; color: var(--accent); }
  .mini-bar { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-bottom: 3px; min-width: 80px; }
  .mini-bar div { height: 100%; }
  .mini-bar + small { color: var(--muted); font-size: 11px; }
  .detail { color: var(--muted); font-size: 11px; }
  .card-stale { border-color: #f59e0b; }
  .stale-tag { font-size: 10px; color: #f59e0b; font-weight: 400; margin-left: 6px; text-transform: none; letter-spacing: 0; }
  .wide-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin: 0 16px 16px; }
  .wide-card h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 12px; }
  .scroll-table { max-height: 500px; overflow-y: auto; }
  .scroll-table thead th { position: sticky; top: 0; background: var(--surface); z-index: 1; }
  .warning-row { background: rgba(245,158,11,0.15); }
  .log-panel { margin: 0 16px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .log-panel h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .log-body { padding: 10px 14px; font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; line-height: 1.6; max-height: 480px; overflow-y: auto; }
  .log-ok    { color: #86efac; }
  .log-warn  { color: #fde68a; }
  .log-error { color: #f87171; }
  .log-info  { color: var(--accent); }
  .log-fbp   { color: #c084fc; }
  .log-default { color: var(--muted); }
</style>
</head>
<body>
${renderNav("home", failureCount)}

<div class="wide-card">
  <h2>Combined Coverage — All Pollers (hourly union)</h2>
  ${renderCoverageCards(coverageStats, spotCoverage)}
</div>

<div class="wide-card">
  <h2>All Poller Runs \u2014 Turso (last 30) ${tursoNote}</h2>
  ${renderStatsCards(runStats)}
  <div class="scroll-table">
    ${renderRunsTable(tursoRuns?.filter(r => !r.poller_id?.includes('spot')))}
  </div>
</div>

<div class="log-panel">
  <h2>Home Poller Log \u2014 last ${LOG_LINES} lines (${LOG_FILE})</h2>
  <div class="log-body" id="log">${logHtml}</div>
</div>

<div class="grid">
  <div class="card">
    <h2>System (home poller VM)</h2>
    <div class="stat-row"><span>Uptime</span><span class="stat-val">${uptime}</span></div>
    <div class="stat-row"><span>Load avg (1/5/15m)</span><span class="stat-val">${cpu ? `${cpu.load1} / ${cpu.load5} / ${cpu.load15}` : "?"}</span></div>
    <div class="stat-row"><span>Memory used</span><span class="stat-val">${cpu ? cpu.memUsedPct + "%" : "?"}</span></div>
  </div>

  <div class="card">
    <h2>Network (${IFACE}) \u2014 cumulative since boot</h2>
    <div class="stat-row"><span>RX (received)</span><span class="stat-val">${netRx}</span></div>
    <div class="stat-row"><span>TX (sent)</span><span class="stat-val">${netTx}</span></div>
    <div class="stat-row"><span>RX packets</span><span class="stat-val">${net ? net.rx_packets.toLocaleString() : "?"}</span></div>
    <div class="stat-row"><span>TX packets</span><span class="stat-val">${net ? net.tx_packets.toLocaleString() : "?"}</span></div>
  </div>

  <div class="card">
    <h2>Services (supervisord)</h2>
    <table><tbody>${supRows}</tbody></table>
  </div>

  <div class="card">
    <h2>Docker Containers</h2>
    <table><tbody>${dockerRows || '<tr><td colspan="3" class="no-data">Docker socket not available</td></tr>'}</tbody></table>
  </div>

  <div class="card${(lockStatus || []).some(l => l.locked) ? ' card-stale' : ''}">
    <h2>Poller Locks</h2>
    ${(lockStatus || []).map(l => {
      const ageStr = l.age != null ? (l.age >= 3600 ? Math.floor(l.age / 3600) + 'h ' + Math.floor((l.age % 3600) / 60) + 'm' : l.age >= 60 ? Math.floor(l.age / 60) + 'm ' + (l.age % 60) + 's' : l.age + 's') : '?';
      const stale = l.age != null && l.age > 900;
      if (l.locked) {
        return `<div class="stat-row">
          <span>${escHtml(l.name)}</span>
          <span>
            <span class="badge" style="background:${stale ? '#ef4444' : '#f59e0b'}">${stale ? 'STALE' : 'LOCKED'}</span>
            <span class="detail" style="margin-left:6px">${ageStr} ago</span>
          </span>
        </div>
        <div style="margin-top:8px">
          <button class="btn-clear-lock" data-path="${escHtml(l.path)}" data-name="${escHtml(l.name)}"
            style="background:#7f1d1d;color:#fca5a5;padding:5px 12px;border-radius:6px;border:1px solid #991b1b;cursor:pointer;font-size:12px;font-weight:600;width:100%">
            Clear Lock
          </button>
        </div>`;
      }
      return `<div class="stat-row">
        <span>${escHtml(l.name)}</span>
        <span><span class="badge" style="background:#22c55e">OK</span></span>
      </div>`;
    }).join("")}
  </div>

  ${renderFlyioCard(flyioHealth, flyRuns, tursoUp, tursoBackup)}
</div>

<script>
  
// ── Diagnose button (Claude Code on VM) ─────────────────────────────────
document.querySelectorAll('.btn-diagnose').forEach(btn => {
  btn.addEventListener('click', async () => {
    const coin = btn.dataset.coin;
    const vendor = btn.dataset.vendor;
    const url = btn.dataset.url;
    if (!url) { alert('No URL configured for this vendor.'); return; }
    btn.disabled = true;
    btn.textContent = '\u23F3 Running...';
    btn.style.opacity = '0.6';
    try {
      const r = await fetch('/api/diagnose', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ coinSlug: coin, vendorId: vendor, url })
      });
      const j = await r.json();
      if (j.error) {
        alert('Diagnosis error: ' + j.error);
      } else {
        // Show result in a modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:300;display:flex;justify-content:center;align-items:center;padding:20px;';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:12px;max-width:850px;width:100%;max-height:85vh;display:flex;flex-direction:column;position:relative;';

        // Header with item context + close button
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #334155;flex-shrink:0;';
        header.innerHTML = '<div>'
          + '<div style="font-size:15px;font-weight:700;color:#e2e8f0;">Diagnosis: ' + coin + ':' + vendor + '</div>'
          + '<div style="font-size:12px;color:#94a3b8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px;">' + url + '</div>'
          + '<div style="font-size:11px;color:#64748b;margin-top:2px;">Engine: ' + (j.engine || '?') + ' \u00B7 Firecrawl: ' + (j.scrapeLength || 0) + ' chars \u00B7 Playwright: ' + (j.playwrightLength || 0) + ' chars</div>'
          + '</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u2715';
        closeBtn.style.cssText = 'background:#334155;color:#e2e8f0;width:32px;height:32px;border-radius:6px;border:none;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px;';
        closeBtn.onmouseover = () => { closeBtn.style.background = '#ef4444'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = '#334155'; };
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);

        // Body — scrollable content
        const body = document.createElement('div');
        body.style.cssText = 'padding:16px 20px;overflow-y:auto;flex:1;font-family:"Cascadia Code","Fira Code",monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#e2e8f0;';
        body.textContent = j.result || '(no output)';

        // Footer with copy button
        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;padding:12px 20px;border-top:1px solid #334155;flex-shrink:0;';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '\uD83D\uDCCB Copy Markdown';
        copyBtn.style.cssText = 'background:#166534;color:#86efac;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;';
        copyBtn.onclick = () => {
          var NL = String.fromCharCode(10);
          var BT = String.fromCharCode(96,96,96);
          var parts = ['## Diagnosis: ' + coin + ':' + vendor, '**URL:** ' + url, '**Engine:** ' + (j.engine || '?'), '**Date:** ' + new Date().toISOString(), '', BT, (j.result || ''), BT, ''];
          navigator.clipboard.writeText(parts.join(NL)).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy Markdown'; }, 2000);
          });
        };
        const copyRawBtn = document.createElement('button');
        copyRawBtn.textContent = '\uD83D\uDCC4 Copy Raw';
        copyRawBtn.style.cssText = 'background:#1e3a5f;color:var(--accent);padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;';
        copyRawBtn.onclick = function() {
          navigator.clipboard.writeText(j.result || '').then(function() {
            copyRawBtn.textContent = 'Copied!';
            setTimeout(function() { copyRawBtn.textContent = 'Copy Raw'; }, 2000);
          });
        };
        footer.appendChild(copyBtn);
        footer.appendChild(copyRawBtn);

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      }
    } catch (err) {
      alert('Request failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '\uD83E\uDD16 Diagnose';
      btn.style.opacity = '1';
    }
  });
});

// ── Browserbase button ──────────────────────────────────────────────────
document.querySelectorAll('.btn-browserbase').forEach(btn => {
  btn.addEventListener('click', async () => {
    const url = btn.dataset.url;
    if (!url) { alert('No URL configured for this vendor.'); return; }
    btn.disabled = true;
    btn.textContent = '\u23F3 Launching...';
    try {
      const r = await fetch('/api/browserbase', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ url, coinSlug: btn.dataset.coin, vendorId: btn.dataset.vendor })
      });
      const j = await r.json();
      if (j.error) {
        alert('Browserbase error: ' + j.error);
      } else if (j.liveUrl) {
        window.open(j.liveUrl, '_blank');
      } else {
        alert('Session created but no live URL returned.');
      }
    } catch (err) {
      alert('Request failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '\uD83C\uDF10 Browserbase';
    }
  });
});

// ── Clear lock button ────────────────────────────────────────────────────
document.querySelectorAll('.btn-clear-lock').forEach(btn => {
  btn.addEventListener('click', async () => {
    const lockPath = btn.dataset.path;
    const lockName = btn.dataset.name;
    if (!confirm('Clear the ' + lockName + ' lock file?\\n\\nThis will allow the next scheduled run to proceed.')) return;
    btn.disabled = true;
    btn.textContent = 'Clearing...';
    try {
      const r = await fetch('/api/clear-lock', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ path: lockPath })
      });
      const j = await r.json();
      if (j.ok) {
        btn.textContent = 'Cleared!';
        btn.style.background = '#14532d';
        btn.style.color = '#86efac';
        btn.style.borderColor = '#166534';
        setTimeout(() => location.reload(), 1500);
      } else {
        alert('Failed: ' + (j.message || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Clear Lock';
      }
    } catch (err) {
      alert('Request failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Clear Lock';
    }
  });
});

const log = document.getElementById('log');
  if (log) log.scrollTop = log.scrollHeight;
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Provider editor page (GET /providers)
// ---------------------------------------------------------------------------

function renderProvidersPage(providers, scrapeStatus, failureCount, readOnly) {
  const coins = providers.coins || {};
  const coinEntries = Object.entries(coins);
  const totalCoins = coinEntries.length;

  // Build vendorsByMetal map for bulk operations
  const vendorsByMetal = {};
  for (const [slug, coin] of coinEntries) {
    const metal = coin.metal || 'silver';
    if (!vendorsByMetal[metal]) vendorsByMetal[metal] = new Set();
    for (const p of (coin.providers || [])) {
      vendorsByMetal[metal].add(p.id);
    }
  }
  // Convert sets to sorted arrays
  for (const m of Object.keys(vendorsByMetal)) {
    vendorsByMetal[m] = [...vendorsByMetal[m]].sort();
  }

  const coinSections = coinEntries.map(([slug, coin]) => {
    const vendorCount = (coin.providers || []).length;
    const metal = coin.metal || "silver";

    const vendorRows = (coin.providers || []).map((p, i) => {
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
    }).join("");

    return `<div class="coin-section" data-slug="${escAttr(slug)}" data-name="${escAttr(coin.name.toLowerCase())}" data-metal="${escAttr(metal)}">
      <div class="coin-header" data-slug="${escAttr(slug)}">
        <span class="coin-toggle">\u25B6</span>
        <strong>${escHtml(coin.name)}</strong>
        <code style="color:var(--muted);margin:0 8px;">${escHtml(slug)}</code>
        ${metalBadge(metal)}
        <span style="color:var(--muted);font-size:12px;margin-left:8px;">${metal === "goldback" ? (coin.weight_oz || 1) + "/1000 oz gold" : (coin.weight_oz || 1) + " oz"} \u00B7 ${vendorCount} vendor${vendorCount !== 1 ? "s" : ""}</span>
        ${readOnly ? "" : `<span style="margin-left:auto;display:flex;gap:4px;">
          <button class="btn-edit-coin" data-slug="${escAttr(slug)}" style="background:#1e3a5f;color:var(--accent);font-size:11px;">Edit</button>
          <button class="btn-del-coin" data-slug="${escAttr(slug)}" data-name="${escAttr(coin.name)}" data-vendors="${vendorCount}" style="background:#7f1d1d;color:#fca5a5;font-size:11px;">Delete</button>
        </span>`}
      </div>
      <div class="coin-body" style="display:none;">
        <table>
          <thead><tr><th style="width:30px"></th><th style="width:30px">On</th><th>Vendor</th><th>URL</th><th style="width:80px"></th></tr></thead>
          <tbody>${vendorRows}</tbody>
        </table>
        ${readOnly ? "" : `<button class="btn-add-vendor" data-coin="${escAttr(slug)}" data-coinname="${escAttr(coin.name)}" style="margin:8px 0;background:#1e3a5f;color:var(--accent);">+ Add provider to ${escHtml(slug)}</button>`}
      </div>
    </div>`;
  }).join("");

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
</div>
${coinSections}

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
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Failure queue page (GET /failures)
// ---------------------------------------------------------------------------

function renderFailuresPage(failures, missingItems, failureCount) {
  const now = new Date().toUTCString();
  const isEmpty = !failures || failures.length === 0;

  const rows = isEmpty ? "" : failures.map(f => {
    const age = f.lastFailure
      ? Math.round((Date.now() - new Date(f.lastFailure)) / 1000)
      : null;
    const ageStr = age != null ? (age < 3600 ? `${Math.round(age/60)}m ago` : `${Math.round(age/3600)}h ago`) : "?";

    return `<tr>
      <td><strong>${escHtml(f.coinName)}</strong><br><code style="color:var(--muted);font-size:11px;">${escHtml(f.coinSlug)}</code></td>
      <td>${escHtml(f.vendorId)}</td>
      <td class="url-cell">${f.url ? `<a href="${escAttr(f.url)}" target="_blank" title="${escAttr(f.url)}" style="color:var(--accent);">${escHtml(f.url.length > 60 ? f.url.slice(0, 57) + "..." : f.url)}</a>` : ""}</td>
      <td style="color:#f87171;font-weight:700;text-align:center;">${escHtml(String(f.failureCount))}</td>
      <td style="color:var(--muted);font-size:12px">${ageStr}</td>
      <td style="color:var(--muted);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(f.lastError || "")}">${escHtml(f.lastError || "")}</td>
      <td style="white-space:nowrap">
        <a href="/providers#${escAttr(f.coinSlug)}" style="font-size:12px;margin-right:8px;">Edit URL</a>
        <button class="btn-disable" data-coin="${escAttr(f.coinSlug)}" data-vendor="${escAttr(f.vendorId)}" style="background:#7f1d1d;color:#fca5a5;">Disable</button>
      </td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>Failure Queue \u2014 StakTrakr</title>
<style>
  ${SHARED_CSS}
  .url-cell { max-width: 400px; word-break: break-all; font-size: 12px; color: var(--muted); }
  .subtitle { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  .empty { color: var(--muted); font-style: italic; padding: 24px 0; }
</style>
</head>
<body>
${renderNav("failures", failureCount)}
<div style="padding:20px;">
<h1 style="color:var(--accent);margin-bottom:4px;">Failure Queue</h1>
<p class="subtitle">Chronic failures (3+ in 7 days) &amp; items missing this hour &bull; Auto-refreshes every 5 min &bull; ${now}</p>
<div id="toast" style="display:none;position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:6px;font-size:13px;z-index:200;"></div>
<h2 style="color:var(--accent);font-size:16px;margin:24px 0 8px;">Missing This Hour</h2>
<p style="color:var(--muted);font-size:12px;margin-bottom:12px;">Enabled vendor-coin pairs with no successful price in the current hour.</p>
${renderMissingItems(missingItems)}

<h2 style="color:var(--accent);font-size:16px;margin:32px 0 8px;">Chronic Failures (3+ in 7 days)</h2>
${isEmpty
  ? '<p class="empty">No providers failing above threshold \u2014 all URLs healthy.</p>'
  : `<table>
  <thead><tr>
    <th>Coin</th><th>Vendor</th><th>URL</th><th>Failures</th><th>Last Failed</th><th>Error</th><th>Actions</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>`}
</div>
<script>
function showToast(text, ok) {
  const t = document.getElementById('toast');
  t.style.display = 'block';
  t.style.background = ok ? '#14532d' : '#7f1d1d';
  t.style.color = ok ? '#86efac' : '#fca5a5';
  t.textContent = text;
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

document.querySelectorAll('.btn-disable').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!confirm('Disable ' + btn.dataset.vendor + ' for ' + btn.dataset.coin + '?')) return;
    const r = await fetch('/providers/toggle', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ coinSlug: btn.dataset.coin, vendorId: btn.dataset.vendor, enabled: false })
    });
    const j = await r.json();
    showToast(j.message, r.ok);
    if (r.ok) btn.closest('tr').style.opacity = '0.4';
  });
});

// ── Diagnose button (Claude Code on VM) ─────────────────────────────────
document.querySelectorAll('.btn-diagnose').forEach(btn => {
  btn.addEventListener('click', async () => {
    const coin = btn.dataset.coin;
    const vendor = btn.dataset.vendor;
    const url = btn.dataset.url;
    if (!url) { alert('No URL configured for this vendor.'); return; }
    btn.disabled = true;
    btn.textContent = '\\u23F3 Running...';
    btn.style.opacity = '0.6';
    try {
      const r = await fetch('/api/diagnose', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ coinSlug: coin, vendorId: vendor, url })
      });
      const j = await r.json();
      if (j.error) {
        alert('Diagnosis error: ' + j.error);
      } else {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:300;display:flex;justify-content:center;align-items:center;padding:20px;';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1e293b;border:1px solid #334155;border-radius:12px;max-width:850px;width:100%;max-height:85vh;display:flex;flex-direction:column;position:relative;';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #334155;flex-shrink:0;';
        header.innerHTML = '<div>'
          + '<div style="font-size:15px;font-weight:700;color:#e2e8f0;">Diagnosis: ' + coin + ':' + vendor + '</div>'
          + '<div style="font-size:12px;color:#94a3b8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:600px;">' + url + '</div>'
          + '<div style="font-size:11px;color:#64748b;margin-top:2px;">Engine: ' + (j.engine || '?') + ' \\u00B7 Firecrawl: ' + (j.scrapeLength || 0) + ' chars \\u00B7 Playwright: ' + (j.playwrightLength || 0) + ' chars</div>'
          + '</div>';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\\u2715';
        closeBtn.style.cssText = 'background:#334155;color:#e2e8f0;width:32px;height:32px;border-radius:6px;border:none;cursor:pointer;font-size:16px;flex-shrink:0;margin-left:12px;';
        closeBtn.onmouseover = () => { closeBtn.style.background = '#ef4444'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = '#334155'; };
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);
        const body = document.createElement('div');
        body.style.cssText = 'padding:16px 20px;overflow-y:auto;flex:1;font-family:"Cascadia Code","Fira Code",monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#e2e8f0;';
        body.textContent = j.result || '(no output)';
        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;gap:8px;padding:12px 20px;border-top:1px solid #334155;flex-shrink:0;';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '\\uD83D\\uDCCB Copy Markdown';
        copyBtn.style.cssText = 'background:#166534;color:#86efac;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;';
        copyBtn.onclick = () => {
          var NL = String.fromCharCode(10);
          var BT = String.fromCharCode(96,96,96);
          var parts = ['## Diagnosis: ' + coin + ':' + vendor, '**URL:** ' + url, '**Engine:** ' + (j.engine || '?'), '**Date:** ' + new Date().toISOString(), '', BT, (j.result || ''), BT, ''];
          navigator.clipboard.writeText(parts.join(NL)).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy Markdown'; }, 2000);
          });
        };
        const copyRawBtn = document.createElement('button');
        copyRawBtn.textContent = '\\uD83D\\uDCC4 Copy Raw';
        copyRawBtn.style.cssText = 'background:#1e3a5f;color:var(--accent);padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:600;';
        copyRawBtn.onclick = function() {
          navigator.clipboard.writeText(j.result || '').then(function() {
            copyRawBtn.textContent = 'Copied!';
            setTimeout(function() { copyRawBtn.textContent = 'Copy Raw'; }, 2000);
          });
        };
        footer.appendChild(copyBtn);
        footer.appendChild(copyRawBtn);
        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      }
    } catch (err) {
      alert('Request failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '\\uD83E\\uDD16 Diagnose';
      btn.style.opacity = '1';
    }
  });
});

// ── Browserbase button ──────────────────────────────────────────────────
document.querySelectorAll('.btn-browserbase').forEach(btn => {
  btn.addEventListener('click', async () => {
    const url = btn.dataset.url;
    if (!url) { alert('No URL configured for this vendor.'); return; }
    btn.disabled = true;
    btn.textContent = '\\u23F3 Launching...';
    try {
      const r = await fetch('/api/browserbase', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ url, coinSlug: btn.dataset.coin, vendorId: btn.dataset.vendor })
      });
      const j = await r.json();
      if (j.error) {
        alert('Browserbase error: ' + j.error);
      } else if (j.liveUrl) {
        window.open(j.liveUrl, '_blank');
      } else {
        alert('Session created but no live URL returned.');
      }
    } catch (err) {
      alert('Request failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '\\uD83C\\uDF10 Browserbase';
    }
  });
});
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
    req.on("data", chunk => { body += chunk; });
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
  } catch { return 0; }
}

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
    let providers, scrapeStatus, failureCount;
    try {
      client = getTursoClient();
      await initProviderSchema(client);
      [providers, scrapeStatus, failureCount] = await Promise.all([
        getProviders(client),
        getVendorScrapeStatus(client).catch(() => null),
        getFailureCount(client),
      ]);
    } catch {
      readOnly = true;
      try { providers = JSON.parse(readFileSync(PROVIDERS_FILE, "utf8")); } catch { providers = { coins: {} }; }
      scrapeStatus = null;
      failureCount = 0;
    } finally {
      if (client) try { await client.close(); } catch { /* ignore */ }
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderProvidersPage(providers, scrapeStatus, failureCount, readOnly));
    return;
  }

  // ── GET /providers/coin-data ────────────────────────────────────────────
  if (req.method === "GET" && url === "/providers/coin-data") {
    const slug = query.get("slug");
    try {
      const client = getTursoClient();
      const coins = await getAllCoins(client);
      const coin = coins.find(c => c.slug === slug);
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
      if (!["silver", "gold", "goldback", "platinum"].includes(data.metal)) throw new Error("Invalid metal");
      const client = getTursoClient();
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
      const client = getTursoClient();
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
      if (data.url && !data.url.startsWith("https://")) throw new Error("URL must start with https://");
      if (data.hints && data.hints.trim()) { try { JSON.parse(data.hints); } catch { throw new Error("Hints must be valid JSON"); } }
      const client = getTursoClient();
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
      res.end(JSON.stringify({ ok: true, message: `Vendor '${data.vendorId}' saved to '${data.coinSlug}'.` }));
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
      const client = getTursoClient();
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
      const client = getTursoClient();
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
      const client = getTursoClient();
      await toggleVendor(client, coinSlug, vendorId, enabled);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `${enabled ? "Enabled" : "Disabled"} ${vendorId}/${coinSlug}.` }));
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
      if (hints && hints.trim()) { try { JSON.parse(hints); } catch { throw new Error("Hints must be valid JSON"); } }
      const client = getTursoClient();
      await updateVendorFields(client, coinSlug, vendorId, { selector: selector || null, hints: hints || null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: `Updated selector/hints for ${vendorId}/${coinSlug}.` }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── POST /providers/bulk-toggle ─────────────────────────────────────────
  if (req.method === "POST" && url === "/providers/bulk-toggle") {
    try {
      const { vendorId, metal, enabled } = JSON.parse(await readBody(req));
      if (!vendorId || !metal || enabled === undefined) throw new Error("vendorId, metal, and enabled required");
      const client = getTursoClient();
      const result = await batchToggleVendor(client, { vendorId, metal, enabled });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, rowsAffected: result.rowsAffected, message: `${enabled ? "Enabled" : "Disabled"} ${vendorId} on ${result.rowsAffected} ${metal} items.` }));
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
      const client = getTursoClient();
      const result = await batchDeleteVendor(client, { vendorId, metal });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, rowsAffected: result.rowsAffected, message: `Removed ${vendorId} from ${result.rowsAffected} ${metal} items.` }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: err.message }));
    }
    return;
  }

  // ── GET /providers/vendor-summary ────────────────────────────────────────
  if (req.method === "GET" && url === "/providers/vendor-summary") {
    try {
      const client = getTursoClient();
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
      const client = getTursoClient();
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
                command: ["/bin/bash", "-c",
                  "git config --global user.name 'StakTrakr Poller' && " +
                  "git config --global user.email 'poller@staktrakr.local' && " +
                  "/app/run-publish.sh"],
                timeout: 60,
              }),
            }
          );
          const result = await execRes.json();
          published = result.exit_code === 0;
          publishMsg = published ? "published" : `failed: ${(result.stderr || "unknown").slice(0, 200)}`;
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

  // ── GET /failures ──────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/failures") {
    let failures = [], missingItems = [], failureCount = 0;
    try {
      const client = getTursoClient();
      [failures, missingItems] = await Promise.all([
        getFailureStats(client),
        getMissingItems(client),
      ]);
      failureCount = failures.length;
    } catch { /* empty */ }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderFailuresPage(failures, missingItems, failureCount));
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
          steps.push("FIRECRAWL: " + (firecrawlOk ? "OK" : "THIN/JS-BLOCKED") + " (" + contentLen + " chars, " + loadingCount + " 'loading' refs)");
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
              "[class*='price']", "[id*='price']", "[data-price]",
              "[itemprop='price']", ".product-price", ".price-current",
              ".our-price", ".sale-price", ".regular-price",
              "[class*='Price']", "[class*='cost']",
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
                if (data["@type"] === "Product" || data["@type"] === "Offer" || JSON.stringify(data).includes("price")) {
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
          steps.push("PLAYWRIGHT: " + (playwrightOk ? "FOUND price elements" : "rendered but no price elements") + " (" + priceElements.length + " price DOM nodes, " + jsonLd.length + " JSON-LD blocks)");
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
        'SELECTOR: the exact CSS selector or extraction path (e.g. .product-price .price-current)',
        'HINTS: suggested JSON hints for the vision pipeline',
        "ANTI_BOT: none | cloudflare | captcha | js_required | other",
        "SUGGESTED_FIX: one-paragraph explanation of what to change in the scraper config",
        "CONFIDENCE: high | medium | low",
        "",
        "--- PAGE CONTENT (" + contentSource + ") ---",
        bestContent.slice(0, 10000),
      ].join("\n");

      const geminiResp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiKey,
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
      } catch { /* non-critical — don't fail the request */ }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        result: "=== DIAGNOSIS PIPELINE ===\n" + steps.join("\n") + "\n\n=== AI ANALYSIS (Gemini 2.5 Flash) ===\n" + aiResult,
        engine: "gemini-2.5-flash",
        pipeline: steps,
        scrapeLength: scrapeContent.length,
        playwrightLength: playwrightContent.length,
      }));
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
      res.end(JSON.stringify({ error: "BROWSERBASE_API_KEY or BROWSERBASE_PROJ_ID not configured" }));
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
        const page = defaultContext?.pages()[0] || await defaultContext?.newPage();
        if (page) {
          await page.goto(vendorUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        }
        // Don't close — leave the session open for the user to inspect
      } catch (navErr) {
        // Non-fatal — session still usable, just won't be pre-navigated
        console.error("[browserbase] auto-navigate failed:", navErr.message);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        sessionId: session.id,
        liveUrl,
        connectUrl: session.connectUrl,
        vendorUrl,
        coinSlug,
        vendorId,
        message: `Browserbase session created. Navigate to: ${vendorUrl}`,
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /api/clear-lock — Remove a stale poller lock file ─────────────
  if (req.method === "POST" && url === "/api/clear-lock") {
    try {
      const { path: lockPath } = JSON.parse(await readBody(req));
      const allowed = LOCK_FILES.map(l => l.path);
      if (!lockPath || !allowed.includes(lockPath)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Invalid lock path" }));
        return;
      }
      if (!existsSync(lockPath)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "Lock file does not exist (already cleared)" }));
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

  const client = getTursoClient();
  const [tursoResult, tursoBackup, runStats, failureCount, net, cpu, uptime, supervisord, systemd, logLines, flyioHealth, coverageStats, spotCoverage, failureTrend, flyRuns, dockerContainers, lockStatus] = await Promise.all([
    fetchRunsFromTurso().then(rows => ({ rows, error: null })).catch(err => ({ rows: null, error: err.message })),
    checkTursoBackup(),
    client ? getRunStats(client).catch(() => null) : Promise.resolve(null),
    client ? getFailureCount(client) : Promise.resolve(0),
    Promise.resolve(getNetStats()),
    Promise.resolve(getCpuMem()),
    Promise.resolve(getUptime()),
    Promise.resolve(getSupervisordStatus()),
    Promise.resolve(getSystemdStatus()),
    Promise.resolve(readLog()),
    Promise.resolve(getFlyioHealth()),
    client ? getCoverageStats(client, 48).catch(() => null) : Promise.resolve(null),
    client ? getSpotCoverage(client, 48).catch(() => null) : Promise.resolve(null),
    client ? getFailureTrend(client).catch(() => []) : Promise.resolve([]),
    client ? fetchFlyioRuns(client).catch(() => null) : Promise.resolve(null),
    Promise.resolve(getDockerContainers()),
    Promise.resolve(getLockStatus()),
  ]);

  const html = renderMainPage({
    net, cpu, uptime, supervisord, systemd, logLines, flyioHealth,
    tursoRuns: tursoResult.rows,
    tursoError: tursoResult.error,
    tursoUp: !tursoResult.error,
    tursoBackup,
    runStats,
    failureCount,
    coverageStats,
    spotCoverage,
    failureTrend,
    flyRuns,
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
