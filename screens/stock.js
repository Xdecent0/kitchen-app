// Stock. On a phone: zones on top, then rows sorted by what spoils first.
// On a desktop: a dense table with an inspector, bulk actions and the keyboard —
// the same data doing a different job, per the approved desktop comp.

import { html, raw, icon, esc, cap, fmtMoney, fmtDate, toast, wide } from "../lib/dom.js";
import { touch, commit, uid } from "../lib/state.js";
import { mark } from "../lib/sync.js";
import * as M from "../lib/model.js";
import { rank, lineMatchesProduct } from "../lib/recipes.js";
import { toStockItem } from "../lib/receipt.js";
import * as T from "../lib/trip.js";

export const ZONES = ["холодильник", "морозилка", "полка", "овощи"];

/** The zone in the accusative, because «в морозилка» is not a sentence. */
const ZONE_INTO = {
  холодильник: "в холодильник",
  морозилка: "в морозилку",
  полка: "на полку",
  овощи: "в овощи",
};

export const ZONE_ICON = {
  холодильник: "i-carton",
  морозилка: "i-freezer",
  полка: "i-shelf",
  овощи: "i-veg",
};

let filter = "all";
let zoneFilter = null;
let selected = new Set();
let cursor = 0;
let query = "";
/**
 * How the shelf is laid out: by category (the way a kitchen is talked about),
 * by zone (the way it is physically stored), or flat by what spoils first.
 */
let grouping = "aisle";
/** The one cell open for editing: {id, field}. Only ever one, so Escape is unambiguous. */
let editing = null;
/** Names whose stack of records is open. Two tubs of ice cream are two records. */
let opened = new Set();

export const alive = (state) => state.stock.filter((i) => !i.deleted && !i.empty);

function filtered(state) {
  const now = M.today();
  let items = alive(state);

  if (filter === "burning") items = items.filter((i) => M.isBurning(i, now));
  if (filter === "low") {
    items = items.filter((i) => {
      const s = M.freshness(i, now).share;
      return s !== null && s < 0.34;
    });
  }
  if (zoneFilter) items = items.filter((i) => i.zone === zoneFilter);
  if (query) {
    const q = query.toLowerCase();
    items = items.filter((i) => i.product.toLowerCase().includes(q));
  }

  return M.sortByUrgency(items, now);
}

/**
 * The shelf in the order it is shown: one nameless run when sorted by expiry,
 * a run per category otherwise. Inside a category the urgent thing still comes
 * first — the grouping answers "where is the milk", not "what is fine to forget".
 */
function groups(state) {
  const items = filtered(state);

  if (grouping === "aisle") {
    return M.groupByAisle(items, state.aisles).map((g) => ({ name: g.name, entries: g.entries }));
  }

  if (grouping === "zone") {
    return ZONES
      .map((zone) => ({ name: zone, entries: items.filter((i) => i.zone === zone) }))
      .filter((g) => g.entries.length);
  }

  return [{ name: null, entries: items }];
}

/**
 * A group's rows in display order: one line per name, with the stack under it
 * when that name is open. What the cursor and the keyboard count is exactly what
 * the eye sees, so a folded stack is one row and an open one is several.
 */
function linesOf(entries, now = M.today()) {
  const lines = [];

  for (const stack of M.collapseSame(entries, now)) {
    if (stack.count === 1) {
      lines.push({ kind: "entry", entry: stack.head });
      continue;
    }

    // A folded stack is a lid, not a record: it carries no entry of its own, so
    // the cursor and the selection never see one row standing in for three.
    const isOpen = opened.has(stack.key);
    lines.push({ kind: "stack", stack, open: isOpen });
    if (isOpen) for (const entry of stack.entries) lines.push({ kind: "entry", entry, child: true });
  }

  return lines;
}

/** Display order flattened, so the cursor and the keyboard count the same rows the eye does. */
const visible = (state) =>
  groups(state).flatMap((g) => linesOf(g.entries).filter((l) => l.kind === "entry").map((l) => l.entry));

function groupSwitch() {
  const options = [
    ["aisle", "категории"],
    ["zone", "зоны"],
    ["urgency", "срок"],
  ];

  return html`<div class="seg seg--sm" role="group" aria-label="Как раскладывать">
    <span class="seg-label">раскладка</span>
    ${raw(options.map(([key, name]) =>
      `<button class="seg-btn" type="button" data-act="grouping" data-grouping="${key}" aria-pressed="${grouping === key}">${esc(name)}</button>`).join(""))}
  </div>`;
}

