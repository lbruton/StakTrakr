/**
 * Playwright global setup: records the work tree so tree-guard-teardown.js can fail a
 * run that writes outside temp output. See devops/testing/tree-guard.mjs.
 */

import { globalSetup } from "../../../devops/testing/tree-guard.mjs";

export default globalSetup;
