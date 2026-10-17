---
name: warn-assertion-weakening
enabled: true
event: file
action: warn
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(spec|test)\.(js|ts|mjs)$
  - field: new_text
    operator: regex_match
    pattern: (toBeLessThan|toBeGreaterThan|toBeLessThanOrEqual|toBeGreaterThanOrEqual|toBeCloseTo|if\s*\(!?result\.|\/\/\s*expect)
---

⚠️ **Possible assertion weakening detected**

Pattern detected that may indicate weakening a test assertion:

- `toBeLessThanOrEqual` / `toBeGreaterThanOrEqual` replacing exact `toBe`
- Conditional wrappers around assertions (`if (!result...`)
- Commented-out expectations (`// expect`)

**This is a test-driven development red flag.**
If you're changing a strict assertion to a looser one to make a test pass, you are masking a bug in the implementation.

**Ask yourself:** Did the original assertion define the correct behavior?
If yes, fix the code.
If no, the spec was wrong; escalate to the user.