export function stockRow(itemEntry, now = M.today()) {
  const f = M.freshness(itemEntry, now);
  const burning = M.isBurning(itemEntry, now);
  const glyph = ZONE_ICON[itemEntry.zone] ?? "i-shelf";

  const meter = f.share == null
    ? `<span class="row-qty">срок ?</span>`
    : `<span class="meter" data-tone="${f.tone}" role="img" aria-label="${esc(M.expiryLabel(itemEntry, now))}"><i style="width:${Math.round(f.share * 100)}%"></i></span>`;

  return html`<a class="row" href="#item/${itemEntry.id}" data-burning="${burning ? 1 : 0}">
    <span class="tile" aria-hidden="true">${raw(icon(glyph, { size: 19, stroke: burning ? "#c1481f" : "#1c3327" }))}</span>
    <span class="row-main">
      <span class="row-name">${itemEntry.product}</span>
      <span class="row-why">${[itemEntry.qty || itemEntry.level, M.expiryLabel(itemEntry, now)].filter(Boolean).join(" · ")}</span>
    </span>
    ${raw(meter)}
  </a>`;
}

/**
 * Typing a product in by hand.
 *
 * Two fields: the name, and how much of it. The rest is already known — the
 * reference table says where the thing lives and how long it keeps, and the
 * zone filter, if one is on, says which shelf the person is standing at.
 *
 * Quantity is free text on purpose. "1,5 кг", "2 рожка" and "пол упаковки" are
 * all how a kitchen is actually counted, and a number with a unit dropdown
 * would refuse two of the three.
 */
function addbar(flat = false, slim = false) {
  const where = zoneFilter ? ZONE_INTO[zoneFilter] : "на склад";

  return html`<form class="addbar${flat ? " addbar--flat" : ""}${slim ? " addbar--slim" : ""}" data-act-submit="add">
    <input class="field" name="product" placeholder="Добавить ${where}" aria-label="Добавить продукт ${where}" autocomplete="off" required>
    <input class="field field--qty" name="qty" placeholder="сколько" aria-label="Сколько" autocomplete="off">
    <button class="icon-btn${slim ? " icon-btn--sm" : ""}" type="submit" aria-label="Добавить продукт ${where}">
      ${raw(icon("i-plus", { size: slim ? 18 : 22, stroke: "#1c3327" }))}
    </button>
  </form>`;
}

function emptyScreen(state) {
  // Both links into the audit used to sit behind this screen, so an empty shelf
  // meant no way in at all — even when the purchase rhythm had a week of
  // questions waiting. An empty shelf is exactly when those questions matter.
  const pending = state ? T.auditCandidates(state).length : 0;

  return html`<main class="screen">
    <header class="head head--dark"><h1>Склад</h1><span class="head-sub">пусто</span></header>
    <div class="body">
      <div class="empty">
        <h2>О запасах ничего не знаю</h2>
        <p>Дальше склад будет заполняться сам из чеков: отсканируй QR в подвале чека, и позиции со сроками появятся здесь. Но первый раз — то, что уже стоит в холодильнике и на полке, — придётся набрать руками.</p>
        ${raw(addbar(true))}
        <a class="btn btn--ghost" href="#scan">Сканировать чек</a>
        ${raw(pending
          ? `<p class="prose prose--muted">А ещё по ритму покупок накопилось ${pending} ${M.plural(pending, "вопрос", "вопроса", "вопросов")} — ревизия ответит на них за двадцать секунд.</p>
             <a class="btn btn--ghost" href="#audit">Пройти ревизию</a>`
          : "")}
      </div>
    </div>
  </main>`;
}

function auditText(state, now) {
  if (state.lastAudit == null) return "ревизии ещё не было";
  const d = M.daysBetween(state.lastAudit, now);
  return d === 0 ? "ревизия сегодня" : `ревизия ${d} ${M.plural(d, "день", "дня", "дней")} назад`;
}

function filterChips() {
  return html`<div class="chips" role="group" aria-label="Фильтр склада">
    <button class="chip" type="button" data-act="filter" data-filter="all" aria-pressed="${filter === "all"}">всё</button>
    <button class="chip" type="button" data-act="filter" data-filter="burning" aria-pressed="${filter === "burning"}">горит</button>
    <button class="chip" type="button" data-act="filter" data-filter="low" aria-pressed="${filter === "low"}">кончается</button>
  </div>`;
}

/* ---------- phone ---------- */

