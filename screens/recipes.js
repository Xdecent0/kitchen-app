// What to cook. Ranked so that whatever rescues a spoiling product comes first.

import { html, raw, icon, esc, toast } from "../lib/dom.js";
import { commit, touch, get } from "../lib/state.js";
import * as M from "../lib/model.js";
import { rank, filterRecipes } from "../lib/recipes.js";
import { alive } from "./stock.js";
import * as gh from "../lib/github.js";
import { parseRecipe } from "../lib/vault.js";

let filter = "burning";
let importing = false;

const FILTERS = [
  { key: "burning", label: "из того, что горит" },
  { key: "quick", label: "до 20 мин" },
  { key: "ready", label: "без магазина" },
  { key: "all", label: "все" },
];

function card(entry) {
  const { recipe, match, rescues } = entry;

  const tags = [
    ...match.have.slice(0, 2).map((h) => `<span class="chip chip--sm">${esc(h.product)} есть</span>`),
    ...match.missing.slice(0, 2).map((m) => `<span class="chip chip--sm chip--dashed">${esc(m.product)} нет</span>`),
  ].join("");

  return html`<a class="rcard" href="#recipe/${recipe.id}">
    <div class="rcard-head">
      <span class="rcard-name">${recipe.name}</span>
      ${raw(rescues.length ? `<span class="chip chip--accent">спасает ${esc(rescues[0].product.toLowerCase())}</span>` : "")}
    </div>
    <span class="rcard-meta num">${[recipe.minutes ? `${recipe.minutes} мин` : null, match.ready ? "всё есть" : `${match.have.length} из ${match.total} продуктов`].filter(Boolean).join(" · ")}</span>
    <div class="chips">${raw(tags)}</div>
  </a>`;
}

export default {
  title: () => "Что приготовить",

  render(state) {
    const stock = alive(state);
    const now = M.today();
    const ranked = rank(state.recipes, stock, { maxMissing: filter === "all" ? 99 : 2, now });
    const burning = stock.filter((i) => M.isBurning(i, now));

    // Nothing spoiling is the normal state, and on that day the default filter
    // used to open the screen empty — which reads as broken rather than calm.
    const wanted = filterRecipes(ranked, filter);
    const fellBack = filter === "burning" && !wanted.length && ranked.length > 0;
    const shown = fellBack ? ranked : wanted;

    const body = !state.recipes.length
      ? html`<div class="empty">
          <h2>Рецептов пока нет</h2>
          <p>Рецепты — markdown-заметки в волте, в папке <code>30 - Личное/Кухня/Рецепты</code>. Их можно писать руками в Obsidian или притащить по ссылке.</p>
          <button class="btn" type="button" data-act="importPrompt">Импортировать по ссылке</button>
        </div>`
      : !shown.length
        ? html`<div class="empty">
            <h2>По этому фильтру пусто</h2>
            <p>Ничего не подходит под «${esc(FILTERS.find((f) => f.key === filter)?.label ?? filter)}». Сними фильтр или загляни после следующей закупки.</p>
            <button class="btn btn--ghost" type="button" data-act="filter" data-filter="all">Показать все</button>
          </div>`
        : shown.map(card).join("");

    return html`<main class="screen">
      <header class="head">
        <h1>Что приготовить</h1>
        <div class="chips" role="group" aria-label="Фильтр рецептов">
          ${raw(FILTERS.map((f) => `<button class="chip" type="button" data-act="filter" data-filter="${f.key}" aria-pressed="${filter === f.key}">${esc(f.label)}</button>`).join(""))}
        </div>
      </header>

      ${raw(burning.length
        ? `<div class="notice notice--alarm">${esc(burning.slice(0, 2).map((b) => `${b.product} — ${M.expiryLabel(b)}`).join(", "))} · начнём с них</div>`
        : fellBack
          ? `<div class="notice">Ничего не горит — показываю всё, что собирается из того, что есть</div>`
          : "")}

      <div class="body">${raw(body)}</div>

      <div class="foot">
        <button class="btn btn--grow" type="button" data-act="importPrompt" ${raw(importing ? "disabled" : "")}>
          ${importing ? "Импортирую…" : "Импортировать по ссылке"}
        </button>
      </div>
    </main>`;
  },

  actions: {
    filter(el) {
      filter = el.dataset.filter;
      touch();
    },

    async importPrompt() {
      const url = prompt("Ссылка на рецепт");
      if (!url) return;

      if (!gh.isConfigured()) {
        toast("Импорт ходит наружу через GitHub Action — сначала подключи репозиторий", "alarm");
        location.hash = "settings";
        return;
      }

      importing = true;
      touch();

      try {
        const id = await gh.submitJob("import-recipe", { url });
        const answer = await gh.awaitJob(id);
        if (answer.error) throw new Error(answer.error);

        const recipe = parseRecipe(answer.name ?? "Рецепт", answer.markdown ?? "");
        commit("recipes.import", (s) => {
          s.recipes = [recipe, ...s.recipes.filter((r) => r.id !== recipe.id)];
          return { kind: "recipes", id: recipe.id };
        });

        toast(`«${recipe.name}» добавлен`);
        location.hash = `recipe/${recipe.id}`;
      } catch (err) {
        toast(`Импорт не вышел: ${err.message}`, "alarm");
      } finally {
        importing = false;
        touch();
      }
    },
  },
};
