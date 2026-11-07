# StakTrakr FAQ

Answers about privacy, backups, Cloud Sync and how the app works. The app carries the full FAQ under Settings → FAQ.

## Your data and privacy

### Who can see my inventory?

Only you. StakTrakr stores your inventory on your own device, in browser localStorage, with photos in IndexedDB. Nothing leaves the device unless you turn on Cloud Sync. Cloud Sync encrypts the data on your device before upload, so Dropbox stores a file it cannot read.

### Can the developer see my data?

No. StakTrakr has no accounts, no user database and no analytics that send inventory data. The app makes these outbound requests, and none of them carry inventory data:

- Spot prices, Market prices and Goldback rates from the StakTrakr API at api.staktrakr.com.
- Spot prices from another provider, if you set one up with your own API key.
- Exchange rates from open.er-api.com.
- Numista and PCGS catalog lookups, when you run one.
- A version check against staktrakr.com/version.json.
- Dropbox, when you connect Cloud Sync.

### Does StakTrakr use cookies or tracking?

StakTrakr sets no cookies and loads no advertising or tracking code. It uses localStorage and IndexedDB only to keep your inventory and settings on your device.

The hosted site at staktrakr.com runs on Cloudflare Pages. Cloudflare Web Analytics counts page views, countries and browser types without cookies or personal profiles. Cloudflare can also set a short-lived bot protection cookie, such as `__cf_bm`. It holds no inventory data, and blocking it does not affect the app. A downloaded copy run from your own computer has no analytics and no cookies.

### What happens if I clear my browser history?

Clearing history leaves your data in place. Clearing site data or browser storage deletes the inventory. Export a backup on a schedule so you keep a copy outside the browser.

### Is the app safe to run?

The full source is public at [github.com/lbruton/StakTrakr](https://github.com/lbruton/StakTrakr). The libraries it uses (Chart.js, PapaParse, jsPDF, JSZip, Forge and LZ-String) ship inside the app. If a local copy fails to load, the app fetches the same version from cdnjs with an integrity check.

## Backups and export

### How do I get my data out?

Open Settings → Inventory and pick a format:

- CSV for Excel, Google Sheets or any spreadsheet app.
- PDF for a printed or archived report.
- ZIP for a full snapshot with settings, which any StakTrakr copy can import.
- Encrypted backup (.stvault) for a password-protected file. Photos save to a second, matching file.

### Will the app keep working in the future?

Yes. StakTrakr runs in the browser and needs no server. A downloaded copy opens offline from `index.html` for as long as browsers support localStorage, IndexedDB and JavaScript. Spot and Market prices need an internet connection.

### What if the developer stops maintaining it?

StakTrakr is open source under the MIT licence. Anyone can fork it and keep it going. Your exports stay readable either way.

## Cloud Sync

### Can Dropbox read my data?

No. StakTrakr encrypts each snapshot in your browser before upload, with AES-256-GCM through the Web Crypto API. The key comes from your vault password and your Dropbox account ID, stretched with PBKDF2-SHA256 over 600,000 iterations. Dropbox receives the ciphertext and a random salt, never the password or the plaintext.

### What if I lose my vault password?

The encrypted data cannot be recovered without it. Keep the password in a password manager.

### Which cloud providers work?

Dropbox is the only active provider. The Cloud tab also shows Google Drive, OneDrive, pCloud and Box as planned providers. They do not connect yet.

## Security

### Is my data safe from hackers?

Your browser keeps each site's storage separate, so other websites cannot read your inventory. The real risks are the same as for any local software. They are malware on the device, extensions with broad permissions and an unlocked device. Keep the OS and browser updated and install only extensions you trust.

### Has StakTrakr had a security audit?

No paid third-party audit has been done. StakTrakr is a one-person project. Every change goes through a pull request with these checks:

- Codacy static analysis, with ESLint and Semgrep rules. The repository holds a Codacy grade of A.
- GitHub CodeQL scans.
- An automated test suite that must pass before a merge.
- Code review from GitHub Copilot, Codex and CodeRabbit.

The encryption code is public, so you can read it yourself.

## About the app

### How is StakTrakr different from other stack trackers?

- Local: your data stays on your device unless you turn on Cloud Sync.
- No account: no email, no sign-up, no profile.
- Open source: anyone can read the code.
- Free: no subscription and no paywall.
- Offline: once loaded, it runs without internet. Prices need a connection.
- Portable: download the ZIP, open `index.html`, and it runs.

### Does it cost anything?

No. Every feature is free with no account. The domain and the hourly spot price service cost money to run. [GitHub Sponsors](https://github.com/sponsors/lbruton) at $1 a month or more helps cover them. The spot service runs on a best-effort basis. If its cost outgrows the support, the service may shrink. The app and Cloud Sync stay free and open source.

### Is a pound troy or avoirdupois?

StakTrakr converts every measured weight to troy oz for storage and melt value. The units mean:

- oz: troy ounce, 31.1035 g. A bar or coin stamped "1 oz" by a mint is troy.
- oz (avdp): avoirdupois ounce, 28.35 g, the ounce a kitchen scale reads. Copper bullion usually sells this way.
- lb: avoirdupois pound, 14.5833 troy oz, for every metal.
- g, mg and kg: metric.

A bar sold as a "troy pound" holds 12 troy oz. Enter it as 12 oz, not 1 lb. Goldback, Silverback and Constitutional silver entries store the denomination or face value and take the metal content from the product spec.

## Known limitations

### Browser storage can be cleared

Clear site data, private windows and iOS Safari storage eviction can each delete localStorage. Safari can evict data from a site you have not opened in a while when the device runs low on space. Export a backup on a schedule, especially on iOS, or turn on Cloud Sync.

### Opening index.html from disk

Some browser setups do not keep localStorage for files opened from disk. If your data does not persist, serve the folder with a local web server, such as `python3 -m http.server`, or use staktrakr.com.

### Spot price is not a dealer price

Spot price is the market price of the metal. Melt value is a reference floor, not a sale price. Dealer prices add premiums and a bid/ask spread. The Market view shows current Vendor prices for common products.

### Numista fills one dimension for bars

For a bar or ingot, a Numista lookup fills the length and leaves the width blank. The Numista API returns one dimension. Enter the width yourself. Later Numista syncs keep the fields you edited.

## Links

[Open StakTrakr](https://www.staktrakr.com) · [Source code](https://github.com/lbruton/StakTrakr) · [Releases](https://github.com/lbruton/StakTrakr/releases) · [Report an issue](https://github.com/lbruton/StakTrakr/issues) · [Privacy policy](https://staktrakr.com/privacy.html) · [GitHub Sponsors](https://github.com/sponsors/lbruton)

Thanks to [r/Silverbugs](https://www.reddit.com/r/Silverbugs/) for the feedback and bug reports that shaped the app.
