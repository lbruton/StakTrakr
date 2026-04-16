/**
 * @fileoverview Promise-based in-app dialog helpers (alert, confirm, prompt).
 * Creates a shared dialog root and serializes dialog requests through a queue.
 */

/* global sanitizeHtml */
(function () {
  // Note: getElementById is used here intentionally. ensureDialogRoot() guarantees
  // all dialog DOM elements exist before any lookup, making safeGetElement() unnecessary.
  const escapeDialogText = (value) => {
    if (typeof sanitizeHtml === "function") {
      return sanitizeHtml(String(value || "")).replace(/\n/g, "<br>");
    }
    return String(value || "")
      .replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char]
      )
      .replace(/\n/g, "<br>");
  };

  const ensureDialogRoot = () => {
    let root = document.getElementById("appDialogModal");
    if (root) return root;

    root = document.createElement("div");
    root.id = "appDialogModal";
    root.className = "modal";
    root.style.display = "none";
    root.style.zIndex = "10060";
    root.innerHTML = `
      <div class="modal-content" style="max-width: 460px; width: calc(100% - 2rem)">
        <div class="modal-header">
          <h3 id="appDialogTitle">Notice</h3>
          <button type="button" id="appDialogClose" class="modal-close" aria-label="Close dialog">&times;</button>
        </div>
        <div class="modal-body">
          <p id="appDialogMessage" style="margin:0 0 1rem 0; line-height:1.5"></p>
          <input id="appDialogInput" type="text" class="form-control" style="display:none; width:100%" />
        </div>
        <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:.5rem">
          <button type="button" id="appDialogCancel" class="btn secondary" style="display:none">Cancel</button>
          <button type="button" id="appDialogOk" class="btn premium">OK</button>
        </div>
      </div>`;

    document.body.appendChild(root);
    return root;
  };

  const dialogQueue = [];
  let dialogActive = false;

  const processQueue = () => {
    if (dialogActive || dialogQueue.length === 0) return;
    const next = dialogQueue.shift();
    presentDialog(next.options, next.resolve);
  };

  const presentDialog = ({ title, message, mode = "alert", defaultValue = "" }, resolve) => {
    dialogActive = true;
    const modal = ensureDialogRoot();
    const titleEl = document.getElementById("appDialogTitle");
    const messageEl = document.getElementById("appDialogMessage");
    const inputEl = document.getElementById("appDialogInput");
    const closeBtn = document.getElementById("appDialogClose");
    const cancelBtn = document.getElementById("appDialogCancel");
    const okBtn = document.getElementById("appDialogOk");

    if (!titleEl || !messageEl || !inputEl || !closeBtn || !cancelBtn || !okBtn) {
      dialogActive = false;
      resolve(mode === "prompt" ? null : mode === "confirm" ? false : undefined);
      processQueue();
      return;
    }

    titleEl.textContent = title || "Notice";
    messageEl.innerHTML = escapeDialogText(message);
    cancelBtn.style.display = mode === "alert" ? "none" : "";
    inputEl.style.display = mode === "prompt" ? "" : "none";
    if (mode === "prompt") {
      inputEl.value = defaultValue || "";
    }

    const cleanup = () => {
      modal.style.display = "none";
      closeBtn.onclick = null;
      cancelBtn.onclick = null;
      okBtn.onclick = null;
      modal.onclick = null;
      document.removeEventListener("keydown", onKeyDown);
    };

    const finish = (result) => {
      cleanup();
      dialogActive = false;
      resolve(result);
      processQueue();
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape")
        finish(mode === "prompt" ? null : mode === "confirm" ? false : undefined);
      if (event.key === "Enter" && document.activeElement !== cancelBtn) {
        if (mode === "prompt") finish(inputEl.value);
        else if (mode === "confirm") finish(true);
        else finish(undefined);
      }
    };

    closeBtn.onclick = () =>
      finish(mode === "alert" ? undefined : mode === "prompt" ? null : false);
    cancelBtn.onclick = () => finish(mode === "prompt" ? null : false);
    okBtn.onclick = () =>
      finish(mode === "prompt" ? inputEl.value : mode === "confirm" ? true : undefined);
    modal.onclick = (event) => {
      if (event.target === modal && mode !== "alert") finish(mode === "prompt" ? null : false);
    };
    document.addEventListener("keydown", onKeyDown);

    modal.style.display = "flex";
    if (mode === "prompt") inputEl.focus();
    else okBtn.focus();
  };

  const showDialog = (options) =>
    new Promise((resolve) => {
      dialogQueue.push({ options, resolve });
      processQueue();
    });

  /**
   * Displays an application-styled alert dialog.
   * @global
   * @function showAppAlert
   * @param {string} message
   * @param {string} [title]
   * @returns {Promise<void>}
   */
  window.showAppAlert = (message, title) => showDialog({ mode: "alert", message, title });
  /**
   * Displays an application-styled confirmation dialog.
   * @global
   * @function showAppConfirm
   * @param {string} message
   * @param {string} [title]
   * @returns {Promise<boolean>}
   */
  window.showAppConfirm = (message, title) => showDialog({ mode: "confirm", message, title });
  /**
   * Displays an application-styled prompt dialog.
   * @global
   * @function showAppPrompt
   * @param {string} message
   * @param {string} [defaultValue]
   * @param {string} [title]
   * @returns {Promise<?string>}
   */
  window.showAppPrompt = (message, defaultValue, title) =>
    showDialog({ mode: "prompt", message, defaultValue, title });

  /**
   * Shared async wrappers used across the app to eliminate native dialogs.
   */
  window.appAlert = (message, title = "Notice") => {
    if (typeof window.showAppAlert === "function") return window.showAppAlert(message, title);
    return Promise.resolve();
  };
  window.appConfirm = async (message, title = "Confirm") => {
    if (typeof window.showAppConfirm === "function")
      return !!(await window.showAppConfirm(message, title));
    return false;
  };
  window.appPrompt = async (message, defaultValue = "", title = "Input") => {
    if (typeof window.showAppPrompt === "function")
      return window.showAppPrompt(message, defaultValue, title);
    return null;
  };
})();