function phone(state) {
  const now = M.today();
  const items = alive(state);
  const burning = items.filter((i) => M.isBurning(i, now));
  const shown = visible(state);

  const zoneCards = ZONES.map((zone) => {
    const inZone = items.filter((i) => i.zone === zone);
    const hot = inZone.filter((i) => M.isBurning(i, now)).length;
    return html`<button class="zone" type="button" data-act="zone" data-zone="${zone}" aria-pressed="${zoneFilter === zone}">
      ${raw(icon(ZONE_ICON[zone], { size: 22, stroke: "#1c3327" }))}
      <span class="zone-name">${cap(zone)}</span>
      <span class="zone-meta num">${inZone.length} · ${hot ? `${hot} ${M.plural(hot, "горит", "горят", "горят")}` : "спокойно"}</span>
    </button>`;
  }).join("");

  const rows = shown.length
    ? groups(state).map((g) => html`${raw(g.name ? `<div class="aisle">${esc(g.name)} <span class="num">${g.entries.length}</span></div>` : "")}
        ${raw(linesOf(g.entries, now).map((line) => line.kind === "stack"
          ? `<button class="row row--stack" type="button" data-act="stack" data-key="${esc(line.stack.key)}" aria-expanded="${line.open}">
               <span class="tile" aria-hidden="true">${icon(line.open ? "i-chev-down" : "i-chev-right", { size: 16, stroke: "#1c3327" })}</span>
               <span class="row-main">
                 <span class="row-name">${esc(line.stack.product)}</span>
                 <span class="row-why">${esc(`${line.stack.count} ${M.plural(line.stack.count, "штука", "штуки", "штук")}`)}${line.open ? "" : ` · ${esc(M.expiryLabel(line.stack.head, now))}`}</span>
               </span>
             </button>`
          : `<div class="${line.child ? "row-nest" : ""}">${stockRow(line.entry, now)}</div>`).join(""))}`).join("")
    : html`<div class="empty">
        <h2>Здесь пусто</h2>
        <p>По этому фильтру ничего нет — редкий случай, когда пустой экран означает, что всё в порядке.</p>
      </div>`;

  return html`<main class="screen">
    <header class="head head--dark">
      <div>
        <h1>Склад</h1>
        <span class="head-sub num">${items.length} ${M.plural(items.length, "позиция", "позиции", "позиций")} · ${burning.length} ${M.plural(burning.length, "горит", "горят", "горят")} · ${auditText(state, now)}</span>
      </div>
      ${raw(filterChips())}
    </header>

    <div class="body">
      <div class="zones">${raw(zoneCards)}</div>
      <div class="groupbar">${raw(groupSwitch())}</div>
      ${raw(rows)}
      <!-- Under the shelf, not above it: on a phone the job is looking at what
           is there, and a field for typing things in would push the first rows
           off a 375px screen for the sake of the rarer task. -->
      ${raw(addbar())}
    </div>

    <div class="foot">
      <a class="btn btn--grow" href="#audit">Ревизия · 20 сек</a>
      <a class="btn btn--ghost" href="#scan">Чек</a>
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

/** Placeholder for a cell we genuinely do not know, kept out of prose punctuation. */
const none = () => '<span class="tnone" aria-label="неизвестно">–</span>';

/** What a date input wants: the expiry as YYYY-MM-DD, or nothing at all. */
export function dateValue(entry) {
  const at = entry?.expires ?? null;
  if (!at) return "";
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * How much is left, in the words the entry actually has.
 *
 * A typed quantity ("14 штук") beats the three-step level, because it is what
 * the person wrote down. The level is the fallback and the thing the audit
 * edits, so both are shown when both are known.
 */
function amountCell(entry) {
  const level = entry.level && entry.level !== "много" ? entry.level : "";
  if (!entry.qty && !level) return `<span class="tamount">${esc(entry.level ?? "много")}</span>`;

  return [
    entry.qty ? `<span class="tamount">${esc(entry.qty)}</span>` : "",
    level ? `<span class="tdim">${esc(level)}</span>` : "",
  ].join(" ");
}

/** Shelf life as a bar plus its own words: the bar is scannable, the words are exact. */
function lifeCell(entry, now) {
  const f = M.freshness(entry, now);
  const burns = M.isBurning(entry, now);
  const label = `<span class="${burns ? "tburn" : "tdim"}">${esc(M.expiryLabel(entry, now))}</span>`;

  if (f.share == null) return `<span class="tnone">срок неизвестен</span>`;
  return `<span class="meter meter--row" data-tone="${f.tone}" aria-hidden="true"><i style="width:${Math.round(f.share * 100)}%"></i></span>${label}`;
}

function desk(state) {
  const now = M.today();
  const items = alive(state);
  const burning = items.filter((i) => M.isBurning(i, now));
  const shown = visible(state);
  cursor = Math.min(cursor, Math.max(0, shown.length - 1));

  const focused = shown[cursor] ?? null;
  const marked = shown.filter((i) => selected.has(i.id));

  const storeOf = (entry) =>
    state.receipts.find((r) => (r.lines ?? []).some((l) => lineMatchesProduct(l, entry.product)))?.store ?? null;

  // A column where every single cell is a dash is not information, it is six
  // dashes. Before the first receipt that is exactly what "где куплен" and
  // "цена" are, so they appear once there is something to put in them.
  const showStore = shown.some((i) => storeOf(i));
  const showPrice = shown.some((i) => i.price);

  const columns = [
    ["", "tcol-check"],
    ["продукт", ""],
    ["сколько", ""],
    ["зона", ""],
    ["срок", "tcol-life"],
    ...(showStore ? [["где куплен", ""]] : []),
    ...(showPrice ? [["цена", ""]] : []),
  ];

  /** A cell that can be typed over: shows the value, or the editor when opened. */
  const cell = (entry, field, body, cls = "") => {
    if (editing?.id === entry.id && editing.field === field) {
      return `<form class="tedit" data-act-submit="editSave">
        <input class="field field--cell" name="value" value="${esc(entry[field] ?? "")}"
            aria-label="${field === "product" ? "Название" : "Сколько"}" autocomplete="off"
            data-act-blur="editSave" autofocus>
      </form>`;
    }
    return `<span class="${cls} tcell" data-act-dbl="editOpen" data-id="${entry.id}" data-field="${field}"
        title="Двойной клик — правка">${body}</span>`;
  };

  const row = (entry, index, child = false) => {
    const burns = M.isBurning(entry, now);
    const on = selected.has(entry.id);

    return html`<div class="trow${child ? " trow--child" : ""}" data-act="focus" data-id="${entry.id}" data-index="${index}"
        data-burning="${burns ? 1 : 0}" data-focused="${index === cursor ? 1 : 0}"
        data-marked="${on ? 1 : 0}" role="row" tabindex="-1">
      <button class="tcheck" type="button" data-act="mark" data-id="${entry.id}" role="checkbox" aria-checked="${on}"
          aria-label="Выделить ${entry.product}">
        ${raw(on ? icon("i-check", { size: 11, stroke: "#f4f1e6", width: 3 }) : "")}
      </button>
      ${raw(cell(entry, "product", `${esc(entry.product)}${entry.opened ? ` <span class="tflag">вскрыт</span>` : ""}`, "tname"))}
      ${raw(cell(entry, "qty", amountCell(entry)))}
      <span class="tdim">${entry.zone}</span>
      <span class="tlife">${raw(lifeCell(entry, now))}</span>
      ${raw(showStore ? `<span class="tdim">${storeOf(entry) ? esc(storeOf(entry)) : none()}</span>` : "")}
      ${raw(showPrice ? `<span class="tprice num">${entry.price ? esc(fmtMoney(entry.price)) : none()}</span>` : "")}
    </div>`;
  };

  /** The lid over a stack of the same thing: how many, and the nearest date. */
  const stackRow = (stack, isOpen) => {
    const burns = M.isBurning(stack.head, now);
    const zones = [...new Set(stack.entries.map((e) => e.zone))];

    return html`<div class="trow trow--stack" data-act="stack" data-key="${stack.key}"
        data-burning="${burns ? 1 : 0}" data-open="${isOpen ? 1 : 0}" role="row" tabindex="-1">
      <span class="tstack-caret" aria-hidden="true">${raw(icon(isOpen ? "i-chev-down" : "i-chev-right", { size: 14, stroke: "#5f7468" }))}</span>
      <span class="tname">${stack.product} <span class="tflag">${stack.count} ${M.plural(stack.count, "штука", "штуки", "штук")}</span></span>
      <span class="tdim">${isOpen ? "" : stack.entries.map((e) => e.qty).filter(Boolean).join(" + ")}</span>
      <span class="tdim">${zones.length === 1 ? zones[0] : `${zones.length} зоны`}</span>
      <span class="tlife">${raw(isOpen ? "" : lifeCell(stack.head, now))}</span>
      ${raw(showStore ? "<span></span>" : "")}
      ${raw(showPrice ? "<span></span>" : "")}
    </div>`;
  };

  // The running index is the one the cursor and the keyboard use, so it counts
  // across group headings rather than restarting inside each one.
  let index = -1;
  const rows = groups(state).map((g) => {
    const head = g.name
      ? `<div class="trow trow--group" role="row"><span role="rowheader">${esc(g.name)}</span><span class="tdim num">${g.entries.length}</span></div>`
      : "";

    const body = linesOf(g.entries, now).map((line) => line.kind === "stack"
      ? stackRow(line.stack, line.open)
      : row(line.entry, (index += 1), line.child)).join("");

    return head + body;
  }).join("");

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Склад</h1>
          <span class="head-sub num">${items.length} ${M.plural(items.length, "позиция", "позиции", "позиций")} · ${burning.length} ${M.plural(burning.length, "горит", "горят", "горят")} · ${auditText(state, now)}</span>
        </div>
        <form class="search" data-act-submit="search" role="search">
          <label class="sr-only" for="stock-q">Поиск по складу</label>
          ${raw(icon("i-search", { size: 16, stroke: "#5f7468" }))}
          <input class="search-field" id="stock-q" name="q" value="${query}" placeholder="Поиск" autocomplete="off">
          <kbd>/</kbd>
        </form>
        <a class="btn btn--ghost btn--sm" href="#scan">Импорт чека</a>
        <a class="btn btn--sm" href="#audit">Ревизия</a>
      </div>
    </header>

    <div class="toolbar">
      ${raw(addbar(true, true))}
      <span class="toolbar-sep" aria-hidden="true"></span>
      ${raw(groupSwitch())}
      ${raw(filterChips())}
      <span class="toolbar-gap"></span>
      ${raw(marked.length
        ? `<span class="toolbar-bulk">Выделено ${marked.length} ·
             <button class="linkbtn" type="button" data-act="bulkUsed">списать</button> ·
             <button class="linkbtn" type="button" data-act="bulkToList">в список</button> ·
             <button class="linkbtn" type="button" data-act="bulkOpened">вскрыт</button> ·
             <button class="linkbtn linkbtn--danger" type="button" data-act="bulkDelete">удалить</button>
             <span class="toolbar-move">переместить: ${ZONES.map((z) =>
               `<button class="linkbtn" type="button" data-act="bulkZone" data-zone="${esc(z)}">${esc(z)}</button>`).join(" · ")}</span>
           </span>`
        : `<span class="toolbar-hint"><kbd>↑↓</kbd> ходить · <kbd>Space</kbd> выделять · <kbd>Enter</kbd> править · <kbd>Del</kbd> удалить</span>`)}
    </div>

    <div class="split">
      <div class="table" role="table" aria-label="Позиции на складе" data-cols="${columns.length}">
        <div class="trow trow--head" role="row">
          ${raw(columns.map(([name]) => `<span role="columnheader">${esc(name)}</span>`).join(""))}
        </div>
        ${raw(rows || `<div class="empty"><h2>Здесь пусто</h2><p>По этому фильтру ничего нет${query ? ` — по запросу «${esc(query)}» тоже` : ""}.</p></div>`)}
      </div>

      <aside class="inspector" aria-label="Инспектор">${raw(inspector(state, focused, marked, now))}</aside>
    </div>
  </main>`;
}

