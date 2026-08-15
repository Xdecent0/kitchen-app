// Domain tests. Every case here is a bug that actually happened or a rule the
// interface depends on — not coverage for its own sake.
//
// Run: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";

import * as M from "../lib/model.js";
import { sameProduct, findInStock, match, rank, stepDown, lineMatchesProduct } from "../lib/recipes.js";
import { purchaseRhythm } from "../lib/model.js";
import { mergeById, mergeHistory, dropTombstones } from "../lib/sync.js";
import { parseTable, parseShelf, parseSynonyms, parseRecipe } from "../lib/vault.js";
import { priceHistory, bestStore, trackingSummary, weekStart, staples } from "../lib/planning.js";
import { SEED_SHELF, SEED_SYNONYMS, SEED_JUNK, SEED_AISLES } from "../lib/store.js";

const DAY = M.DAY;
const T0 = Date.UTC(2026, 7, 15);
const day = (n) => T0 - n * DAY;

const refs = { rules: {}, synonyms: SEED_SYNONYMS, junk: SEED_JUNK };

/* ---------------------------------------------------------------- receipts */

test("маска синонима переводит кассовую строку в продукт", () => {
  const line = M.normalize("МЛК ПРОСТ 2,5% 900МЛ", refs);
  assert.equal(line.product, "Молоко");
  assert.equal(line.source, "synonym");
  assert.ok(!M.needsReview(line));
});

test("более длинная маска выигрывает у более короткой", () => {
  // Regression: "СЫР" silently swallowed "СЫРОК ГЛАЗИР" until the longer
  // mask was placed above it, which is the ordering rule the reference states.
  assert.equal(M.normalize("СЫРОК ГЛАЗИР ВАН", refs).product, "Глазированный сырок");
  assert.equal(M.normalize("СЫР РОССИЙСКИЙ", refs).product, "Сыр");
});

test("выученное правило бьёт справочник и не переспрашивает", () => {
  const learned = { ...refs, rules: { "МЛК ПРОСТ 2,5% 900МЛ": "Молоко деревенское" } };
  const line = M.normalize("МЛК ПРОСТ 2,5% 900МЛ", learned);
  assert.equal(line.product, "Молоко деревенское");
  assert.equal(line.confidence, 1);
});

test("мусорные строки чека не попадают на склад", () => {
  for (const junk of ["ПАКЕТ МАЙКА", "СКИДКА ПО КАРТЕ", "ИТОГО К ОПЛАТЕ"]) {
    assert.equal(M.normalize(junk, refs).product, null, junk);
  }
});

test("догадка берёт первое слово, а не самое длинное", () => {
  // Regression: the longest-word heuristic turned this into "Клюкв".
  assert.equal(M.normalize("МОРС КЛЮКВ 1Л", refs).product, "Морс");
  assert.equal(M.normalize("ПЕРЕЦ СЛАД ВЕС", refs).product, "Перец");
});

test("неизвестная строка уходит на подтверждение человеку", () => {
  const line = M.normalize("ЩЕРБЕТ АРАХИСОВЫЙ", refs);
  assert.ok(M.needsReview(line), "строка должна попасть в спорные");
  assert.ok(line.confidence < M.CONFIDENCE_FLOOR);
});

/* ------------------------------------------------------------- shelf life */

test("вскрытая упаковка живёт по короткой колонке", () => {
  assert.equal(M.shelfLife("молоко", SEED_SHELF, { opened: false }).days, 10);
  assert.equal(M.shelfLife("молоко", SEED_SHELF, { opened: true }).days, 3);
});

test("один продукт в разных зонах живёт по-разному", () => {
  const fridge = M.shelfLife("куриное филе", SEED_SHELF, { zone: "холодильник" });
  assert.equal(fridge.days, 3);
});

test("продукта нет в справочнике — срок неизвестен, а не выдуман", () => {
  assert.equal(M.shelfLife("щербет", SEED_SHELF, {}), null);
});

test("свежесть падает до нуля и не уходит в минус", () => {
  const item = { product: "Творог", boughtAt: day(9), shelfDays: 5 };
  const f = M.freshness(item, T0);
  assert.equal(f.share, 0);
  assert.equal(f.tone, "bad");
  assert.ok(M.isBurning(item, T0));
});

