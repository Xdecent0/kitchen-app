// Recipe domain: what can be cooked right now, what rescues a spoiling product,
// and what cooking a dish does to the stock.

import * as M from "./model.js";

const letters = (s) => String(s).toLowerCase().replace(/[^\p{L}]/gu, "");

/**
 * Russian recipes say "яйцо" where the receipt says "Яйца", so exact matching is
 * useless here. Compare the leading stems and allow the last couple of characters
 * to differ — enough for case and number, not enough to confuse мука with молоко.
 */
export function sameProduct(a, b) {
  const x = letters(a);
  const y = letters(b);
  if (!x || !y) return false;
  if (x === y) return true;

  const n = Math.min(x.length, y.length);
  let i = 0;
  while (i < n && x[i] === y[i]) i += 1;

  return i >= 3 && i >= n - 2;
}

/** Does this receipt line refer to the same thing as this stock item? */
export function lineMatchesProduct(line, product) {
  if (!line?.product || !product) return false;
  const a = line.product.toLowerCase();
  const b = product.toLowerCase();
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return sameProduct(a.split(/[\s,]+/)[0], b.split(/[\s,]+/)[0]);
}

/** Loose product matching — "Творог 5%" in stock should satisfy "творог" in a recipe. */
export function findInStock(ingredient, stock) {
  const key = ingredient.toLowerCase().trim();
  const head = (s) => s.toLowerCase().split(/[\s,]+/)[0];

  return stock.find((entry) => {
    const product = entry.product.toLowerCase();
    if (product.includes(key) || key.includes(head(product))) return true;
    return sameProduct(head(key), head(product));
  });
}

/** How well a recipe is covered by the stock, and what is missing. */
export function match(recipe, stock) {
  const have = [];
  const missing = [];

  for (const ing of recipe.ingredients) {
    const hit = findInStock(ing.product, stock);
    if (hit && !hit.empty) have.push({ ...ing, item: hit });
    else missing.push(ing);
  }

  const total = recipe.ingredients.length;
  return {
    have,
    missing,
    total,
    ready: missing.length === 0,
    share: total ? have.length / total : 0,
  };
}

/** Products in this recipe that are about to spoil — the reason to cook it today. */
export function rescues(recipe, stock, now = M.today()) {
  return match(recipe, stock)
    .have.map((h) => h.item)
    .filter((item) => M.isBurning(item, now));
}

/**
 * Rank recipes: rescuing a spoiling product wins, then completeness, then speed.
 * A recipe missing more than two products is not a suggestion, it is a shopping list.
 */
export function rank(recipes, stock, { maxMissing = 2, now = M.today() } = {}) {
  return recipes
    .map((recipe) => {
      const m = match(recipe, stock);
      const saved = rescues(recipe, stock, now);
      return { recipe, match: m, rescues: saved };
    })
    .filter((r) => r.match.missing.length <= maxMissing)
    .sort((a, b) => {
      if (a.rescues.length !== b.rescues.length) return b.rescues.length - a.rescues.length;
      if (a.match.missing.length !== b.match.missing.length) return a.match.missing.length - b.match.missing.length;
      return (a.recipe.minutes ?? 999) - (b.recipe.minutes ?? 999);
    });
}

export function filterRecipes(ranked, filter) {
  if (filter === "burning") return ranked.filter((r) => r.rescues.length > 0);
  if (filter === "quick") return ranked.filter((r) => (r.recipe.minutes ?? 999) <= 20);
  if (filter === "ready") return ranked.filter((r) => r.match.ready);
  return ranked;
}

/**
 * Cooking consumes ingredients. Quantities in home recipes are not reliable enough
 * to subtract grams, so stock steps down a coarse ladder instead of pretending.
 */
export const LEVELS = ["много", "на один раз", "кончился"];

export function stepDown(level) {
  const i = LEVELS.indexOf(level ?? "много");
  return LEVELS[Math.min(i + 1, LEVELS.length - 1)];
}

export function applyCooking(recipe, stock) {
  const m = match(recipe, stock);
  const touched = [];

  for (const { item } of m.have) {
    const level = stepDown(item.level);
    touched.push({ id: item.id, level, empty: level === "кончился" });
  }

  return touched;
}

/** Ingredients a recipe needs but the stock lacks, ready to drop into the list. */
export function shoppingGap(recipes, stock) {
  const gap = new Map();

  for (const recipe of recipes) {
    for (const ing of match(recipe, stock).missing) {
      const key = ing.product.toLowerCase();
      if (!gap.has(key)) gap.set(key, { product: ing.product, qty: ing.qty, forRecipes: [] });
      gap.get(key).forRecipes.push(recipe.name);
    }
  }

  return [...gap.values()];
}
