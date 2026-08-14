// Cooking mode: one step at a time, screen awake, and at the end the stock
// steps down by itself — which is the whole reason cooking is tracked at all.

import { html, raw, icon, esc, toast } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import { applyCooking, match } from "../lib/recipes.js";
import { alive } from "./stock.js";

let step = 0;
let wakeLock = null;
let finishedFor = null;

const find = (state, id) => state.recipes.find((r) => r.id === id);
const currentId = () => location.hash.split("/")[1] ?? null;

export default {
  title: (state, id) => `Готовим: ${find(state, id)?.name ?? ""}`,

  render(state, id) {
    const recipe = find(state, id);
    if (!recipe) {
      return html`<main class="screen">
        <header class="head"><h1>Рецепт не найден</h1></header>
        <div class="body"><div class="empty"><h2>Готовить нечего</h2><p>Рецепт не найден — возможно, ссылка устарела.</p><a class="btn" href="#recipes">К рецептам</a></div></div>
      </main>`;
    }

    if (finishedFor === recipe.id) return finished(recipe);

    const total = recipe.steps.length;
    const m = match(recipe, alive(state));

    if (!total) {
      return html`<main class="screen">
        <header class="head"><h1>${recipe.name}</h1></header>
        <div class="body"><div class="empty"><h2>Шагов не записано</h2><p>В заметке рецепта нет раздела с шагами. Можно готовить по памяти и просто отметить, что блюдо сделано.</p></div></div>
        <div class="foot"><button class="btn btn--grow" type="button" data-act="done">Готово</button></div>
      </main>`;
    }

    const current = Math.min(step, total - 1);

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <a class="icon-btn icon-btn--sm" href="#recipe/${recipe.id}" aria-label="Выйти из готовки">${raw(icon("i-close", { size: 18, stroke: "#1c3327" }))}</a>
          <span class="head-sub num">шаг ${current + 1} из ${total}</span>
        </div>
        <h1 class="h1--sm">${recipe.name}</h1>
        <div class="steps" role="img" aria-label="Шаг ${current + 1} из ${total}">
          ${raw(recipe.steps.map((_, i) => `<i data-on="${i <= current ? 1 : 0}"></i>`).join(""))}
        </div>
      </header>

      <div class="body">
        <p class="cook-step">${recipe.steps[current]}</p>

        ${raw(m.missing.length ? `<div class="notice notice--alarm">Не хватает: ${esc(m.missing.map((i) => i.product).join(", "))}</div>` : "")}

        <section class="pane">
          <div class="label">Продукты</div>
          <div class="chips">
            ${raw(recipe.ingredients.map((i) => `<span class="chip chip--sm">${esc(i.product)}${i.qty ? ` · ${esc(i.qty)}` : ""}</span>`).join(""))}
          </div>
        </section>
      </div>

      <div class="foot">
        ${raw(current > 0 ? `<button class="btn btn--ghost" type="button" data-act="prev">Назад</button>` : "")}
        <button class="btn btn--grow" type="button" data-act="${current + 1 >= total ? "done" : "next"}">
          ${current + 1 >= total ? "Готово" : "Дальше"}
        </button>
      </div>
    </main>`;
  },

  async mount() {
    if (finishedFor) return;
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      /* hands are wet, screen will sleep — not worth an error */
    }
  },

  leave() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
    if (finishedFor && finishedFor !== currentId()) {
      finishedFor = null;
      step = 0;
    }
  },

  actions: {
    next() {
      step += 1;
      touch();
    },
    prev() {
      step = Math.max(0, step - 1);
      touch();
    },
    done(_el, state) {
      finish(state);
    },
    restart() {
      step = 0;
      finishedFor = null;
      touch();
    },
  },
};

function finished(recipe) {
  return html`<main class="screen">
    <header class="head"><h1>Готово</h1><span class="head-sub">${recipe.name}</span></header>
    <div class="body">
      <div class="pane pane--calm">
        <div class="label">Что записано</div>
        <p class="prose">Продукты рецепта на складе сдвинулись на ступень вниз, а блюдо попало в трекинг за сегодня. Кончившееся ушло в список покупок.</p>
      </div>
      <p class="prose prose--muted">Количества в домашних рецептах слишком приблизительные, чтобы вычитать граммы, поэтому склад идёт по ступеням: много → на один раз → кончился.</p>
    </div>
    <div class="foot">
      <a class="btn btn--grow" href="#stock">На склад</a>
      <button class="btn btn--ghost" type="button" data-act="restart">Готовить снова</button>
    </div>
  </main>`;
}

/** Cooking is the one moment the app knows for sure that stock went down. */
function finish(state) {
  const recipe = find(state, currentId());
  if (!recipe) return;

  const touched = applyCooking(recipe, alive(state));

  commit("cook.finish", (s) => {
    for (const change of touched) {
      const entry = s.stock.find((i) => i.id === change.id);
      if (!entry) continue;

      entry.level = change.level;
      entry.at = Date.now();

      if (change.empty) {
        entry.empty = true;
        entry.outcome = "used";
        entry.closedAt = M.today();

        const already = s.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === entry.product.toLowerCase());
        if (!already) {
          s.list.push({ id: uid("l"), product: entry.product, qty: "", done: false, from: "forecast", at: Date.now() });
        }
      }
    }

    s.meals.push({
      id: uid("m"),
      date: M.today(),
      slot: guessSlot(),
      source: "дома",
      title: recipe.name,
      recipeId: recipe.id,
      products: recipe.ingredients.map((i) => i.product),
      cost: 0,
      at: Date.now(),
    });

    return { kind: "cook", id: recipe.id };
  });

  finishedFor = recipe.id;
  const emptied = touched.filter((t) => t.empty).length;
  toast(emptied ? `Готово · ${emptied} ${M.plural(emptied, "продукт", "продукта", "продуктов")} кончилось и ушло в список` : "Готово · склад обновлён");
  touch();
}

function guessSlot() {
  const h = new Date().getHours();
  if (h < 11) return "завтрак";
  if (h < 16) return "обед";
  return "ужин";
}
