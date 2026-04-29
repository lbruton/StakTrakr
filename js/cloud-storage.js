// =============================================================================
// CLOUD STORAGE — Dropbox, pCloud, Box OAuth + vault backup/restore
// =============================================================================

// ---------------------------------------------------------------------------
// Cloud Activity Log — records all cloud sync transactions
// ---------------------------------------------------------------------------

var CLOUD_ACTIVITY_KEY = "cloud_activity_log"; // nosemgrep: codacy.javascript.security.hard-coded-password
var CLOUD_ACTIVITY_MAX = 500;
var CLOUD_ACTIVITY_MAX_AGE_DAYS = 180;

function loadCloudActivityLog() {
  try {
    return typeof loadDataSync === "function"
      ? loadDataSync(CLOUD_ACTIVITY_KEY, [])
      : JSON.parse(localStorage.getItem(CLOUD_ACTIVITY_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function saveCloudActivityLog(log) {
  try {
    if (typeof saveDataSync === "function") {
      saveDataSync(CLOUD_ACTIVITY_KEY, log);
    } else {
      localStorage.setItem(CLOUD_ACTIVITY_KEY, JSON.stringify(log));
    }
  } catch (e) {
    console.warn("[CloudStorage] Failed to save activity log", e);
  }
}

function recordCloudActivity(entry) {
  var log = loadCloudActivityLog();

  // Purge old entries
  var cutoff = Date.now() - CLOUD_ACTIVITY_MAX_AGE_DAYS * 86400000;
  log = log.filter(function (e) {
    return e.timestamp >= cutoff;
  });

  log.unshift({
    timestamp: Date.now(),
    action: entry.action || "",
    provider: entry.provider || "",
    result: entry.result || "success",
    detail: entry.detail || "",
    duration: entry.duration != null ? entry.duration : null,
  });

  // Cap at max entries
  if (log.length > CLOUD_ACTIVITY_MAX) log.length = CLOUD_ACTIVITY_MAX;

  saveCloudActivityLog(log);
}

/** @type {string|null} Sort column for settings cloud activity table */
var settingsCloudSortColumn = null;
/** @type {boolean} Sort ascending for settings cloud activity table */
var settingsCloudSortAsc = true;

function renderCloudActivityTable() {
  var table = document.getElementById("settingsCloudActivityTable");
  if (!table) return;

  var data = loadCloudActivityLog();

  // Sort
  if (settingsCloudSortColumn) {
    var col = settingsCloudSortColumn;
    var asc = settingsCloudSortAsc;
    data.sort(function (a, b) {
      var valA = a[col],
        valB = b[col];
      if (valA < valB) return asc ? -1 : 1;
      if (valA > valB) return asc ? 1 : -1;
      return 0;
    });
  }
  // Default: newest first (already stored newest-first, but sort explicitly)
  if (!settingsCloudSortColumn) {
    data.sort(function (a, b) {
      return b.timestamp - a.timestamp;
    });
  }

  var tbody = table.querySelector("tbody");
  if (!tbody) return;

  if (data.length === 0) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML =
      '<tr class="settings-log-empty"><td colspan="6">No cloud activity recorded yet.</td></tr>';
    return;
  }

  var rows = data.map(function (e) {
    var d = new Date(e.timestamp);
    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    var timeStr =
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds());
    var resultStyle = e.result === "fail" ? ' style="color: var(--danger, #e74c3c);"' : "";
    var durationStr = e.duration != null ? e.duration + "ms" : "—";
    var safeDetail = sanitizeHtml(e.detail);
    return (
      "<tr><td>" +
      timeStr +
      "</td><td>" +
      sanitizeHtml(e.action) +
      "</td><td>" +
      sanitizeHtml(e.provider) +
      "</td><td" +
      resultStyle +
      ">" +
      sanitizeHtml(e.result) +
      "</td><td>" +
      safeDetail +
      "</td><td>" +
      durationStr +
      "</td></tr>"
    );
  });

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML = rows.join("");

  // Sortable headers
  var cols = ["timestamp", "action", "provider", "result", "detail", "duration"];
  table.querySelectorAll("th").forEach(function (th, idx) {
    th.style.cursor = "pointer";
    th.onclick = function () {
      var c = cols[idx];
      if (settingsCloudSortColumn === c) {
        settingsCloudSortAsc = !settingsCloudSortAsc;
      } else {
        settingsCloudSortColumn = c;
        settingsCloudSortAsc = true;
      }
      renderCloudActivityTable();
    };
  });
}

/**
 * Render the Sync History section in Settings → Cloud.
 * Shows metadata for the pre-pull local snapshot (if any) and a restore button.
 */
function renderSyncHistorySection() {
  var container = document.getElementById("cloudSyncHistorySection");
  if (!container) return;

  var backup = null;
  try {
    backup = JSON.parse(localStorage.getItem("cloud_sync_override_backup") || "null");
  } catch (_) {}

  if (!backup || !backup.timestamp) {
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    container.innerHTML =
      '<p class="settings-subtext" style="margin:0">No snapshot available. A local snapshot is saved automatically before any remote pull is accepted.</p>';
    return;
  }

  var d = new Date(backup.timestamp);
  var pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  var timeStr =
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes());

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  container.innerHTML =
    '<div class="cloud-sync-update-meta">' +
    '<div class="cloud-sync-update-row"><span>Snapshot taken</span><strong>' +
    timeStr +
    "</strong></div>" +
    '<div class="cloud-sync-update-row"><span>Items</span><strong>' +
    (backup.itemCount != null ? backup.itemCount : "?") +
    "</strong></div>" +
    (backup.appVersion
      ? '<div class="cloud-sync-update-row"><span>Version</span><strong>v' +
        sanitizeHtml(String(backup.appVersion)) +
        "</strong></div>"
      : "") +
    "</div>" +
    '<div style="margin-top:0.6rem">' +
    '<button class="btn warning" type="button" style="font-size:0.8rem;padding:0.25rem 0.6rem" ' +
    "onclick=\"if(typeof syncRestoreOverrideBackup==='function')syncRestoreOverrideBackup();\">" +
    "Restore This Snapshot" +
    "</button>" +
    "</div>";
}

async function clearCloudActivityLog() {
  const confirmed =
    typeof showAppConfirm === "function"
      ? await showAppConfirm("Clear all cloud activity log? This cannot be undone.", "Cloud Sync")
      : false;
  if (!confirmed) return;
  saveCloudActivityLog([]);
  var panel = document.getElementById("logPanel_cloud");
  if (panel) delete panel.dataset.rendered;
  renderCloudActivityTable();
}

/**
 * Cloud provider configurations.
 * Client IDs are placeholder — replace with real registered app IDs.
 */
const CLOUD_PROVIDERS = {
  dropbox: {
    name: "Dropbox",
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    clientId: "gbxz5vvffweoz4f",
    scopes: "",
    folder: "/StakTrakr",
    usePKCE: true,
    refreshable: true,
  },
  pcloud: {
    name: "pCloud",
    authUrl: "https://my.pcloud.com/oauth2/authorize",
    tokenUrl: "/api/token-exchange",
    clientId: "TODO_REPLACE_PCLOUD_CLIENT_ID",
    scopes: "",
    folder: "/StakTrakr",
    usePKCE: false,
    refreshable: false, // pCloud tokens are lifetime
  },
  box: {
    name: "Box",
    authUrl: "https://account.box.com/api/oauth2/authorize",
    tokenUrl: "/api/token-exchange",
    clientId: "TODO_REPLACE_BOX_CLIENT_ID",
    scopes: "",
    folder: "StakTrakr",
    usePKCE: false,
    refreshable: true,
  },
};

const CLOUD_REDIRECT_URI = window.location.origin + "/oauth-callback.html";

// Fallback: if we landed on index.html with OAuth params (user navigated back
// from a stale oauth-callback.html, or redirect URI was changed), capture them.
(function checkUrlForOAuthParams() {
  var params = new URLSearchParams(window.location.search);
  var code = params.get("code");
  var state = params.get("state");
  if (code) {
    history.replaceState(null, "", window.location.pathname);
    try {
      localStorage.setItem("staktrakr_oauth_result", JSON.stringify({ code: code, state: state }));
    } catch (e) {
      /* ignore */
    }
  }
})();

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function cloudGenerateVerifier() {
  var arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode.apply(null, arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function cloudGenerateChallenge(verifier) {
  var encoder = new TextEncoder();
  var digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

function cloudGetStorageKey(provider) {
  return "cloud_token_" + provider;
}

function cloudGetStoredToken(provider) {
  try {
    var raw = localStorage.getItem(cloudGetStorageKey(provider));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cloudStoreToken(provider, tokenData) {
  localStorage.setItem(cloudGetStorageKey(provider), JSON.stringify(tokenData));
}

function cloudClearToken(provider) {
  localStorage.removeItem(cloudGetStorageKey(provider));
}

function cloudIsConnected(provider) {
  return !!cloudGetStoredToken(provider);
}

async function cloudGetToken(provider) {
  var stored = cloudGetStoredToken(provider);
  if (!stored) return null;

  var config = CLOUD_PROVIDERS[provider];

  // pCloud tokens never expire
  if (!config.refreshable) return stored.access_token;

  // Check if token is expired (with 60s buffer)
  if (stored.expires_at && Date.now() < stored.expires_at - 60000) {
    return stored.access_token;
  }

  // Attempt refresh
  if (!stored.refresh_token) {
    cloudClearToken(provider);
    if (typeof syncCloudUI === "function") syncCloudUI();
    recordCloudActivity({
      action: "auth_fail",
      provider: provider,
      result: "fail",
      detail: "No refresh token — session expired",
    });
    return null;
  }

  var refreshStart = Date.now();
  try {
    var isProxy = config.tokenUrl.startsWith("/api/");
    var headers = isProxy
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/x-www-form-urlencoded" };

    var body;
    if (isProxy) {
      body = JSON.stringify({
        provider: provider,
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
      });
    } else {
      body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
        client_id: config.clientId,
      });
    }

    var resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: headers,
      body: body,
    });
    if (!resp.ok) throw new Error("Refresh failed");
    var data = await resp.json();
    var updated = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || stored.refresh_token,
      expires_at: Date.now() + (data.expires_in || 14400) * 1000,
    };
    cloudStoreToken(provider, updated);
    recordCloudActivity({
      action: "refresh",
      provider: provider,
      result: "success",
      detail: "Token refreshed",
      duration: Date.now() - refreshStart,
    });
    return updated.access_token;
  } catch (e) {
    recordCloudActivity({
      action: "refresh",
      provider: provider,
      result: "fail",
      detail: String(e.message || e),
      duration: Date.now() - refreshStart,
    });
    debugLog("[CloudStorage] Token refresh failed for " + provider, e);
    cloudClearToken(provider);
    if (typeof syncCloudUI === "function") syncCloudUI();
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth popup flow
// ---------------------------------------------------------------------------

function cloudAuthStart(provider, options) {
  var config = CLOUD_PROVIDERS[provider];
  if (!config) return;

  var state = provider + "_" + generateUUID();
  sessionStorage.setItem("cloud_oauth_state", state);

  var params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: CLOUD_REDIRECT_URI,
    state: state,
    token_access_type: "offline",
  });

  // STAK-449: Force Dropbox to show account picker for multi-account switching
  if (options && options.forceReauth && provider === "dropbox") {
    params.set("force_reauthentication", "true");
  }

  // Open popup synchronously (in click handler context) to avoid popup blockers,
  // then navigate it after the async PKCE challenge is computed.
  var popup = window.open("about:blank", "staktrakr_oauth", "width=600,height=700");

  if (config.usePKCE) {
    var verifier = cloudGenerateVerifier();
    sessionStorage.setItem("cloud_pkce_verifier", verifier);
    cloudGenerateChallenge(verifier)
      .then(function (challenge) {
        params.set("code_challenge", challenge);
        params.set("code_challenge_method", "S256");
        var url = config.authUrl + "?" + params.toString();
        if (popup && !popup.closed) {
          popup.location.href = url;
        } else {
          // Popup was blocked — fall back to main-window redirect
          window.location.href = url;
        }
      })
      .catch(function (err) {
        sessionStorage.removeItem("cloud_oauth_state");
        sessionStorage.removeItem("cloud_pkce_verifier");
        if (popup && !popup.closed) popup.close();
        cloudNotifyAuthFailure(
          provider,
          "PKCE challenge generation failed. Please try again.",
          err
        );
      });
  } else {
    var url = config.authUrl + "?" + params.toString();
    if (popup && !popup.closed) {
      popup.location.href = url;
    } else {
      window.location.href = url;
    }
  }
}

// Surface auth failures to the user (toast with alert fallback).
function cloudNotifyAuthFailure(provider, message, details) {
  var providerName =
    (CLOUD_PROVIDERS[provider] && CLOUD_PROVIDERS[provider].name) || "Cloud provider";
  var fullMessage = providerName + " authentication failed: " + message;

  recordCloudActivity({ action: "auth_fail", provider: provider, result: "fail", detail: message });
  debugLog("[CloudStorage] " + fullMessage, details || "");
  if (details) {
    try {
      console.error("[CloudStorage] OAuth error details:", details);
    } catch (_) {
      /* ignore */
    }
  }

  if (typeof showCloudToast === "function") {
    showCloudToast(fullMessage, 7000);
  } else {
    if (typeof showAppAlert === "function") {
      showAppAlert(fullMessage, "Cloud Sync");
    } else {
      appAlert(fullMessage);
    }
  }
}

// Exchange an OAuth authorization code for an access token.
async function cloudExchangeCode(code, state) {
  var savedState = sessionStorage.getItem("cloud_oauth_state");

  if (state !== savedState) {
    // Parse provider from savedState (trusted), not from the attacker-controlled state param
    var failProvider = savedState ? savedState.split("_")[0] : "unknown";
    cloudNotifyAuthFailure(failProvider, "OAuth state mismatch. Please try again.");
    return;
  }

  var provider = (savedState || "").split("_")[0] || "dropbox";

  var config = CLOUD_PROVIDERS[provider];
  if (!config) return;

  var verifier = sessionStorage.getItem("cloud_pkce_verifier");
  if (verifier) {
    sessionStorage.removeItem("cloud_pkce_verifier");
  }

  var isProxy = config.tokenUrl.startsWith("/api/");
  var headers = isProxy
    ? { "Content-Type": "application/json" }
    : { "Content-Type": "application/x-www-form-urlencoded" };

  var body;
  if (isProxy) {
    body = JSON.stringify({
      provider: provider,
      code: code,
      redirect_uri: CLOUD_REDIRECT_URI,
      code_verifier: verifier || undefined,
    });
  } else {
    body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      client_id: config.clientId,
      redirect_uri: CLOUD_REDIRECT_URI,
    });
    if (verifier) {
      body.set("code_verifier", verifier);
    }
  }

  try {
    var resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: headers,
      body: body,
    });

    var raw = await resp.text();
    var data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        data = { rawResponse: raw };
      }
    }

    if (!resp.ok) {
      var errText = data.error_summary || data.error_description || data.error || "Unknown error";
      cloudNotifyAuthFailure(
        provider,
        "Token exchange failed (" + resp.status + "). " + String(errText),
        data
      );
      return;
    }

    if (!data.access_token) {
      cloudNotifyAuthFailure(
        provider,
        "Token exchange response did not include an access token.",
        data
      );
      return;
    }

    var tokenData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
    cloudStoreToken(provider, tokenData);

    // Store Dropbox account ID for key derivation and profile info for multi-account UX (STAK-449).
    // The token exchange response includes account_id — grab it directly (synchronous, no race).
    // Always call get_current_account to fetch email + display_name (not in token response).
    if (provider === "dropbox") {
      if (data.account_id) {
        localStorage.setItem("cloud_dropbox_account_id", data.account_id);
        // STAK-398 diagnostic: MUST use console.warn (not debugWarn) so it's always visible
        console.warn("[CloudStorage] Stored Dropbox account_id from token exchange: present");
      }

      // Always fetch full profile — email and display_name are only available via this API
      try {
        let acctResp = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + tokenData.access_token,
            "Content-Type": "application/json",
          },
          body: "null",
        });
        let info = acctResp.ok ? await acctResp.json() : null;
        if (info) {
          if (info.account_id) {
            localStorage.setItem("cloud_dropbox_account_id", info.account_id);
            console.warn("[CloudStorage] Stored Dropbox account_id from API: present");
          }
          if (info.email) {
            localStorage.setItem("cloud_dropbox_email", info.email);
            console.warn("[CloudStorage] Stored Dropbox email: present");
          }
          if (info.name && info.name.display_name) {
            localStorage.setItem("cloud_dropbox_display_name", info.name.display_name);
            console.warn("[CloudStorage] Stored Dropbox display_name: present");
          }
        } else {
          console.warn("[CloudStorage] get_current_account returned no data");
        }
      } catch (e) {
        console.warn("[CloudStorage] Failed to fetch Dropbox profile — connection still works.");
      }
    }
    sessionStorage.removeItem("cloud_oauth_state");
    if (typeof syncCloudUI === "function") syncCloudUI();
    if (typeof showCloudToast === "function") showCloudToast("Connected to " + config.name + ".");
    recordCloudActivity({
      action: "connect",
      provider: provider,
      result: "success",
      detail: "Connected to " + config.name,
    });
    debugLog("[CloudStorage] Connected to " + config.name);
  } catch (err) {
    sessionStorage.removeItem("cloud_oauth_state");
    cloudNotifyAuthFailure(
      provider,
      "Token exchange request failed. Check redirect URI/domain registration and try again.",
      err
    );
  }
}

