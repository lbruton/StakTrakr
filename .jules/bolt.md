## 2026-03-16 - DOM Batch Insertion with DocumentFragment
**Learning:** Appending DOM nodes individually inside a loop triggers layout reflows and repaints for each element, degrading rendering performance in tight UI updates.
**Action:** When creating multiple elements to attach to the same container, always use `document.createDocumentFragment()` as an intermediary. Append all items to the fragment, then append the fragment to the DOM once to reduce repaints from O(N) to O(1).
