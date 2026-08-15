// Pull, merge, push. Merges are per-entry so two people ticking different items
// in the same store never overwrite each other.

import * as gh from "./github.js";
import { get, replace, drainQueue } from "./state.js";

/** Union two collections by id, keeping whichever version was touched last. */
export function mergeById(mine = [], theirs = []) {
  const out = new Map();
  for (const entry of theirs) out.set(entry.id, entry);

  for (const entry of mine) {
    const rival = out.get(entry.id);
    if (!rival) out.set(entry.id, entry);
    else out.set(entry.id, (entry.at ?? 0) >= (rival.at ?? 0) ? entry : rival);
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

/** Deletions must survive a merge, so they travel as tombstones rather than absence. */
export function dropTombstones(entries, keepDays = 30) {
  const cutoff = Date.now() - keepDays * 86400000;
  return entries.filter((e) => !e.deleted || (e.at ?? 0) > cutoff);
}

const COLLECTIONS = [
  ["list", gh.paths.list],
  ["stock", gh.paths.stock],
  ["menu", gh.paths.menu],
  ["meals", gh.paths.meals],
  ["stores", gh.paths.stores],
];

let running = null;

export function syncing() {
  return running !== null;
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
    const state = get();
    const next = { ...state };
    const report = { pulled: 0, pushed: 0, collections: [] };

    for (const [key, path] of COLLECTIONS) {
      onStep?.(key);
      const merged = await gh.writeJson(
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

      next[key] = merged.data;
      report.pushed += 1;
      report.collections.push(key);
    }

    onStep?.("rules");
    const rules = await gh.writeJson(gh.paths.rules, () => state.rules, {
      message: "kitchen: правила",
      merge: (remote) => ({ ...(remote ?? {}), ...state.rules }),
    });
    next.rules = rules.data;

    onStep?.("history");
    const history = await gh.writeJson(gh.paths.history, () => state.history, {
      message: "kitchen: расход",
      merge: (remote) => mergeHistory(state.history, remote ?? {}),
    });
    next.history = history.data;

    next.syncedAt = Date.now();
    const ids = state.queue.map((op) => op.id);
    replace(next, "sync");
    drainQueue(ids);

    return report;
  })();

  try {
    return await running;
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
