/**
 * Playwright global setup: a coverage run starts from an empty `coverage/raw/`, so
 * records from an earlier run never reach the merge.
 */

import { rmSync } from "node:fs";
import { RAW_COVERAGE_DIR, isCoverageEnabled } from "./coverage.js";

export default function resetRawCoverage() {
  if (isCoverageEnabled()) rmSync(RAW_COVERAGE_DIR, { recursive: true, force: true });
}