// Primary: listen for OAuth callback postMessage from popup
window.addEventListener("message", function (event) {
  if (event.origin !== window.location.origin) return;
  if (!event.data || event.data.type !== "staktrakr-oauth") return;
  var code = event.data.code;
  var state = event.data.state;
  if (!code || !state) return;
  cloudExchangeCode(code, state);
});

// Fallback: localStorage relay when popup loses window.opener (Cloudflare challenge, etc.)
function cloudCheckOAuthRelay() {
  try {
    var raw = localStorage.getItem("staktrakr_oauth_result");
    if (!raw) return;
    localStorage.removeItem("staktrakr_oauth_result");
    var data = JSON.parse(raw);
    if (data.code && data.state) {
      const savedState = sessionStorage.getItem("cloud_oauth_state");
      if (!savedState || savedState !== data.state) {
        console.warn("[CloudStorage] OAuth relay: state mismatch (likely another tab) — skipping");
        return;
      }
      cloudExchangeCode(data.code, data.state);
    }
  } catch (e) {
    /* ignore */
  }
}

// Pick up the relay key via storage event (fires when another tab/popup writes it)
window.addEventListener("storage", function (event) {
  if (event.key === "staktrakr_oauth_result" && event.newValue) {
    cloudCheckOAuthRelay();
  }
});