test("подпись срока склоняется по-русски", () => {
  const at = (left, shelf = 30) => M.expiryLabel({ boughtAt: T0 - (shelf - left) * DAY, shelfDays: shelf }, T0);
  assert.equal(at(0), "сегодня последний день");
  assert.equal(at(1), "до завтра");
  assert.equal(at(2), "2 дня");
  assert.equal(at(5), "5 дней");
  assert.equal(at(21), "21 день");
});

/* ---------------------------------------------------------------- forecast */

test("ритм покупок считается медианой, а не средним", () => {
  // One stock-up trip must not double the estimate for everything else.
  const regular = [day(21), day(18), day(15), day(12)];
  assert.equal(purchaseRhythm(regular), 3);

  const withStockUp = [day(60), day(18), day(15), day(12)];
  assert.equal(purchaseRhythm(withStockUp), 3, "выброс не должен растягивать ритм");
});

test("одной покупки мало, чтобы предсказывать", () => {
  assert.equal(purchaseRhythm([day(3)]), null);
  assert.equal(M.isDue("Молоко", { Молоко: [day(3)] }, T0), false);
});

test("продукт становится нужен, когда просрочен свой ритм", () => {
  const history = { Молоко: [day(12), day(9), day(6), day(3)] };
  assert.equal(M.isDue("Молоко", history, T0), true);
  assert.match(M.dueReason("Молоко", history, T0), /берёшь каждые 3 дня/);
});

/* ------------------------------------------------------------------- list */

test("список раскладывается по отделам в порядке обхода зала", () => {
  const entries = [
    { product: "Хлеб" },
    { product: "Помидоры" },
    { product: "Молоко" },
  ];
  const groups = M.groupByAisle(entries, SEED_AISLES);
  assert.deepEqual(groups.map((g) => g.name), ["овощи", "молочка", "хлеб"]);
});

test("склад сортируется по тому, что испортится первым", () => {
  const items = [
    { id: "a", product: "Рис", boughtAt: day(1), shelfDays: 365 },
    { id: "b", product: "Творог", boughtAt: day(4), shelfDays: 5 },
    { id: "c", product: "Кефир", boughtAt: day(2), shelfDays: 14 },
  ];
  assert.deepEqual(M.sortByUrgency(items, T0).map((i) => i.id), ["b", "c", "a"]);
});

/* ---------------------------------------------------------------- recipes */

test("русская морфология не ломает подбор продуктов", () => {
  // Regression: "яйцо" in a recipe never matched "Яйца" on the shelf,
  // which silently dropped half the suggestions.
  assert.ok(sameProduct("яйцо", "яйца"));
  assert.ok(sameProduct("помидор", "помидоры"));
  assert.ok(!sameProduct("мука", "молоко"));
  assert.ok(!sameProduct("рис", "рыба"));
});

test("продукт со склада с процентами и весом всё равно узнаётся", () => {
  const stock = [{ id: "s1", product: "Творог 5%" }, { id: "s2", product: "Яйца" }];
  assert.equal(findInStock("творог", stock).id, "s1");
  assert.equal(findInStock("яйцо", stock).id, "s2");
});

test("строка чека сопоставляется с позицией склада", () => {
  assert.ok(lineMatchesProduct({ product: "Творог" }, "Творог 5%"));
  assert.ok(!lineMatchesProduct({ product: "Хлеб" }, "Творог 5%"));
});

const RECIPES = [
  {
    id: "r1",
    name: "Сырники",
    minutes: 20,
    ingredients: [{ product: "творог" }, { product: "яйцо" }, { product: "мука" }],
  },
  {
    id: "r2",
    name: "Плов",
    minutes: 60,
    ingredients: [{ product: "рис" }, { product: "баранина" }, { product: "морковь" }, { product: "зира" }],
  },
];

