## 2025-02-18 - PBKDF2 Iterations Upgrade
**Vulnerability:** Weak PBKDF2 iterations (100,000) for password-based encryption.
**Learning:** OWASP recommendations for PBKDF2-HMAC-SHA256 have increased to 600,000 iterations to counter modern GPU-based brute-force capabilities. The original 100,000 count was outdated.
**Prevention:** Regularly review cryptographic parameters against current industry standards (OWASP, NIST). Use versioned file headers (like the `.stvault` format here) to allow seamless upgrades of security parameters without breaking backward compatibility.

## 2026-02-21 - UUID Generation Hardening
**Vulnerability:** Weak random number generation in `generateUUID` fallback.
**Learning:** The implementation was missing the `crypto.getRandomValues()` fallback documented in `AGENTS.md` and jumped straight to `Math.random()` when `crypto.randomUUID()` was unavailable.
**Prevention:** Ensure implementation matches security documentation. Use `crypto.getRandomValues()` as a standard fallback for `crypto.randomUUID()` before resorting to insecure PRNGs.

## 2026-05-22 - OAuth State Predictability
**Vulnerability:** Use of `Date.now()` for OAuth `state` parameter generation.
**Learning:** Using a predictable timestamp for the `state` parameter in OAuth flows significantly weakens protection against CSRF attacks, as an attacker can potentially guess the state.
**Prevention:** Always use a cryptographically secure random string (like a UUID v4) for OAuth state parameters to ensure unpredictability and robust CSRF protection.