// Also check on visibility change (user returns to tab after popup closed)
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) cloudCheckOAuthRelay();
});

// Check on page load (main-window redirect lands here after oauth-callback.html)
if (document.readyState === "complete") {
  cloudCheckOAuthRelay();
} else {
  window.addEventListener("load", cloudCheckOAuthRelay);
}

function cloudDisconnect(provider) {
  cloudClearToken(provider);

  // Clear all cloud state keys
  var keysToRemove = [
    "cloud_last_backup",
    "cloud_dropbox_account_id",
    "cloud_dropbox_email",
    "cloud_dropbox_display_name",
    "cloud_vault_password",
    "cloud_sync_enabled",
    "cloud_sync_device_id",
    "cloud_sync_cursor",
    "cloud_sync_last_push",
    "cloud_sync_last_pull",
    "cloud_sync_override_backup",
    "cloud_sync_mode",
    "cloud_sync_local_modified",
    "cloud_sync_migrated",
    "staktrakr_oauth_result",
  ];
  for (var i = 0; i < keysToRemove.length; i++) {
    localStorage.removeItem(keysToRemove[i]);
  }

  // Cancel any pending sync push
  if (typeof scheduleSyncPush === "function" && typeof scheduleSyncPush.cancel === "function") {
    scheduleSyncPush.cancel();
  }

  var providerName = (CLOUD_PROVIDERS[provider] && CLOUD_PROVIDERS[provider].name) || provider;
  recordCloudActivity({
    action: "disconnect",
    provider: provider,
    result: "success",
    detail: "Disconnected from " + providerName,
  });
  if (typeof syncCloudUI === "function") syncCloudUI();
}