test("спасающий рецепт поднимается выше просто готового", () => {
  const stock = [
    { id: "s1", product: "Творог 5%", boughtAt: day(4), shelfDays: 5 },
    { id: "s2", product: "Яйца", boughtAt: day(1), shelfDays: 25 },
    { id: "s3", product: "Мука", boughtAt: day(1), shelfDays: 365 },
    { id: "s4", product: "Рис", boughtAt: day(1), shelfDays: 365 },
  ];
  const ranked = rank(RECIPES, stock, { now: T0 });
  assert.equal(ranked[0].recipe.id, "r1");
  assert.equal(ranked[0].rescues.length, 1);
});

test("рецепт, где не хватает половины продуктов, не предлагается", () => {
  const stock = [{ id: "s4", product: "Рис", boughtAt: day(1), shelfDays: 365 }];
  const ranked = rank(RECIPES, stock, { now: T0 });
  assert.ok(!ranked.some((r) => r.recipe.id === "r2"), "плов требует трёх покупок — это не подсказка");
});

test("готовка сдвигает остаток по ступеням, а не вычитает граммы", () => {
  assert.equal(stepDown("много"), "на один раз");
  assert.equal(stepDown("на один раз"), "кончился");
  assert.equal(stepDown("кончился"), "кончился");
  assert.equal(stepDown(undefined), "на один раз");
});

test("match честно считает, чего не хватает", () => {
  const stock = [{ id: "s1", product: "Творог 5%" }];
  const m = match(RECIPES[0], stock);
  assert.equal(m.have.length, 1);
  assert.deepEqual(m.missing.map((i) => i.product), ["яйцо", "мука"]);
  assert.equal(m.ready, false);
});

/* ------------------------------------------------------------------- sync */

test("слияние идёт по позициям: двое в магазине не затирают друг друга", () => {
  const mine = [{ id: "a", done: true, at: 200 }, { id: "b", done: false, at: 100 }];
  const theirs = [{ id: "a", done: false, at: 100 }, { id: "c", done: true, at: 150 }];
  const merged = mergeById(mine, theirs);

  assert.equal(merged.length, 3);
  assert.equal(merged.find((e) => e.id === "a").done, true, "выигрывает более поздняя отметка");
  assert.ok(merged.find((e) => e.id === "c"), "чужая позиция не теряется");
});

test("история покупок объединяется, а не перезаписывается", () => {
  const merged = mergeHistory({ Молоко: [1, 3] }, { Молоко: [2, 3], Хлеб: [5] });
  assert.deepEqual(merged["Молоко"], [1, 2, 3]);
  assert.deepEqual(merged["Хлеб"], [5]);
});

test("удаление переживает слияние, но не копится вечно", () => {
  const fresh = { id: "a", deleted: true, at: Date.now() };
  const old = { id: "b", deleted: true, at: Date.now() - 40 * DAY };
  const alive = { id: "c", at: Date.now() };

  const kept = dropTombstones([fresh, old, alive]);
  assert.deepEqual(kept.map((e) => e.id), ["a", "c"]);
});

/* ------------------------------------------------------------------ vault */

test("markdown-таблица из волта читается в структуру", () => {
  const md = `| продукт | зона | закрыт | открыт |\n|---|---|---|---|\n| молоко | холодильник | 10 | 3 |\n| хлеб | полка | 4 | |`;
  const rows = parseTable(md);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["зона"], "холодильник");

  const shelf = parseShelf(md);
  assert.equal(shelf[0].closed, 10);
  assert.equal(shelf[1].opened, null);
});

test("справочник синонимов отдаёт и маски, и мусор", () => {
  const md = `| маска | продукт |\n|---|---|\n| МЛК | молоко |\n\n\`\`\`\nПАКЕТ\nСКИДКА\n\`\`\``;
  const { synonyms, junk } = parseSynonyms(md);
  assert.deepEqual(synonyms, [{ mask: "МЛК", product: "молоко" }]);
  assert.deepEqual(junk, ["ПАКЕТ", "СКИДКА"]);
});

