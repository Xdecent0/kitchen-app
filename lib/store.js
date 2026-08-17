// Local state. Single source of truth in the browser; the GitHub layer syncs it later.
// Reference tables seed from here and are overwritten by the data repo once a token is set.

import * as log from "./log.js";

const KEY = "kitchen.state.v1";

/* localStorage gives about 5 MB per origin and every save rewrites the whole
   state, so both numbers matter: how big it is, and how long writing it takes.
   Guessing at either is how an app gets slow without anyone noticing when. */
const BIG_STATE = 1_500_000;
const SLOW_SAVE = 16;

let lastSize = 0;
let warnedBig = false;

/** Bytes the saved state currently occupies — shown in settings, not guessed at. */
export const size = () => lastSize;

export const SEED_SHELF = [
  { product: "молоко", zone: "холодильник", closed: 10, opened: 3 },
  { product: "кефир", zone: "холодильник", closed: 14, opened: 4 },
  { product: "сметана", zone: "холодильник", closed: 20, opened: 7 },
  { product: "творог", zone: "холодильник", closed: 5, opened: 3 },
  { product: "сыр", zone: "холодильник", closed: 60, opened: 14 },
  { product: "сливочное масло", zone: "холодильник", closed: 60, opened: 20 },
  { product: "яйца", zone: "холодильник", closed: 25 },
  { product: "куриное филе", zone: "холодильник", closed: 3 },
  { product: "фарш", zone: "холодильник", closed: 2 },
  { product: "хлеб", zone: "полка", closed: 4 },
  { product: "батон", zone: "полка", closed: 3 },
  { product: "рис", zone: "полка", closed: 365, opened: 180 },
  { product: "гречка", zone: "полка", closed: 365, opened: 180 },
  { product: "макароны", zone: "полка", closed: 365, opened: 180 },
  { product: "помидоры", zone: "овощи", closed: 7 },
  { product: "огурцы", zone: "овощи", closed: 7 },
  { product: "картофель", zone: "овощи", closed: 60 },
  { product: "лук", zone: "овощи", closed: 90 },
  { product: "морковь", zone: "овощи", closed: 30 },
  { product: "яблоки", zone: "овощи", closed: 21 },
  { product: "бананы", zone: "овощи", closed: 5 },
  { product: "зелень", zone: "холодильник", closed: 5 },
];

/**
 * Till strings to products. Longest match first — "СЫР" would otherwise swallow
 * "СЫРОК ГЛАЗИР", and "СИР" would swallow "СИР КИСЛОМОЛ".
 *
 * Ukrainian belongs here as much as Russian: the shops are АТБ and Сільпо and
 * they print Ukrainian. Without these lines "СИР КИСЛОМОЛ" matched nothing, went
 * to the disputed pile at confidence 0.4, and — worse — never found a shelf life,
 * so the product never burned and never appeared in an audit. The OCR side was
 * already asking tesseract for ukr+rus; only the dictionary was monolingual.
 */