function inspector(state, entry, marked, now) {
  if (!entry) {
    return html`<div class="pane pane--calm">
      <p class="prose">Выбери строку слева — здесь появится, откуда взялась позиция, сколько её осталось и что из неё можно приготовить.</p>
    </div>`;
  }

  const receipt = state.receipts.find((r) => (r.lines ?? []).some((l) => lineMatchesProduct(l, entry.product)));
  const burns = M.isBurning(entry, now);
  const cookable = rank(state.recipes, alive(state), { now })
    .filter((r) => r.match.have.some((h) => h.item.id === entry.id))
    .slice(0, 3);

  return html`<div class="insp-head">
    <h2 class="insp-name">${entry.product}</h2>
    <div class="chips">
      ${raw(burns ? `<span class="chip chip--alarm">${esc(M.expiryLabel(entry, now))}</span>` : `<span class="chip">${esc(M.expiryLabel(entry, now))}</span>`)}
      ${raw(entry.opened ? `<span class="chip">открыт</span>` : "")}
      <span class="chip">${entry.zone}</span>
    </div>
  </div>

  <div class="insp-block">
    <div class="label">Остаток</div>
    <div class="seg">
      ${raw(["много", "на один раз", "кончился"].map((level) => `<button class="seg-btn" type="button" data-act="level" data-level="${esc(level)}" aria-pressed="${(entry.level ?? "много") === level}">${esc(level)}</button>`).join(""))}
    </div>
  </div>

  <div class="insp-block">
    <div class="label">Где лежит</div>
    <div class="chips">
      ${raw(ZONES.map((z) => `<button class="chip" type="button" data-act="zone1" data-zone="${esc(z)}" aria-pressed="${entry.zone === z}">${esc(z)}</button>`).join(""))}
    </div>
  </div>

  <div class="insp-block">
    <div class="label">Категория</div>
    <div class="chips">
      ${raw(state.aisles.map((a) => `<button class="chip chip--sm" type="button" data-act="aisle" data-aisle="${esc(a.name)}" aria-pressed="${M.aisleOfEntry(entry, state.aisles).name === a.name}">${esc(a.name)}</button>`).join(""))}
    </div>
  </div>

  <div class="insp-block">
    <div class="label">Годен до</div>
    <input class="field field--date" type="date" value="${raw(dateValue(entry))}"
        aria-label="Годен до" data-act-change="expires" data-id="${entry.id}">
    <p class="prose prose--muted">${entry.expires ? "Дата с упаковки — она главнее справочника. Очисти поле, чтобы вернуться к расчёту." : "Пока считается от даты покупки по справочнику. Поставь дату с пачки, если она есть."}</p>
  </div>

  <div class="insp-block">
    <div class="label">Упаковка</div>
    <p class="prose prose--muted">Вскрытое живёт по короткой колонке справочника, и срок пересчитывается со дня, когда вскрыл.</p>
    <button class="btn btn--ghost btn--sm" type="button" data-act="opened1">${entry.opened ? "Закрыть обратно" : "Отметить вскрытым"}</button>
  </div>

  <div class="insp-block">
    <div class="label">Откуда знаю</div>
    <p class="prose">${[
      receipt ? `Чек «${receipt.store}» ${fmtDate(receipt.at)}${entry.price ? `, ${fmtMoney(entry.price)}` : ""}.` : "Добавлено руками.",
      entry.shelfDays ? `Срок ${entry.shelfDays} ${M.plural(entry.shelfDays, "день", "дня", "дней")} — из справочника.` : "Продукта нет в справочнике, срок неизвестен.",
    ].join(" ")}</p>
  </div>

  ${raw(cookable.length ? `<div class="insp-block">
    <div class="label">Успеть съесть</div>
    ${cookable.map((r) => `<a class="insp-row" href="#recipe/${esc(r.recipe.id)}">
      <span>${esc(r.recipe.name)}</span>
      <span class="tdim num">${r.recipe.minutes ? `${r.recipe.minutes} мин · ` : ""}${r.match.ready ? "всё есть" : `нет ${r.match.missing.length}`}</span>
    </a>`).join("")}
  </div>` : "")}

  <div class="insp-foot">
    <a class="btn" href="#item/${entry.id}">Открыть карточку</a>
    <div class="rowbtns">
      <button class="btn btn--ghost btn--grow" type="button" data-act="used">Съел</button>
      <button class="btn btn--ghost btn--danger btn--grow" type="button" data-act="threw">Выбросил</button>
    </div>
  </div>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Склад",

  render(state) {
    if (!alive(state).length) return emptyScreen(state);
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    selected.clear();
    cursor = 0;
    query = "";
    editing = null;
  },

  keys(e, state) {
    if (!wide.matches) return;
    const shown = visible(state);

    // Escape reaches here even from inside the open editor — that is the one
    // key that has to work while typing, because it is how you get out.
    if (e.key === "Escape") {
      if (!editing) return;
      editing = null;
      touch();
      return;
    }

    if (e.key === "Enter") {
      const entry = shown[cursor];
      if (!entry || editing) return;
      e.preventDefault();
      editing = { id: entry.id, field: "product" };
      touch();
      return;
    }

    if (e.key === "Delete") {
      const entry = shown[cursor];
      if (!entry) return;
      e.preventDefault();
      remove([entry]);
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      document.getElementById("stock-q")?.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, Math.min(shown.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
      touch();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      const entry = shown[cursor];
      if (!entry) return;
      selected.has(entry.id) ? selected.delete(entry.id) : selected.add(entry.id);
      touch();
      return;
    }
    if (e.key.toLowerCase() === "e" || e.key === "е") {
      e.preventDefault();
      close(shown[cursor], "used");
    }
  },

  actions: {
    grouping(el) {
      grouping = el.dataset.grouping;
      cursor = 0;
      touch();
    },

    stack(el) {
      const key = el.dataset.key;
      opened.has(key) ? opened.delete(key) : opened.add(key);
      cursor = 0;
      touch();
    },

    editOpen(el) {
      editing = { id: el.dataset.id, field: el.dataset.field };
      touch();
    },

    /** The date printed on the packet outranks any table. */
    expires(el, state) {
      const entry = state.stock.find((i) => i.id === el.dataset.id) ?? visible(state)[cursor];
      if (!entry) return;

      const value = el.value;
      commit("stock.expires", (s) => {
        const target = s.stock.find((i) => i.id === entry.id);
        if (!target) return null;
        target.expires = value ? Date.parse(`${value}T00:00:00Z`) : null;
        target.at = Date.now();
        return { kind: "stock", id: target.id };
      });

      toast(value ? `${entry.product} — срок до ${value}` : `${entry.product} — срок снова из справочника`);
    },

    aisle(el, state) {
      const entry = visible(state)[cursor];
      if (!entry) return;
      const name = el.dataset.aisle;

      commit("stock.aisle", (s) => {
        const target = s.stock.find((i) => i.id === entry.id);
        if (!target) return null;
        // Choosing the aisle the table would have guessed anyway clears the
        // override instead of freezing it: then a better table still helps later.
        target.aisle = M.aisleOf(target.product, s.aisles).name === name ? null : name;
        target.at = Date.now();
        return { kind: "stock", id: target.id };
      });
    },

    /**
     * Saving is idempotent on purpose: it runs on Enter and again on the blur
     * that Enter causes. Writing the same value twice would still stamp a new
     * `at` and push a pointless change through the sync, so an unchanged value
     * closes the editor and touches nothing.
     */
    editSave(node) {
      if (!editing) return;
      const form = node.closest("form") ?? node;
      const value = String(new FormData(form).get("value") ?? "").trim();
      const { id, field } = editing;
      editing = null;

      let changed = false;
      commit("stock.edit", (s) => {
        const entry = s.stock.find((i) => i.id === id);
        if (!entry) return null;
        if (field === "product" && !value) return null;
        if ((entry[field] ?? "") === value) return null;

        entry[field] = value;
        // A renamed product is a different thing to the reference table, so its
        // shelf life is looked up again rather than kept from the old name.
        if (field === "product") {
          const life = M.shelfLife(value, s.shelf, { opened: entry.opened, zone: entry.zone });
          entry.shelfDays = life?.days ?? null;
        }
        entry.at = Date.now();
        changed = true;
        return { kind: "stock", id: entry.id };
      });

      if (!changed) touch();
    },

    zone1(el, state) {
      const entry = visible(state)[cursor];
      if (!entry) return;
      move([entry], el.dataset.zone);
    },

    opened1(_el, state) {
      const entry = visible(state)[cursor];
      if (entry) setOpened([entry], !entry.opened);
    },

    add(form, state) {
      const data = new FormData(form);
      const product = String(data.get("product") ?? "").trim();
      const qty = String(data.get("qty") ?? "").trim();
      if (!product) return;

      const twice = alive(state).some((i) => i.product.toLowerCase() === product.toLowerCase());
      let added = null;

      commit("stock.add", (s) => {
        // The receipt path already knows how to turn a name into a shelf entry —
        // zone and shelf life out of the reference table, bought today. Adding by
        // hand is the same product arriving by a different door, not a second
        // kind of stock item.
        added = toStockItem({ product, qty, zone: zoneFilter ?? undefined }, {
          shelf: s.shelf,
          boughtAt: M.today(),
          id: uid("s"),
        });
        s.stock.push(added);
        return { kind: "stock", id: added.id };
      });

      const life = added?.shelfDays
        ? `${added.shelfDays} ${M.plural(added.shelfDays, "день", "дня", "дней")}`
        : "срок неизвестен";
      toast(twice
        ? `«${product}» уже был на складе — теперь две записи`
        : [product, qty, added?.zone, life].filter(Boolean).join(" · "));

      // commit() re-renders, so this form node is detached: re-query the live one
      // or every addition after the first loses the caret.
      const live = document.querySelector('[data-act-submit="add"]');
      live?.reset();
      live?.querySelector('[name="product"]')?.focus();
    },

    filter(el) {
      filter = el.dataset.filter;
      cursor = 0;
      touch();
    },

    zone(el) {
      zoneFilter = zoneFilter === el.dataset.zone ? null : el.dataset.zone;
      cursor = 0;
      touch();
    },

    focus(el) {
      cursor = Number(el.dataset.index);
      touch();
    },

    mark(el) {
      const id = el.dataset.id;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      touch();
    },

    search(form) {
      query = String(new FormData(form).get("q") ?? "").trim();
      cursor = 0;
      touch();
    },

    level(el, state) {
      const entry = visible(state)[cursor];
      if (!entry) return;
      const level = el.dataset.level;

      commit("stock.level", (s) => {
        const target = s.stock.find((i) => i.id === entry.id);
        if (!target) return null;
        target.level = level;
        target.empty = level === "кончился";
        target.at = Date.now();
        return { kind: "stock", id: target.id };
      });
    },

    used(_el, state) {
      close(visible(state)[cursor], "used");
    },

    threw(_el, state) {
      close(visible(state)[cursor], "threw");
    },

    bulkUsed(_el, state) {
      bulk(state, "used");
    },

    bulkToList(_el, state) {
      const marked = alive(state).filter((i) => selected.has(i.id));
      if (!marked.length) return;

      commit("stock.bulkToList", (s) => {
        for (const entry of marked) {
          const exists = s.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === entry.product.toLowerCase());
          if (exists) continue;
          s.list.push({ id: uid("l"), product: entry.product, qty: entry.qty ?? "", done: false, from: "manual", at: Date.now() });
        }
        return { kind: "list", bulk: true };
      });

      toast(`${marked.length} ${M.plural(marked.length, "позиция", "позиции", "позиций")} в списке`);
      selected.clear();
    },

    bulkZone(el, state) {
      move(alive(state).filter((i) => selected.has(i.id)), el.dataset.zone);
      selected.clear();
    },

    bulkOpened(_el, state) {
      const marked = alive(state).filter((i) => selected.has(i.id));
      // Mixed selections open rather than toggle each one: "вскрыт" as a command
      // has to mean the same thing for every row it is pressed on.
      setOpened(marked, !marked.every((i) => i.opened));
      selected.clear();
    },

    bulkDelete(_el, state) {
      remove(alive(state).filter((i) => selected.has(i.id)));
      selected.clear();
    },
  },
};

/**
 * Deleting says the record should not exist — different from eating the thing,
 * which is what "съел" records. A tombstone rather than a splice, so the removal
 * survives the trip through the other device instead of coming back on sync.
 */
function remove(entries) {
  if (!entries.length) return;
  const ids = entries.map((e) => e.id);
  const undoData = entries.map((e) => ({ id: e.id, at: e.at }));

  commit("stock.remove", (s) => {
    for (const entry of s.stock) if (ids.includes(entry.id)) mark(entry, "deleted", true);
    return { kind: "stock", bulk: true };
  });

  for (const id of ids) selected.delete(id);

  toast(
    entries.length === 1
      ? `${entries[0].product} удалён`
      : `Удалено ${entries.length}`,
    "calm",
    {
      undo: () => commit("stock.undelete", (s) => {
        for (const entry of s.stock) {
          const was = undoData.find((u) => u.id === entry.id);
          if (was) mark(entry, "deleted", false);
        }
        return { kind: "stock", bulk: true };
      }),
    }
  );
}

/** Moving between zones is not cosmetic: a freezer keeps things far longer than a shelf. */
function move(entries, zone) {
  if (!entries.length || !ZONES.includes(zone)) return;
  const ids = entries.map((e) => e.id);

  commit("stock.move", (s) => {
    for (const entry of s.stock) {
      if (!ids.includes(entry.id)) continue;
      entry.zone = zone;
      const life = M.shelfLife(entry.product, s.shelf, { opened: entry.opened, zone });
      if (life) entry.shelfDays = life.days;
      entry.at = Date.now();
    }
    return { kind: "stock", bulk: true };
  });

  toast(entries.length === 1
    ? `${entries[0].product} → ${zone}`
    : `${entries.length} ${M.plural(entries.length, "позиция", "позиции", "позиций")} → ${zone}`);
}

/**
 * Opening a packet starts a new, shorter clock. The reference table has a second
 * column for exactly this, and the countdown restarts from today — the sealed
 * days already spent do not carry over.
 */
function setOpened(entries, opened) {
  if (!entries.length) return;
  const ids = entries.map((e) => e.id);

  commit("stock.opened", (s) => {
    for (const entry of s.stock) {
      if (!ids.includes(entry.id)) continue;
      entry.opened = opened;
      const life = M.shelfLife(entry.product, s.shelf, { opened, zone: entry.zone });
      if (life) {
        entry.shelfDays = life.days;
        if (opened) entry.boughtAt = M.today();
      }
      entry.at = Date.now();
    }
    return { kind: "stock", bulk: true };
  });

  toast(entries.length === 1
    ? `${entries[0].product} — ${opened ? "вскрыт" : "закрыт"}`
    : `${entries.length} ${M.plural(entries.length, "позиция", "позиции", "позиций")} — ${opened ? "вскрыты" : "закрыты"}`);
}

/**
 * Closing a product out records what happened to it. Thrown-away food means the
 * shelf-life guess was too generous, so the reference tightens for that product.
 */
function close(entry, outcome) {
  if (!entry) return;

  commit(`stock.${outcome}`, (s) => {
    const target = s.stock.find((i) => i.id === entry.id);
    if (!target) return null;

    target.empty = true;
    target.outcome = outcome;
    target.closedAt = M.today();
    target.at = Date.now();

    if (outcome === "threw" && target.boughtAt) {
      const lived = M.daysBetween(target.boughtAt, M.today());
      const ref = s.shelf.find((e) => target.product.toLowerCase().includes(e.product));
      if (ref && lived > 0 && lived < ref.closed) ref.closed = lived;
    }

    return { kind: "stock", id: target.id };
  });

  selected.delete(entry.id);
  toast(outcome === "threw" ? `${entry.product} выброшен — срок в справочнике подтянут` : `${entry.product} списан`);
}

function bulk(state, outcome) {
  const marked = alive(state).filter((i) => selected.has(i.id));
  if (!marked.length) return;

  for (const entry of marked) close(entry, outcome);
  toast(`Списано ${marked.length}`);
  selected.clear();
}
