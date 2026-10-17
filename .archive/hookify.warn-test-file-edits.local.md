---
name: warn-test-file-edits
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(spec|test)\.(js|ts|mjs)$
---

⚠️ **Test file edit detected**

You are editing a test file. If this test was written during a test-driven development red phase:

- **Do not** change assertions to match your implementation.
- **Do not** add conditionals to weaken assertions.
- **Do not** remove or comment out failing expectations.

Tests define correct behavior. If they fail, fix the **implementation code**.

Only edit test files to:

- Add new tests for additional behavior
- Fix genuine test infrastructure issues (imports, setup, teardown)
- Update test data that doesn't change the behavioral contract
