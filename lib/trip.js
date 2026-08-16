// The shopping trip: what should go in the list, and what the assembled list costs.
// A phone answers "what do I grab next"; a desktop answers "what is going in this
// trip, and where do I drive". These are the numbers behind the second question.

import * as M from "./model.js";
import { bestStore, priceHistory, weekGap } from "./planning.js";
import { isBurning, isDue } from "./model.js";

const key = (s) => String(s ?? "").toLowerCase().trim();

export function inList(list, product) {
  return list.some((e) => !e.deleted && !e.done && key(e.product) === key(product));
}

/**
 * Everything the app already knows should be bought, from three independent
 * sources. Each candidate carries why it is here, because a suggestion without
 * a reason is just noise the person has to re-derive.
 */
export function candidates(state, now = M.today()) {
  const out = { rhythm: [], burning: [], menu: [] };

  for (const product of Object.keys(state.history)) {
    if (inList(state.list, product)) continue;
    if (!isDue(product, state.history, now, state.confirmed)) continue;

    const onShelf = state.stock.find(
      (i) => !i.deleted && !i.empty && key(i.product).includes(key(product))
    );
    // Still on the shelf means the rhythm is early, not that it ran out.
    if (onShelf && !isBurning(onShelf, now)) continue;

    out.rhythm.push({ product, reason: M.dueReason(product, state.history, now) });
  }

  // Grouped by product, not by row: a receipt line becomes a new stock row every
  // time, so three cartons of the same milk used to be three separate suggestions
  // to buy milk.
  const burning = new Map();
  for (const entry of state.stock) {
    if (entry.deleted || entry.empty) continue;
    if (!isBurning(entry, now)) continue;
    if (inList(state.list, entry.product)) continue;

    const k = key(entry.product);
    const found = burning.get(k);
    if (found) {
      found.rows += 1;
      // The one closest to the edge is the reason to act.
      if ((M.freshness(entry, now).left ?? Infinity) < (M.freshness(found.item, now).left ?? Infinity)) {
        found.item = entry;
        found.reason = M.expiryLabel(entry, now);
      }
      continue;
    }
    burning.set(k, { product: entry.product, reason: M.expiryLabel(entry, now), item: entry, rows: 1 });
  }
  out.burning.push(...burning.values());

  const gap = weekGap(state.menu, state.recipes, state.stock.filter((i) => !i.deleted && !i.empty), M.today());
  for (const g of gap) {
    if (inList(state.list, g.product)) continue;
    out.menu.push({ product: g.product, qty: g.qty, reason: g.forRecipes.join(", ") });
  }

  return out;
}

/**
 * What the weekly audit should ask about: stock the app believes is past its
 * shelf life, and products whose purchase rhythm says they ran out. Both need a
 * human yes or no — the app never closes a position on its own.
 *
 * Grouped by product, not by row. A receipt line becomes a new stock row every
 * time, so buying творог weekly leaves four identical rows, and the audit whose
 * whole promise is twenty seconds asked about each one separately. The rows
 * travel with the card so an answer still lands on all of them.
 */
export function auditCandidates(state, now = M.today()) {
  const seen = new Set();
  const byProduct = new Map();

  for (const entry of state.stock) {
    if (entry.deleted || entry.empty) continue;
    const { left } = M.freshness(entry, now);
    if (left == null || left > 0) continue;

    const k = key(entry.product);
    const found = byProduct.get(k);
    if (found) found.items.push(entry);
    else byProduct.set(k, { kind: "stock", id: entry.id, product: entry.product, item: entry, items: [entry] });
    seen.add(k);
  }

  const out = [...byProduct.values()];

  for (const product of Object.keys(state.history)) {
    if (seen.has(key(product))) continue;
    if (!isDue(product, state.history, now, state.confirmed)) continue;

    const inStock = state.stock.filter((i) => !i.deleted && !i.empty && key(i.product).includes(key(product)));
    // Derived from the product, not random: the same card keeps the same id
    // across re-renders, which is what a cursor into this list depends on.
    out.push({ kind: "rhythm", id: `a_${key(product)}`, product, item: inStock[0] ?? null, items: inStock });
  }

  return out;
}

export function candidateCount(sources) {
  return sources.rhythm.length + sources.burning.length + sources.menu.length;
}

/** Last known price for a product, whatever store it came from. */
export function lastPrice(receipts, product) {
  const rows = priceHistory(receipts, product);
  return rows.length ? rows[rows.length - 1].price : null;
}

/**
 * Group the live list the way the trip will actually be driven. Until receipts
 * show a real price difference there is nothing to split by, so the grouping
 * falls back to store aisles — the honest answer being "I don't know yet".
 */
export function tripPlan(state) {
  const entries = state.list.filter((e) => !e.deleted);
  const pending = entries.filter((e) => !e.done);

  const priced = pending.map((entry) => {
    const best = bestStore(state.receipts, entry.product);
    return { entry, best, price: best?.price ?? lastPrice(state.receipts, entry.product) };
  });

  const known = priced.filter((p) => p.best);
  const byStore = new Map();

  for (const row of priced) {
    const store = row.best?.store ?? null;
    if (!byStore.has(store)) byStore.set(store, { store, rows: [], saves: 0 });
    byStore.get(store).rows.push(row);
    byStore.get(store).saves += row.best?.saves ?? 0;
  }

  const groups = [...byStore.values()].sort((a, b) => {
    if (a.store === null) return 1;
    if (b.store === null) return -1;
    return b.rows.length - a.rows.length;
  });

  return {
    entries,
    pending,
    done: entries.filter((e) => e.done),
    groups,
    byStoreKnown: known.length,
    canSplit: groups.filter((g) => g.store !== null).length > 1,
    expected: priced.reduce((sum, p) => sum + (p.price ?? 0), 0),
    unpriced: priced.filter((p) => p.price == null).length,
    saves: groups.reduce((sum, g) => sum + g.saves, 0),
  };
}

/**
 * The one sentence the desktop list exists to answer. Deliberately admits
 * ignorance instead of printing a confident total built from three prices.
 */
export function tripAnswer(plan, currency = "₴") {
  if (!plan.pending.length) {
    return plan.entries.length
      ? { value: "Всё взято", note: `${plan.done.length} ${M.plural(plan.done.length, "позиция", "позиции", "позиций")} отмечено — список можно очистить` }
      : { value: "Список пуст", note: "Слева то, что приложение предлагает добавить" };
  }

  if (!plan.expected) {
    return {
      value: String(plan.pending.length),
      unit: M.plural(plan.pending.length, "позиция", "позиции", "позиций"),
      note: "Цены появятся, когда отсканируешь пару чеков — тогда здесь будет сумма",
    };
  }

  const note = plan.unpriced
    ? `${plan.pending.length - plan.unpriced} из ${plan.pending.length} по последним ценам, остальные ещё не встречались`
    : plan.canSplit && plan.saves
      ? `разделить по магазинам — дешевле на ${Math.round(plan.saves)} ${currency}`
      : `${plan.pending.length} ${M.plural(plan.pending.length, "позиция", "позиции", "позиций")} по последним ценам`;

  return { value: Math.round(plan.expected).toLocaleString("ru"), unit: currency, note, money: plan.expected };
}
