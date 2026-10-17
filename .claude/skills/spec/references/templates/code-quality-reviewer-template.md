# Code Quality Reviewer

You are reviewing code changes for production readiness. Only dispatch this review AFTER spec compliance has passed.

> **Gate Ordering:** This is Stage 2 of the two-stage review pipeline. Stage 1 (spec compliance review via `spec-reviewer-template.md`) must PASS before this review is dispatched. The implementer must have addressed all STOP checkpoints from the `implementer-prompt-template.md` — TDD gate, test gate, implementation log gate, and requirements verification gate — before this code quality review begins.

## What Was Implemented

{DESCRIPTION}

## Git Range to Review

```bash
git diff --stat {BASE_SHA}..{HEAD_SHA}
git diff {BASE_SHA}..{HEAD_SHA}
```

## Review Checklist

**Code Quality:**

- Clean separation of concerns?
- Proper error handling?
- Type safety (if applicable)?
- DRY principle followed?
- Edge cases handled?

**Architecture:**

- Sound design decisions?
- Scalability considerations?
- Performance implications?

**Testing:**

- Tests actually test logic (not just mocks)?
- Edge cases covered?
- Integration tests where needed?
- All tests passing?
- Test execution results logged in implementation artifacts? (name, status, pass/fail counts)
- Tests linked to user stories from spec requirements?

**Requirements:**

- All plan requirements met?
- Implementation matches spec?
- No scope creep?
- Breaking changes documented?

**Production Readiness:**

- Backward compatibility considered?
- Documentation complete?
- No obvious bugs?

## Security Review

> **Pairing:** This section complements (does NOT replace) the Codacy SRM scan in tasks.md C5.5. Codacy catches known-pattern findings; this human/AI review catches contextual issues Codacy can't see (business logic flaws, trust boundary violations, intent vs implementation gaps). Run BOTH.

Read the design.md `Security Considerations` section first to know what the spec author declared. If they declared `Security Impact: No`, verify that's actually true by walking the checklist below — silent assumptions are how regressions ship.

### Input Validation & Trust Boundaries

- **Untrusted input identified:** Where does data cross from user-controlled to system-trusted? Form fields, query params, file uploads, API payloads, environment variables, file paths.
- **Validation present:** Type, length, format, allow-list (preferred over deny-list), encoding.
- **Validation location:** Server-side validation MUST exist even if client-side validation is present. Client-only validation is a finding.
- **Sanitization for sinks:** HTML escape for DOM, parameterized queries for SQL, path normalization for file system, command argument arrays (never string concat) for shell.

### Authentication & Authorization

- **Auth checks present:** Every protected endpoint/action verifies the caller's identity.
- **Authz checks present:** Every protected resource verifies the caller has permission for THIS specific resource (not just "logged in").
- **No auth bypass:** Search for hardcoded credentials, debug flags, test-only branches that skip auth in production code paths.
- **Session/token handling:** Tokens stored securely (httpOnly cookies, secure storage), proper expiration, no tokens in URLs or logs.

### Secrets & Credentials

- **No hardcoded secrets:** Grep the diff for `api_key`, `password`, `token`, `secret`, `Bearer`, AWS-style keys, JWT-shaped strings.
- **Secrets sourced correctly:** From Infisical, env vars, or platform secrets manager — never from code, config files, or test fixtures.
- **No secrets in logs:** Verify that secret values, tokens, and credentials are not logged at any level (info, debug, error).
- **No secrets in error messages:** User-facing error messages must not echo back any secret material.

### Injection Risks

- **SQL injection:** Parameterized queries only. String concatenation into SQL is a Critical finding.
- **Command injection:** No `exec`/`spawn`/`Function()`/template strings used as shell commands. Use array-form arguments.
- **Path traversal:** User-supplied paths are normalized and verified to stay within an allowed root directory.
- **Cross-site scripting (XSS):** All user content rendered via safe APIs (`textContent`, framework escaping, sanitization libraries), never `innerHTML` with raw input.
- **Cross-site request forgery (CSRF):** State-changing endpoints require CSRF tokens or SameSite cookies.
- **Server-side request forgery (SSRF):** Outbound HTTP calls to user-supplied URLs validate the host against an allow-list.

### Data Exposure

- **Sensitive data classification:** PII, financial, health, location, credentials — all flagged for secure handling.
- **Logging hygiene:** No PII in logs without redaction. No request/response body dumps containing user data.
- **Error responses:** Don't leak stack traces, file paths, or internal IDs to unauthenticated users.
- **API response shape:** No fields returned that the caller shouldn't see (e.g., other users' data, internal flags, password hashes).

### Dependencies & Supply Chain

- **New dependencies justified:** Each new package in `package.json`/`requirements.txt`/etc. is necessary and from a reputable source.
- **Version pinning:** New deps are pinned to specific versions (not `*` or `^latest`).
- **Known vulnerabilities:** Run the project's audit command (`npm audit`, `pip-audit`, etc.) — any High/Critical findings must be addressed or documented.
- **Supply chain markers:** Watch for typo-squatting (suspicious near-name packages), recently published packages, and packages with unusual install scripts.

### Codacy SRM Cross-Reference

- **Read tasks.md C5.5 results:** What did Codacy find on the changed files? Are all Critical/High findings addressed (fixed or explicitly waivered with justification)?
- **Look for Codacy blind spots:** Codacy excels at known patterns. It does NOT catch business logic flaws, race conditions, multi-step authorization gaps, or "the right code in the wrong place." Those are this reviewer's job.
- **If C5.5 was skipped:** That's a finding. Security gate cannot be bypassed.

## Output Format

### Strengths

[What's well done? Be specific with file:line references.]

### Issues

#### Critical (Must Fix — blocks PR)

[Bugs, security issues, data loss risks, broken functionality, auth bypasses, injection vectors, secret leaks]

#### Important (Should Fix — blocks PR unless explicitly waived)

[Architecture problems, missing security controls, poor error handling, test gaps, missing validation]

#### Minor (Nice to Have — advisory)

[Code style, optimization opportunities, documentation improvements]

**For each issue:**

- File:line reference
- What's wrong
- Why it matters (especially for security findings — explain the threat model)
- How to fix (if not obvious)

### Security Assessment

**Security review status:** [✅ PASS / ⚠️ FINDINGS / ❌ FAIL]

**Codacy SRM cross-reference:** [Aligned / Discrepancy — explain]

**Threat model coverage:** [Did design.md Security Considerations match what was actually implemented? Any unstated risks?]

### Assessment

**Ready to proceed?** [Yes / No / With fixes]

**Reasoning:** [1-2 sentence technical assessment, including security posture]