// ---------------------------------------------------------------------------
// Folder management (provider-specific)
// ---------------------------------------------------------------------------

async function cloudEnsureFolder(provider, token) {
  if (provider === "dropbox") {
    // Dropbox auto-creates on upload with autorename=false
    return;
  }
  if (provider === "pcloud") {
    // Create folder if not exists (pCloud returns existing folder if already created)
    await fetch(
      "https://api.pcloud.com/createfolderifnotexists?path=" +
        encodeURIComponent(CLOUD_PROVIDERS[provider].folder) +
        "&access_token=" +
        encodeURIComponent(token)
    );
    return;
  }
  if (provider === "box") {
    // Check if StakTrakr folder exists at root (folder_id 0)
    var resp = await fetch(
      "https://api.box.com/2.0/search?query=StakTrakr&type=folder&ancestor_folder_ids=0&limit=5",
      {
        headers: { Authorization: "Bearer " + token },
      }
    );
    var data = await resp.json();
    var existing = (data.entries || []).find(function (e) {
      return e.name === "StakTrakr" && e.type === "folder";
    });
    if (existing) return existing.id;
    // Create folder
    var createResp = await fetch("https://api.box.com/2.0/folders", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "StakTrakr", parent: { id: "0" } }),
    });
    var created = await createResp.json();
    return created.id;
  }
}

// ---------------------------------------------------------------------------
// Versioned filename helper
// ---------------------------------------------------------------------------

function cloudBuildVersionedFilename() {
  var d = new Date();
  var pad = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  var stamp =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  return "staktrakr-backup-" + stamp + ".stvault";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cloudSafeItemCount() {
  try {
    if (typeof inventory === "undefined" || !Array.isArray(inventory)) return 0;
    return inventory.reduce(function (sum, it) {
      return sum + (Number(it.qty) || 1);
    }, 0);
  } catch (_) {
    return 0;
  }
}

function cloudSafeAppVersion() {
  return typeof APP_VERSION !== "undefined" ? APP_VERSION : "unknown";
}

// ---------------------------------------------------------------------------
// Upload vault to cloud (accepts pre-built fileBytes)
// ---------------------------------------------------------------------------

async function cloudUploadVault(provider, fileBytes, opts) {
  var uploadStart = Date.now();
  var token = await cloudGetToken(provider);
  if (!token) throw new Error("Not connected to " + CLOUD_PROVIDERS[provider].name);

  var config = CLOUD_PROVIDERS[provider];
  var filename = cloudBuildVersionedFilename();
  var now = Date.now();

  await cloudEnsureFolder(provider, token);

  if (provider === "dropbox") {
    // Ensure /backups/ subfolder exists (ignore 409 = already exists)
    const backupsPath = config.folder + "/backups";
    try {
      const ensureResp = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: backupsPath, autorename: false }),
      });
      if (ensureResp.ok || ensureResp.status === 409) {
        debugLog("[CloudStorage] Backups folder OK:", backupsPath);
      } else {
        debugLog("[CloudStorage] Backups folder create returned", ensureResp.status);
      }
    } catch (ensureErr) {
      debugLog("[CloudStorage] Backups folder ensure failed:", ensureErr.message);
    }

    // Upload versioned backup
    var apiArg = JSON.stringify({
      path: config.folder + "/backups/" + filename,
      mode: "add",
      autorename: true,
      mute: true,
    });
    var vaultResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": apiArg,
      },
      body: fileBytes,
    });
    if (!vaultResp.ok) throw new Error("Vault upload failed: " + vaultResp.status);

    // Upload latest.json pointer (skip for manual backups — STAK-419)
    if (!(opts && opts.skipLatestUpdate)) {
      var latestData = {
        filename: filename,
        timestamp: now,
        appVersion: cloudSafeAppVersion(),
        itemCount: cloudSafeItemCount(),
      };
      var latestBytes = new TextEncoder().encode(JSON.stringify(latestData));
      var latestArg = JSON.stringify({
        path: config.folder + "/backups/" + CLOUD_LATEST_FILENAME,
        mode: "overwrite",
        autorename: false,
        mute: true,
      });
      var latestResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/octet-stream",
          "Dropbox-API-Arg": latestArg,
        },
        body: latestBytes,
      });
      if (!latestResp.ok) throw new Error("Latest pointer upload failed: " + latestResp.status);
    }
  } else if (provider === "pcloud") {
    var formData = new FormData();
    formData.append("file", new Blob([fileBytes]), filename);
    var pcloudResp = await fetch(
      "https://api.pcloud.com/uploadfile?path=" +
        encodeURIComponent(config.folder) +
        "&renameifexists=1&nopartial=1&access_token=" +
        encodeURIComponent(token),
      {
        method: "POST",
        body: formData,
      }
    );
    if (!pcloudResp.ok) throw new Error("pCloud upload failed: " + pcloudResp.status);
  } else if (provider === "box") {
    var folderId = await cloudEnsureFolder(provider, token);
    var fd = new FormData();
    fd.append("file", new Blob([fileBytes]), filename);
    fd.append("attributes", JSON.stringify({ name: filename, parent: { id: folderId } }));
    var boxResp = await fetch("https://upload.box.com/api/2.0/files/content", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd,
    });
    if (!boxResp.ok) throw new Error("Box upload failed: " + boxResp.status);
  }

  var safeCount = cloudSafeItemCount();
  var backupMeta = {
    provider: provider,
    timestamp: now,
    filename: filename,
    appVersion: cloudSafeAppVersion(),
    itemCount: safeCount,
  };
  localStorage.setItem("cloud_last_backup", JSON.stringify(backupMeta));

  recordCloudActivity({
    action: "backup",
    provider: provider,
    result: "success",
    detail: filename + " (" + safeCount + " items)",
    duration: Date.now() - uploadStart,
  });

  if (typeof syncCloudUI === "function") syncCloudUI();
  debugLog("[CloudStorage] Backup uploaded to " + config.name + " as " + filename);
}

