// The week ahead.
//
// Phone: a reference — what is for dinner today, one slot at a time.
// Desktop: a bench for assembling a shop. Twenty-one decisions and their single
// consequence have to be visible together, so the week is a canvas and the
// picker lives in the rail instead of replacing the week the person is planning.

import { html, raw, icon, esc, toast, fmtDate, fmtMoney, wide } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as P from "../lib/planning.js";
import { match, rank } from "../lib/recipes.js";
import { alive } from "./stock.js";
import { lastPrice } from "../lib/trip.js";

let weekOffset = 0;
let picking = null;
let query = "";
let filter = "all";

const startOf = () => P.weekStart() + weekOffset * 7 * M.DAY;

function planned(state, date, slot) {
  const entry = P.planFor(state.menu.filter((m) => !m.deleted), date, slot);
  if (!entry) return null;
  const recipe = state.recipes.find((r) => r.id === entry.recipeId);
  return recipe ? { entry, recipe } : null;
}

/* ---------- phone ---------- */

function phone(state) {
  const start = startOf();
  const days = P.weekDays(start);
  const stock = alive(state);
  const coverage = P.weekCoverage(state.menu, state.recipes, stock, start);
  const gap = P.weekGap(state.menu, state.recipes, stock, start);

  if (picking) return picker(state, stock, { phone: true });

  const grid = html`<div class="week" role="table" aria-label="Меню недели">
    <div class="week-row week-row--head" role="row">
      <span class="week-cell week-cell--corner" role="columnheader"></span>
      ${raw(days.map((d) => `<span class="week-cell week-head" role="columnheader"><b>${esc(d.label)}</b><span class="num">${esc(fmtDate(d.date))}</span></span>`).join(""))}
    </div>
    ${raw(P.SLOTS.map((slot) => `<div class="week-row" role="row">
      <span class="week-cell week-slot" role="rowheader">${esc(slot)}</span>
      ${days.map((d) => {
        const hit = planned(state, d.date, slot);
        if (!hit) return `<span class="week-cell" role="cell"><button class="slot slot--empty" type="button" data-act="pick" data-date="${d.date}" data-slot="${esc(slot)}" aria-label="Запланировать ${esc(slot)}, ${esc(d.label)}">${icon("i-plus", { size: 16, stroke: "#5f7468" })}</button></span>`;
        const m = match(hit.recipe, stock);
        return `<span class="week-cell" role="cell"><button class="slot" type="button" data-act="open" data-recipe="${esc(hit.recipe.id)}" data-ready="${m.ready ? 1 : 0}">
          <span class="slot-name">${esc(hit.recipe.name)}</span>
          <span class="slot-meta num">${m.ready ? "всё есть" : `нет ${m.missing.length}`}</span>
        </button></span>`;
      }).join("")}
    </div>`).join(""))}
  </div>`;

  return html`<main class="screen">
    <header class="head">
      <div class="head-row">
        <h1>Меню недели</h1>
        <span class="head-sub num">${coverage.planned} из ${coverage.slots}</span>
      </div>
      <div class="chips">
        <button class="chip" type="button" data-act="prevWeek">← неделя назад</button>
        <button class="chip" type="button" data-act="thisWeek" aria-pressed="${weekOffset === 0}">эта неделя</button>
        <button class="chip" type="button" data-act="nextWeek">вперёд →</button>
      </div>
    </header>

    <div class="body">
      ${raw(grid)}
      ${raw(gap.length ? `<section class="pane">
        <div class="head-row">
          <div class="label">Чего не хватает на неделю</div>
          <button class="chip" type="button" data-act="gapToList">Всё в список</button>
        </div>
        <div class="chips">${gap.map((g) => `<span class="chip chip--sm chip--dashed">${esc(g.product)}</span>`).join("")}</div>
      </section>` : `<section class="pane pane--calm">
        <div class="label">Закупка не нужна</div>
        <p class="prose">Всё, что запланировано на эту неделю, готовится из того, что уже есть.</p>
      </section>`)}
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

function canvas(state, days, stock) {
  const today = M.today();

  const head = html`<div class="wrow wrow--head">
    <span></span>
    ${raw(P.SLOTS.map((s) => `<span class="wslot-head">${esc(s)}</span>`).join(""))}
  </div>`;

  const rows = days.map((d) => {
    const weekend = d.index >= 5;
    const cells = P.SLOTS.map((slot) => {
      const hit = planned(state, d.date, slot);
      const active = picking && picking.date === d.date && picking.slot === slot;

      if (!hit) {
        return `<button class="wcell wcell--empty" type="button" data-act="pick" data-date="${d.date}" data-slot="${esc(slot)}"
            data-active="${active ? 1 : 0}" aria-label="Запланировать ${esc(slot)}, ${esc(d.label)}">
          ${icon("i-plus", { size: 15, stroke: "#5f7468" })}
        </button>`;
      }

      const m = match(hit.recipe, stock);
      const cost = m.missing.reduce((sum, i) => sum + (lastPrice(state.receipts, i.product) ?? 0), 0);

      return `<button class="wcell" type="button" data-act="pick" data-date="${d.date}" data-slot="${esc(slot)}"
          data-active="${active ? 1 : 0}" data-ready="${m.ready ? 1 : 0}">
        <span class="wcell-name">${esc(hit.recipe.name)}</span>
        ${m.ready
          ? `<span class="wcell-meta">всё есть</span>`
          : `<span class="wcell-meta wcell-meta--gap">нет ${m.missing.length}: ${esc(m.missing.slice(0, 3).map((i) => i.product).join(", "))}</span>`}
        ${cost ? `<span class="wcell-cost num">${esc(fmtMoney(Math.round(cost)))}</span>` : ""}
      </button>`;
    }).join("");

    return html`<div class="wrow" data-today="${d.date === today ? 1 : 0}" data-weekend="${weekend ? 1 : 0}">
      <span class="wday"><b>${d.label}</b><span class="num">${fmtDate(d.date)}</span></span>
      ${raw(cells)}
    </div>`;
  }).join("");

  return html`<div class="weekcanvas">${raw(head)}${raw(rows)}</div>`;
}

/** The rail: the picker while choosing, the week's consequence otherwise. */
function railPicker(state, stock) {
  const ranked = rank(state.recipes, stock, { maxMissing: 99 });
  const q = query.trim().toLowerCase();

  let shown = ranked;
  if (filter === "ready") shown = shown.filter((r) => r.match.ready);
  if (filter === "quick") shown = shown.filter((r) => (r.recipe.minutes ?? 999) <= 20);
  if (filter === "burning") shown = shown.filter((r) => r.rescues.length);
  if (q) shown = shown.filter((r) => r.recipe.name.toLowerCase().includes(q));

  const day = new Date(picking.date).toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" });
  const current = planned(state, picking.date, picking.slot);

  return html`<div class="insp-head">
    <h2 class="insp-name">${picking.slot}</h2>
    <p class="prose prose--muted">${day}</p>
    <form class="search" data-act-submit="search" role="search">
      <label class="sr-only" for="menu-q">Поиск рецепта</label>
      ${raw(icon("i-search", { size: 16, stroke: "#5f7468" }))}
      <input class="search-field" id="menu-q" name="q" value="${query}" placeholder="Поиск" autocomplete="off">
    </form>
    <div class="chips">
      ${raw([["all", "все"], ["ready", "всё есть"], ["quick", "до 20 мин"], ["burning", "спасает срок"]]
        .map(([k, label]) => `<button class="chip chip--sm" type="button" data-act="filter" data-filter="${k}" aria-pressed="${filter === k}">${esc(label)}</button>`).join(""))}
    </div>
  </div>

  <div class="pickerlist">
    ${raw(shown.length
      ? shown.map((r) => `<button class="feed-row" type="button" data-act="choose" data-id="${esc(r.recipe.id)}">
          <span class="feed-main">
            <span class="feed-name">${esc(r.recipe.name)}</span>
            <span class="feed-why">${[r.recipe.minutes ? `${r.recipe.minutes} мин` : null, r.match.ready ? "всё есть" : `не хватает ${r.match.missing.length}`].filter(Boolean).join(" · ")}</span>
          </span>
        </button>`).join("")
      : `<div class="feed-empty"><p class="prose">${q ? `По запросу «${esc(q)}» ничего нет.` : "Под этот фильтр рецептов нет."}</p></div>`)}
  </div>

  <div class="insp-foot">
    ${raw(current ? `<button class="btn btn--ghost" type="button" data-act="clear" data-id="${esc(current.entry.id)}">Убрать «${esc(current.recipe.name)}»</button>` : "")}
    <button class="btn btn--ghost" type="button" data-act="cancelPick">Отмена</button>
  </div>`;
}

function railWeek(state, stock, start) {
  const coverage = P.weekCoverage(state.menu, state.recipes, stock, start);
  const gap = P.weekGap(state.menu, state.recipes, stock, start);
  const split = P.splitByStore(gap.map((g) => ({ ...g, id: g.product })), state.receipts, state.stores);
  const total = gap.reduce((sum, g) => sum + (lastPrice(state.receipts, g.product) ?? 0), 0);

  const answer = !coverage.planned
    ? { value: "Пусто", note: "Ни один приём не запланирован. Нажми на ячейку — подбор появится здесь." }
    : gap.length
      ? { value: total ? Math.round(total).toLocaleString("ru") : String(gap.length), unit: total ? state.currency : M.plural(gap.length, "продукт", "продукта", "продуктов"), note: `столько стоит докупить · ${coverage.ready} из ${coverage.planned} блюд готовятся без магазина` }
      : {
          value: "Ничего не нужно",
          note: coverage.planned === 1
            ? "блюдо собирается из того, что есть"
            : `все ${coverage.planned} ${M.plural(coverage.planned, "блюдо", "блюда", "блюд")} собираются из того, что есть`,
        };

  /* Which single dish drags the most of the shopping — the cheapest thing to drop. */
  const heaviest = state.menu
    .filter((m) => !m.deleted && m.date >= start && m.date < start + 7 * M.DAY)
    .map((m) => state.recipes.find((r) => r.id === m.recipeId))
    .filter(Boolean)
    .map((recipe) => ({ recipe, missing: match(recipe, stock).missing.length }))
    .sort((a, b) => b.missing - a.missing)[0];

  return html`<div class="answer">
    <p class="answer-value">${answer.value}${raw(answer.unit ? `<span class="answer-unit">${esc(answer.unit)}</span>` : "")}</p>
    <p class="answer-note">${answer.note}</p>
  </div>

  ${raw(gap.length ? `<div class="insp-block">
    <div class="label">Что докупить</div>
    ${split.map((g) => `<div class="insp-row">
      <span>${esc(g.store ?? "магазин не ясен")}</span>
      <span class="tdim num">${g.entries.length} ${esc(M.plural(g.entries.length, "продукт", "продукта", "продуктов"))}</span>
    </div>`).join("")}
    <div class="chips">${gap.slice(0, 8).map((g) => `<span class="chip chip--sm chip--dashed">${esc(g.product)}</span>`).join("")}</div>
  </div>` : "")}

  ${raw(heaviest && heaviest.missing > 2 ? `<div class="insp-block">
    <div class="label">Дорогое решение</div>
    <p class="prose">«${esc(heaviest.recipe.name)}» тянет ${heaviest.missing} ${esc(M.plural(heaviest.missing, "продукт", "продукта", "продуктов"))} из списка. Если неделя выходит дорогой, дешевле всего заменить именно его.</p>
  </div>` : "")}

  <div class="insp-foot">
    ${raw(gap.length ? `<button class="btn" type="button" data-act="gapToList">Всё в список · ${gap.length}</button>` : "")}
    <button class="btn btn--ghost" type="button" data-act="repeatWeek">Повторить прошлую неделю</button>
  </div>`;
}

function desk(state) {
  const start = startOf();
  const days = P.weekDays(start);
  const stock = alive(state);
  const coverage = P.weekCoverage(state.menu, state.recipes, stock, start);

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Меню недели</h1>
          <span class="head-sub num">${coverage.planned} из ${coverage.slots} · ${coverage.ready} без магазина</span>
        </div>
      </div>
    </header>

    <div class="toolbar">
      <div class="chips">
        <button class="chip" type="button" data-act="prevWeek">←</button>
        <button class="chip" type="button" data-act="thisWeek" aria-pressed="${weekOffset === 0}">эта неделя</button>
        <button class="chip" type="button" data-act="nextWeek">→</button>
      </div>
      <span class="toolbar-sep" aria-hidden="true"></span>
      <button class="chip" type="button" data-act="clearWeek">Очистить неделю</button>
      <span class="toolbar-gap"></span>
      <span class="toolbar-hint"><kbd>Enter</kbd> подбор · <kbd>Backspace</kbd> очистить ячейку</span>
    </div>

    <div class="split">
      <div class="table">${raw(canvas(state, days, stock))}</div>
      <aside class="inspector" aria-label="${picking ? "Подбор блюда" : "Неделя целиком"}">
        ${raw(picking ? railPicker(state, stock) : railWeek(state, stock, start))}
      </aside>
    </div>
  </main>`;
}

