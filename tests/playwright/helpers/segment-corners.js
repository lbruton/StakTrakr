export const SEGMENT_THEMES = ["light", "dark", "slate", "sepia"];

/**
 * Reads the outer corner radii of each segmented toggle that matches a selector.
 * Queries and reads in one evaluation: a re-render between the two would leave detached nodes.
 * @param {import('@playwright/test').Page} page - Browser page.
 * @param {string} scope - CSS selector for the toggle groups to measure.
 * @returns {Promise<Array<{radius: number, overflow: string, first: number[], last: number[]}>>} The group radius and overflow,
 *   then the top and bottom left radii of the first segment and the top and bottom right radii
 *   of the last segment.
 */
export const readSegmentCorners = (page, scope) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].map((group) => {
        const segments = [...group.children].filter((el) => el.classList.contains("chip-sort-btn"));
        const first = getComputedStyle(segments[0]);
        const last = getComputedStyle(segments[segments.length - 1]);
        return {
          radius: parseFloat(getComputedStyle(group).borderTopLeftRadius),
          overflow: getComputedStyle(group).overflowX,
          first: [parseFloat(first.borderTopLeftRadius), parseFloat(first.borderBottomLeftRadius)],
          last: [parseFloat(last.borderTopRightRadius), parseFloat(last.borderBottomRightRadius)],
        };
      }),
    scope
  );