// ---------------------------------------------------------------------------
// Download latest.json metadata from cloud
// ---------------------------------------------------------------------------

async function cloudGetRemoteLatest(provider) {
  var token = await cloudGetToken(provider);
  if (!token) return null;

  var config = CLOUD_PROVIDERS[provider];

  try {
    if (provider === "dropbox") {
      // Try v2 path first (/backups/ subfolder)
      var apiArg = JSON.stringify({ path: config.folder + "/backups/" + CLOUD_LATEST_FILENAME });
      var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Dropbox-API-Arg": apiArg,
        },
      });
      if (resp.ok) return resp.json();

      // Fallback: legacy flat path (pre-v2 migration)
      if (resp.status === 409 || resp.status === 404) {
        var legacyArg = JSON.stringify({ path: config.folder + "/" + CLOUD_LATEST_FILENAME });
        var legacyResp = await fetch("https://content.dropboxapi.com/2/files/download", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Dropbox-API-Arg": legacyArg,
          },
        });
        if (legacyResp.ok) return legacyResp.json();
      }
      return null;
    }
  } catch (e) {
    debugLog("[CloudStorage] Failed to fetch remote latest", e);
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// List backups in cloud folder
// ---------------------------------------------------------------------------

async function cloudListBackups(provider, type) {
  var listStart = Date.now();
  var token = await cloudGetToken(provider);
  if (!token) throw new Error("Not connected to " + CLOUD_PROVIDERS[provider].name);

  var config = CLOUD_PROVIDERS[provider];
  var backups = [];

  if (provider === "dropbox") {
    var resp = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: config.folder + "/backups", recursive: false }),
    });
    if (!resp.ok) {
      // Folder may not exist yet
      if (resp.status === 409) return [];
      throw new Error("List failed: " + resp.status);
    }
    var data = await resp.json();
    var entries = data.entries || [];

    // Pagination: fetch remaining pages if Dropbox has more
    while (data.has_more) {
      try {
        var contResp = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ cursor: data.cursor }),
        });
        if (!contResp.ok) {
          debugLog(
            "[CloudStorage] Pagination failed at",
            entries.length,
            "entries:",
            contResp.status
          );
          break;
        }
        data = await contResp.json();
        entries = entries.concat(data.entries || []);
      } catch (pageErr) {
        debugLog("[CloudStorage] Pagination error:", pageErr.message);
        break;
      }
    }

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (entry[".tag"] === "file" && entry.name.endsWith(".stvault")) {
        backups.push({
          name: entry.name,
          server_modified: entry.server_modified,
          size: entry.size,
        });
      }
    }
  }

  // Sort newest first
  backups.sort(function (a, b) {
    return new Date(b.server_modified) - new Date(a.server_modified);
  });

  // Filter by backup type if requested (STAK-419)
  if (type === "manual") {
    backups = backups.filter(function (b) {
      return b.name.indexOf(MANUAL_BACKUP_PREFIX) === 0;
    });
  } else if (type === "sync") {
    backups = backups.filter(function (b) {
      return b.name.indexOf(SYNC_BACKUP_PREFIX) === 0;
    });
  }

  recordCloudActivity({
    action: "list",
    provider: provider,
    result: "success",
    detail: backups.length + " backups found",
    duration: Date.now() - listStart,
  });

  return backups;
}

// ---------------------------------------------------------------------------
// Download a specific vault file by name
// ---------------------------------------------------------------------------

async function cloudDownloadVaultByName(provider, filename) {
  var dlStart = Date.now();
  var token = await cloudGetToken(provider);
  if (!token) throw new Error("Not connected to " + CLOUD_PROVIDERS[provider].name);

  var config = CLOUD_PROVIDERS[provider];

  if (provider === "dropbox") {
    var apiArg = JSON.stringify({ path: config.folder + "/backups/" + filename });
    var resp = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Dropbox-API-Arg": apiArg,
      },
    });
    if (!resp.ok) throw new Error("Download failed: " + resp.status);
    var bytes = new Uint8Array(await resp.arrayBuffer());
    var sizeKB = Math.round(bytes.byteLength / 1024);
    recordCloudActivity({
      action: "restore",
      provider: provider,
      result: "success",
      detail: filename + " (" + sizeKB + " KB)",
      duration: Date.now() - dlStart,
    });
    return bytes;
  }

  throw new Error("Download by name not supported for " + provider);
}

// ---------------------------------------------------------------------------
// Delete a backup file from cloud
// ---------------------------------------------------------------------------

async function cloudDeleteBackup(provider, filename) {
  var deleteStart = Date.now();
  var token = await cloudGetToken(provider);
  if (!token) throw new Error("Not connected to " + CLOUD_PROVIDERS[provider].name);

  var config = CLOUD_PROVIDERS[provider];

  if (provider === "dropbox") {
    var resp = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: config.folder + "/backups/" + filename }),
    });
    if (!resp.ok) throw new Error("Delete failed: " + resp.status);

    // If this was also the latest pointer, clear the pointer too
    var latest = null;
    try {
      latest = JSON.parse(localStorage.getItem("cloud_last_backup"));
    } catch (_) {
      /* ignore */
    }
    if (latest && latest.filename === filename) {
      localStorage.removeItem("cloud_last_backup");

      // Update remote latest pointer: point to next most recent, or delete
      try {
        var remaining = await cloudListBackups(provider);
        if (remaining.length > 0) {
          var newest = remaining[0];
          var updatedLatest = {
            filename: newest.name,
            timestamp: new Date(newest.server_modified).getTime(),
            appVersion: cloudSafeAppVersion(),
            itemCount: cloudSafeItemCount(),
          };
          var updatedBytes = new TextEncoder().encode(JSON.stringify(updatedLatest));
          var updatedArg = JSON.stringify({
            path: config.folder + "/backups/" + CLOUD_LATEST_FILENAME,
            mode: "overwrite",
            autorename: false,
            mute: true,
          });
          var latResp = await fetch("https://content.dropboxapi.com/2/files/upload", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/octet-stream",
              "Dropbox-API-Arg": updatedArg,
            },
            body: updatedBytes,
          });
          if (latResp.ok) {
            localStorage.setItem(
              "cloud_last_backup",
              JSON.stringify({
                provider: provider,
                timestamp: updatedLatest.timestamp,
                filename: updatedLatest.filename,
                appVersion: updatedLatest.appVersion,
                itemCount: updatedLatest.itemCount,
              })
            );
          } else {
            debugLog("[CloudStorage] Latest pointer update failed:", latResp.status);
          }
        } else {
          // No backups remain — delete the latest.json pointer
          var delLatestResp = await fetch("https://api.dropboxapi.com/2/files/delete_v2", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ path: config.folder + "/backups/" + CLOUD_LATEST_FILENAME }),
          });
          if (!delLatestResp.ok) {
            debugLog("[CloudStorage] Failed to delete latest pointer:", delLatestResp.status);
          }
        }
      } catch (latestErr) {
        debugLog("[CloudStorage] Latest pointer update after delete failed:", latestErr.message);
      }

      if (typeof syncCloudUI === "function") syncCloudUI();
    }

    recordCloudActivity({
      action: "delete",
      provider: provider,
      result: "success",
      detail: filename,
      duration: Date.now() - deleteStart,
    });
    return;
  }

  throw new Error("Delete not supported for " + provider);
}

