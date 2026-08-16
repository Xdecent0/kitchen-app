// Recipes.
//
// Phone: one question — what do I cook today. A ranked feed, the winner is first.
// Desktop: assembly. This is the only place the shopping list is composed ahead
// rather than recorded after the fact, so dishes are ticked and their products
// merge into one set — shoppingGap has existed all along and was never shown.

import { html, raw, icon, esc, toast, fmtMoney, wide } from "../lib/dom.js";
import { commit, uid, touch, get } from "../lib/state.js";
import * as M from "../lib/model.js";
import { rank, filterRecipes, match, shoppingGap } from "../lib/recipes.js";
import { alive } from "./stock.js";
import { lastPrice } from "../lib/trip.js";
import * as gh from "../lib/github.js";
import { parseRecipe, recipeToMarkdown } from "../lib/vault.js";

let filter = "burning";
let importing = false;
let cursor = 0;
let basket = new Set();

const FILTERS = [
  { key: "burning", label: "спасает срок" },
  { key: "quick", label: "до 20 мин" },
  { key: "ready", label: "без магазина" },
  { key: "all", label: "все" },
];

function ranked(state) {
  const stock = alive(state);
  const now = M.today();
  const all = rank(state.recipes, stock, { maxMissing: filter === "all" ? 99 : 3, now });
  const wanted = filterRecipes(all, filter);

  // Nothing spoiling is the normal state; opening empty reads as broken.
  const fellBack = filter === "burning" && !wanted.length && all.length > 0;
  return { list: fellBack ? all : wanted, fellBack, burning: stock.filter((i) => M.isBurning(i, now)) };
}

/* ---------- phone ---------- */

function card(entry) {
  const { recipe, match: m, rescues } = entry;
  const tags = [
    ...m.have.slice(0, 2).map((h) => `<span class="chip chip--sm">${esc(h.product)} есть</span>`),
    ...m.missing.slice(0, 2).map((i) => `<span class="chip chip--sm chip--dashed">${esc(i.product)} нет</span>`),
  ].join("");

  return html`<a class="rcard" href="#recipe/${recipe.id}">
    <div class="rcard-head">
      <span class="rcard-name">${recipe.name}</span>
      ${raw(rescues.length ? `<span class="chip chip--accent">спасает ${esc(rescues[0].product.toLowerCase())}</span>` : "")}
    </div>
    <span class="rcard-meta num">${[recipe.minutes ? `${recipe.minutes} мин` : null, m.ready ? "всё есть" : `${m.have.length} из ${m.total} продуктов`].filter(Boolean).join(" · ")}</span>
    <div class="chips">${raw(tags)}</div>
  </a>`;
}