export const SEED_SYNONYMS = [
  { mask: "МЛК СГУЩ", product: "Сгущённое молоко" },
  { mask: "МОЛОКО ЗГУЩ", product: "Сгущённое молоко" },
  { mask: "МЛК", product: "Молоко" },
  { mask: "МОЛОКО", product: "Молоко" },
  { mask: "КЕФИР", product: "Кефир" },
  { mask: "КЕФІР", product: "Кефир" },
  { mask: "ЙОГУРТ", product: "Йогурт" },
  { mask: "СМЕТ", product: "Сметана" },
  { mask: "ВЕРШКИ", product: "Сливки" },
  { mask: "ТВОРОГ", product: "Творог" },
  { mask: "ТВОР", product: "Творог" },
  { mask: "СИР КИСЛОМОЛ", product: "Творог" },
  { mask: "СИРОК", product: "Глазированный сырок" },
  { mask: "СЫРОК", product: "Глазированный сырок" },
  { mask: "СЫР ПЛАВЛ", product: "Плавленый сыр" },
  { mask: "СИР ПЛАВЛ", product: "Плавленый сыр" },
  { mask: "СИР ТВЕРД", product: "Сыр" },
  { mask: "СЫР", product: "Сыр" },
  { mask: "СИР", product: "Сыр" },
  { mask: "Т/В СЛ", product: "Сливочное масло" },
  { mask: "МАСЛО СЛИВ", product: "Сливочное масло" },
  { mask: "МАСЛО ВЕРШК", product: "Сливочное масло" },
  { mask: "МАСЛО ПОДС", product: "Растительное масло" },
  { mask: "ОЛІЯ", product: "Растительное масло" },
  { mask: "ЯЙЦО", product: "Яйца" },
  { mask: "ЯЙЦА", product: "Яйца" },
  { mask: "ЯЙЦЯ", product: "Яйца" },
  { mask: "ЯЄЧН", product: "Яйца" },
  { mask: "КУР ФИЛЕ", product: "Куриное филе" },
  { mask: "КУР ФІЛЕ", product: "Куриное филе" },
  { mask: "ФІЛЕ КУР", product: "Куриное филе" },
  { mask: "ФИЛЕ ЦБ", product: "Куриное филе" },
  { mask: "ФІЛЕ ЦБ", product: "Куриное филе" },
  { mask: "ФАРШ", product: "Фарш" },
  { mask: "ХЛЕБ", product: "Хлеб" },
  { mask: "ХЛІБ", product: "Хлеб" },
  { mask: "БАТОН", product: "Батон" },
  { mask: "РИС", product: "Рис" },
  { mask: "ГРЕЧ", product: "Гречка" },
  { mask: "МАКАР", product: "Макароны" },
  { mask: "ПОМИДОР", product: "Помидоры" },
  { mask: "ПОМІДОР", product: "Помидоры" },
  { mask: "ТОМАТ", product: "Помидоры" },
  { mask: "ОГУР", product: "Огурцы" },
  { mask: "ОГІР", product: "Огурцы" },
  { mask: "КАРТОФ", product: "Картофель" },
  { mask: "КАРТОПЛ", product: "Картофель" },
  { mask: "ЛУК РЕПЧ", product: "Лук" },
  { mask: "ЦИБУЛ", product: "Лук" },
  { mask: "МОРКОВ", product: "Морковь" },
  { mask: "МОРКВ", product: "Морковь" },
  { mask: "ЯБЛОК", product: "Яблоки" },
  { mask: "ЯБЛУК", product: "Яблоки" },
  { mask: "БАНАН", product: "Бананы" },
  { mask: "ЗЕЛЕН", product: "Зелень" },
  { mask: "ЦУКОР", product: "Сахар" },
  { mask: "САХАР", product: "Сахар" },
  { mask: "БОРОШНО", product: "Мука" },
  { mask: "МУКА", product: "Мука" },
  { mask: "СІЛЬ", product: "Соль" },
  { mask: "СОЛЬ", product: "Соль" },
];

export const SEED_JUNK = [
  "ПАКЕТ",
  "СКИДКА",
  "ЗНИЖКА",
  "БОНУС",
  "ИТОГО",
  "РАЗОМ",
  "СУМА",
  "ДО СПЛАТИ",
  "СДАЧА",
  "РЕШТА",
  "НАЛИЧНЫМИ",
  "ГОТІВКА",
  "КАРТОЙ",
  "КАРТКА",
  "БЕЗГОТІВК",
  "ПДВ",
  "ФІСКАЛЬНИЙ",
  "ДЯКУЄМО",
];

/** Where things are kept. A starting four, not a law — the vault table wins. */
export const SEED_ZONES = [
  { name: "холодильник", icon: "i-carton", into: "в холодильник" },
  { name: "морозилка", icon: "i-freezer", into: "в морозилку" },
  { name: "полка", icon: "i-shelf", into: "на полку" },
  { name: "овощи", icon: "i-veg", into: "в овощи" },
];

