// Pull, merge, push. Merges are per-entry so two people ticking different items
// in the same store never overwrite each other.

import * as gh from "./github.js";
import { get, replace, drainQueue, flush } from "./state.js";
import * as log from "./log.js";

/**
 * Record a flag change with the moment it happened, so a merge can tell an
 * explicit undo from a stale copy. Every place that ticks, unticks, deletes or
 * restores goes through here.
 */
export function mark(entry, flag, value, now = Date.now()) {
  entry[flag] = value;
  entry[`${flag}At`] = now;
  entry.at = now;
  return entry;
}

/**
 * When was this flag last *decided* on this copy? A legacy record carries the
 * flag without a stamp, so its own `at` stands in; a record that never touched
 * the flag has no opinion at all and loses to anyone who does.
 */
function stampOf(entry, flag) {
  const stamp = entry[`${flag}At`];
  if (stamp != null) return stamp;
  return entry[flag] ? entry.at ?? 0 : 0;
}

function resolveFlag(a, b, flag) {
  const sa = stampOf(a, flag);
  const sb = stampOf(b, flag);
  return Boolean(sa >= sb ? a[flag] : b[flag]);
}

/**
 * Union two collections by id, keeping whichever version was touched last —
 * except for the flags, which are resolved by when each side last decided them.
 *
 * Whole-record last-write-wins loses real work: he ticks "молоко — взял" at
 * noon, I change its quantity at one, my record wins entire, and the tick
 * disappears. Making the flags sticky instead fixed that and broke something
 * worse — «Вернуть» could not survive a single round trip, because the remote
 * still said deleted and sticky means deleted always wins. A dozen rows removed
 * by one tap and restored by the next came back deleted and stayed that way.
 *
 * So the flag belongs to whoever touched it last, and an edit that does not
 * touch it has no vote. That keeps the original protection — a quantity change
 * still cannot clear a tick — and lets an explicit undo win, which is the whole
 * reason undo exists.
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
    const done = resolveFlag(entry, rival, "done");
    const deleted = resolveFlag(entry, rival, "deleted");

    // Who ticked it travels with the tick, not with the record: otherwise a
    // quantity edit on my phone rewrites "взяла Аня" into my own name.
    const ticker = stampOf(entry, "done") >= stampOf(rival, "done") ? entry : rival;

    out.set(entry.id, {
      ...win,
      done,
      deleted,
      takenBy: done ? ticker.takenBy ?? null : null,
      takenName: done ? ticker.takenName ?? null : null,
      doneAt: Math.max(entry.doneAt ?? 0, rival.doneAt ?? 0) || undefined,
      deletedAt: Math.max(entry.deletedAt ?? 0, rival.deletedAt ?? 0) || undefined,
      at: Math.max(entry.at ?? 0, rival.at ?? 0),
    });
  }

  return [...out.values()];
}

/**
 * Purchase dates are a set — union and sort, never last-write-wins.
 *
 * But a pure union cannot forget: unticking a row you ticked by mistake removed
 * the date locally, the repository still had it, and the next sync handed it
 * straight back. The forecast then believed in a purchase that never happened
 * and went quiet for a whole cycle. So removals travel too, as their own set of
 * dates, and are subtracted after the union.
 */
export function mergeHistory(mine = {}, theirs = {}, gone = {}) {
  const out = { ...theirs };
  for (const [product, dates] of Object.entries(mine)) {
    out[product] = [...new Set([...(out[product] ?? []), ...dates])].sort((a, b) => a - b);
  }

  for (const [product, dates] of Object.entries(gone)) {
    if (!out[product]) continue;
    const dropped = new Set(dates);
    out[product] = out[product].filter((d) => !dropped.has(d));
    if (!out[product].length) delete out[product];
  }

  return out;
}

/** Union of removals from both sides, pruned like any other tombstone. */
export function mergeGone(mine = {}, theirs = {}, keepDays = 365, now = Date.now()) {
  const cutoff = now - keepDays * 86400000;
  const out = {};

  for (const product of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const dates = [...new Set([...(mine[product] ?? []), ...(theirs[product] ?? [])])]
      .filter((d) => d > cutoff)
      .sort((a, b) => a - b);
    if (dates.length) out[product] = dates;
  }

  return out;
}

/**
 * Deletions travel as tombstones, and syncing is manual — a second device used
 * once a month would arrive with the row still alive and resurrect it. A year
 * of `{id, deleted, at}` records costs nothing next to that.
 */
export function dropTombstones(entries, keepDays = 365, now = Date.now()) {
  const cutoff = now - keepDays * 86400000;
  // The moment of deletion, not the last touch of any kind: a tombstone whose
  // quantity was edited on the way out is still a year-old tombstone.
  return entries.filter((e) => !e.deleted || (e.deletedAt ?? e.at ?? 0) > cutoff);
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

    // Removals go first: the merged history below subtracts them, so writing
    // them second would leave one round trip where the date is back.
    onStep?.("gone");
    const gone = await gh.writeJson(gh.paths.gone, () => state.gone ?? {}, {
      message: "kitchen: снятое",
      merge: (remote) => mergeGone(state.gone ?? {}, remote ?? {}),
    });
    if (gone.skipped) report.skipped += 1;
    else report.pushed += 1;

    onStep?.("history");
    const history = await gh.writeJson(gh.paths.history, () => state.history, {
      message: "kitchen: расход",
      merge: (remote) => mergeHistory(state.history, remote ?? {}, gone.data ?? {}),
    });
    if (history.skipped) report.skipped += 1;
    else report.pushed += 1;

    // Fold the result onto whatever the state is NOW, not onto the snapshot:
    // the same per-entry merge picks up anything ticked while we were away.
    const live = get();
    const next = { ...live };
    for (const [key] of COLLECTIONS) next[key] = dropTombstones(mergeById(live[key] ?? [], merged[key] ?? []));
    next.rules = { ...rules.data, ...live.rules };
    next.gone = mergeGone(live.gone ?? {}, gone.data ?? {});
    next.history = mergeHistory(live.history, history.data ?? {}, next.gone);
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
