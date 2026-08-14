// One dish. Ingredients are checked against the stock, so what is missing is
// one tap from the shopping list.

import { html, raw, icon, esc, toast } from "../lib/dom.js";
import { commit, uid } from "../lib/state.js";
import * as M from "../lib/model.js";
import { match, rescues } from "../lib/recipes.js";
import { alive } from "./stock.js";

const find = (state, id) => state.recipes.find((r) => r.id === id);

export default {
  title: (state, id) => find(state, id)?.name ?? "Рецепт",

  render(state, id) {
    const recipe = find(state, id);
    if (!recipe) {
      return html`<main class="screen">
        <header class="head"><h1>Рецепт не найден</h1></header>
        <div class="body"><div class="empty"><h2>Такого рецепта нет</h2><p>Возможно, он удалён или ссылка устарела.</p><a class="btn" href="#recipes">К рецептам</a></div></div>
      </main>`;
    }

    const stock = alive(state);
    const m = match(recipe, stock);
    const saved = rescues(recipe, stock);

    const rows = recipe.ingredients.map((ing) => {
      const hit = m.have.find((h) => h.product === ing.product);
      return html`<div class="ing" data-have="${hit ? 1 : 0}">
        <span class="ing-tick" aria-hidden="true">${raw(hit ? icon("i-check", { size: 14, stroke: "#f4f1e6" }) : "")}</span>
        <span class="ing-name">${ing.product}</span>
        ${raw(hit
          ? `<span class="ing-qty num">${esc(ing.qty || "")}${ing.qty ? " · " : ""}есть</span>`
          : `<button class="chip chip--alarm" type="button" data-act="toList" data-product="${esc(ing.product)}" data-qty="${esc(ing.qty ?? "")}">в список</button>`)}
      </div>`;
    }).join("");

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <a class="icon-btn icon-btn--sm" href="#recipes" aria-label="Назад к рецептам">${raw(icon("i-back", { size: 18, stroke: "#1c3327" }))}</a>
        </div>
        <h1>${recipe.name}</h1>
        <span class="head-sub num">${[recipe.minutes ? `${recipe.minutes} мин` : null, recipe.servings ? `${recipe.servings} ${M.plural(recipe.servings, "порция", "порции", "порций")}` : null, recipe.difficulty].filter(Boolean).join(" · ")}</span>
      </header>

      <div class="body">
        ${raw(saved.length ? `<div class="notice notice--alarm">Спасает ${esc(saved.map((s) => s.product.toLowerCase()).join(", "))} — ${esc(M.expiryLabel(saved[0]))}</div>` : "")}

        <section class="pane">
          <div class="head-row">
            <div class="label">Продукты · со склада</div>
            <span class="head-sub num">${m.have.length} из ${m.total}</span>
          </div>
          ${raw(rows)}
        </section>

        ${raw(recipe.steps.length ? `<section class="pane">
          <div class="label">Шаги</div>
          <ol class="steps-list">${recipe.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        </section>` : "")}

        ${raw(recipe.note ? `<section class="pane pane--calm"><div class="label">Заметка</div><p class="prose">${esc(recipe.note)}</p></section>` : "")}
      </div>

      <div class="foot">
        <a class="btn btn--grow" href="#cook/${recipe.id}">Готовить</a>
        ${raw(m.missing.length ? `<button class="btn btn--ghost" type="button" data-act="missingToList">Не хватает ${m.missing.length}</button>` : "")}
      </div>
    </main>`;
  },

  actions: {
    toList(el) {
      addToList(el.dataset.product, el.dataset.qty);
      toast(`${el.dataset.product} — в список`);
    },

    missingToList(_el, state) {
      const recipe = find(state, location.hash.split("/")[1]);
      if (!recipe) return;

      const missing = match(recipe, alive(state)).missing;
      for (const ing of missing) addToList(ing.product, ing.qty, recipe.name);
      toast(`${missing.length} ${M.plural(missing.length, "продукт", "продукта", "продуктов")} в списке`);
    },
  },
};

function addToList(product, qty, forRecipe) {
  commit("list.fromRecipe", (s) => {
    const exists = s.list.find((l) => !l.deleted && !l.done && l.product.toLowerCase() === product.toLowerCase());
    if (exists) return null;

    const entry = {
      id: uid("l"),
      product,
      qty: qty ?? "",
      done: false,
      from: "recipe",
      forRecipe: forRecipe ?? null,
      at: Date.now(),
    };
    s.list.push(entry);
    return { kind: "list", id: entry.id };
  });
}
