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

/**
 * Learned receipt rules, minus the ones forgotten on purpose.
 *
 * A plain `{...remote, ...local}` cannot express a deletion: the forgotten key is
 * absent locally, so the remote copy wins and «Забыть правило» was undone by the
 * very next round trip. The tombstone is what carries the intent.
 */
export function mergeRules(mine = {}, theirs = {}, gone = {}) {
  const out = { ...theirs, ...mine };
  for (const raw of Object.keys(gone)) delete out[raw];
  return out;
}

/** Timestamped tombstones: the later stamp wins, and stale ones age out. */
export function mergeStamps(mine = {}, theirs = {}, keepDays = 365, now = Date.now()) {
  const cutoff = now - keepDays * 86400000;
  const out = {};

  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const at = Math.max(mine[k] ?? 0, theirs[k] ?? 0);
    if (at > cutoff) out[k] = at;
  }

  return out;
}

/** Both sides observed something surviving that long; the longer observation stands. */
export function mergeLongest(mine = {}, theirs = {}) {
  const out = { ...theirs };
  for (const [k, v] of Object.entries(mine)) out[k] = Math.max(v ?? 0, out[k] ?? 0);
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
/**
 * A finished stock row is only ever flagged `empty` — never removed — so a year
 * of groceries stays in the file at full width forever, and the file is read and
 * rewritten on every single sync. After three months a closed position has
 * nothing left to say, so it becomes an ordinary tombstone: same id, same
 * protection against a stale device resurrecting it, a fraction of the bytes.
 */
export function foldClosed(entries, closedDays = 90, now = Date.now()) {
  const cutoff = now - closedDays * 86400000;

  return entries.map((e) => {
    if (!e.empty || e.deleted) return e;
    const closedAt = e.closedAt ?? e.at ?? 0;
    if (closedAt > cutoff) return e;
    return { id: e.id, deleted: true, deletedAt: closedAt, at: e.at ?? closedAt };
  });
}

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
let lastLook = 0;

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

/**
 * Whether to go and look, having changed nothing ourselves.
 *
 * The per-entry merge was written so two people can shop at once, and the device
 * that is only watching never ran it: the send gate required a non-empty queue,
 * so a phone that had ticked nothing pulled nothing and showed a list frozen at
 * whenever it was last touched. Looking is cheap now that an unchanged
 * collection is not written back, so it can happen on its own — just rarely.
 */
export function shouldAutoPull({ configured, demo, online, busy, lastPull, now, cooldown = 240000 }) {
  if (!configured || demo || busy) return false;
  if (!online) return false;
  return now - lastPull >= cooldown;
}

export function autoSync(state) {
  const now = Date.now();
  const common = {
    configured: gh.isConfigured(),
    demo: Boolean(state.demo),
    online: navigator.onLine,
    busy: syncing(),
    now,
  };

  const sending = shouldAutoSync({ ...common, queued: state.queue.length, lastAttempt: lastTry });
  const looking = !sending && shouldAutoPull({ ...common, lastPull: lastLook });
  if (!sending && !looking) return null;

  lastLook = now;
  if (sending) lastTry = now;
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
            const merged = mergeById(state[key] ?? [], theirs);
            const result = dropTombstones(key === "stock" ? foldClosed(merged) : merged);
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

    onStep?.("rulesGone");
    const rulesGone = await gh.writeJson(gh.paths.rulesGone, () => state.rulesGone ?? {}, {
      message: "kitchen: забытые правила",
      merge: (remote) => mergeStamps(state.rulesGone ?? {}, remote ?? {}),
    });
    if (rulesGone.skipped) report.skipped += 1;
    else report.pushed += 1;

    onStep?.("rules");
    const rules = await gh.writeJson(gh.paths.rules, () => state.rules, {
      message: "kitchen: правила",
      merge: (remote) => mergeRules(state.rules, remote ?? {}, rulesGone.data ?? {}),
    });
    if (rules.skipped) report.skipped += 1;
    else report.pushed += 1;

    onStep?.("shelfLearned");
    const learned = await gh.writeJson(gh.paths.shelfLearned, () => state.shelfLearned ?? {}, {
      message: "kitchen: выученные сроки",
      // The longest observed life wins: both sides are reporting something that
      // actually survived that long, so the larger number is the truer one.
      merge: (remote) => mergeLongest(state.shelfLearned ?? {}, remote ?? {}),
    });
    if (learned.skipped) report.skipped += 1;
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
    for (const [key] of COLLECTIONS) {
      const folded = mergeById(live[key] ?? [], merged[key] ?? []);
      next[key] = dropTombstones(key === "stock" ? foldClosed(folded) : folded);
    }
    next.rulesGone = mergeStamps(live.rulesGone ?? {}, rulesGone.data ?? {});
    next.rules = mergeRules(live.rules, rules.data ?? {}, next.rulesGone);
    next.shelfLearned = mergeLongest(live.shelfLearned ?? {}, learned.data ?? {});
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

const REFERENCE_FILES = {
  shelf: "Справочники/Сроки.md",
  synonyms: "Справочники/Синонимы.md",
  aisles: "Справочники/Отделы.md",
};

/**
 * Reference tables live as markdown in the vault; the app reads them, never writes.
 *
 * Every failure used to look like "нет такого файла": a 401 from an expired
 * token, a 403 from a key scoped to the wrong repository and a genuine 404 all
 * came back as an empty result, and the interface said «Справочники обновлены»
 * regardless. So the outcome is now per file, and it distinguishes read from
 * missing from refused.
 */
export async function pullReferences() {
  const out = {};

  for (const [key, path] of Object.entries(REFERENCE_FILES)) {
    try {
      const file = await gh.readFile(path);
      out[key] = file ? { status: "read", text: file.text } : { status: "missing", path };
    } catch (err) {
      log.fail("справочники", `${path} не прочитан`, err?.message);
      out[key] = { status: "failed", path, error: err?.message ?? "ошибка" };
    }
  }

  return out;
}

/** Recipes are markdown too — one file per dish, front matter plus a body. */
export async function pullRecipes() {
  let entries;
  try {
    entries = await gh.listDir("Рецепты");
  } catch (err) {
    log.fail("рецепты", "папка не прочитана", err?.message);
    return { status: "failed", error: err?.message ?? "ошибка", files: [] };
  }

  if (!entries) return { status: "missing", files: [] };

  const names = entries.filter((e) => e.type === "file" && e.name.endsWith(".md"));
  const files = await Promise.all(
    names.map(async (entry) => {
      const file = await gh.readFile(`Рецепты/${entry.name}`).catch(() => null);
      return { name: entry.name.replace(/\.md$/, ""), text: file?.text ?? "" };
    })
  );

  return { status: "read", files: files.filter((f) => f.text) };
}

/** One sentence about what actually happened, for the interface to say out loud. */
export function referenceReport(refs, recipes) {
  const label = { shelf: "сроки", synonyms: "синонимы", aisles: "отделы" };

  const read = [];
  const missing = [];
  const failed = [];

  for (const [key, res] of Object.entries(refs)) {
    if (res.status === "read") read.push(label[key] ?? key);
    else if (res.status === "missing") missing.push(label[key] ?? key);
    else failed.push(label[key] ?? key);
  }

  if (recipes.status === "read" && recipes.files.length) read.push(`рецепты · ${recipes.files.length}`);
  else if (recipes.status === "failed") failed.push("рецепты");

  if (failed.length) return { tone: "alarm", text: `Не удалось прочитать: ${failed.join(", ")}` };
  if (!read.length) return { tone: "alarm", text: `В репозитории нет ни одного справочника${missing.length ? ` (${missing.join(", ")})` : ""}` };

  const tail = missing.length ? ` · не найдено: ${missing.join(", ")}` : "";
  return { tone: "calm", text: `Прочитано: ${read.join(", ")}${tail}` };
}
