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
index.html            shell, icon sprite, navigation
app.css               design system; tokens mirror the approved comps
app.js                router and chrome
sw.js                 cache-first shell so the list survives a dead signal

lib/model.js          normalization, shelf life, forecast, aisle grouping
lib/recipes.js        stock matching, ranking, what cooking consumes
lib/planning.js       week menu, price history, eating log
lib/github.js         Contents API transport and the job protocol
lib/sync.js           per-entry merges, tombstones, history union
lib/receipt.js        camera, QR, and turning raw lines into stock
lib/vault.js          markdown tables and recipe notes in, structures out
lib/state.js          the single mutable state with an outbox
lib/dom.js            escaping template helper, icons, toasts

screens/*.js          one file per screen: {render, mount, leave, actions}
data-repo-template/   what goes into the private data repo, incl. the workflow
```

Everything under `lib/` is domain logic that touches neither the DOM nor storage, so it can be reasoned about on its own. Screens never compute — they ask.

## Running locally

Any static server works; ES modules need HTTP rather than `file://`.

```bash
npm run serve
```

## Tests

```bash
npm test
```

33 cases over the pure domain modules. Every one is a bug that actually happened or a rule the interface leans on — Russian morphology in recipe matching, median purchase rhythm, mask ordering in receipt normalization, per-entry sync merges. No DOM, no network, no fixtures beyond the seed tables.

## State of things

Thirteen screens are working end to end: the shopping list with aisle grouping and purchase-rhythm reasons, stock sorted by what spoils first, the item card, receipt intake with disputed-line review, the weekly audit, recipes with stock matching, cooking mode that steps the stock down, the week menu, stores with price comparison, the eating log, receipts, and settings.

Still to do: point it at a real GitHub repo and check that the tax service actually publishes line items for the shops you use. Until then the scan screen offers a demonstration receipt so the whole pipeline can be seen without any setup.

First run seeds demo data so the interface can be judged before a single receipt exists.

## Design

Palette "Рынок": dark green is the interface, terracotta is the only action accent, brick red means expiry and nothing else. Icons are inline SVG at a single stroke weight. No external fonts, no CDN, no analytics — the app is fully self-contained.

Specification and decision log live in the owner's vault under `10 - Проекты/Активные/Кухня`.
