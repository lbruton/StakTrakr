# STRK-423 — narrow tablet Ledger readability

The 641–800px Ledger uses two grid rows: Slot identity, linked Item and actions above; Paid, Melt, Retail and G/L / best price below. Item names can wrap. Wider tablet/desktop and phone layouts keep their existing arrangement.

Browser regression coverage checks 641, 670 and 700px in dark, light, slate and sepia for Item-name space, clipped cells and overlapping columns. The action-boundary check covers 390, 640, 641, 700, 800, 801, 1024, 1025 and 1280px.

- [641px, dark](ledger-641-dark.png)
- [700px, light](ledger-700-light.png)

Test inventory delta: +1 -0 tests, +0 -0 test files.