// ---------------------------------------------------------------------------
// Download vault from cloud (legacy — downloads latest)
// ---------------------------------------------------------------------------

async function cloudDownloadVault(provider) {
  // Try to get latest pointer first
  var latest = await cloudGetRemoteLatest(provider);
  if (latest && latest.filename) {
    return cloudDownloadVaultByName(provider, latest.filename);
  }

  // Fallback: list and download newest
  var backups = await cloudListBackups(provider);
  if (backups.length > 0) {
    return cloudDownloadVaultByName(provider, backups[0].name);
  }

  throw new Error("No backups found on " + CLOUD_PROVIDERS[provider].name);
}

// ---------------------------------------------------------------------------
// Conflict check
// ---------------------------------------------------------------------------

async function cloudCheckConflict(provider) {
  var remote = await cloudGetRemoteLatest(provider);
  var localCount = cloudSafeItemCount();
  if (!remote || !remote.timestamp) {
    return { conflict: false, local: { itemCount: localCount } };
  }

  var local = null;
  try {
    local = JSON.parse(localStorage.getItem("cloud_last_backup"));
  } catch {
    /* ignore */
  }

  if (!local || !local.timestamp) {
    // No local record — remote is newer by definition
    return {
      conflict: true,
      reason: "no_local_backup_record",
      remote: remote,
      local: { itemCount: localCount },
    };
  }

  if (remote.timestamp > local.timestamp) {
    return {
      conflict: true,
      reason: "remote_newer",
      remote: remote,
      local: {
        timestamp: local.timestamp,
        lastBackupItemCount: Number(local.itemCount) || 0,
        itemCount: localCount,
      },
    };
  }

  return {
    conflict: false,
    local: {
      timestamp: local.timestamp,
      lastBackupItemCount: Number(local.itemCount) || 0,
      itemCount: localCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Cloud UI sync
// ---------------------------------------------------------------------------

function syncCloudUI() {
  var lastBackup = null;
  try {
    lastBackup = JSON.parse(localStorage.getItem("cloud_last_backup"));
  } catch {
    /* ignore */
  }

  Object.keys(CLOUD_PROVIDERS).forEach(function (key) {
    var connected = cloudIsConnected(key);
    var card = document.getElementById("cloudCard_" + key);
    if (!card) return;

    // Toggle login vs disconnect buttons
    var loginArea = card.querySelector(".cloud-login-area");
    var connectedBadge = card.querySelector(".cloud-connected-badge");
    var disconnectBtn = document.querySelector(
      '.cloud-disconnect-btn[data-provider="' + key + '"]'
    );
    var backupListEl = document.getElementById("cloudBackupList_" + key);

    // Hide only the Connect button when connected — Backup/Restore remain visible in the same row
    var connectBtn = loginArea ? loginArea.querySelector(".cloud-connect-btn") : null;
    if (connectBtn) connectBtn.style.display = connected ? "none" : "";
    if (connectedBadge) connectedBadge.style.display = connected ? "" : "none";
    if (disconnectBtn) disconnectBtn.style.display = connected ? "" : "none";

    // Enable/disable backup & restore buttons based on connection
    document
      .querySelectorAll(
        '.cloud-backup-btn[data-provider="' +
          key +
          '"], .cloud-restore-btn[data-provider="' +
          key +
          '"]'
      )
      .forEach(function (btn) {
        btn.disabled = !connected;
      });

    // Update status indicator
    var indicator = card.querySelector(".cloud-status-indicator");
    if (indicator) {
      indicator.dataset.state = connected ? "connected" : "disconnected";
      var textEl = indicator.querySelector(".cloud-status-text");
      if (textEl) textEl.textContent = connected ? "Connected" : "Not connected";
    }

    // STAK-449: Display connected Dropbox account identity
    if (key === "dropbox") {
      const acctInfoRow = safeGetElement("cloudDropboxAccountInfo");
      const acctText = safeGetElement("cloudDropboxAccountText");
      const switchBtn = safeGetElement("cloudSwitchAccountBtn_dropbox");
      const signoutDiv = safeGetElement("cloudDropboxSignoutLink");

      if (connected) {
        const email = localStorage.getItem("cloud_dropbox_email");
        const displayName = localStorage.getItem("cloud_dropbox_display_name");
        let label = "Unknown account";
        if (displayName && email) {
          label = displayName + " (" + email + ")";
        } else if (email) {
          label = email;
        } else if (displayName) {
          label = displayName;
        }
        if (acctInfoRow) acctInfoRow.style.display = "";
        if (acctText) acctText.textContent = label;
        if (switchBtn) switchBtn.style.display = "";
        if (signoutDiv) signoutDiv.style.display = "";
      } else {
        if (acctInfoRow) acctInfoRow.style.display = "none";
        if (acctText) acctText.textContent = "";
        if (switchBtn) switchBtn.style.display = "none";
        if (signoutDiv) signoutDiv.style.display = "none";
      }
    }

    // Update sync & item count rows
    var syncEl = card.querySelector(".cloud-status-sync");
    var itemsEl = card.querySelector(".cloud-status-items");
    if (connected && lastBackup && lastBackup.provider === key) {
      var d = new Date(lastBackup.timestamp);
      if (syncEl) {
        syncEl.textContent =
          d.toLocaleDateString() +
          " " +
          d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      }
      if (itemsEl) {
        var meta = lastBackup.itemCount ? lastBackup.itemCount.toLocaleString() : "0";
        if (lastBackup.appVersion) meta += " (v" + lastBackup.appVersion + ")";
        itemsEl.textContent = meta;
      }
    } else {
      if (syncEl) syncEl.textContent = connected ? "No backups yet" : "Never";
      if (itemsEl) itemsEl.textContent = "\u2014";
    }

    // Update legacy status detail text
    var statusEl = card.querySelector(".cloud-status-detail");
    if (statusEl) statusEl.textContent = "";

    // Update backup count badge when connected; clear when disconnected
    if (connected && typeof cloudUpdateBackupCount === "function") {
      cloudUpdateBackupCount(key);
    } else {
      var badgeEl = document.getElementById("cloudBackupCount_" + key);
      if (badgeEl) badgeEl.textContent = "";
    }

    // Hide backup list when disconnected
    if (backupListEl && !connected) {
      backupListEl.style.display = "none";
      backupListEl.innerHTML = "";
    }
  });

  // STAK-149: Refresh auto-sync UI (toggle, last-synced, status dot)
  if (typeof refreshSyncUI === "function") refreshSyncUI();
}

// ---------------------------------------------------------------------------
// Password cache (session-only — never persisted to localStorage)
// ---------------------------------------------------------------------------

function cloudCachePassword(provider, password) {
  var len = password.length;
  var nonce = new Uint8Array(len);
  crypto.getRandomValues(nonce);
  var encoded = new TextEncoder().encode(password);
  var data = new Uint8Array(len);
  for (var i = 0; i < len; i++) data[i] = encoded[i] ^ nonce[i];
  var payload = {
    nonce: btoa(String.fromCharCode.apply(null, nonce)),
    data: btoa(String.fromCharCode.apply(null, data)),
    provider: provider,
  };
  sessionStorage.setItem("cloud_vault_pw_cache", JSON.stringify(payload));
  _startIdleLockTimer();
}

function cloudGetCachedPassword(provider) {
  try {
    var raw = sessionStorage.getItem("cloud_vault_pw_cache");
    if (!raw) return null;
    var payload = JSON.parse(raw);
    if (payload.provider !== provider) return null;
    var nonce = Uint8Array.from(atob(payload.nonce), function (c) {
      return c.charCodeAt(0);
    });
    var data = Uint8Array.from(atob(payload.data), function (c) {
      return c.charCodeAt(0);
    });
    var decoded = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) decoded[i] = data[i] ^ nonce[i];
    return new TextDecoder().decode(decoded);
  } catch (_) {
    return null;
  }
}

function cloudClearCachedPassword() {
  sessionStorage.removeItem("cloud_vault_pw_cache");
  _stopIdleLockTimer();
}

// ---------------------------------------------------------------------------
// Idle auto-lock: clear cached vault password after inactivity
// ---------------------------------------------------------------------------

let _idleLockTimer = null;
let _idleThrottleTimer = null;

/** Returns the vault idle lock timeout in ms. 0 means never lock. */
function _getIdleLockTimeoutMs() {
  var stored = localStorage.getItem(CLOUD_VAULT_IDLE_TIMEOUT_KEY);
  var minutes = stored !== null ? parseInt(stored, 10) : 15;
  if (isNaN(minutes) || ![0, 15, 30, 60, 120].includes(minutes)) minutes = 15;
  return minutes === 0 ? 0 : minutes * 60 * 1000;
}

function _resetIdleLockTimer() {
  if (!sessionStorage.getItem("cloud_vault_pw_cache")) return;
  clearTimeout(_idleLockTimer);
  var timeoutMs = _getIdleLockTimeoutMs();
  if (timeoutMs === 0) {
    // "Never" — cancel throttle too so activity listeners become true no-ops
    clearTimeout(_idleThrottleTimer);
    _idleThrottleTimer = null;
    return;
  }
  _idleLockTimer = setTimeout(function () {
    if (!sessionStorage.getItem("cloud_vault_pw_cache")) return;
    cloudClearCachedPassword();
    if (typeof showCloudToast === "function") {
      showCloudToast("Cloud vault password cleared (idle timeout)");
    }
    debugLog("[CloudStorage] Vault password cache cleared due to inactivity");
  }, timeoutMs);
}

function _onUserActivity() {
  if (_idleThrottleTimer) return;
  _idleThrottleTimer = setTimeout(function () {
    _idleThrottleTimer = null;
  }, 30000);
  _resetIdleLockTimer();
}

function _startIdleLockTimer() {
  _stopIdleLockTimer();
  _resetIdleLockTimer();
  document.addEventListener("mousemove", _onUserActivity);
  document.addEventListener("keydown", _onUserActivity);
  document.addEventListener("touchstart", _onUserActivity);
}

function _stopIdleLockTimer() {
  clearTimeout(_idleLockTimer);
  clearTimeout(_idleThrottleTimer);
  _idleLockTimer = null;
  _idleThrottleTimer = null;
  document.removeEventListener("mousemove", _onUserActivity);
  document.removeEventListener("keydown", _onUserActivity);
  document.removeEventListener("touchstart", _onUserActivity);
}

// ---------------------------------------------------------------------------
// Kraken toast (easter egg on first cloud backup)
// ---------------------------------------------------------------------------

function showCloudToast(message, durationMs) {
  durationMs = durationMs || 5000;
  var toast = document.createElement("div");
  toast.className = "cloud-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function () {
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", function () {
      toast.remove();
    });
  }, durationMs);
}

