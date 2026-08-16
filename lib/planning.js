// Week menu, store profiles with price history, and the eating log.

import * as M from "./model.js";
import { match, shoppingGap } from "./recipes.js";

export const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
export const SLOTS = ["завтрак", "обед", "ужин"];

export function weekStart(now = M.today()) {
  const d = new Date(now);
  const shift = (d.getUTCDay() + 6) % 7;
  return now - shift * M.DAY;
}

export function weekDays(start) {
  return WEEKDAYS.map((label, i) => ({ label, date: start + i * M.DAY, index: i }));
}

export function planFor(menu, date, slot) {
  return menu.find((m) => m.date === date && m.slot === slot) ?? null;
}

/** Everything the planned week needs but the stock does not have. */
export function weekGap(menu, recipes, stock, start) {
  const end = start + 7 * M.DAY;
  const planned = menu
    .filter((m) => m.date >= start && m.date < end)
    .map((m) => recipes.find((r) => r.id === m.recipeId))
    .filter(Boolean);

  return shoppingGap(planned, stock);
}

export function weekCoverage(menu, recipes, stock, start) {
  const end = start + 7 * M.DAY;
  const planned = menu.filter((m) => m.date >= start && m.date < end);
  const slots = 7 * SLOTS.length;

  let ready = 0;
  for (const entry of planned) {
    const recipe = recipes.find((r) => r.id === entry.recipeId);
    if (recipe && match(recipe, stock).ready) ready += 1;
  }

  return { planned: planned.length, slots, ready };
}

/* ---------- stores and prices ---------- */

/** Price history per product per store, newest last. */
export function priceHistory(receipts, product) {
  const key = product.toLowerCase();
  const rows = [];

  for (const receipt of receipts) {
    for (const line of receipt.lines ?? []) {
      if (!line.product || line.product.toLowerCase() !== key) continue;
      rows.push({ store: receipt.store, at: receipt.at, price: line.price });
    }
  }

  return rows.sort((a, b) => a.at - b.at);
}

/** Cheapest store for a product, and by how much — only when there is real evidence. */
export function bestStore(receipts, product, { minObservations = 2 } = {}) {
  const rows = priceHistory(receipts, product);
  if (rows.length < minObservations) return null;

  const byStore = new Map();
  for (const row of rows) {
    // A receipt whose page never named a shop cannot take part in a comparison
    // between shops — lumping the unnamed ones together invented a store.
    if (!row.store) continue;
    if (!byStore.has(row.store)) byStore.set(row.store, []);
    byStore.get(row.store).push(row.price);
  }
  if (byStore.size < 2) return null;

  const avg = [...byStore.entries()]
    .map(([store, prices]) => ({ store, price: prices.reduce((a, b) => a + b, 0) / prices.length, n: prices.length }))
    .sort((a, b) => a.price - b.price);

  const [cheapest, next] = avg;
  return {
    store: cheapest.store,
    price: Math.round(cheapest.price),
    saves: Math.round(next.price - cheapest.price),
    observations: rows.length,
  };
}

/** Split a shopping list across stores by where each product is cheapest. */
export function splitByStore(list, receipts, stores) {
  const fallback = stores[0]?.name ?? "любой";
  const plan = new Map();

  for (const entry of list) {
    const best = bestStore(receipts, entry.product);
    const store = best?.store ?? fallback;
    if (!plan.has(store)) plan.set(store, { store, entries: [], saves: 0 });
    plan.get(store).entries.push({ ...entry, best });
    if (best) plan.get(store).saves += best.saves;
  }

  return [...plan.values()].sort((a, b) => b.entries.length - a.entries.length);
}

export function storeSpend(receipts, store, sinceDays = 30, now = M.today()) {
  const since = now - sinceDays * M.DAY;
  return receipts
    .filter((r) => r.store === store && r.at >= since)
    .reduce((sum, r) => sum + (r.total ?? 0), 0);
}

/* ---------- eating log ---------- */

export const MEAL_SOURCES = ["дома", "заведение", "доставка"];

export function mealsOn(log, date) {
  return log.filter((m) => m.date === date);
}

export function trackingSummary(log, days = 7, now = M.today()) {
  const since = now - (days - 1) * M.DAY;
  const recent = log.filter((m) => m.date >= since);

  const bySource = Object.fromEntries(MEAL_SOURCES.map((s) => [s, 0]));
  let spent = 0;

  for (const meal of recent) {
    bySource[meal.source] = (bySource[meal.source] ?? 0) + 1;
    spent += meal.cost ?? 0;
  }

  const home = bySource["дома"] ?? 0;
  return {
    total: recent.length,
    bySource,
    spent,
    homeShare: recent.length ? home / recent.length : 0,
    days,
  };
}

/**
 * What gets eaten most often — the things worth never running out of.
 *
 * Only meals logged from a recipe carry a product list; anything typed by hand
 * has none. Counting products alone therefore answered "what did I cook from a
 * recipe", not "what do I eat", and quietly excluded most of the log. Hand-typed
 * meals fall back to their own title, which is what the person actually wrote down.
 */
export function staples(log, { limit = 5, days = null, now = M.today() } = {}) {
  const since = days ? now - (days - 1) * M.DAY : -Infinity;
  const counts = new Map();

  for (const meal of log) {
    if (meal.date < since) continue;

    // A dish cooked at home contributes its products; anything else contributes
    // its own name. The distinction matters downstream: "keep this in stock"
    // makes sense for творог and nonsense for «Столовая на работе».
    const kind = meal.products?.length ? "product" : "meal";
    const names = kind === "product" ? meal.products : meal.title ? [meal.title] : [];

    for (const name of names) {
      const seen = counts.get(name) ?? { times: 0, kind, home: true };
      seen.times += 1;
      if (kind === "product") seen.kind = "product";
      if (meal.source && meal.source !== "дома") seen.home = false;
      counts.set(name, seen);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1].times - a[1].times || a[0].localeCompare(b[0], "ru"))
    .slice(0, limit)
    .map(([product, info]) => ({ product, times: info.times, kind: info.kind, home: info.home }));
}