export const SEED_AISLES = [
  { order: 1, name: "овощи", items: ["помидор", "огур", "картоф", "лук", "морков", "яблок", "банан", "зелень"] },
  { order: 2, name: "бакалея", items: ["рис", "гречк", "макарон", "мука", "сахар", "масло", "консерв"] },
  { order: 3, name: "молочка", items: ["молоко", "кефир", "сметан", "творог", "сыр", "яйц"] },
  { order: 4, name: "хлеб", items: ["хлеб", "батон", "лаваш"] },
  { order: 5, name: "мясо", items: ["филе", "фарш", "колбас", "рыб"] },
  { order: 6, name: "заморозка", items: ["пельмен", "мороженое", "смесь"] },
  { order: 7, name: "бытовое", items: ["бумага", "порошок", "мешк"] },
];

export const SEED_RECIPES = [
  {
    id: "r_syrniki",
    name: "Сырники",
    minutes: 20,
    servings: 2,
    difficulty: "просто",
    ingredients: [
      { product: "творог", qty: "400 г" },
      { product: "яйцо", qty: "1 шт" },
      { product: "мука", qty: "3 ст. л." },
      { product: "сахар", qty: "1 ст. л." },
      { product: "сметана", qty: "по вкусу" },
    ],
    steps: [
      "Размять творог вилкой, добавить яйцо и сахар.",
      "Всыпать муку, перемешать до липкого теста.",
      "Слепить биточки, обвалять в муке.",
      "Жарить на среднем огне по 3-4 минуты с каждой стороны.",
      "Подавать со сметаной.",
    ],
  },
  {
    id: "r_zapekanka",
    name: "Творожная запеканка",
    minutes: 45,
    servings: 4,
    difficulty: "просто",
    ingredients: [
      { product: "творог", qty: "500 г" },
      { product: "яйцо", qty: "2 шт" },
      { product: "мука", qty: "4 ст. л." },
      { product: "сахар", qty: "3 ст. л." },
    ],
    steps: [
      "Смешать творог с яйцами и сахаром.",
      "Добавить муку, вымешать до однородности.",
      "Выложить в форму, разровнять.",
      "Выпекать 35 минут при 180 °C.",
    ],
  },
  {
    id: "r_omlet",
    name: "Омлет с помидорами",
    minutes: 10,
    servings: 1,
    difficulty: "просто",
    ingredients: [
      { product: "яйцо", qty: "3 шт" },
      { product: "молоко", qty: "50 мл" },
      { product: "помидоры", qty: "2 шт" },
    ],
    steps: [
      "Взбить яйца с молоком.",
      "Обжарить помидоры дольками одну минуту.",
      "Влить яйца, готовить под крышкой 4 минуты.",
    ],
  },
  {
    id: "r_kuritsa_ris",
    name: "Курица с рисом",
    minutes: 35,
    servings: 3,
    difficulty: "просто",
    ingredients: [
      { product: "куриное филе", qty: "500 г" },
      { product: "рис", qty: "1 стакан" },
      { product: "лук", qty: "1 шт" },
      { product: "морковь", qty: "1 шт" },
    ],
    steps: [
      "Обжарить нарезанное филе до румяности.",
      "Добавить лук и морковь, готовить 5 минут.",
      "Всыпать рис, залить двумя стаканами воды.",
      "Тушить под крышкой 20 минут.",
    ],
  },
];

export const SEED_STORES = [
  { id: "st_1", name: "АТБ", aisleOrder: null, note: "рядом с домом" },
  { id: "st_2", name: "Сільпо", aisleOrder: null, note: "молочка лучше" },
  { id: "st_3", name: "Рынок", aisleOrder: null, note: "мясо и овощи" },
];

