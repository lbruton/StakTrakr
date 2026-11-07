/**
 * Sideways overflow on one surface: body scrollers that scroll sideways, elements that reach
 * past the surface edge, clipped boxes, text cut by an ellipsis, and selects too narrow for
 * their chosen option. Content inside a listed scroll wrapper is exempt; any other box that
 * scrolls sideways is reported with the body scrollers.
 * @param {import('@playwright/test').Page} page - Playwright page.
 * @param {string} rootSelector - CSS selector of the surface root.
 * @param {string[]} bodySelectors - Scrollers inside the root that must never scroll sideways.
 * @param {string[]} [wrapperSelectors] - Wrappers whose content may scroll sideways inside them.
 * @returns {Promise<{tested:number, scrollingBodies:string[], pastEdge:string[], clipped:string[], ellipsis:string[], narrowSelects:string[]}>}
 */
export async function readHorizontalOverflow(
  page,
  rootSelector,
  bodySelectors = [],
  wrapperSelectors = []
) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null))
    )
  );
  return page.locator(rootSelector).evaluate(
    (root, [bodySelectors, wrapperSelectors]) => {
      const shown = (el) =>
        el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
        !el.closest(".sr-only") &&
        !el.closest("[aria-hidden='true']");
      const name = (el) =>
        `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${
          typeof el.className === "string" && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).join(".")}`
            : ""
        }`;
      const bodies = bodySelectors.flatMap((sel) => [
        ...(root.matches(sel) ? [root] : []),
        ...root.querySelectorAll(sel),
      ]);
      const scrollingBodies = bodies
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${name(el)} ${el.scrollWidth - el.clientWidth}px`);

      const scrollsSideways = (el) => /auto|scroll/.test(getComputedStyle(el).overflowX);
      const isWrapper = (el) => wrapperSelectors.some((sel) => el.matches(sel));
      const inOwnScroller = (el) => {
        for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
          if (isWrapper(p)) return true;
        }
        return false;
      };

      const edge = root.getBoundingClientRect();
      const canvas = document.createElement("canvas").getContext("2d");
      const pastEdge = [];
      const clipped = [];
      const ellipsis = [];
      const narrowSelects = [];
      let tested = 0;
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
        if (el.tagName === "OPTION" || !shown(el) || inOwnScroller(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        tested++;
        const style = getComputedStyle(el);
        const over = Math.round(Math.max(r.right - edge.right, edge.left - r.left));
        if (over > 1) pastEdge.push(`${name(el)} ${over}px`);
        if (bodies.includes(el)) continue;
        if (scrollsSideways(el)) {
          if (!isWrapper(el) && el.scrollWidth > el.clientWidth + 1) {
            scrollingBodies.push(`${name(el)} ${el.scrollWidth - el.clientWidth}px`);
          }
          continue;
        }
        const hidden = /hidden|clip/.test(style.overflowX);
        if (style.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) {
          ellipsis.push(name(el));
        } else if (hidden && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) {
          clipped.push(`${name(el)} ${el.scrollWidth - el.clientWidth}px`);
        }
        if (el.tagName === "SELECT" && el.selectedOptions[0]) {
          canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const text = canvas.measureText(el.selectedOptions[0].textContent.trim()).width;
          // The native arrow sits inside the right padding when appearance is none.
          const arrow = style.appearance === "none" ? 0 : 20;
          const room =
            el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - arrow;
          if (text > room + 1) narrowSelects.push(`${name(el)} needs ${Math.ceil(text - room)}px`);
        }
      }
      return { tested, scrollingBodies, pastEdge, clipped, ellipsis, narrowSelects };
    },
    [bodySelectors, wrapperSelectors]
  );
}
