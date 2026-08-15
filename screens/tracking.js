// The eating log: home, restaurant, delivery. Kept because "where the money and
// the meals actually go" is a different question from "what is in the fridge".

import { html, raw, icon, esc, fmtMoney, toast } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as P from "../lib/planning.js";

let window_ = 7;
let adding = false;

export default {
  title: () => "Трекинг еды",

  render(state) {
    const now = M.today();
    const s = P.trackingSummary(state.meals, window_, now);
    const top = P.staples(state.meals, { days: window_, now });

    const days = Array.from({ length: window_ }, (_, i) => now - (window_ - 1 - i) * M.DAY);

    const timeline = days.map((date) => {
      const meals = P.mealsOn(state.meals, date);
      const label = new Date(date).toLocaleDateString("ru", { weekday: "short", day: "numeric" });

      return html`<div class="day">
        <div class="day-head">
          <span class="day-name">${label}</span>
          ${raw(meals.length ? `<span class="day-meta num">${meals.length} ${esc(M.plural(meals.length, "приём", "приёма", "приёмов"))}</span>` : `<span class="day-meta">пусто</span>`)}
        </div>
        ${raw(meals.length
          ? meals.map((meal) => `<div class="meal" data-source="${esc(meal.source)}">
              <span class="meal-slot">${esc(meal.slot)}</span>
              <span class="meal-title">${esc(meal.title)}</span>
              <span class="meal-tail num">${meal.cost ? esc(fmtMoney(meal.cost)) : esc(meal.source)}</span>
            </div>`).join("")
          : `<p class="prose prose--muted">Ничего не записано.</p>`)}
      </div>`;
    }).join("");

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <h1>Трекинг еды</h1>
          <span class="head-sub num">${s.total} ${M.plural(s.total, "приём", "приёма", "приёмов")} · ${fmtMoney(s.spent)} вне дома</span>
        </div>
        <div class="chips" role="group" aria-label="Период">
          <button class="chip" type="button" data-act="window" data-days="7" aria-pressed="${window_ === 7}">неделя</button>
          <button class="chip" type="button" data-act="window" data-days="14" aria-pressed="${window_ === 14}">две недели</button>
          <button class="chip" type="button" data-act="window" data-days="30" aria-pressed="${window_ === 30}">месяц</button>
        </div>
      </header>

      <div class="body">
        <div class="figures">
          <div class="figure"><span class="figure-n num">${Math.round(s.homeShare * 100)}%</span><span class="figure-t">приёмов пищи дома</span></div>
          <div class="figure"><span class="figure-n num">${s.bySource["заведение"] ?? 0}</span><span class="figure-t">в заведениях</span></div>
          <div class="figure"><span class="figure-n num">${s.bySource["доставка"] ?? 0}</span><span class="figure-t">доставок</span></div>
        </div>

        ${raw(top.length ? `<section class="pane">
          <div class="label">Чем питаешься чаще всего</div>
          <div class="chips">${top.map((t) => `<span class="chip chip--sm">${esc(t.product)} · ${t.times}</span>`).join("")}</div>
          <p class="prose prose--muted">Эти продукты стоит держать всегда — по ним прогноз работает точнее всего.</p>
        </section>` : "")}

        ${raw(adding ? addForm() : `<div class="pane"><button class="btn btn--grow" type="button" data-act="add">Записать приём пищи</button></div>`)}

        <div class="aisle">последние ${window_} дней</div>
        ${raw(timeline)}
      </div>
    </main>`;
  },

  actions: {
    window(el) {
      window_ = Number(el.dataset.days);
      touch();
    },

    add() {
      adding = true;
      touch();
    },

    cancelAdd() {
      adding = false;
      touch();
    },

    saveMeal(form) {
      const data = new FormData(form);
      const title = String(data.get("title") ?? "").trim();
      if (!title) return;

      commit("meals.add", (s) => {
        const meal = {
          id: uid("m"),
          date: M.today(),
          slot: String(data.get("slot") ?? "обед"),
          source: String(data.get("source") ?? "дома"),
          title,
          cost: Number(data.get("cost") || 0),
          products: [],
          at: Date.now(),
        };
        s.meals.push(meal);
        return { kind: "meals", id: meal.id };
      });

      adding = false;
      toast("Записано");
    },
  },
};

function addForm() {
  return html`<section class="pane">
    <div class="head-row">
      <div class="label">Что съел</div>
      <button class="chip" type="button" data-act="cancelAdd">отмена</button>
    </div>
    <form class="mealform" data-act-submit="saveMeal">
      <input class="field" name="title" placeholder="Название" aria-label="Что съел" autocomplete="off" required>
      <div class="mealform-row">
        <label class="sr-only" for="meal-slot">Приём пищи</label>
        <select class="field" id="meal-slot" name="slot">
          ${raw(P.SLOTS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join(""))}
        </select>
        <label class="sr-only" for="meal-source">Где</label>
        <select class="field" id="meal-source" name="source">
          ${raw(P.MEAL_SOURCES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join(""))}
        </select>
        <label class="sr-only" for="meal-cost">Сколько стоило</label>
        <input class="field field--qty" id="meal-cost" name="cost" type="number" min="0" step="10" placeholder="₽" inputmode="numeric">
      </div>
      <button class="btn btn--grow" type="submit">Записать</button>
    </form>
  </section>`;
}
