// Local state. Single source of truth in the browser; the GitHub layer syncs it later.
// Reference tables seed from here and are overwritten by the data repo once a token is set.

const KEY = "kitchen.state.v1";

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

export const SEED_SYNONYMS = [
  { mask: "МЛК СГУЩ", product: "Сгущённое молоко" },
  { mask: "МЛК", product: "Молоко" },
  { mask: "МОЛОКО", product: "Молоко" },
  { mask: "КЕФИР", product: "Кефир" },
  { mask: "СМЕТ", product: "Сметана" },
  { mask: "ТВОРОГ", product: "Творог" },
  { mask: "ТВОР", product: "Творог" },
  { mask: "СЫРОК", product: "Глазированный сырок" },
  { mask: "СЫР ПЛАВЛ", product: "Плавленый сыр" },
  { mask: "СЫР", product: "Сыр" },
  { mask: "Т/В СЛ", product: "Сливочное масло" },
  { mask: "МАСЛО СЛИВ", product: "Сливочное масло" },
  { mask: "МАСЛО ПОДС", product: "Растительное масло" },
  { mask: "ЯЙЦО", product: "Яйца" },
  { mask: "ЯЙЦА", product: "Яйца" },
  { mask: "КУР ФИЛЕ", product: "Куриное филе" },
  { mask: "ФИЛЕ ЦБ", product: "Куриное филе" },
  { mask: "ФАРШ", product: "Фарш" },
  { mask: "ХЛЕБ", product: "Хлеб" },
  { mask: "БАТОН", product: "Батон" },
  { mask: "РИС", product: "Рис" },
  { mask: "ГРЕЧ", product: "Гречка" },
  { mask: "МАКАР", product: "Макароны" },
  { mask: "ПОМИДОР", product: "Помидоры" },
  { mask: "ТОМАТ", product: "Помидоры" },
  { mask: "ОГУР", product: "Огурцы" },
  { mask: "КАРТОФ", product: "Картофель" },
  { mask: "ЛУК РЕПЧ", product: "Лук" },
  { mask: "МОРКОВ", product: "Морковь" },
  { mask: "ЯБЛОК", product: "Яблоки" },
  { mask: "БАНАН", product: "Бананы" },
];

export const SEED_JUNK = [
  "ПАКЕТ",
  "СКИДКА",
  "БОНУС",
  "ИТОГО",
  "СДАЧА",
  "НАЛИЧНЫМИ",
  "КАРТОЙ",
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
  { id: "st_1", name: "Пятёрочка", aisleOrder: null, note: "рядом с домом" },
  { id: "st_2", name: "ВкусВилл", aisleOrder: null, note: "молочка лучше" },
  { id: "st_3", name: "Рынок на Мира", aisleOrder: null, note: "мясо и овощи" },
];

export const EMPTY_STATE = {
  version: 2,
  stock: [],
  list: [],
  history: {},
  rules: {},
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
  queue: [],
  jobs: [],
  lastAudit: null,
  syncedAt: null,
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY_STATE);
    return { ...structuredClone(EMPTY_STATE), ...JSON.parse(raw) };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
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
        store: "Пятёрочка",
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
        store: "ВкусВилл",
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
        store: "Рынок на Мира",
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
