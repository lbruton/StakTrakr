# Bug Report

Use when filing a bug report as a Linear issue. Triggers on: "file a bug", "bug report", "report a bug", "open a bug", or when the user describes broken behavior that needs tracking.

## Template

When creating a bug issue in Linear, use this structure for the description:

```markdown
## Bug Report

**Version:** [e.g., v3.33.51]
**Platform:** [e.g., Android / iOS / macOS / Windows]
**Browser:** [e.g., Chrome / Safari / Firefox]
**Context:** [e.g., Cloud Sync enabled, file:// protocol, specific settings]

---

### Summary

[One-line description of the bug]

### Steps to Reproduce

1.
2.
3.

### Expected Behavior

[What should happen]

### Actual Behavior

[What actually happens]

### Workaround

[If the user found a workaround, describe it here. Otherwise "None known."]

### Screenshots / Console Errors

[Attach if available]

### Severity

- [ ] Blocker — app unusable
- [x] Major — core feature broken, workaround exists
- [ ] Minor — edge case or cosmetic
- [ ] Cosmetic — visual only, no functional impact
```

## Rules

1. Always set the Linear label to `Bug`
2. Set priority based on severity: Blocker=1(Urgent), Major=2(High), Minor=3(Normal), Cosmetic=4(Low)
3. If the user provides partial info, fill in what you can and mark unknowns as `[unknown]`
4. If a workaround was discovered during reporting, always document it
5. Team is determined by the current project's `linearTeamId` in `.claude/project.json`
