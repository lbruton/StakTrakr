# FAQ — StakTrakr In-App FAQ Management

Update the in-app FAQ in Settings > FAQ. Use when adding, editing, or removing FAQ entries. Triggers on: "faq", "add faq", "update faq", "faq entry", "known limitation", "honest limitation".

---

## Where the FAQ Lives

**Single source:** `index.html` inside `#settingsPanel_faq` (Settings modal > FAQ tab).

There is NO external FAQ file, no GitHub wiki FAQ, no dynamically loaded FAQ. It's all static HTML in `index.html`. The README references it but doesn't duplicate it.

**Access path:** `faq.js` is a shim that redirects `showFaqModal()` to `showSettingsModal('faq')`.

---

## FAQ Structure

The FAQ is organized into collapsible sections using `<details>` + `<summary>` elements:

```html
<!-- Section wrapper -->
<div class="settings-fieldset">
  <div class="settings-fieldset-title">EMOJI Section Name</div>

  <details class="faq-item">
    <summary class="faq-question">Question text here</summary>
    <div class="faq-answer">
      <p>Answer paragraph(s) here.</p>
    </div>
  </details>

  <!-- More faq-item entries... -->
</div>
```

### Current Sections (in order)

| #   | Title               | Line Range | Content                                                                                                   |
| --- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Your Data & Privacy | ~3818      | Who sees data, cookies, tracking, browser history, malware                                                |
| 2   | Backups & Export    | ~3895      | Data export, future-proofing, developer abandonment                                                       |
| 3   | Cloud Storage       | ~3930      | Dropbox visibility, encryption explanation                                                                |
| 4   | Security            | ~3955      | Hacker protection, security practices                                                                     |
| 5   | About the App       | ~3974      | Differentiators, cost/subscriptions                                                                       |
| 6   | Honest Limitations  | ~4010      | localStorage clearing, file:// protocol, no audit, single cloud provider, spot prices, Numista dimensions |
| 7   | More Information    | ~4067      | Resource links (Privacy Policy, Source Code, Community, Changelog)                                        |

**Note:** Line numbers shift as the file grows. Search for the section title text to find the right location.

---

## How to Add a New FAQ Entry

1. **Find the right section** — grep for the section title in `index.html`
2. **Add before the closing `</div>` of that section's `settings-fieldset`:**

```html
<details class="faq-item">
  <summary class="faq-question">Your question here</summary>
  <div class="faq-answer">
    <p>
      Your answer here. Use <strong>bold</strong> for emphasis, <code>code</code> for technical
      terms.
    </p>
    <p>Second paragraph if needed.</p>
  </div>
</details>
```

3. **Use `&mdash;` for em dashes, `&amp;` for ampersands** — standard HTML entities
4. **Commit to the current working branch** (not a separate PR for FAQ-only changes)

### Style Guidelines

- Questions are plain text, no markdown, no HTML tags in `<summary>`
- Answers use `<p>` tags, can include `<ul>`, `<strong>`, `<code>`, `<a>` links
- Keep answers concise — 1-3 paragraphs max
- For technical deep-dives, nest a `<details class="faq-technical">` inside the answer
- Honest Limitations section: frame as factual statements, not apologies

---

## There is Also a Cloud Sync FAQ

A second FAQ panel exists inside the Cloud Sync modal at `#settingsPanel_cloud` (lines ~4986-5065). This covers cloud-specific questions:

- Where is data stored
- Can data be lost
- Cloud provider access
- Disconnect instructions
- External services contacted
- Tracking and hosted version

**Same HTML pattern** (`faq-item` / `faq-question` / `faq-answer`), just located in a different modal section.

---

## What NOT to Do

- Do NOT create a separate FAQ.md file — the FAQ lives in index.html only
- Do NOT try to dynamically load FAQ content — it's static HTML by design
- Do NOT duplicate FAQ entries between the Settings FAQ and the Cloud Sync FAQ
- Do NOT modify `faq.js` — it's just a redirect shim
