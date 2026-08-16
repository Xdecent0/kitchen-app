// Pull, merge, push. Merges are per-entry so two people ticking different items
// in the same store never overwrite each other.

import * as gh from "./github.js";
import { get, replace, drainQueue, flush } from "./state.js";
import * as log from "./log.js";

/**
 * Union two collections by id, keeping whichever version was touched last —
 * except for the flags that must not be undone by an unrelated edit.
 *
 * Whole-record last-write-wins loses real purchases: he ticks "молоко — взял"
 * at noon, I change its quantity at one, my record wins entire, and the tick
 * disappears. So `done` and `deleted` are sticky across a merge; clearing them
 * stays possible on one device, where there is no race to lose.
 */
export function mergeById(mine = [], theirs = []) {
  const out = new Map();
  for (const entry of theirs) out.set(entry.id, entry);

  for (const entry of mine) {
    const rival = out.get(entry.id);
    if (!rival) {
      out.set(entry.id, entry);
      continue;
    }

    const win = (entry.at ?? 0) >= (rival.at ?? 0) ? entry : rival;
    out.set(entry.id, {
      ...win,
      done: Boolean(entry.done || rival.done),
      deleted: Boolean(entry.deleted || rival.deleted),
      at: Math.max(entry.at ?? 0, rival.at ?? 0),
    });
  }

  return [...out.values()];
}

/** Purchase dates are a set — union and sort, never last-write-wins. */
export function mergeHistory(mine = {}, theirs = {}) {
  const out = { ...theirs };
  for (const [product, dates] of Object.entries(mine)) {
    out[product] = [...new Set([...(out[product] ?? []), ...dates])].sort((a, b) => a - b);
  }
  return out;
}

/**
 * Deletions travel as tombstones, and syncing is manual — a second device used
 * once a month would arrive with the row still alive and resurrect it. A year
 * of `{id, deleted, at}` records costs nothing next to that.
 */
export function dropTombstones(entries, keepDays = 365) {
  const cutoff = Date.now() - keepDays * 86400000;
  return entries.filter((e) => !e.deleted || (e.at ?? 0) > cutoff);
}

const COLLECTIONS = [
  ["list", gh.paths.list],
  ["stock", gh.paths.stock],
  ["receipts", gh.paths.receipts],
  ["menu", gh.paths.menu],
  ["meals", gh.paths.meals],
  ["stores", gh.paths.stores],
];

let running = null;
let lastTry = 0;

export function syncing() {
  return running !== null;
}

/**
 * Whether a queued edit should go out on its own. The shop is the one place the
 * list is used for real and the last place anyone will open settings, so the
 * queue has to leave without being asked — but not on every flicker of signal.
 */
export function shouldAutoSync({ configured, demo, queued, online, busy, lastAttempt, now, cooldown = 60000 }) {
  if (!configured || demo || busy) return false;
  if (!queued || !online) return false;
  return now - lastAttempt >= cooldown;
}

export function autoSync(state) {
  const ok = shouldAutoSync({
    configured: gh.isConfigured(),
    demo: Boolean(state.demo),
    queued: state.queue.length,
    online: navigator.onLine,
    busy: syncing(),
    lastAttempt: lastTry,
    now: Date.now(),
  });
  if (!ok) return null;

  lastTry = Date.now();
  return sync().catch(() => null);
}

/**
 * One round trip: every collection is merged remote-into-local and written back.
 * Returns what changed so the UI can say something true instead of "готово".
 */
export async function sync({ onStep } = {}) {
  if (running) return running;
  if (!gh.isConfigured()) throw new Error("нет доступа к репозиторию данных");
  if (get().demo) {
    throw new Error("в приложении демо-данные — очисти их, иначе выдуманный склад уедет в репозиторий");
  }

  running = (async () => {
    // A round trip can take fifteen seconds; anything still only in memory when
    // it starts should be on disk before the tab gets a chance to die.
    flush();
    const state = get();
    const stop = log.time("синк", "круг", { warnAfter: 0 });
    // A round trip is fourteen requests and can take fifteen seconds on a phone
    // in a shop, during which the person keeps ticking things off. Snapshot the
    // queue NOW, so edits made while it runs are not drained as if they synced.
    const ids = state.queue.map((op) => op.id);
    const merged = {};
    const report = { pulled: 0, pushed: 0, skipped: 0, collections: [] };

    for (const [key, path] of COLLECTIONS) {
      onStep?.(key);
      const written = await gh.writeJson(
        path,
        () => state[key],
        {
          message: `kitchen: ${key}`,
          merge: (remote) => {
            const theirs = Array.isArray(remote) ? remote : [];
            const result = dropTombstones(mergeById(state[key] ?? [], theirs));
            if (theirs.length !== result.length) report.pulled += 1;
            return result;
          },
        }
      );

      merged[key] = written.data;
      if (written.skipped) report.skipped += 1;
      else {
        report.pushed += 1;
        report.collections.push(key);
      }
    }

    onStep?.("rules");
    const rules = await gh.writeJson(gh.paths.rules, () => state.rules, {
      message: "kitchen: правила",
      merge: (remote) => ({ ...(remote ?? {}), ...state.rules }),
    });
    if (rules.skipped) report.skipped += 1;
    else report.pushed += 1;

    onStep?.("history");
    const history = await gh.writeJson(gh.paths.history, () => state.history, {
      message: "kitchen: расход",
      merge: (remote) => mergeHistory(state.history, remote ?? {}),
    });
    if (history.skipped) report.skipped += 1;
    else report.pushed += 1;

    // Fold the result onto whatever the state is NOW, not onto the snapshot:
    // the same per-entry merge picks up anything ticked while we were away.
    const live = get();
    const next = { ...live };
    for (const [key] of COLLECTIONS) next[key] = dropTombstones(mergeById(live[key] ?? [], merged[key] ?? []));
    next.rules = { ...rules.data, ...live.rules };
    next.history = mergeHistory(live.history, history.data ?? {});
    next.syncedAt = Date.now();

    replace(next, "sync");
    drainQueue(ids);

    stop({ отправлено: report.pushed, пропущено: report.skipped, подтянуто: report.pulled, очередь: ids.length });
    return report;
  })();

  try {
    return await running;
  } catch (err) {
    log.fail("синк", "круг не прошёл", err?.message);
    throw err;
  } finally {
    running = null;
  }
}

/** Reference tables live as markdown in the vault; the app reads them, never writes. */
export async function pullReferences() {
  const files = {
    shelf: "Справочники/Сроки.md",
    synonyms: "Справочники/Синонимы.md",
    aisles: "Справочники/Отделы.md",
  };

  const out = {};
  for (const [key, path] of Object.entries(files)) {
    const file = await gh.readFile(path).catch(() => null);
    if (file) out[key] = file.text;
  }
  return out;
}

/** Recipes are markdown too — one file per dish, front matter plus a body. */
export async function pullRecipes() {
  const { token, repo, branch = "main" } = gh.config();
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/Рецепты?ref=${branch}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return [];

  const entries = await res.json();
  const files = entries.filter((e) => e.type === "file" && e.name.endsWith(".md"));

  return Promise.all(
    files.map(async (entry) => {
      const file = await gh.readFile(`Рецепты/${entry.name}`);
      return { name: entry.name.replace(/\.md$/, ""), text: file?.text ?? "" };
    })
  );
}
