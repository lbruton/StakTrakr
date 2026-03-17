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

## 2026-05-23 - Cryptographic Fallback Integrity
**Vulnerability:** Security degradation when `generateUUID` is unavailable and the fallback uses `Math.random()`, undermining the hardening provided by `crypto.randomUUID()` / `crypto.getRandomValues()`.
**Learning:** Fallback implementations for security utilities must preserve the same cryptographic properties as the primary implementation. In a vanilla JS, global-scope architecture, load-order fragility can accidentally route calls to insecure fallbacks, effectively undoing security upgrades even if no runtime errors occur.
**Prevention:** Avoid using weak PRNGs such as `Math.random()` in ID or token generation paths. When designing fallbacks for globals like `generateUUID`, use `crypto.getRandomValues()` directly — it is available in every targeted environment (modern browsers, file:// protocol, Node 15+) and matches the precedent in `cloud-sync.js`.

## 2026-06-25 - Mutation XSS via DOM-based HTML escaping
**Vulnerability:** Mutation XSS (mXSS) risk from using custom DOM-based HTML escaping (`div.textContent = str; return div.innerHTML;`).
**Learning:** Browsers can mutate HTML during the parsing process, introducing mXSS vulnerabilities when using properties like `innerHTML` and `textContent` sequentially. The regex-based `escapeHtml` function provided globally in `js/utils.js` prevents these parsing anomalies.
**Prevention:** Avoid custom DOM-based HTML escaping. Always use the globally available, regex-based `escapeHtml` function defined in `js/utils.js`.

## 2026-06-25 - XSS via Insufficient Attribute Escaping in innerHTML
**Vulnerability:** XSS vulnerability caused by manually escaping quotes (`.replace(/"/g, '&quot;')`) instead of using a comprehensive HTML escaping utility when injecting user-controlled data into HTML attributes via `innerHTML`.
**Learning:** When using template literals and `innerHTML` to construct HTML with dynamic attributes, escaping only double quotes is insufficient. Attackers can inject payloads if they break out of the context or use other HTML special characters.
**Prevention:** Always use robust HTML escaping functions (like the regex-based `escapeHtml` utility in `js/utils.js`) for *all* dynamic content interpolated into HTML strings, particularly when setting HTML element attributes. Even better, avoid `innerHTML` entirely and use DOM methods (`createElement` and `value` property assignment) for dynamically constructing inputs.
