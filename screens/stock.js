// Stock. On a phone: zones on top, then rows sorted by what spoils first.
// On a desktop: a dense table with an inspector, bulk actions and the keyboard —
// the same data doing a different job, per the approved desktop comp.

import { html, raw, icon, esc, cap, fmtMoney, fmtDate, toast, wide } from "../lib/dom.js";
import { touch, commit, uid } from "../lib/state.js";
import * as M from "../lib/model.js";
import { rank, lineMatchesProduct } from "../lib/recipes.js";
import * as T from "../lib/trip.js";

export const ZONES = ["холодильник", "морозилка", "полка", "овощи"];

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

export const alive = (state) => state.stock.filter((i) => !i.deleted && !i.empty);

function visible(state) {
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
        <p>Склад заполняется сам из чеков: отсканируй QR в подвале чека, и позиции со сроками появятся здесь.</p>
        <a class="btn" href="#scan">Сканировать чек</a>
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

  const heading = [
    filter === "all" ? "всё" : filter === "burning" ? "горит" : "кончается",
    zoneFilter ?? "по сроку",
  ].join(" · ");

  const rows = shown.length
    ? shown.map((i) => stockRow(i, now)).join("")
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
      <div class="aisle">${heading}</div>
      ${raw(rows)}
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

const COLUMNS = ["", "продукт", "зона", "остаток", "срок", "где куплен", "цена"];

function desk(state) {
  const now = M.today();
  const items = alive(state);
  const burning = items.filter((i) => M.isBurning(i, now));
  const shown = visible(state);
  cursor = Math.min(cursor, Math.max(0, shown.length - 1));

  const focused = shown[cursor] ?? null;
  const marked = shown.filter((i) => selected.has(i.id));

  const zoneChips = ZONES.map((zone) => {
    const n = items.filter((i) => i.zone === zone).length;
    return `<button class="chip" type="button" data-act="zone" data-zone="${esc(zone)}" aria-pressed="${zoneFilter === zone}">${esc(zone)} ${n}</button>`;
  }).join("");

  const rows = shown.map((entry, index) => {
    const f = M.freshness(entry, now);
    const burns = M.isBurning(entry, now);
    const receipt = state.receipts.find((r) => (r.lines ?? []).some((l) => lineMatchesProduct(l, entry.product)));
    const on = selected.has(entry.id);

    return html`<div class="trow" data-act="focus" data-id="${entry.id}" data-index="${index}"
        data-burning="${burns ? 1 : 0}" data-focused="${index === cursor ? 1 : 0}" role="row" tabindex="-1">
      <button class="tcheck" type="button" data-act="mark" data-id="${entry.id}" role="checkbox" aria-checked="${on}"
          aria-label="Выделить ${entry.product}">
        ${raw(on ? icon("i-check", { size: 11, stroke: "#f4f1e6", width: 3 }) : "")}
      </button>
      <span class="tname">${entry.product}</span>
      <span class="tdim">${entry.zone}</span>
      <span>${raw(entry.qty || entry.level || none())}</span>
      <span class="${burns ? "tburn" : "tdim"}">${M.expiryLabel(entry, now)}</span>
      <span class="tdim">${raw(receipt?.store ? esc(receipt.store) : none())}</span>
      <span class="tprice num">${raw(entry.price ? esc(fmtMoney(entry.price)) : none())}</span>
    </div>`;
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
      ${raw(filterChips())}
      <span class="toolbar-sep" aria-hidden="true"></span>
      <div class="chips">${raw(zoneChips)}</div>
      <span class="toolbar-gap"></span>
      ${raw(marked.length
        ? `<span class="toolbar-bulk">Выделено ${marked.length} · <button class="linkbtn" type="button" data-act="bulkUsed">списать</button> · <button class="linkbtn" type="button" data-act="bulkToList">в список</button></span>`
        : `<span class="toolbar-hint"><kbd>↑↓</kbd> ходить · <kbd>Space</kbd> выделять · <kbd>E</kbd> списать</span>`)}
    </div>

    <div class="split">
      <div class="table" role="table" aria-label="Позиции на складе">
        <div class="trow trow--head" role="row">
          ${raw(COLUMNS.map((c) => `<span role="columnheader">${esc(c)}</span>`).join(""))}
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
  },

  keys(e, state) {
    if (!wide.matches) return;
    const shown = visible(state);

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
  },
};

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
