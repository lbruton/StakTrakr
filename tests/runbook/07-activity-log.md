# Section 07 — Activity Log

Tests for activity log recording, display, and persistence. The activity log captures every Add, Edit, and Delete action performed during a session and displays each entry with a timestamp and item name. These tests verify that the log faithfully records all three action types, that the log panel opens and closes correctly via the header icon, and that logged entries survive a page reload.

Note: Tests 7.1 through 7.3 require that CRUD actions have already been performed in this session. REQUIRES: run Section 02 (CRUD) before this section, or manually add, edit, and delete one item before starting 7.1. Running this section without prior CRUD actions will cause 7.1–7.3 to fail.

---

### Test 7.1 — Log records Add action with timestamp and item name
_Added: v3.33.25 (STAK-396)_
**Preconditions:** REQUIRES: Section 02-crud has run this session (or one item was manually added). The activity log must contain at least one Add entry — this test will fail if no Add actions were performed.
**Steps:**
- act: "click the Log button or Log icon in the header navigation"
- extract: "an Add action entry with a timestamp is visible in the log panel" → expect: true
- screenshot: "07-activity-log-add"
**Pass criteria:** After opening the log panel, at least one entry with an "Add" or equivalent action label and a readable timestamp is visible. The entry includes the name of the added item.
**Tags:** activity-log, add, log
**Section:** 07-activity-log

---

### Test 7.2 — Log records Edit action with timestamp and item name
_Added: v3.33.25 (STAK-396)_
**Preconditions:** REQUIRES: Section 02-crud has run this session (or one item was manually edited). The activity log must contain at least one Edit entry — this test will fail if no Edit actions were performed. The log panel is open from 7.1, or can be re-opened.
**Steps:**
- extract: "an Edit action entry with a timestamp is visible in the log panel" → expect: true
**Pass criteria:** At least one entry with an "Edit" or equivalent action label and a readable timestamp is visible in the log, along with the name of the edited item.
**Tags:** activity-log, edit, log
**Section:** 07-activity-log

---

### Test 7.3 — Log records Delete action with timestamp and item name
_Added: v3.33.25 (STAK-396)_
**Preconditions:** REQUIRES: Section 02-crud has run this session (or one item was manually deleted). The activity log must contain at least one Delete entry — this test will fail if no Delete actions were performed. The log panel is open from 7.1 or 7.2, or can be re-opened.
**Steps:**
- extract: "a Delete action entry with a timestamp is visible in the log panel" → expect: true
**Pass criteria:** At least one entry with a "Delete" or equivalent action label and a readable timestamp is visible in the log, along with the name of the deleted item.
**Tags:** activity-log, delete, log
**Section:** 07-activity-log

---

### Test 7.4 — Log panel opens and closes correctly
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Page is fully loaded and no modal is blocking the header. The log panel may be open from a prior test.
**Steps:**
- act: "click the Log button or Log icon in the header navigation"
- screenshot: "07-activity-log-open"
- act: "close the activity log panel or modal by clicking the close button or clicking outside the panel"
- extract: "the activity log panel is visible" → expect: false
**Pass criteria:** The log panel opens when the Log header icon is clicked and closes when the close affordance is activated. The panel is fully hidden after closing and does not remain partially visible.
**Tags:** activity-log, open, close
**Section:** 07-activity-log

---

### Test 7.5 — Log persists across page reload
_Added: v3.33.25 (STAK-396)_
**Preconditions:** The activity log contains at least one entry from this session (from 7.1–7.3). The log entries are stored in localStorage.
**Steps:**
- act: "navigate to BASE_URL/index.html"
- act: "click the I Understand or Accept button if an acknowledgment modal is visible"
- act: "click the Log button or Log icon in the header navigation"
- extract: "at least one log entry is visible in the log panel" → expect: true
**Pass criteria:** After reloading the page and re-opening the log panel, previously recorded log entries are still present. The log is not cleared on page reload.
**Tags:** activity-log, persistence, reload
**Section:** 07-activity-log