/* ---------- shared picker for the phone ---------- */

function picker(state, stock, { phone: isPhone } = {}) {
  const day = new Date(picking.date).toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" });
  const options = state.recipes
    .map((recipe) => ({ recipe, m: match(recipe, stock) }))
    .sort((a, b) => a.m.missing.length - b.m.missing.length);

  return html`<main class="screen">
    <header class="head">
      <div class="head-row">
        <h1 class="h1--sm">Что готовим</h1>
        <button class="icon-btn icon-btn--sm" type="button" data-act="cancelPick" aria-label="Отмена">${raw(icon("i-close", { size: 18, stroke: "#1c3327" }))}</button>
      </div>
      <span class="head-sub">${picking.slot}, ${day}</span>
    </header>
    <div class="body">
      ${raw(options.length
        ? options.map(({ recipe, m }) => `<button class="row" type="button" data-act="choose" data-id="${esc(recipe.id)}">
            <span class="row-main">
              <span class="row-name">${esc(recipe.name)}</span>
              <span class="row-why">${[recipe.minutes ? `${recipe.minutes} мин` : null, m.ready ? "всё есть" : `не хватает ${m.missing.length}`].filter(Boolean).join(" · ")}</span>
            </span>
          </button>`).join("")
        : `<div class="empty"><h2>Рецептов нет</h2><p>Сначала добавь хотя бы один рецепт.</p><a class="btn" href="#recipes">К рецептам</a></div>`)}
    </div>
  </main>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Меню недели",

  render(state) {
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    picking = null;
    query = "";
    filter = "all";
  },

  keys(e) {
    if (!wide.matches) return;
    if (e.key === "Escape" && picking) {
      e.preventDefault();
      picking = null;
      touch();
    }
  },

  actions: {
    prevWeek() {
      weekOffset -= 1;
      picking = null;
      touch();
    },
    nextWeek() {
      weekOffset += 1;
      picking = null;
      touch();
    },
    thisWeek() {
      weekOffset = 0;
      picking = null;
      touch();
    },

    pick(el) {
      const date = Number(el.dataset.date);
      const slot = el.dataset.slot;
      picking = picking && picking.date === date && picking.slot === slot ? null : { date, slot };
      query = "";
      touch();
    },

    cancelPick() {
      picking = null;
      touch();
    },

    filter(el) {
      filter = el.dataset.filter;
      touch();
    },

    search(form) {
      query = String(new FormData(form).get("q") ?? "").trim();
      touch();
    },

    choose(el) {
      const recipeId = el.dataset.id;
      const { date, slot } = picking;

      commit("menu.set", (s) => {
        const existing = s.menu.find((m) => m.date === date && m.slot === slot && !m.deleted);
        if (existing) {
          existing.recipeId = recipeId;
          existing.at = Date.now();
          return { kind: "menu", id: existing.id };
        }
        const entry = { id: uid("mn"), date, slot, recipeId, at: Date.now() };
        s.menu.push(entry);
        return { kind: "menu", id: entry.id };
      });

      picking = null;
      touch();
    },

    open(el) {
      location.hash = `recipe/${el.dataset.recipe}`;
    },

    clear(el) {
      commit("menu.clear", (s) => {
        const entry = s.menu.find((m) => m.id === el.dataset.id);
        if (!entry) return null;
        entry.deleted = true;
        entry.at = Date.now();
        return { kind: "menu", id: entry.id };
      });
      picking = null;
    },

    clearWeek(_el, state) {
      const start = startOf();
      const end = start + 7 * M.DAY;
      const ids = state.menu.filter((m) => !m.deleted && m.date >= start && m.date < end).map((m) => m.id);
      if (!ids.length) return toast("Неделя и так пуста");

      commit("menu.clearWeek", (s) => {
        for (const entry of s.menu) {
          if (ids.includes(entry.id)) {
            entry.deleted = true;
            entry.at = Date.now();
          }
        }
        return { kind: "menu", bulk: true };
      });

      toast(`Очищено ${ids.length}`, "calm", {
        undo() {
          commit("menu.clearWeek.undo", (s) => {
            for (const entry of s.menu) {
              if (ids.includes(entry.id)) {
                entry.deleted = false;
                entry.at = Date.now();
              }
            }
            return { kind: "menu", bulk: true };
          });
        },
      });
    },

    /** Most weeks repeat themselves; retyping twenty-one slots is the tax for pretending they do not. */
    repeatWeek(_el, state) {
      const start = startOf();
      const prev = start - 7 * M.DAY;
      const source = state.menu.filter((m) => !m.deleted && m.date >= prev && m.date < start);
      if (!source.length) return toast("Прошлая неделя пуста — повторять нечего");

      commit("menu.repeat", (s) => {
        for (const entry of source) {
          const date = entry.date + 7 * M.DAY;
          const existing = s.menu.find((m) => !m.deleted && m.date === date && m.slot === entry.slot);
          if (existing) continue;
          s.menu.push({ id: uid("mn"), date, slot: entry.slot, recipeId: entry.recipeId, at: Date.now() });
        }
        return { kind: "menu", bulk: true };
      });

      toast(`Перенесено ${source.length}`);
    },

    gapToList(_el, state) {
      const gap = P.weekGap(state.menu, state.recipes, alive(state), startOf());
      if (!gap.length) return;

      commit("menu.gapToList", (s) => {
        for (const g of gap) {
          const exists = s.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === g.product.toLowerCase());
          if (exists) continue;
          s.list.push({
            id: uid("l"),
            product: g.product,
            qty: g.qty ?? "",
            done: false,
            from: "recipe",
            forRecipe: g.forRecipes[0] ?? null,
            at: Date.now(),
          });
        }
        return { kind: "list", bulk: true };
      });

      toast(`${gap.length} ${M.plural(gap.length, "продукт", "продукта", "продуктов")} в списке`);
    },
  },
};