function showKrakenToastIfFirst() {
  if (localStorage.getItem("cloud_kraken_seen") === "true") return;
  localStorage.setItem("cloud_kraken_seen", "true");
  showCloudToast(
    "Yarr! Release the Krakens! Your treasure is encrypted and ready to brave the cloud seas. Stay vigilant, captain!"
  );
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

window.CLOUD_PROVIDERS = CLOUD_PROVIDERS;
window.cloudAuthStart = cloudAuthStart;
window.cloudDisconnect = cloudDisconnect;
window.cloudUploadVault = cloudUploadVault;
window.cloudDownloadVault = cloudDownloadVault;
// ---------------------------------------------------------------------------
// Cloud folder migration — flat layout → /sync/ + /backups/ (v2)
// ---------------------------------------------------------------------------

/**
 * Migrate cloud files from the legacy flat /StakTrakr/ layout to the v2
 * folder structure (/StakTrakr/sync/ and /StakTrakr/backups/).
 * Idempotent: checks localStorage flag before running. Best-effort — logs
 * failures but continues so partial migrations don't block sync.
 * @param {string} provider - Cloud provider name (e.g. 'dropbox')
 */
async function cloudMigrateToV2(provider) {
  debugLog("[CloudMigrate] Starting v2 folder migration…");
  var token = typeof cloudGetToken === "function" ? await cloudGetToken(provider) : null;
  if (!token) {
    debugLog("[CloudMigrate] No token — migration skipped");
    return;
  }

  // 1. Create /StakTrakr/sync/ and /StakTrakr/backups/ folders (ignore 409 = already exists)
  var folders = ["/StakTrakr/sync", "/StakTrakr/backups"];
  for (var fi = 0; fi < folders.length; fi++) {
    try {
      var folderResp = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: folders[fi], autorename: false }),
      });
      if (folderResp.ok || folderResp.status === 409) {
        debugLog("[CloudMigrate] Folder OK:", folders[fi]);
      } else {
        debugLog("[CloudMigrate] Folder create returned", folderResp.status, "for", folders[fi]);
      }
    } catch (folderErr) {
      debugLog("[CloudMigrate] Folder create failed for", folders[fi], ":", folderErr.message);
    }
  }

  // 2. Move each legacy sync file to /sync/ subfolder
  var fileMoves = [
    { from: SYNC_FILE_PATH_LEGACY, to: SYNC_FILE_PATH },
    { from: SYNC_META_PATH_LEGACY, to: SYNC_META_PATH },
    { from: SYNC_IMAGES_PATH_LEGACY, to: SYNC_IMAGES_PATH },
  ];
  var criticalMovesFailed = false;
  for (var mi = 0; mi < fileMoves.length; mi++) {
    try {
      var moveResp = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from_path: fileMoves[mi].from,
          to_path: fileMoves[mi].to,
          autorename: false,
          allow_ownership_transfer: false,
        }),
      });
      if (moveResp.ok) {
        debugLog("[CloudMigrate] Moved", fileMoves[mi].from, "→", fileMoves[mi].to);
      } else {
        var moveStatus = moveResp.status;
        // 409 = file doesn't exist at old path (already migrated or never created) — not a failure
        if (moveStatus !== 409) criticalMovesFailed = true;
        debugLog(
          "[CloudMigrate] Move returned",
          moveStatus,
          "for",
          fileMoves[mi].from,
          "(may not exist yet)"
        );
      }
    } catch (moveErr) {
      criticalMovesFailed = true;
      debugLog("[CloudMigrate] Move failed for", fileMoves[mi].from, ":", moveErr.message);
    }
  }

  // 3. Move existing staktrakr-backup-* files from /StakTrakr/ to /StakTrakr/backups/
  try {
    var listResp = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "/StakTrakr", recursive: false, limit: 200 }),
    });
    if (listResp.ok) {
      var listData = await listResp.json();
      var entries = listData.entries || [];
      for (var ei = 0; ei < entries.length; ei++) {
        var entry = entries[ei];
        if (entry.name && entry.name.indexOf("staktrakr-backup-") === 0) {
          try {
            var bkMoveResp = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
              method: "POST",
              headers: {
                Authorization: "Bearer " + token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from_path: entry.path_lower || "/StakTrakr/" + entry.name,
                to_path: SYNC_BACKUP_FOLDER + "/" + entry.name,
                autorename: false,
                allow_ownership_transfer: false,
              }),
            });
            if (bkMoveResp.ok) {
              debugLog("[CloudMigrate] Moved backup", entry.name, "→ /backups/");
            } else {
              debugLog("[CloudMigrate] Backup move returned", bkMoveResp.status, "for", entry.name);
            }
          } catch (bkErr) {
            debugLog("[CloudMigrate] Backup move failed for", entry.name, ":", bkErr.message);
          }
        }
      }
    }
  } catch (listErr) {
    debugLog("[CloudMigrate] List folder failed (backup move skipped):", listErr.message);
  }

  // 4. Set migration flag only if critical file moves succeeded
  if (!criticalMovesFailed) {
    saveData("cloud_sync_migrated", "v2");
    debugLog("[CloudMigrate] Migration complete — flag set to v2");
  } else {
    debugLog(
      "[CloudMigrate] Critical file moves failed — migration flag NOT set (will retry next sync)"
    );
  }
}