function phone(state) {
  const { list, fellBack, burning } = ranked(state);

  const body = !state.recipes.length
    ? html`<div class="empty">
        <h2>Рецептов пока нет</h2>
        <p>Рецепты — markdown-заметки в волте, в папке <code>30 - Личное/Кухня/Рецепты</code>. Их можно писать руками в Obsidian или притащить по ссылке.</p>
        <button class="btn" type="button" data-act="importPrompt">Импортировать по ссылке</button>
      </div>`
    : !list.length
      ? html`<div class="empty">
          <h2>По этому фильтру пусто</h2>
          <p>Ничего не подходит под «${esc(FILTERS.find((f) => f.key === filter)?.label ?? filter)}».</p>
          <button class="btn btn--ghost" type="button" data-act="filter" data-filter="all">Показать все</button>
        </div>`
      : list.map(card).join("");

  return html`<main class="screen">
    <header class="head">
      <h1>Что приготовить</h1>
      <div class="chips" role="group" aria-label="Фильтр рецептов">
        ${raw(FILTERS.map((f) => `<button class="chip" type="button" data-act="filter" data-filter="${f.key}" aria-pressed="${filter === f.key}">${esc(f.label)}</button>`).join(""))}
      </div>
    </header>

    ${raw(burning.length
      ? `<div class="notice notice--alarm">${esc(burning.slice(0, 2).map((b) => `${b.product} — ${M.expiryLabel(b)}`).join(", "))} · начнём с них</div>`
      : fellBack ? `<div class="notice">Ничего не горит — показываю всё, что собирается из того, что есть</div>` : "")}

    <div class="body">${raw(body)}</div>

    <div class="foot">
      <button class="btn btn--grow" type="button" data-act="importPrompt" ${raw(importing ? "disabled" : "")}>
        ${importing ? "Импортирую…" : "Импортировать по ссылке"}
      </button>
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

function reel(state, list) {
  if (!list.length) {
    return html`<div class="reel">
      <div class="feed-empty"><p class="prose">${state.recipes.length ? "Под этот фильтр ничего не подходит." : "Рецептов ещё нет. Они живут markdown-заметками в волте, в папке Рецепты."}</p></div>
    </div>`;
  }

  return html`<div class="reel">${raw(list.map((entry, i) => {
    const { recipe, match: m, rescues } = entry;
    const on = basket.has(recipe.id);

    return `<div class="reel-row" data-act="focus" data-index="${i}" data-focused="${i === cursor ? 1 : 0}"
        data-burning="${rescues.length ? 1 : 0}">
      <button class="tcheck" type="button" data-act="basket" data-id="${esc(recipe.id)}" role="checkbox"
          aria-checked="${on}" aria-label="Добавить ${esc(recipe.name)} в набор">
        ${on ? icon("i-check", { size: 11, stroke: "#f4f1e6", width: 3 }) : ""}
      </button>
      <span class="reel-main">
        <span class="reel-name">${esc(recipe.name)}</span>
        ${m.missing.length
          ? `<span class="reel-gap">нет: ${esc(m.missing.map((i2) => i2.product).join(", "))}</span>`
          : `<span class="reel-ok">всё есть</span>`}
      </span>
      <span class="reel-min num">${recipe.minutes ? `${recipe.minutes} мин` : ""}</span>
    </div>`;
  }).join(""))}</div>`;
}

function reading(state, entry) {
  if (!entry) {
    return html`<div class="reading"><div class="feed-empty"><p class="prose">Выбери блюдо слева, чтобы прочитать его целиком.</p></div></div>`;
  }

  const { recipe, match: m, rescues } = entry;

  return html`<div class="reading">
    <div class="reading-top">
      <h2 class="reading-name">${recipe.name}</h2>
      <span class="head-sub num">${[recipe.minutes ? `${recipe.minutes} мин` : null, recipe.servings ? `${recipe.servings} ${M.plural(recipe.servings, "порция", "порции", "порций")}` : null, recipe.difficulty].filter(Boolean).join(" · ")}</span>
      ${raw(rescues.length ? `<div class="chips"><span class="chip chip--alarm">спасает ${esc(rescues.map((r) => r.product.toLowerCase()).join(", "))}</span></div>` : "")}
    </div>

    <div class="reading-body">
      <div class="reading-ings">
        <div class="label">Продукты · ${m.have.length} из ${m.total}</div>
        ${raw(recipe.ingredients.map((ing) => {
          const has = m.have.some((h) => h.product === ing.product);
          return `<div class="ing" data-have="${has ? 1 : 0}">
            <span class="ing-tick" aria-hidden="true">${has ? icon("i-check", { size: 14, stroke: "#f4f1e6" }) : ""}</span>
            <span class="ing-name">${esc(ing.product)}</span>
            <span class="ing-qty num">${esc(ing.qty ?? "")}</span>
          </div>`;
        }).join(""))}
      </div>

      <div class="reading-steps">
        <div class="label">Шаги</div>
        ${raw(recipe.steps.length
          ? `<ol class="steps-list">${recipe.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
          : `<p class="prose prose--muted">В заметке рецепта нет раздела с шагами.</p>`)}
        ${raw(recipe.note ? `<p class="prose">${esc(recipe.note)}</p>` : "")}
      </div>
    </div>

    <div class="reading-foot">
      <a class="btn" href="#cook/${recipe.id}">Готовить</a>
      ${raw(m.missing.length ? `<button class="btn btn--ghost" type="button" data-act="basket" data-id="${esc(recipe.id)}">В набор · нет ${m.missing.length}</button>` : "")}
    </div>
  </div>`;
}

/** The rail is the basket: several dishes merged into one shopping set, no repeats. */
function railBasket(state) {
  const chosen = state.recipes.filter((r) => basket.has(r.id));

  if (!chosen.length) {
    return html`<div class="answer">
      <p class="answer-value">Набор пуст</p>
      <p class="answer-note">Отметь блюда слева — здесь соберётся один список покупок без повторов.</p>
    </div>
    <div class="insp-block">
      <div class="label">Зачем это</div>
      <p class="prose">Выбрал четыре ужина на неделю — и видишь один слитый набор, где молоко для двух блюд стоит одной строкой, а то, что уже в списке, не считается дважды.</p>
    </div>`;
  }

  const gap = shoppingGap(chosen, alive(state));
  const already = gap.filter((g) => state.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === g.product.toLowerCase()));
  const fresh = gap.filter((g) => !already.includes(g));
  const total = fresh.reduce((sum, g) => sum + (lastPrice(state.receipts, g.product) ?? 0), 0);

  return html`<div class="answer">
    <p class="answer-value">${total ? Math.round(total).toLocaleString("ru") : String(fresh.length)}${raw(total ? `<span class="answer-unit">${esc(state.currency)}</span>` : "")}</p>
    <p class="answer-note">${fresh.length
      ? `докупить на ${chosen.length} ${M.plural(chosen.length, "блюдо", "блюда", "блюд")}${already.length ? ` · ${already.length} уже в списке` : ""}${!total ? " · цены появятся после чеков" : ""}`
      : chosen.length === 1
        ? "блюдо готовится из того, что есть"
        : `все ${chosen.length} ${M.plural(chosen.length, "блюдо", "блюда", "блюд")} готовятся из того, что есть`}</p>
  </div>

  <div class="insp-block">
    <div class="label">Блюда · ${chosen.length}</div>
    ${raw(chosen.map((r) => `<div class="insp-row">
      <span>${esc(r.name)}</span>
      <button class="linkbtn tdim" type="button" data-act="basket" data-id="${esc(r.id)}">убрать</button>
    </div>`).join(""))}
  </div>

  ${raw(fresh.length ? `<div class="insp-block">
    <div class="label">Один набор продуктов</div>
    ${fresh.map((g) => `<div class="insp-row">
      <span>${esc(g.product)}</span>
      <span class="tdim num">${g.forRecipes.length > 1 ? `для ${g.forRecipes.length}` : esc(g.forRecipes[0] ?? "")}</span>
    </div>`).join("")}
  </div>` : "")}

  ${raw(already.length ? `<div class="insp-block">
    <div class="label">Уже в списке</div>
    <div class="chips">${already.map((g) => `<span class="chip chip--sm">${esc(g.product)}</span>`).join("")}</div>
  </div>` : "")}

  <div class="insp-foot">
    ${raw(fresh.length ? `<button class="btn" type="button" data-act="basketToList">В список · ${fresh.length}</button>` : "")}
    <button class="btn btn--ghost" type="button" data-act="basketClear">Очистить набор</button>
  </div>`;
}

function desk(state) {
  const { list, fellBack, burning } = ranked(state);
  cursor = Math.min(cursor, Math.max(0, list.length - 1));
  const entry = list[cursor] ?? null;

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Рецепты</h1>
          <span class="head-sub num">${list.length} ${M.plural(list.length, "блюдо", "блюда", "блюд")} · ${basket.size ? `${basket.size} в наборе` : "набор пуст"}</span>
        </div>
        <span class="toolbar-gap"></span>
        <button class="btn btn--ghost btn--sm" type="button" data-act="importPrompt" ${raw(importing ? "disabled" : "")}>
          ${importing ? "Импортирую…" : "Импорт по ссылке"}
        </button>
      </div>
    </header>

    <div class="toolbar">
      <div class="chips" role="group" aria-label="Фильтр рецептов">
        ${raw(FILTERS.map((f) => `<button class="chip" type="button" data-act="filter" data-filter="${f.key}" aria-pressed="${filter === f.key}">${esc(f.label)}</button>`).join(""))}
      </div>
      <span class="toolbar-gap"></span>
      <span class="toolbar-hint"><kbd>↑↓</kbd> ходить · <kbd>Space</kbd> в набор</span>
    </div>

    ${raw(burning.length
      ? `<div class="notice notice--alarm">${esc(burning.slice(0, 3).map((b) => `${b.product} — ${M.expiryLabel(b)}`).join(", "))}</div>`
      : fellBack ? `<div class="notice">Ничего не горит — показываю всё, что собирается из того, что есть</div>` : "")}

    <div class="split">
      ${raw(reel(state, list))}
      ${raw(reading(state, entry))}
      <aside class="inspector" aria-label="Набор">${raw(railBasket(state))}</aside>
    </div>
  </main>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Рецепты",

  render(state) {
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    cursor = 0;
  },

  keys(e, state) {
    if (!wide.matches) return;
    const { list } = ranked(state);
    if (!list.length) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, Math.min(list.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
      touch();
    }
    if (e.key === " ") {
      e.preventDefault();
      const id = list[cursor]?.recipe.id;
      if (!id) return;
      basket.has(id) ? basket.delete(id) : basket.add(id);
      touch();
    }
  },

  actions: {
    filter(el) {
      filter = el.dataset.filter;
      cursor = 0;
      touch();
    },

    focus(el) {
      cursor = Number(el.dataset.index);
      touch();
    },

    basket(el) {
      const id = el.dataset.id;
      basket.has(id) ? basket.delete(id) : basket.add(id);
      touch();
    },

    basketClear() {
      basket.clear();
      touch();
    },

    basketToList(_el, state) {
      const chosen = state.recipes.filter((r) => basket.has(r.id));
      const gap = shoppingGap(chosen, alive(state));
      if (!gap.length) return;

      let added = 0;
      commit("recipes.basketToList", (s) => {
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
          added += 1;
        }
        return { kind: "list", bulk: true };
      });

      basket.clear();
      toast(added ? `${added} ${M.plural(added, "продукт", "продукта", "продуктов")} в списке` : "Всё уже было в списке");
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

        // The vault is where recipes live: the Action only writes its answer into
        // Задания/выход, and the next "Обновить справочники" replaces the whole
        // list with whatever is in Рецепты/ — so a recipe that never got written
        // there simply disappeared, having been promised a note in the vault.
        // Written first, on purpose: state that outlives the write is a lie.
        await gh.writeFile(
          `Рецепты/${recipe.name.replace(/[\\/:*?"<>|]/g, "-")}.md`,
          recipeToMarkdown(recipe),
          { message: `kitchen: рецепт «${recipe.name}»` }
        );

        commit("recipes.import", (s) => {
          s.recipes = [recipe, ...s.recipes.filter((r) => r.id !== recipe.id)];
          return null;
        }, { sync: false });

        toast(`«${recipe.name}» добавлен и записан в волт`);
      } catch (err) {
        toast(`Импорт не вышел: ${err.message}`, "alarm");
      } finally {
        importing = false;
        touch();
      }
    },
  },
};
