// The shopping list.
//
// Phone: one column of large targets, grouped by store aisle — the job is walking
// the hall and ticking things off.
//
// Desktop: the trip is assembled, not walked. Three zones — what the app suggests,
// the list itself, and the answer panel: the trip's cost up top as one number and
// one sentence, dense context underneath.

import { html, raw, icon, esc, cap, fmtMoney, toast, wide } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as T from "../lib/trip.js";
import { priceHistory } from "../lib/planning.js";

const alive = (state) => state.list.filter((e) => !e.deleted);

let cursor = 0;
let selected = new Set();

/* ---------- shared pieces ---------- */

function reasonOf(entry, state) {
  if (entry.from === "forecast") return M.dueReason(entry.product, state.history);
  if (entry.from === "recipe") return entry.forRecipe ? `для рецепта: ${entry.forRecipe}` : "для рецепта";
  return "";
}

function whoOf(entry, state) {
  if (!entry.takenBy || entry.takenBy === "me") return null;
  return state.people.find((p) => p.id === entry.takenBy)?.name ?? entry.takenBy;
}

/* ---------- phone ---------- */

function phoneRow(entry, state) {
  const why = reasonOf(entry, state);
  const who = whoOf(entry, state);

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

function phone(state) {
  const entries = alive(state);
  const pending = entries.filter((e) => !e.done);
  const done = entries.filter((e) => e.done);
  const share = entries.length ? done.length / entries.length : 0;
  const others = state.people.filter((p) => !p.self);

  const body = !entries.length
    ? html`<div class="empty">
        <h2>Список пуст</h2>
        <p>Либо всё куплено, либо приложение ещё не знает твоих привычек. Отсканируй чек — по нему станет видно, что и как часто ты берёшь.</p>
        <a class="btn" href="#scan">Сканировать чек</a>
      </div>`
    : [
        ...M.groupByAisle(pending, state.aisles).flatMap((group) => [
          html`<div class="aisle">${group.name} · отдел ${group.order}</div>`,
          ...group.entries.map((e) => phoneRow(e, state)),
        ]),
        done.length ? html`<div class="aisle">взято · ${done.length}</div>` : "",
        ...done.map((e) => phoneRow(e, state)),
      ].join("");

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
}

/* ---------- desktop ---------- */

const SOURCES = [
  { key: "burning", title: "горит на складе", tone: "alarm" },
  { key: "rhythm", title: "кончилось по ритму", tone: "" },
  { key: "menu", title: "нет для меню недели", tone: "" },
];

function feeder(state) {
  const sources = T.candidates(state);
  const total = T.candidateCount(sources);

  if (!total) {
    return html`<div class="feed">
      <div class="feed-empty">
        <p class="prose">Предлагать нечего: ритм покупок соблюдён, ничего не горит, меню собрано из того, что есть.</p>
      </div>
    </div>`;
  }

  const blocks = SOURCES.filter((s) => sources[s.key].length).map((s) => {
    const rows = sources[s.key].map((c) => html`<button class="feed-row" type="button" data-act="take"
        data-product="${c.product}" data-qty="${c.qty ?? ""}" data-from="${s.key}">
      <span class="feed-main">
        <span class="feed-name">${c.product}</span>
        <span class="feed-why" data-tone="${s.tone}">${c.reason}</span>
      </span>
      <span class="feed-plus" aria-hidden="true">${raw(icon("i-plus", { size: 15, stroke: "#5f7468" }))}</span>
    </button>`).join("");

    return html`<div class="feed-group">
      <div class="feed-head">
        <span>${s.title}</span>
        <button class="linkbtn" type="button" data-act="takeAll" data-source="${s.key}">взять все · ${sources[s.key].length}</button>
      </div>
      ${raw(rows)}
    </div>`;
  }).join("");

  return html`<div class="feed">${raw(blocks)}</div>`;
}

function tripRow(row, state, index) {
  const { entry } = row;
  const why = reasonOf(entry, state);
  const who = whoOf(entry, state);
  const on = selected.has(entry.id);

  return html`<div class="lrow" data-act="focus" data-id="${entry.id}" data-index="${index}"
      data-focused="${index === cursor ? 1 : 0}" data-done="${entry.done ? 1 : 0}">
    <button class="tcheck" type="button" data-act="tick" data-id="${entry.id}" role="checkbox"
        aria-checked="${entry.done}" aria-label="Отметить ${entry.product}">
      ${raw(entry.done ? icon("i-check", { size: 11, stroke: "#f4f1e6", width: 3 }) : "")}
    </button>
    <span class="lrow-main">
      <span class="lrow-name">${entry.product}</span>
      ${raw(why || who ? `<span class="lrow-why">${esc([why, who ? `взял${who === "я" ? "" : "а"} ${who}` : null].filter(Boolean).join(" · "))}</span>` : "")}
    </span>
    <span class="lrow-qty num">${entry.qty}</span>
    <span class="lrow-price num">${raw(row.price ? esc(fmtMoney(row.price)) : `<span class="tnone" aria-label="цену не знаю">–</span>`)}</span>
    ${raw(on ? `<span class="sr-only">выделено</span>` : "")}
  </div>`;
}

function answerPanel(state, plan) {
  const answer = T.tripAnswer(plan);

  return html`<div class="answer">
    <p class="answer-value">${answer.value}${raw(answer.unit ? `<span class="answer-unit">${esc(answer.unit)}</span>` : "")}</p>
    <p class="answer-note">${answer.note}</p>
  </div>`;
}

function railContext(state, plan, focusedRow) {
  if (focusedRow) {
    const { entry } = focusedRow;
    const history = priceHistory(state.receipts, entry.product).slice(-4);

    return html`<div class="insp-block">
      <h2 class="insp-name">${entry.product}</h2>
      <p class="prose">${reasonOf(entry, state) || "Добавлено руками."}</p>
    </div>

    ${raw(history.length ? `<div class="insp-block">
      <div class="label">Сколько стоило</div>
      ${history.map((h) => `<div class="insp-row"><span>${esc(h.store)}</span><span class="tdim num">${esc(fmtMoney(h.price))} · ${esc(new Date(h.at).toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(/\.$/, ""))}</span></div>`).join("")}
    </div>` : `<div class="insp-block"><div class="label">Сколько стоило</div><p class="prose prose--muted">Этот продукт ещё не встречался в чеках — цену узнаю после первой покупки.</p></div>`)}

    <div class="insp-foot">
      <button class="btn btn--ghost" type="button" data-act="remove" data-id="${entry.id}">Убрать из списка</button>
    </div>`;
  }

  const stores = plan.groups.filter((g) => g.store);
  const unknown = plan.groups.find((g) => !g.store);

  return html`<div class="insp-block">
    <div class="label">Куда ехать</div>
    ${raw(stores.length
      ? stores.map((g) => `<div class="insp-row">
          <span>${esc(g.store)}</span>
          <span class="tdim num">${g.rows.length} ${esc(M.plural(g.rows.length, "позиция", "позиции", "позиций"))}${g.saves ? ` · дешевле на ${esc(fmtMoney(Math.round(g.saves)))}` : ""}</span>
        </div>`).join("")
      : `<p class="prose prose--muted">Где что дешевле — пока не знаю. Нужны чеки хотя бы из двух магазинов по одному продукту.</p>`)}
    ${raw(unknown?.rows.length ? `<div class="insp-row"><span class="tdim">без привязки</span><span class="tdim num">${unknown.rows.length}</span></div>` : "")}
  </div>

  <div class="insp-foot">
    <a class="btn" href="#scan">Сканировать чек</a>
    <button class="btn btn--ghost" type="button" data-act="clearDone">Убрать взятое · ${plan.done.length}</button>
  </div>`;
}

function desk(state) {
  const plan = T.tripPlan(state);
  const rows = [...plan.pending.map((e) => wrap(e, plan)), ...plan.done.map((e) => wrap(e, plan))];
  cursor = Math.min(cursor, Math.max(0, rows.length - 1));
  const focusedRow = rows[cursor] ?? null;

  const grouped = plan.canSplit
    ? plan.groups.flatMap((g) => [
        html`<div class="aisle">${g.store ?? "магазин пока не ясен"} · ${g.rows.length}${g.saves ? ` · дешевле на ${fmtMoney(Math.round(g.saves))}` : ""}</div>`,
        ...g.rows.map((r) => tripRow(r, state, rows.indexOf(r))),
      ])
    : M.groupByAisle(plan.pending, state.aisles).flatMap((group) => [
        html`<div class="aisle">${group.name}</div>`,
        ...group.entries.map((e) => {
          const row = rows.find((r) => r.entry.id === e.id);
          return tripRow(row, state, rows.indexOf(row));
        }),
      ]);

  const doneRows = plan.done.length
    ? [html`<div class="aisle">взято · ${plan.done.length}</div>`, ...plan.done.map((e) => {
        const row = rows.find((r) => r.entry.id === e.id);
        return tripRow(row, state, rows.indexOf(row));
      })]
    : [];

  const field = plan.entries.length
    ? [...grouped, ...doneRows].join("")
    : html`<div class="feed-empty">
        <p class="prose">Список пуст. Слева — то, что приложение уже считает нужным купить; нажми, чтобы добавить.</p>
      </div>`;

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Список</h1>
          <span class="head-sub num">${plan.pending.length} ${M.plural(plan.pending.length, "позиция", "позиции", "позиций")} · ${plan.done.length} отмечено</span>
        </div>
        <span class="toolbar-gap"></span>
        <a class="btn btn--ghost btn--sm" href="#scan">Сканировать чек</a>
      </div>
    </header>

    <div class="toolbar">
      <form class="addbar addbar--flat" data-act-submit="add">
        <input class="field" name="product" placeholder="Добавить продукт" aria-label="Добавить продукт" autocomplete="off" required>
        <input class="field field--qty" name="qty" placeholder="сколько" aria-label="Количество" autocomplete="off">
        <button class="btn btn--ghost btn--sm" type="submit">Добавить</button>
      </form>
      <span class="toolbar-gap"></span>
      <span class="toolbar-hint"><kbd>↑↓</kbd> ходить · <kbd>Space</kbd> отметить · <kbd>Backspace</kbd> убрать</span>
    </div>

    <div class="split">
      <div class="feedwrap">${raw(feeder(state))}</div>
      <div class="table">${raw(field)}</div>
      <aside class="inspector" aria-label="Рейс">
        ${raw(answerPanel(state, plan))}
        ${raw(railContext(state, plan, focusedRow))}
      </aside>
    </div>
  </main>`;
}

function wrap(entry, plan) {
  return plan.groups.flatMap((g) => g.rows).find((r) => r.entry.id === entry.id) ?? { entry, price: null, best: null };
}

/* ---------- screen ---------- */

export default {
  title: () => "Список",

  render(state) {
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    cursor = 0;
    selected.clear();
  },

  keys(e, state) {
    if (!wide.matches) return;
    const plan = T.tripPlan(state);
    const rows = [...plan.pending, ...plan.done];

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, Math.min(rows.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
      touch();
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      toggleEntry(rows[cursor]?.id);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      removeEntry(rows[cursor]?.id);
    }
  },

  actions: {
    toggle(el) {
      toggleEntry(el.dataset.id);
    },

    tick(el) {
      toggleEntry(el.dataset.id);
    },

    focus(el) {
      cursor = Number(el.dataset.index);
      touch();
    },

    remove(el) {
      removeEntry(el.dataset.id);
    },

    take(el) {
      addEntry(el.dataset.product, el.dataset.qty, el.dataset.from === "menu" ? "recipe" : "forecast");
      toast(`${el.dataset.product} — в список`);
    },

    takeAll(el, state) {
      const sources = T.candidates(state);
      const list = sources[el.dataset.source] ?? [];
      if (!list.length) return;

      commit("list.takeAll", (s) => {
        for (const c of list) {
          if (T.inList(s.list, c.product)) continue;
          s.list.push({
            id: uid("l"),
            product: c.product,
            qty: c.qty ?? "",
            done: false,
            from: el.dataset.source === "menu" ? "recipe" : "forecast",
            at: Date.now(),
          });
        }
        return { kind: "list", bulk: true };
      });

      toast(`Добавлено ${list.length}`);
    },

    add(form) {
      const data = new FormData(form);
      const product = String(data.get("product") ?? "").trim();
      if (!product) return;

      addEntry(product, String(data.get("qty") ?? "").trim(), "manual");

      // commit() re-renders the screen, so this form node is already detached —
      // resetting and focusing it would silently do nothing and drop the caret
      // on every single addition. Re-query the live one.
      const live = document.querySelector('[data-act-submit="add"]');
      live?.reset();
      live?.querySelector('[name="product"]')?.focus();
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

/* ---------- mutations ---------- */

function addEntry(product, qty, from) {
  commit("list.add", (s) => {
    if (T.inList(s.list, product)) return null;
    const entry = { id: uid("l"), product, qty: qty ?? "", done: false, from, at: Date.now() };
    s.list.push(entry);
    return { kind: "list", id: entry.id };
  });
}

function toggleEntry(id) {
  if (!id) return;
  commit("list.toggle", (s) => {
    const entry = s.list.find((x) => x.id === id);
    if (!entry) return null;
    entry.done = !entry.done;
    entry.takenBy = entry.done ? "me" : null;
    entry.at = Date.now();
    return { kind: "list", id: entry.id };
  });
}

function removeEntry(id) {
  if (!id) return;
  commit("list.remove", (s) => {
    const entry = s.list.find((x) => x.id === id);
    if (!entry) return null;
    entry.deleted = true;
    entry.at = Date.now();
    return { kind: "list", id: entry.id };
  });
}