// ---------------------------------------------------------------------------
// Prune old backups — keeps only the newest `maxKeep` backups
// ---------------------------------------------------------------------------

async function cloudPruneBackups(provider, maxKeep, type) {
  try {
    var effectiveType = type || "sync";
    var backups = await cloudListBackups(provider, effectiveType);
    if (!backups || backups.length <= maxKeep) return;

    // cloudListBackups returns newest-first; delete from the end (oldest)
    var toDelete = backups.slice(maxKeep);
    for (var i = 0; i < toDelete.length; i++) {
      try {
        await cloudDeleteBackup(provider, toDelete[i].name);
        debugLog("[CloudPrune] Deleted old backup:", toDelete[i].name);
      } catch (delErr) {
        debugLog("[CloudPrune] Failed to delete backup:", toDelete[i].name, delErr.message);
      }
    }

    if (typeof logCloudSyncActivity === "function") {
      logCloudSyncActivity(
        "backup_prune",
        "success",
        "Pruned " + toDelete.length + " of " + backups.length + " backups (keep " + maxKeep + ")"
      );
    }
  } catch (err) {
    debugLog("[CloudPrune] Prune failed:", err.message);
    if (typeof logCloudSyncActivity === "function") {
      logCloudSyncActivity("backup_prune", "fail", err.message);
    }
  }
}

window.cloudPruneBackups = cloudPruneBackups;
window.cloudMigrateToV2 = cloudMigrateToV2;
window.cloudDownloadVaultByName = cloudDownloadVaultByName;
window.cloudDeleteBackup = cloudDeleteBackup;
window.cloudListBackups = cloudListBackups;
window.cloudGetRemoteLatest = cloudGetRemoteLatest;
window.cloudCheckConflict = cloudCheckConflict;
window.cloudIsConnected = cloudIsConnected;
window.syncCloudUI = syncCloudUI;
window.cloudCachePassword = cloudCachePassword;
window.cloudGetCachedPassword = cloudGetCachedPassword;
window.cloudClearCachedPassword = cloudClearCachedPassword;
window.showCloudToast = showCloudToast;
window.showKrakenToastIfFirst = showKrakenToastIfFirst;
window.recordCloudActivity = recordCloudActivity;
window.renderCloudActivityTable = renderCloudActivityTable;
window.clearCloudActivityLog = clearCloudActivityLog;
window.renderSyncHistorySection = renderSyncHistorySection;