export const EMPTY_STATE = {
  version: 3,
  currency: "₴",
  /** Which currencies to show next to the hryvnia. Empty means hryvnia alone. */
  showCurrencies: [],
  /** Daily rates from the National Bank, refreshed by the Action. */
  rates: null,
  stock: [],
  list: [],
  history: {},
  /** Dates removed from history by unticking — travels so the repository cannot undo it. */
  gone: {},
  confirmed: {},
  rules: {},
  /** Rules forgotten on purpose — without this the next merge hands them straight back. */
  rulesGone: {},
  /** Shelf lives learned from "ещё есть", kept apart from the vault's own table. */
  shelfLearned: {},
  receipts: [],
  recipes: SEED_RECIPES,
  menu: [],
  meals: [],
  stores: SEED_STORES,
  people: [{ id: "me", name: "я", self: true }],
  shelf: SEED_SHELF,
  synonyms: SEED_SYNONYMS,
  junk: SEED_JUNK,
  aisles: SEED_AISLES,
  zones: SEED_ZONES,
  queue: [],
  jobs: [],
  lastAudit: null,
  syncedAt: null,
};

/** Ids only the seeded demo uses — the marker for states saved before the flag existed. */
const DEMO_IDS = ["s1", "s2", "s3", "rc_1", "rc_2", "rc_3"];

export function looksLikeDemo(state) {
  const ids = new Set([...(state.stock ?? []), ...(state.receipts ?? [])].map((e) => e.id));
  return DEMO_IDS.filter((id) => ids.has(id)).length >= 3;
}

/** True only when this browser has never saved state — not merely when it is empty. */
export function isFresh() {
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return true;
  }
}

/** Strip the seeded demo out of a state that has since gained real data. */
export function stripDemo(state) {
  const demoIds = new Set(DEMO_IDS);
  return {
    ...state,
    demo: false,
    stock: (state.stock ?? []).filter((e) => !demoIds.has(e.id)),
    receipts: (state.receipts ?? []).filter((e) => !demoIds.has(e.id)),
  };
}

/** Storage can be absent entirely — private mode, a locked-down browser, a test run. */
const hasStorage = () => typeof localStorage !== "undefined";

export function load() {
  if (!hasStorage()) return structuredClone(EMPTY_STATE);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY_STATE);

    lastSize = raw.length;
    const state = { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
    if (state.demo === undefined) state.demo = looksLikeDemo(state);
    log.info("хранилище", `загружено ${Math.round(lastSize / 1024)} КБ`, {
      список: state.list?.length,
      склад: state.stock?.length,
      очередь: state.queue?.length,
    });
    return state;
  } catch (err) {
    // Unreadable saved state is the worst silent failure there is: the app opens
    // looking brand new and the person assumes their data is gone. Say so.
    log.fail("хранилище", "сохранённое состояние не читается — начинаю с пустого", err?.message);
    return structuredClone(EMPTY_STATE);
  }
}

export function save(state) {
  if (!hasStorage()) return false;
  const stop = log.time("хранилище", "запись состояния", { warnAfter: SLOW_SAVE });
  try {
    const text = JSON.stringify(state);
    localStorage.setItem(KEY, text);
    lastSize = text.length;
    stop({ bytes: lastSize });

    if (lastSize > BIG_STATE && !warnedBig) {
      warnedBig = true;
      log.warn("хранилище", `состояние выросло до ${Math.round(lastSize / 1024)} КБ`, {
        чеки: state.receipts?.length,
        приёмы: state.meals?.length,
        склад: state.stock?.length,
      });
    }
    return true;
  } catch (err) {
    log.fail("хранилище", "запись не прошла — место кончилось", err?.name);
    return false;
  }
}

export function reset() {
  localStorage.removeItem(KEY);
}

