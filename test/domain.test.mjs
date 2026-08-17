// Domain tests. Every case here is a bug that actually happened or a rule the
// interface depends on — not coverage for its own sake.
//
// Run: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";

import * as M from "../lib/model.js";
import { sameProduct, findInStock, match, rank, stepDown, lineMatchesProduct } from "../lib/recipes.js";
import { purchaseRhythm } from "../lib/model.js";
import { mergeById, mergeHistory, mergeGone, dropTombstones, shouldAutoSync, shouldAutoPull, referenceReport, mergeRules, mergeStamps, mergeLongest, foldClosed } from "../lib/sync.js";
import { unchanged } from "../lib/github.js";
import { candidates } from "../lib/trip.js";
import { encodePairing, parsePairing } from "../lib/pair.js";
import { encode, versionFor } from "../lib/qr.js";
import * as M_MONEY from "../lib/money.js";
import * as log from "../lib/log.js";
import { parseTable, parseShelf, parseSynonyms, parseRecipe } from "../lib/vault.js";
import { toStockItem } from "../lib/receipt.js";
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

test("подтверждение «ещё есть» замолкает на цикл, а не навсегда", () => {
  // Without this the audit asks the same question every week while its summary
  // claims the forecast moved.
  const history = { Молоко: [day(12), day(9), day(6), day(3)] };
  assert.equal(M.isDue("Молоко", history, T0), true);
  assert.equal(M.isDue("Молоко", history, T0, { Молоко: day(1) }), false, "подтвердили вчера");
  assert.equal(M.isDue("Молоко", history, T0, { Молоко: day(5) }), true, "цикл прошёл — спрашиваем снова");
});

test("сезонный продукт не всплывает через полгода", () => {
  // A watermelon bought every four days in July must not arrive in December
  // announcing that it ran out 124 days ago.
  const history = { Арбуз: [day(160), day(156), day(152), day(148)] };
  assert.equal(M.isDue("Арбуз", history, T0), false);
});

