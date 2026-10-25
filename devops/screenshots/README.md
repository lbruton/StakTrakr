# Screenshots

`npm run screenshots` captures every screen in `shots.json` with Playwright. It uses the demo
stack in `demo-data.js` and the API responses recorded in `fixtures/api.har.zip`, so a run makes no
network request and two runs on one build write the same images.

## Commands

| Command                                                 | Writes                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run screenshots`                                   | The site set to `screenshots/`, used by `about.html` and `README.md`              |
| `npm run screenshots -- --set=release --version=vX.Y.Z` | The release set to `docs/announcements/images/vX.Y.Z-<shot>.png` (ignored by git) |
| `npm run screenshots -- --shots=a,b`                    | Only the named shots of the chosen set                                            |
| `npm run screenshots -- --record`                       | Records the live API again, then writes every shot                                |

## Shot entries

Each entry in `shots.json` names the file, the set, the theme, the viewport and the hash route.
`steps` runs in order: `click` and `wait` take a selector, and `call` runs an app function with
`args`. `runStep` in `capture.spec.js` lists the functions a `call` step may name. `target` must be
visible before the capture, so a renamed screen fails the run. `clip` is `viewport`, `element` (the
target only) or `full`.

## Recording

The clock stays at the recording time (`fixtures/recorded.json`), so prices, ages and dates
match the recorded responses. Record again when a new screen calls an endpoint the recording
lacks: the run aborts any request it has no response for.
