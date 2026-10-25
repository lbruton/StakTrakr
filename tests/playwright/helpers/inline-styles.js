/**
 * Lists every inline style property under the given roots that is not in the
 * runtime allowlist, as "<label> <root> <TAG> <property>" strings.
 * @param {import('@playwright/test').Page} page - Page with the markup rendered.
 * @param {{roots: string[], runtime: string[], label: string}} opts - Roots to scan,
 *   allowed property names, and a label naming the rendered state.
 * @returns {Promise<string[]>} Offending properties; empty when the markup is clean.
 */
export const collectInlineStyleOffenders = (page, { roots, runtime, label }) =>
  page.evaluate(
    ({ rootSelectors, allowed, stateLabel }) => {
      const runtimeProps = new Set(allowed);
      const found = [];
      for (const sel of rootSelectors) {
        const root = document.querySelector(sel);
        if (!root) continue;
        for (const el of root.querySelectorAll("[style]")) {
          for (let i = 0; i < el.style.length; i++) {
            const prop = el.style[i];
            if (!runtimeProps.has(prop)) found.push(`${stateLabel} ${sel} <${el.tagName}> ${prop}`);
          }
        }
      }
      return found;
    },
    { rootSelectors: roots, allowed: runtime, stateLabel: label }
  );