test("пропущенная строка чека не считается добавленной", async () => {
  const { summarize } = await import("../lib/receipt.js");
  const parsed = {
    accepted: [{ product: "Молоко" }, { product: "Хлеб" }],
    disputed: [{ product: "Щербет" }, { raw: "ЩЕРБЕТ", product: null }],
    discarded: [{ product: null }],
  };
  const s = summarize(parsed, { listRemoved: 0, learned: [] });

  assert.equal(s.added, 3, "две принятые плюс одна подтверждённая");
  assert.equal(s.discarded, 2, "пропущенная уходит к отброшенным");
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

test("слияние не отменяет чужую покупку и не воскрешает удалённое", async () => {
  // Whole-record last-write-wins lost real purchases: he ticks "взял" at noon,
  // I edit the quantity at one, my record wins entire and the tick vanishes.
  const ticked = { id: "a", done: true, qty: "1 л", at: 100 };
  const edited = { id: "a", qty: "2 л", at: 200 };
  const [merged] = mergeById([edited], [ticked]);

  assert.equal(merged.done, true, "покупка не отменяется правкой количества");
  assert.equal(merged.qty, "2 л", "остальные поля берутся у более поздней записи");

  const grave = { id: "b", deleted: true, at: 100 };
  const touched = { id: "b", qty: "3", at: 300 };
  const [afterGrave] = mergeById([touched], [grave]);
  assert.equal(afterGrave.deleted, true, "надгробие переживает правку");
});

test("очередь уходит сама, но не на каждое дрожание сети", async () => {
  const { shouldAutoSync } = await import("../lib/sync.js");
  const base = { configured: true, demo: false, queued: 3, online: true, busy: false, lastAttempt: 0, now: 120000 };

  assert.equal(shouldAutoSync(base), true);
  assert.equal(shouldAutoSync({ ...base, configured: false }), false, "без репозитория некуда");
  assert.equal(shouldAutoSync({ ...base, demo: true }), false, "демо не уезжает");
  assert.equal(shouldAutoSync({ ...base, queued: 0 }), false, "нечего отправлять");
  assert.equal(shouldAutoSync({ ...base, online: false }), false, "офлайн");
  assert.equal(shouldAutoSync({ ...base, busy: true }), false, "обмен уже идёт");
  assert.equal(shouldAutoSync({ ...base, lastAttempt: 100000 }), false, "минута не прошла");
});

test("история покупок объединяется, а не перезаписывается", () => {
  const merged = mergeHistory({ Молоко: [1, 3] }, { Молоко: [2, 3], Хлеб: [5] });
  assert.deepEqual(merged["Молоко"], [1, 2, 3]);
  assert.deepEqual(merged["Хлеб"], [5]);
});

test("надгробие живёт год, потому что синк ручной", () => {
  // A second device used once a month would arrive with the row still alive and
  // resurrect it, so tombstones have to outlast the gap between syncs — thirty
  // days was shorter than that gap, not longer.
  const fresh = { id: "a", deleted: true, at: Date.now() };
  const twoMonths = { id: "b", deleted: true, at: Date.now() - 60 * DAY };
  const ancient = { id: "c", deleted: true, at: Date.now() - 400 * DAY };
  const alive = { id: "d", at: Date.now() };

  const kept = dropTombstones([fresh, twoMonths, ancient, alive]);
  assert.deepEqual(kept.map((e) => e.id), ["a", "b", "d"]);
});

test("экспорт списка не выдумывает того, чего не знает", async () => {
  const S = await import("../lib/share.js");
  const entries = [
    { id: "1", product: "Молоко", qty: "2 л", price: 89 },
    { id: "2", product: "Хлеб", qty: "", price: null },
    { id: "3", product: "Творог", qty: "", done: true, price: 212 },
  ];

  const checklist = S.render(entries, { currency: "₴" });
  assert.match(checklist, /☐ Молоко · 2 л/);
  assert.match(checklist, /☑ Творог/, "взятое уходит вниз отдельным блоком");
  assert.ok(!checklist.includes("₴"), "в чек-листе цен нет");

  const receipt = S.render(entries, { style: "receipt", currency: "₴", aisles: SEED_AISLES });
  assert.match(receipt, /Молоко · 2 л · 89 ₴/);
  assert.match(receipt, /^\s*Хлеб\s*$/m, "без известной цены строка идёт без неё");
  assert.match(receipt, /Итого 89 ₴/, "итог считается только по известным ценам");

  assert.equal(S.render([], {}), "Список покупок\n— пусто");
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

test("место, где ты ел, не предлагается держать дома", () => {
  // "Чем питаешься чаще всего" counts anything logged, which is right for the
  // question; "держать всегда" is a different question, and «Столовая на
  // работе» is not a product you can keep in a fridge.
  const meals = [
    { date: day(1), title: "Сырники", source: "дома", products: ["Творог", "Яйца"] },
    { date: day(2), title: "Столовая на работе", source: "заведение", cost: 480 },
    { date: day(3), title: "Пицца", source: "доставка", cost: 890 },
  ];

  const all = staples(meals, { days: 7, now: T0, limit: 10 });
  const keepable = all.filter((s) => s.kind === "product" && s.home);

  assert.deepEqual(keepable.map((s) => s.product).sort(), ["Творог", "Яйца"]);
  assert.ok(all.some((s) => s.product === "Пицца"), "но в «чем питаешься» она остаётся");
});

test("неделя начинается с понедельника", () => {
  const start = weekStart(Date.UTC(2026, 7, 15)); // суббота
  assert.equal(new Date(start).getUTCDay(), 1);
  assert.equal(M.daysBetween(start, Date.UTC(2026, 7, 15)), 5);
});

/* ---------- запись наружу: что не изменилось, то не пишется ---------- */

test("одинаковое содержимое не переписывается", () => {
  // Каждый синк писал все восемь файлов, даже когда ничего не менялось:
  // восемь запросов в лимит и восемь пустых коммитов в истории, которую
  // человек читает глазами.
  const text = JSON.stringify({ a: 1, b: [2, 3] }, null, 2);

  assert.equal(unchanged(text, text), true, "байт в байт");
  assert.equal(unchanged(`${text}\n`, text), true, "перевод строки в конце — не содержимое");
  assert.equal(unchanged(null, text), false, "файла ещё нет — писать надо");
});

test("порядок ключей и отступы не считаются изменением", () => {
  // Состав чека пишет Action на питоне, а состояние — браузер. Один и тот же
  // объект приходит с другим порядком ключей, и посимвольное сравнение решило
  // бы, что файл изменился, — снова коммит на пустом месте.
  const mine = JSON.stringify({ product: "Молоко", price: 89 }, null, 2);
  const theirs = '{"price": 89, "product": "Молоко"}';

  assert.equal(unchanged(theirs, mine), true);
  assert.equal(unchanged('{"price": 96, "product": "Молоко"}', mine), false, "цена другая — это изменение");
});

test("порядок в массиве — это содержимое", () => {
  // Отделы упорядочены обходом зала; переставленные строки менять надо.
  const mine = JSON.stringify([{ n: 1 }, { n: 2 }], null, 2);
  assert.equal(unchanged(JSON.stringify([{ n: 2 }, { n: 1 }]), mine), false);
});

test("нечитаемый remote не выдаётся за совпадение", () => {
  // Иначе битый файл в репозитории тихо блокировал бы любую запись поверх.
  assert.equal(unchanged("{не json", "{}"), false);
});

/* ---------- журнал ---------- */

test("журнал не растёт бесконечно", () => {
  log.clear();
  for (let i = 0; i < 450; i += 1) log.info("тест", `строка ${i}`);

  const all = log.entries();
  assert.equal(all.length, 400, "кольцо обрезается до потолка");
  assert.equal(all.at(-1).m, "строка 449", "последняя запись — самая свежая");
  assert.equal(all[0].m, "строка 50", "самые старые вытеснены");
});

test("журнал считает отдельно сбои и предупреждения", () => {
  log.clear();
  log.info("тест", "обычное");
  log.warn("тест", "медленно");
  log.fail("тест", "сломалось");

  assert.deepEqual(log.counts(), { all: 3, warn: 1, fail: 1 });
  assert.deepEqual(log.entries({ level: "e" }).map((e) => e.m), ["сломалось"]);
  assert.deepEqual(log.entries({ src: "другое" }), [], "фильтр по источнику");
});

test("длинная нагрузка обрезается, а не роняет запись", () => {
  // Стек ошибки или тело ответа GitHub легко на килобайты — журнал делит
  // квоту с самими данными, и данные важнее.
  log.clear();
  log.fail("тест", "ошибка", { stack: "x".repeat(5000) });

  const entry = log.entries().at(-1);
  assert.ok(entry.d.length <= 241, `нагрузка обрезана, а не ${entry.d.length}`);
  assert.ok(entry.d.endsWith("…"), "видно, что обрезано");
});

test("журнал отдаётся текстом для пересылки", () => {
  log.clear();
  log.warn("синк", "круг · 4200 мс", "квота 58");

  const text = log.asText();
  assert.match(text, /W \[синк\] круг · 4200 мс — квота 58/);
});

/* ---------- дубли склада ---------- */

test("три пакета одного молока — одно предложение, а не три", () => {
  // Строка чека заводит новую запись склада каждый раз, поиска существующей нет.
  // Значит еженедельная покупка молока к месяцу даёт четыре записи, и список
  // предлагал купить молоко четырежды подряд.
  const state = {
    list: [],
    history: {},
    confirmed: {},
    menu: [],
    recipes: [],
    stock: [
      { id: "a", product: "Молоко 2,5%", boughtAt: day(10), shelfDays: 10 },
      { id: "b", product: "Молоко 2,5%", boughtAt: day(11), shelfDays: 10 },
      { id: "c", product: "Молоко 2,5%", boughtAt: day(9), shelfDays: 10 },
    ],
  };

  const c = candidates(state, T0);
  assert.equal(c.burning.length, 1, "одна карточка на продукт");
  assert.equal(c.burning[0].rows, 3, "но видно, что записей три");
  assert.equal(c.burning[0].item.id, "b", "показывается та, что ближе всех к краю");
});

test("разные продукты не схлопываются", () => {
  const state = {
    list: [],
    history: {},
    confirmed: {},
    menu: [],
    recipes: [],
    stock: [
      { id: "a", product: "Молоко", boughtAt: day(9), shelfDays: 10 },
      { id: "b", product: "Кефир", boughtAt: day(13), shelfDays: 14 },
    ],
  };

  assert.equal(candidates(state, T0).burning.length, 2);
});

/* ---------- отмена против репозитория ---------- */

test("«Вернуть» переживает круг синхронизации", () => {
  // Раньше deleted был липким: remote всё ещё говорил «удалено», липкость
  // означала «удалено побеждает всегда» — и дюжина строк, убранных одним тапом
  // и возвращённых следующим, возвращалась удалённой. Навсегда.
  const remote = [{ id: "l1", product: "Молоко", deleted: true, deletedAt: 1000, at: 1000 }];
  const mine = [{ id: "l1", product: "Молоко", deleted: false, deletedAt: 2000, at: 2000 }];

  const merged = mergeById(mine, remote);
  assert.equal(merged[0].deleted, false, "последнее слово за отменой");
});

test("правка количества не снимает чужую галочку", () => {
  // Ради чего липкость и вводилась: он отмечает «взял» в полдень, я в час меняю
  // количество, и запись целиком выигрывает мою — вместе с отсутствующей галкой.
  const his = [{ id: "l1", product: "Молоко", done: true, doneAt: 1200, at: 1200 }];
  const myEdit = [{ id: "l1", product: "Молоко", qty: "2 л", done: false, at: 1300 }];

  const merged = mergeById(myEdit, his);
  assert.equal(merged[0].done, true, "правка без касания галочки не голосует");
  assert.equal(merged[0].qty, "2 л", "но сама правка доезжает");
});

test("снятая вручную галочка побеждает старую отметку", () => {
  const stale = [{ id: "l1", done: true, doneAt: 1000, at: 1000 }];
  const untick = [{ id: "l1", done: false, doneAt: 3000, at: 3000 }];

  assert.equal(mergeById(untick, stale)[0].done, false);
  assert.equal(mergeById(stale, untick)[0].done, false, "порядок аргументов не решает");
});

test("старые записи без меток времени продолжают работать", () => {
  // Всё, что уже лежит в репозитории, метки не имеет — для них решает entry.at.
  const legacy = [{ id: "l1", done: true, at: 500 }];
  const fresh = [{ id: "l1", done: false, at: 100 }];

  assert.equal(mergeById(legacy, fresh)[0].done, true);
});

test("имя того, кто взял, едет вместе с галочкой, а не с записью", () => {
  const hers = [{ id: "l1", done: true, doneAt: 1200, at: 1200, takenBy: "me_anna", takenName: "Аня" }];
  const myEdit = [{ id: "l1", qty: "2 л", done: false, at: 1300 }];

  const merged = mergeById(myEdit, hers);
  assert.equal(merged[0].takenName, "Аня", "правка количества не переписывает автора отметки");
});

test("надгробие считается от момента удаления, а не последнего касания", () => {
  const now = Date.UTC(2026, 7, 15);
  const old = now - 400 * DAY;
  const entries = [
    { id: "a", deleted: true, deletedAt: old, at: now },
    { id: "b", deleted: true, deletedAt: now - 10 * DAY, at: now },
  ];

  assert.deepEqual(dropTombstones(entries, 365, now).map((e) => e.id), ["b"]);
});

/* ---------- история покупок ---------- */

test("снятая отметка не возвращается из репозитория", () => {
  // Чистое объединение множеств не умеет забывать: дата уезжала в репозиторий,
  // снятие вычитало её только локально, и следующий синк возвращал её обратно.
  const mine = { Молоко: [day(9), day(3)] };
  const theirs = { Молоко: [day(9), day(6), day(3)] };
  const gone = { Молоко: [day(6)] };

  assert.deepEqual(mergeHistory(mine, theirs, gone).Молоко, [day(9), day(3)].sort((a, b) => a - b));
});

test("объединение без снятого остаётся объединением", () => {
  const merged = mergeHistory({ Хлеб: [day(4)] }, { Хлеб: [day(7)] });
  assert.deepEqual(merged.Хлеб, [day(7), day(4)].sort((a, b) => a - b));
});

test("продукт исчезает из истории, когда снято всё", () => {
  const merged = mergeHistory({ Морс: [day(2)] }, { Морс: [day(2)] }, { Морс: [day(2)] });
  assert.ok(!("Морс" in merged), "пустой хвост не остаётся ключом");
});

test("снятое подрезается по возрасту, как любое надгробие", () => {
  const now = Date.UTC(2026, 7, 15);
  const merged = mergeGone({ Молоко: [now - 400 * DAY, now - 10 * DAY] }, {}, 365, now);
  assert.deepEqual(merged.Молоко, [now - 10 * DAY]);
});

/* ---------- честность отчёта по справочникам ---------- */

test("отказ доступа не выдаётся за отсутствие файла", () => {
  // 401 от протухшего токена, 403 от ключа не на тот репозиторий и настоящий
  // 404 приходили одинаково — пустотой, — а интерфейс в любом случае говорил
  // «Справочники обновлены», и человек шёл искать ошибку в таблице, которую
  // приложение не читало.
  const refs = {
    shelf: { status: "failed", error: "401" },
    synonyms: { status: "read", text: "" },
    aisles: { status: "missing" },
  };

  const r = referenceReport(refs, { status: "read", files: [] });
  assert.equal(r.tone, "alarm");
  assert.match(r.text, /Не удалось прочитать: сроки/);
});

test("прочитанное называется поимённо, ненайденное — отдельно", () => {
  const refs = {
    shelf: { status: "read", text: "" },
    synonyms: { status: "read", text: "" },
    aisles: { status: "missing" },
  };

  const r = referenceReport(refs, { status: "read", files: [{ name: "Сырники", text: "x" }] });
  assert.equal(r.tone, "calm");
  assert.match(r.text, /Прочитано: сроки, синонимы, рецепты · 1/);
  assert.match(r.text, /не найдено: отделы/);
});

test("пустой репозиторий не выдаётся за успех", () => {
  const refs = {
    shelf: { status: "missing" },
    synonyms: { status: "missing" },
    aisles: { status: "missing" },
  };

  assert.equal(referenceReport(refs, { status: "missing", files: [] }).tone, "alarm");
});

/* ---------- наблюдающее устройство ---------- */

test("устройство без своих правок всё равно ходит смотреть", () => {
  // Раньше гейт отправки требовал непустую очередь, поэтому телефон, который
  // ничего не менял, не подтягивал ничего: весь пер-записный merge, написанный
  // ради двоих в магазине, у второго не запускался ни разу.
  const base = { configured: true, demo: false, online: true, busy: false, now: 1_000_000 };

  assert.equal(shouldAutoSync({ ...base, queued: 0, lastAttempt: 0 }), false, "отправлять нечего");
  assert.equal(shouldAutoPull({ ...base, lastPull: 0 }), true, "а посмотреть — есть зачем");
});

test("смотреть — реже, чем отправлять", () => {
  const base = { configured: true, demo: false, online: true, busy: false, now: 1_000_000 };
  assert.equal(shouldAutoPull({ ...base, lastPull: base.now - 120_000 }), false, "две минуты назад — рано");
  assert.equal(shouldAutoPull({ ...base, lastPull: base.now - 300_000 }), true, "пять минут — пора");
});

test("демо наружу не ходит ни при каких условиях", () => {
  const base = { configured: true, demo: true, online: true, busy: false, now: 1_000_000, lastPull: 0 };
  assert.equal(shouldAutoPull(base), false);
});

/* ---------- забытое правило и выученные сроки ---------- */

test("забытое правило не воскресает на следующем круге", () => {
  // {...remote, ...local} не умеет выражать удаление: забытого ключа локально
  // нет, поэтому побеждала копия из репозитория — и «Забыть правило» отменялось
  // первым же синком.
  const local = { "МЛК ПРОСТ": "Молоко" };
  const remote = { "МЛК ПРОСТ": "Молоко", "СЫРОК ГЛАЗИР": "Глазированный сырок" };
  const gone = { "СЫРОК ГЛАЗИР": 2000 };

  const merged = mergeRules(local, remote, gone);
  assert.deepEqual(Object.keys(merged), ["МЛК ПРОСТ"]);
});

test("локальное правило бьёт удалённое при одном и том же ключе", () => {
  const merged = mergeRules({ "МЛК": "Молоко деревенское" }, { "МЛК": "Молоко" });
  assert.equal(merged["МЛК"], "Молоко деревенское");
});

test("выученный срок берётся самый длинный из наблюдавшихся", () => {
  // Обе стороны сообщают о продукте, который реально столько прожил.
  assert.deepEqual(mergeLongest({ Сыр: 70 }, { Сыр: 45, Творог: 6 }), { Сыр: 70, Творог: 6 });
});

test("забытые правила подрезаются по возрасту", () => {
  const now = Date.UTC(2026, 7, 15);
  const merged = mergeStamps({ старое: now - 400 * DAY, свежее: now - DAY }, {}, 365, now);
  assert.deepEqual(Object.keys(merged), ["свежее"]);
});

/* ---------- склад не растёт вечно ---------- */

test("закрытая три месяца назад позиция сворачивается в надгробие", () => {
  // Закрытые позиции только помечались empty и не удалялись никогда: год
  // покупок оставался в файле в полную ширину, а файл читается и переписывается
  // на каждом синке.
  const now = Date.UTC(2026, 7, 15);
  const rows = [
    { id: "a", product: "Творог 5%", qty: "400 г", zone: "холодильник", empty: true, closedAt: now - 120 * DAY, at: now - 120 * DAY },
    { id: "b", product: "Кефир", qty: "1 л", zone: "холодильник", empty: true, closedAt: now - 10 * DAY, at: now - 10 * DAY },
    { id: "c", product: "Молоко", qty: "2 л", zone: "холодильник", boughtAt: now - DAY },
  ];

  const folded = foldClosed(rows, 90, now);
  assert.deepEqual(folded[0], { id: "a", deleted: true, deletedAt: now - 120 * DAY, at: now - 120 * DAY });
  assert.equal(folded[1].product, "Кефир", "недавно закрытая ещё видна на складе");
  assert.equal(folded[2].product, "Молоко", "живая не трогается");
});

test("свёрнутая позиция не воскресает со второго устройства", () => {
  // Смысл надгробия: id остаётся, и старая копия не может вернуть строку.
  const now = Date.UTC(2026, 7, 15);
  const tomb = { id: "a", deleted: true, deletedAt: now - 120 * DAY, at: now - 120 * DAY };
  const stale = { id: "a", product: "Творог 5%", empty: true, at: now - 200 * DAY };

  assert.equal(mergeById([tomb], [stale])[0].deleted, true);
});

/* ---------- украинская касса ---------- */

test("украинская строка чека распознаётся так же, как русская", () => {
  // Магазины — АТБ и Сільпо, печатают по-украински. Без этих масок «СИР
  // КИСЛОМОЛ» не совпадал ни с чем, уходил в спорные с доверием 0.4 и —
  // хуже — не находил срока годности: продукт не горел и не попадал в ревизию
  // никогда.
  assert.equal(M.normalize("СИР КИСЛОМОЛ 9% 350Г", refs).product, "Творог");
  assert.equal(M.normalize("МОЛОКО СЕЛЯНСЬКЕ 2,5%", refs).product, "Молоко");
  assert.equal(M.normalize("ЯЙЦЯ КУРЯЧІ С0 10ШТ", refs).product, "Яйца");
  assert.equal(M.normalize("КАРТОПЛЯ МИТА ВАГ", refs).product, "Картофель");
  assert.equal(M.normalize("ЦИБУЛЯ РІПЧАСТА", refs).product, "Лук");
  assert.equal(M.normalize("ОЛІЯ СОНЯШНИКОВА 1Л", refs).product, "Растительное масло");
});

test("украинский творог не съедается маской сыра", () => {
  // Тот же порядок, что и у СЫР/СЫРОК: частная маска обязана стоять выше общей.
  assert.equal(M.normalize("СИР КИСЛОМОЛ", refs).product, "Творог");
  assert.equal(M.normalize("СИР ТВЕРДИЙ ГОЛЛАНД", refs).product, "Сыр");
});

test("украинский мусор чека не попадает на склад", () => {
  for (const junk of ["ЗНИЖКА НА ТОВАР", "СУМА ДО СПЛАТИ", "ГОТІВКА", "РЕШТА", "ПДВ 20%"]) {
    assert.equal(M.normalize(junk, refs).product, null, junk);
  }
});

test("найденный по украинской маске продукт получает срок годности", () => {
  // Ради этого всё и делалось: маска отдаёт русское имя продукта, а справочник
  // сроков говорит на нём же.
  const line = M.normalize("СИР КИСЛОМОЛ 9%", refs);
  assert.equal(M.shelfLife(line.product.toLowerCase(), SEED_SHELF, {}).days, 5);
});

/* ---------- перенос ключа на телефон ---------- */

test("код подключения собирается и разбирается обратно", () => {
  const cfg = { repo: "Xdecent0/kitchen-data", branch: "main", token: "github_pat_11ABC_xyz", name: "Тимофій" };
  const parsed = parsePairing(encodePairing(cfg));
  assert.deepEqual(parsed, cfg);
});

test("ветка по умолчанию не теряется", () => {
  const parsed = parsePairing(encodePairing({ repo: "a/b", token: "t" }));
  assert.equal(parsed.branch, "main");
  assert.equal(parsed.name, "");
});

test("чужой QR не принимается за ключ", () => {
  // Камера видит чеки, афиши и наклейки на посылках. Ни одно из этого не должно
  // подставиться в настройки — и не должно считаться ошибкой.
  assert.equal(parsePairing("https://cabinet.tax.gov.ua/check?id=42"), null);
  assert.equal(parsePairing(""), null);
  assert.equal(parsePairing("kitchen1\tне-репозиторий\tmain\tтокен\t"), null, "имя репозитория проверяется");
  assert.equal(parsePairing("kitchen1\ta/b\tmain\t\t"), null, "без ключа переносить нечего");
});

test("табуляция в имени не ломает разбор", () => {
  const parsed = parsePairing(encodePairing({ repo: "a/b", token: "t", name: "Ан\tна" }));
  assert.equal(parsed.name, "Ан на");
});

test("QR-код собирается для полезной нагрузки любого размера", () => {
  // Версия выбирается по длине; ключ плюс репозиторий — около 140 байт.
  assert.equal(versionFor(9), 1);
  assert.equal(versionFor(134), 6);
  assert.equal(versionFor(150), 7);
  assert.equal(versionFor(230), 9);
  assert.equal(versionFor(400), null, "выше девятой версии не кодируем");

  const code = encode(encodePairing({ repo: "Xdecent0/kitchen-data", token: "github_pat_" + "x".repeat(82), name: "Тимофій" }));
  assert.equal(code.size, code.version * 4 + 17);
  assert.equal(code.get(0, 0), 1, "левый верхний глаз на месте");
  assert.equal(code.get(8, code.size - 8), 1, "тёмный модуль на месте");
});

/* ---------- доллары и евро поверх гривны ---------- */

const RATES = {
  base: "UAH",
  updated: T0,
  days: {
    "2026-03-10": { USD: 39.5, EUR: 43.0 },
    "2026-08-14": { USD: 44.7, EUR: 51.5 },
    "2026-08-15": { USD: 44.7, EUR: 51.5 },
  },
};

test("сумма пересчитывается по курсу своего дня, а не сегодняшнего", () => {
  // Покупка в марте по мартовскому курсу. Пересчёт годовалой траты по
  // сегодняшнему курсу — не то, во что она обошлась.
  const march = M_MONEY.convert(3950, "USD", { rates: RATES, at: Date.UTC(2026, 2, 10) });
  assert.equal(Math.round(march.value), 100);
  assert.equal(march.basis, "exact");

  const august = M_MONEY.convert(4470, "USD", { rates: RATES, at: Date.UTC(2026, 7, 14) });
  assert.equal(Math.round(august.value), 100);
});

test("на выходной берётся курс ближайшего предыдущего дня", () => {
  // Банк курса за воскресенье не публикует — берётся пятничный, как в жизни.
  const sunday = M_MONEY.convert(4470, "USD", { rates: RATES, at: Date.UTC(2026, 7, 16) });
  assert.equal(sunday.basis, "nearest");
  assert.equal(sunday.day, "2026-08-15");
});

test("для даты старше всей истории курс помечается как поздний", () => {
  const ancient = M_MONEY.convert(1000, "USD", { rates: RATES, at: Date.UTC(2025, 0, 1) });
  assert.equal(ancient.basis, "latest", "нужно сказать, что курс не тот");
});

test("без курсов ничего не выдумывается", () => {
  assert.equal(M_MONEY.convert(1000, "USD", { rates: null }), null);
  assert.equal(M_MONEY.alongside(1000, { rates: null, show: ["USD"] }), null);
  assert.equal(M_MONEY.alongside(1000, { rates: RATES, show: [] }), null, "не просили — не показываем");
});

test("строка рядом собирается в заданном порядке и помечает устаревший курс", () => {
  const fresh = M_MONEY.alongside(4470, { rates: RATES, at: Date.UTC(2026, 7, 14), show: ["USD", "EUR"] });
  // Ниже сотни показывается десятая: «87 €» вместо 86,8 — уже не та сумма.
  assert.match(fresh.text, /^≈ 100 \$ · 86,8 €$/);
  assert.equal(fresh.stale, false);

  const old = M_MONEY.alongside(4470, { rates: RATES, at: Date.UTC(2025, 0, 1), show: ["USD"] });
  assert.equal(old.stale, true);
});

test("гривна сама себя не пересчитывает", () => {
  assert.equal(M_MONEY.convert(100, "UAH", { rates: RATES }).value, 100);
  assert.equal(M_MONEY.alongside(100, { rates: RATES, show: ["UAH"] }), null);
});

test("набранный руками продукт получает зону и срок из справочника", () => {
  const known = toStockItem({ product: "творог" }, { shelf: SEED_SHELF, boughtAt: Date.UTC(2026, 7, 16), id: "s1" });
  assert.equal(known.zone, "холодильник");
  assert.equal(known.shelfDays, 5);
  assert.equal(known.level, "много");

  // Незнакомого продукта в справочнике нет — и выдумывать ему срок нельзя:
  // полка со сроком «неизвестно» честнее, чем красивое число из ниоткуда.
  const stranger = toStockItem({ product: "тортилья" }, { shelf: SEED_SHELF, boughtAt: Date.UTC(2026, 7, 16), id: "s2" });
  assert.equal(stranger.zone, "полка");
  assert.equal(stranger.shelfDays, null);

  // Зона, названная человеком (фильтр склада), перебивает справочник.
  const chosen = toStockItem({ product: "тортилья", zone: "морозилка" }, { shelf: SEED_SHELF, boughtAt: Date.UTC(2026, 7, 16), id: "s3" });
  assert.equal(chosen.zone, "морозилка");
});

test("человек сказал, в какой отдел — справочник не спорит", () => {
  const aisles = SEED_AISLES;
  assert.equal(M.aisleOfEntry({ product: "Гречка" }, aisles).name, "бакалея", "без ответа работает догадка");
  assert.equal(M.aisleOfEntry({ product: "Гречка", aisle: "заморозка" }, aisles).name, "заморозка");

  // Отдела, которого нет в таблице, всё равно достаточно: это ответ человека,
  // и терять его из-за того, что таблицу ещё не дописали, нельзя.
  const own = M.aisleOfEntry({ product: "Что-то", aisle: "мой ящик" }, aisles);
  assert.equal(own.name, "мой ящик");
});

test("одинаковые продукты складываются в одну строку, но не в одну запись", () => {
  const now = Date.UTC(2026, 7, 17);
  const day = 86400000;
  const items = [
    { id: "a", product: "Мороженое", qty: "рожок", boughtAt: now - 2 * day, shelfDays: 180 },
    { id: "b", product: "мороженое", qty: "ведро", boughtAt: now - 100 * day, shelfDays: 101 },
    { id: "c", product: "Хлеб", boughtAt: now, shelfDays: 4 },
  ];

  const groups = M.collapseSame(items, now);
  assert.equal(groups.length, 2, "две строки: мороженое и хлеб");

  const ice = groups.find((g) => g.key === "мороженое");
  assert.equal(ice.count, 2);
  // Наружу выходит то, что испортится первым, — по нему строка и горит.
  assert.equal(ice.head.id, "b");
  assert.equal(ice.entries.map((e) => e.id).join(""), "bа".replace("а", "a"));
});

test("дата с пачки главнее справочника и рисует полоску сама", () => {
  const now = Date.UTC(2026, 7, 17);
  const day = 86400000;
  const byHand = { product: "Тортилья", boughtAt: now - 5 * day, shelfDays: null, expires: now + 5 * day };

  const f = M.freshness(byHand, now);
  assert.equal(f.left, 5);
  // Без этого у выставленного руками срока были бы дни, но не было бы шкалы.
  assert.equal(f.share, 0.5);
});
