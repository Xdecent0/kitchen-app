# Кухня

A shopping list that knows what ran out.

Stock with expiry dates and recipes exist to feed the list with signals — they are not the point. The point is opening the app in a store and seeing what to buy, grouped by aisle, without ever having kept inventory by hand.

## Why it looks like this

No server, no hosting bill, nothing to maintain:

| Piece | Where it lives |
|---|---|
| App | static PWA on GitHub Pages |
| Data | private repo, synced over the GitHub API |
| "Backend" | GitHub Actions, triggered by committing a job file |

The browser cannot reach third-party origins, so anything that needs the outside world (fetching a fiscal receipt from its QR, importing a recipe from a URL) is written as a job into the data repo. An Action picks it up, does the fetch, and commits the answer back. Round trip is about 30 seconds, and the interface says so instead of faking a spinner.

The code repo is public because GitHub Pages on a private repo requires a paid plan. It contains no personal data — not one line.

## Layout

```
index.html      shell and screens
app.css         design system, tokens mirror the approved comps
app.js          state in, DOM out
lib/model.js    normalization, shelf life, forecast, list assembly — pure functions
lib/store.js    local persistence and reference tables
sw.js           cache-first shell so the list survives a dead signal
```

`lib/model.js` holds every domain decision and touches neither the DOM nor storage, so it can be reasoned about and tested on its own.

## Running locally

Any static server works; ES modules need HTTP rather than `file://`.

```bash
python -m http.server 8778 --directory .
```

## State of things

Working: shopping list with aisle grouping and purchase-rhythm reasons, stock sorted by urgency with zone breakdown, offline indicator, empty states, service worker, phone and desktop layouts.

Not yet: GitHub sync, receipt scanning (QR and photo), the weekly audit, recipes.

First run seeds demo data so the interface can be judged before a single receipt exists.

## Design

Palette "Рынок": dark green is the interface, terracotta is the only action accent, brick red means expiry and nothing else. Icons are inline SVG at a single stroke weight. No external fonts, no CDN, no analytics — the app is fully self-contained.

Specification and decision log live in the owner's vault under `10 - Проекты/Активные/Кухня`.