test("заметка рецепта разбирается во frontmatter, продукты и шаги", () => {
  const md = `---\nтип: рецепт\nназвание: Сырники\nвремя: 20 мин\nпорции: 2\n---\n\n# Сырники\n\n## Продукты\n\n- творог — 400 г\n- яйцо — 1 шт\n\n## Шаги\n\n1. Размять творог.\n2. Пожарить.\n`;
  const recipe = parseRecipe("Сырники", md);

  assert.equal(recipe.name, "Сырники");
  assert.equal(recipe.minutes, 20);
  assert.equal(recipe.servings, 2);
  assert.deepEqual(recipe.ingredients, [
    { product: "творог", qty: "400 г" },
    { product: "яйцо", qty: "1 шт" },
  ]);
  assert.deepEqual(recipe.steps, ["Размять творог.", "Пожарить."]);
});

/* --------------------------------------------------------------- planning */

const RECEIPTS = [
  { store: "Пятёрочка", at: day(10), total: 500, lines: [{ product: "Молоко", price: 89 }] },
  { store: "ВкусВилл", at: day(7), total: 400, lines: [{ product: "Молоко", price: 96 }] },
  { store: "Пятёрочка", at: day(3), total: 600, lines: [{ product: "Молоко", price: 91 }] },
];

test("история цен собирается по чекам в хронологии", () => {
  const rows = priceHistory(RECEIPTS, "Молоко");
  assert.deepEqual(rows.map((r) => r.price), [89, 96, 91]);
});

test("дешёвый магазин называется только при наличии сравнения", () => {
  const best = bestStore(RECEIPTS, "Молоко");
  assert.equal(best.store, "Пятёрочка");
  assert.equal(best.saves, 6);

  assert.equal(bestStore(RECEIPTS, "Хлеб"), null, "без наблюдений выводов нет");
  assert.equal(bestStore([RECEIPTS[0], RECEIPTS[2]], "Молоко"), null, "один магазин не с чем сравнивать");
});

test("трекинг считает долю еды дома и траты вне дома", () => {
  const meals = [
    { date: day(1), source: "дома", cost: 0 },
    { date: day(1), source: "заведение", cost: 480 },
    { date: day(2), source: "дома", cost: 0 },
    { date: day(30), source: "доставка", cost: 900 },
  ];
  const s = trackingSummary(meals, 7, T0);

  assert.equal(s.total, 3, "старая доставка вне окна");
  assert.equal(s.spent, 480);
  assert.ok(Math.abs(s.homeShare - 2 / 3) < 0.001);
});

/* -------------------------------------------------------- demo protection */

test("демо-данные опознаются даже без флага", async () => {
  // States saved before the flag existed must still be recognised, or the
  // guard fails exactly for the person who set the app up early.
  const { looksLikeDemo } = await import("../lib/store.js");
  assert.ok(looksLikeDemo({ stock: [{ id: "s1" }, { id: "s2" }], receipts: [{ id: "rc_1" }] }));
  assert.ok(!looksLikeDemo({ stock: [{ id: "s_a1b2" }], receipts: [{ id: "rc_x9" }] }));
  assert.ok(!looksLikeDemo({ stock: [], receipts: [] }));
});

test("опоры считают и записанное руками, и период", () => {
  // Regression: only meals with a product list were counted, so the panel
  // showed "what I cooked from recipes" while calling itself "what I eat" —
  // and it ignored the period selector entirely.
  const meals = [
    { date: day(1), title: "Сырники", products: ["Творог", "Яйца"] },
    { date: day(2), title: "Шаурма" },
    { date: day(3), title: "Шаурма" },
    { date: day(40), title: "Плов" },
  ];

  const week = staples(meals, { days: 7, now: T0 });
  assert.equal(week.find((s) => s.product === "Шаурма").times, 2, "ручные записи считаются");
  assert.ok(!week.some((s) => s.product === "Плов"), "вне периода не попадает");

  const month = staples(meals, { days: 60, now: T0 });
  assert.ok(month.some((s) => s.product === "Плов"), "период управляет выборкой");
});

test("неделя начинается с понедельника", () => {
  const start = weekStart(Date.UTC(2026, 7, 15)); // суббота
  assert.equal(new Date(start).getUTCDay(), 1);
  assert.equal(M.daysBetween(start, Date.UTC(2026, 7, 15)), 5);
});