/** Demo data — lets the interface be judged before a single receipt exists. */
export function demoState(now) {
  const DAY = 86400000;
  const day = (n) => now - n * DAY;

  return {
    ...structuredClone(EMPTY_STATE),
    // Marked so sync can refuse to push invented stock into a real repository.
    demo: true,
    stock: [
      { id: "s1", product: "Творог 5%", qty: "400 г", zone: "холодильник", boughtAt: day(4), shelfDays: 5, opened: true },
      { id: "s2", product: "Кефир 1%", qty: "1 л", zone: "холодильник", boughtAt: day(11), shelfDays: 14, opened: true },
      { id: "s3", product: "Яйца", qty: "2 из 10", zone: "холодильник", boughtAt: day(19), shelfDays: 25 },
      { id: "s4", product: "Молоко 2,5%", qty: "2 л", zone: "холодильник", boughtAt: day(1), shelfDays: 10 },
      { id: "s5", product: "Куриное филе", qty: "1 кг", zone: "морозилка", boughtAt: day(2), shelfDays: 180 },
      { id: "s6", product: "Рис", qty: "не знаю", zone: "полка", boughtAt: day(30), shelfDays: 365 },
      { id: "s7", product: "Помидоры", qty: "4 шт", zone: "овощи", boughtAt: day(3), shelfDays: 7 },
      { id: "s8", product: "Хлеб", qty: "1", zone: "полка", boughtAt: day(3), shelfDays: 4 },
      { id: "s9", product: "Мука", qty: "1 кг", zone: "полка", boughtAt: day(40), shelfDays: 365 },
      { id: "s10", product: "Сахар", qty: "1 кг", zone: "полка", boughtAt: day(40), shelfDays: 365 },
      { id: "s11", product: "Лук", qty: "3 шт", zone: "овощи", boughtAt: day(12), shelfDays: 90 },
    ],
    list: [
      { id: "l1", product: "Молоко", qty: "2 л", done: false, from: "forecast" },
      { id: "l2", product: "Сметана", qty: "200 г", done: false, from: "recipe" },
      { id: "l3", product: "Творог", qty: "", done: true, from: "manual" },
      { id: "l4", product: "Батон", qty: "1", done: false, from: "forecast" },
      { id: "l5", product: "Помидоры", qty: "1 кг", done: false, from: "manual" },
      { id: "l6", product: "Куриное филе", qty: "1 кг", done: false, from: "recipe" },
    ],
    history: {
      Молоко: [day(13), day(10), day(7), day(4)],
      Батон: [day(9), day(6), day(3)],
      Творог: [day(12), day(4)],
      Помидоры: [day(17), day(10), day(3)],
    },
    receipts: [
      {
        id: "rc_1",
        store: "АТБ",
        at: day(4),
        total: 1842,
        lines: [
          { product: "Творог", qty: "400 г", price: 212 },
          { product: "Молоко", qty: "2 л", price: 89 },
          { product: "Яйца", qty: "10 шт", price: 129 },
          { product: "Хлеб", qty: "1", price: 62 },
        ],
      },
      {
        id: "rc_2",
        store: "Сільпо",
        at: day(11),
        total: 964,
        lines: [
          { product: "Кефир", qty: "1 л", price: 98 },
          { product: "Творог", qty: "400 г", price: 189 },
          { product: "Молоко", qty: "1 л", price: 96 },
        ],
      },
      {
        id: "rc_3",
        store: "Рынок",
        at: day(2),
        total: 1130,
        lines: [
          { product: "Куриное филе", qty: "1 кг", price: 389 },
          { product: "Помидоры", qty: "1 кг", price: 180 },
          { product: "Морковь", qty: "1 кг", price: 64 },
        ],
      },
    ],
    meals: [
      { id: "m1", date: day(0), slot: "завтрак", source: "дома", title: "Омлет", products: ["Яйца", "Помидоры"], cost: 0 },
      { id: "m2", date: day(1), slot: "обед", source: "заведение", title: "Столовая на работе", cost: 480 },
      { id: "m3", date: day(1), slot: "ужин", source: "дома", title: "Курица с рисом", products: ["Куриное филе", "Рис"], cost: 0 },
      { id: "m4", date: day(2), slot: "ужин", source: "доставка", title: "Пицца", cost: 890 },
      { id: "m5", date: day(3), slot: "завтрак", source: "дома", title: "Сырники", products: ["Творог", "Яйца"], cost: 0 },
    ],
    menu: [
      { id: "mn1", date: day(0), slot: "ужин", recipeId: "r_syrniki", at: day(1) },
      { id: "mn2", date: day(-1), slot: "ужин", recipeId: "r_kuritsa_ris", at: day(1) },
    ],
    lastAudit: day(6),
  };
}
