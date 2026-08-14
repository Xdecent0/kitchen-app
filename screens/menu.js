// The week ahead. Seven days by three meals; filling a slot pulls whatever the
// dish needs into the shopping list, which is the point of planning at all.

import { html, raw, icon, esc, toast, fmtDate } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as P from "../lib/planning.js";
import { match } from "../lib/recipes.js";
import { alive } from "./stock.js";

let weekOffset = 0;
let picking = null;

const startOf = () => P.weekStart() + weekOffset * 7 * M.DAY;

function slotCell(day, slot, state, stock) {
  const entry = P.planFor(state.menu, day.date, slot);
  const recipe = entry ? state.recipes.find((r) => r.id === entry.recipeId) : null;

  if (!recipe) {
    return html`<button class="slot slot--empty" type="button" data-act="pick" data-date="${day.date}" data-slot="${slot}"
        aria-label="Запланировать ${slot}, ${day.label}">
      ${raw(icon("i-plus", { size: 16, stroke: "#5f7468" }))}
    </button>`;
  }

  const m = match(recipe, stock);
  return html`<button class="slot" type="button" data-act="open" data-id="${entry.id}" data-recipe="${recipe.id}"
      data-ready="${m.ready ? 1 : 0}">
    <span class="slot-name">${recipe.name}</span>
    <span class="slot-meta num">${m.ready ? "всё есть" : `нет ${m.missing.length}`}</span>
  </button>`;
}

export default {
  title: () => "Меню недели",

  render(state) {
    const start = startOf();
    const days = P.weekDays(start);
    const stock = alive(state);
    const coverage = P.weekCoverage(state.menu, state.recipes, stock, start);
    const gap = P.weekGap(state.menu, state.recipes, stock, start);

    if (picking) return picker(state, stock);

    const grid = html`<div class="week" role="table" aria-label="Меню недели">
      <div class="week-row week-row--head" role="row">
        <span class="week-cell week-cell--corner" role="columnheader"></span>
        ${raw(days.map((d) => `<span class="week-cell week-head" role="columnheader">
          <b>${esc(d.label)}</b><span class="num">${esc(fmtDate(d.date))}</span>
        </span>`).join(""))}
      </div>
      ${raw(P.SLOTS.map((slot) => `<div class="week-row" role="row">
        <span class="week-cell week-slot" role="rowheader">${esc(slot)}</span>
        ${days.map((d) => `<span class="week-cell" role="cell">${slotCell(d, slot, state, stock)}</span>`).join("")}
      </div>`).join(""))}
    </div>`;

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <h1>Меню недели</h1>
          <span class="head-sub num">${coverage.planned} из ${coverage.slots} · ${coverage.ready} готовы без магазина</span>
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
          <p class="prose prose--muted">Эти продукты нужны запланированным блюдам, но на складе их нет.</p>
        </section>` : `<section class="pane pane--calm">
          <div class="label">Закупка не нужна</div>
          <p class="prose">Всё, что запланировано на эту неделю, готовится из того, что уже есть.</p>
        </section>`)}
      </div>
    </main>`;
  },

  actions: {
    prevWeek() {
      weekOffset -= 1;
      touch();
    },
    nextWeek() {
      weekOffset += 1;
      touch();
    },
    thisWeek() {
      weekOffset = 0;
      touch();
    },

    pick(el) {
      picking = { date: Number(el.dataset.date), slot: el.dataset.slot };
      touch();
    },

    cancelPick() {
      picking = null;
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

function picker(state, stock) {
  const day = new Date(picking.date).toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" });

  const options = state.recipes
    .map((recipe) => ({ recipe, m: match(recipe, stock) }))
    .sort((a, b) => a.m.missing.length - b.m.missing.length)
    .map(({ recipe, m }) => html`<button class="row" type="button" data-act="choose" data-id="${recipe.id}">
      <span class="row-main">
        <span class="row-name">${recipe.name}</span>
        <span class="row-why">${[recipe.minutes ? `${recipe.minutes} мин` : null, m.ready ? "всё есть" : `не хватает ${m.missing.length}`].filter(Boolean).join(" · ")}</span>
      </span>
    </button>`)
    .join("");

  return html`<main class="screen">
    <header class="head">
      <div class="head-row">
        <h1 class="h1--sm">Что готовим</h1>
        <button class="icon-btn icon-btn--sm" type="button" data-act="cancelPick" aria-label="Отмена">${raw(icon("i-close", { size: 18, stroke: "#1c3327" }))}</button>
      </div>
      <span class="head-sub">${picking.slot}, ${day}</span>
    </header>
    <div class="body">${raw(options || `<div class="empty"><h2>Рецептов нет</h2><p>Сначала добавь хотя бы один рецепт.</p><a class="btn" href="#recipes">К рецептам</a></div>`)}</div>
  </main>`;
}
