/**
 * Playwright global teardown: fails the run when a test changed a file in the work
 * tree. See devops/testing/tree-guard.mjs.
 */

import { assertTreeUnchanged } from "../../../devops/testing/tree-guard.mjs";

export default assertTreeUnchanged;
