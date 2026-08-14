// The shopping list. Grouped by store aisle so the hall is walked once,
// and every forecast line says why it is there.

import { html, raw, icon, esc, toast } from "../lib/dom.js";
import { commit, uid } from "../lib/state.js";
import * as M from "../lib/model.js";

const alive = (state) => state.list.filter((e) => !e.deleted);

function row(entry, state) {
  const why =
    entry.from === "forecast"
      ? M.dueReason(entry.product, state.history)
      : entry.from === "recipe"
        ? `для рецепта${entry.forRecipe ? `: ${entry.forRecipe}` : ""}`
        : "";

  const who = entry.takenBy && entry.takenBy !== "me"
    ? state.people.find((p) => p.id === entry.takenBy)?.name ?? entry.takenBy
    : null;

  return html`<button class="row" type="button" data-act="toggle" data-id="${entry.id}"
      data-done="${entry.done ? 1 : 0}" aria-pressed="${entry.done}">
    <span class="tick" aria-hidden="true">${raw(icon("i-check", { size: 16, stroke: "#f4f1e6" }))}</span>
    <span class="row-main">
      <span class="row-name">${entry.product}</span>
      ${raw(why ? `<span class="row-why">${esc(why)}</span>` : "")}
      ${raw(who ? `<span class="row-why">взял${who === "я" ? "" : "а"} ${esc(who)}</span>` : "")}
    </span>
    ${raw(entry.qty ? `<span class="row-qty num">${esc(entry.qty)}</span>` : "")}
  </button>`;
}

export default {
  title: () => "Магазин",

  render(state) {
    const entries = alive(state);
    const pending = entries.filter((e) => !e.done);
    const done = entries.filter((e) => e.done);
    const share = entries.length ? done.length / entries.length : 0;

    const body = !entries.length
      ? html`<div class="empty">
          <h2>Список пуст</h2>
          <p>Либо всё куплено, либо приложение ещё не знает твоих привычек. Отсканируй чек — по нему станет видно, что и как часто ты берёшь.</p>
          <a class="btn" href="#scan">Сканировать чек</a>
        </div>`
      : [
          ...M.groupByAisle(pending, state.aisles).flatMap((group) => [
            html`<div class="aisle">${group.name} · отдел ${group.order}</div>`,
            ...group.entries.map((e) => row(e, state)),
          ]),
          done.length ? html`<div class="aisle">взято · ${done.length}</div>` : "",
          ...done.map((e) => row(e, state)),
        ].join("");

    const others = state.people.filter((p) => !p.self);

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <h1>Магазин</h1>
          <span class="head-sub num">${done.length} / ${entries.length}</span>
        </div>
        <div class="bar"><i style="transform:scaleX(${share})"></i></div>
      </header>

      ${raw(others.length ? `<div class="notice">${esc(others.map((p) => p.name).join(", "))} тоже видит этот список — отметки сливаются, ничего не теряется</div>` : "")}

      <form class="addbar" data-act-submit="add">
        <input class="field" name="product" placeholder="Добавить продукт" aria-label="Добавить продукт" autocomplete="off" required>
        <input class="field field--qty" name="qty" placeholder="сколько" aria-label="Количество" autocomplete="off">
        <button class="icon-btn" type="submit" aria-label="Добавить">${raw(icon("i-plus", { size: 22, stroke: "#1c3327" }))}</button>
      </form>

      <div class="body">${raw(body)}</div>

      <div class="foot">
        <a class="btn btn--grow" href="#scan">Сканировать чек</a>
        <button class="btn btn--ghost" type="button" data-act="clearDone">Убрать взятое</button>
      </div>
    </main>`;
  },

  actions: {
    toggle(el) {
      commit("list.toggle", (s) => {
        const entry = s.list.find((x) => x.id === el.dataset.id);
        if (!entry) return null;
        entry.done = !entry.done;
        entry.takenBy = entry.done ? "me" : null;
        entry.at = Date.now();
        return { kind: "list", id: entry.id };
      });
    },

    add(form) {
      const data = new FormData(form);
      const product = String(data.get("product") ?? "").trim();
      if (!product) return;

      commit("list.add", (s) => {
        const entry = {
          id: uid("l"),
          product,
          qty: String(data.get("qty") ?? "").trim(),
          done: false,
          from: "manual",
          at: Date.now(),
        };
        s.list.push(entry);
        return { kind: "list", id: entry.id };
      });

      form.reset();
      form.querySelector('[name="product"]').focus();
    },

    clearDone(_el, state) {
      const done = state.list.filter((e) => e.done && !e.deleted);
      if (!done.length) return toast("Взятого пока нет");

      commit("list.clearDone", (s) => {
        for (const entry of s.list) {
          if (entry.done && !entry.deleted) {
            entry.deleted = true;
            entry.at = Date.now();
          }
        }
        return { kind: "list", bulk: true };
      });

      toast(`Убрано ${done.length}`);
    },
  },
};
