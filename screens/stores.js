// Stores and prices.
//
// Phone: where to go and what to take — a route, one column, read while walking.
// Desktop: a price matrix. Comparing needs columns, and columns do not exist at
// 375px, so this is the one question a big screen can answer that a phone cannot:
// is it actually cheaper there, and what went up.

import { html, raw, icon, esc, fmtMoney, fmtDate, toast, wide } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as P from "../lib/planning.js";

let selected = null;
let cursor = -1;
let window_ = 90;

const none = '<span class="tnone" aria-label="не встречалось">–</span>';

/** Every product that has ever appeared on a receipt, with its price per store. */
function matrix(state, days = window_) {
  const since = M.today() - days * M.DAY;
  const receipts = state.receipts.filter((r) => r.at >= since);
  const stores = state.stores.map((s) => s.name);
  const products = new Map();

  for (const receipt of receipts) {
    for (const line of receipt.lines ?? []) {
      if (!line.product || line.price == null) continue;
      const key = line.product;
      if (!products.has(key)) products.set(key, { product: key, byStore: new Map(), seen: 0 });

      const row = products.get(key);
      // Unnamed receipts carry prices but no shop, so they cannot join a
      // comparison between shops without inventing one.
      if (!receipt.store) continue;
      if (!row.byStore.has(receipt.store)) row.byStore.set(receipt.store, []);
      row.byStore.get(receipt.store).push(line.price);
      row.seen += 1;
    }
  }

  const rows = [...products.values()].map((row) => {
    const cells = stores.map((store) => {
      const prices = row.byStore.get(store) ?? [];
      if (!prices.length) return { store, price: null, n: 0 };
      return { store, price: prices.reduce((a, b) => a + b, 0) / prices.length, n: prices.length };
    });

    const known = cells.filter((c) => c.price != null).sort((a, b) => a.price - b.price);
    const cheapest = known[0] ?? null;
    const gap = known.length > 1 ? known[known.length - 1].price - known[0].price : 0;
    const times = (state.history[row.product] ?? []).length || 1;

    return { ...row, cells, cheapest, gap, loss: gap * times, comparable: known.length > 1 };
  });

  // Sorted by what the difference actually costs over a year of buying it, so
  // the top of the table answers "where am I overpaying most".
  return { stores, rows: rows.sort((a, b) => b.loss - a.loss) };
}

function answerOf(state, table) {
  const comparable = table.rows.filter((r) => r.comparable);
  const total = Math.round(comparable.reduce((sum, r) => sum + r.loss, 0));

  if (!state.receipts.length) {
    return { value: "Нет чеков", note: "Цены берутся из твоих же чеков. Пока их нет, сравнивать нечего и выдумывать я не буду." };
  }
  if (!comparable.length) {
    return {
      value: `0 из ${table.rows.length}`,
      note: "Чтобы сравнить продукт, нужны покупки в двух разных магазинах. Пока ни по одному такого нет.",
    };
  }

  return {
    value: total ? total.toLocaleString("ru") : String(comparable.length),
    unit: total ? state.currency : M.plural(comparable.length, "продукт", "продукта", "продуктов"),
    note: total
      ? `столько стоит разница за год привычных покупок · сравнение открыто по ${comparable.length} из ${table.rows.length}`
      : `сравнение открыто, но разницы в ценах пока не видно`,
  };
}

/* ---------- phone ---------- */

function phone(state) {
  const list = state.list.filter((e) => !e.deleted && !e.done);
  const plan = P.splitByStore(list, state.receipts, state.stores);

  if (!state.receipts.length) {
    return html`<main class="screen">
      <header class="head"><h1>Магазины</h1></header>
      <div class="body">
        <div class="empty">
          <h2>Сравнивать пока не с чем</h2>
          <p>Цены берутся из твоих же чеков. Пока их нет, приложение не знает, где что дешевле, и врать не будет.</p>
          <a class="btn" href="#scan">Сканировать чек</a>
        </div>
      </div>
    </main>`;
  }

  const blocks = plan.map((p) => html`<section class="pane">
    <div class="head-row">
      <div class="label">${p.store ?? "магазин не выбран"}</div>
      <span class="head-sub num">${p.entries.length} ${M.plural(p.entries.length, "позиция", "позиции", "позиций")}${p.saves ? ` · выгода ${fmtMoney(p.saves)}` : ""}</span>
    </div>
    ${raw(p.entries.map((e) => `<div class="ing" data-have="0">
      <span class="ing-name">${esc(e.product)}</span>
      <span class="ing-qty num">${e.best ? esc(fmtMoney(e.best.price)) : "цену не знаю"}</span>
    </div>`).join(""))}
  </section>`).join("");

  return html`<main class="screen">
    <header class="head"><h1>Магазины</h1><span class="head-sub num">${state.receipts.length} ${M.plural(state.receipts.length, "чек", "чека", "чеков")}</span></header>
    <div class="body">
      ${raw(list.length ? `<div class="aisle">план закупки</div>${blocks}` : `<section class="pane pane--calm"><div class="label">Список пуст</div><p class="prose">Когда в списке что-то появится, разложу его по магазинам: туда, где каждый продукт выходил дешевле.</p></section>`)}
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

function desk(state) {
  const table = matrix(state);
  const answer = answerOf(state, table);
  cursor = cursor < 0 ? -1 : Math.min(cursor, table.rows.length - 1);
  const row = table.rows[cursor] ?? null;

  const cols = `grid-template-columns:1.5fr ${table.stores.map(() => "minmax(96px, 1fr)").join(" ")} 116px`;

  const head = html`<div class="trow trow--head" role="row" style="${cols}">
    <span role="columnheader">продукт</span>
    ${raw(table.stores.map((s) => `<span role="columnheader" style="text-align:right">${esc(s)}</span>`).join(""))}
    <span role="columnheader" style="text-align:right">разница за год</span>
  </div>`;

  const body = table.rows.map((r, i) => {
    const cells = r.cells.map((c) => {
      if (c.price == null) return `<span class="tprice num">${none}</span>`;
      const best = r.comparable && r.cheapest?.store === c.store;
      return `<span class="tprice num${best ? " tbest" : ""}">${esc(fmtMoney(Math.round(c.price)))}${c.n === 1 ? '<span class="tonce" title="одно наблюдение">·1</span>' : ""}</span>`;
    }).join("");

    return html`<div class="trow" role="row" style="${cols}" data-act="pick" data-index="${i}" data-focused="${i === cursor ? 1 : 0}">
      <span class="tname">${r.product}</span>
      ${raw(cells)}
      <span class="tprice num">${raw(r.comparable && r.loss ? esc(fmtMoney(Math.round(r.loss))) : none)}</span>
    </div>`;
  }).join("");

  const field = table.rows.length
    ? html`<div class="table" role="table" aria-label="Цены по магазинам">${raw(head)}${raw(body)}</div>`
    : html`<div class="table"><div class="feed-empty"><p class="prose">В чеках за этот период нет ни одной позиции с ценой. Расширь период или отсканируй чек.</p></div></div>`;

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Магазины</h1>
          <span class="head-sub num">${state.receipts.length} ${M.plural(state.receipts.length, "чек", "чека", "чеков")} · ${table.stores.length} ${M.plural(table.stores.length, "магазин", "магазина", "магазинов")}</span>
        </div>
        <span class="toolbar-gap"></span>
        <a class="btn btn--ghost btn--sm" href="#scan">Импорт чека</a>
      </div>
    </header>

    <div class="toolbar">
      <div class="chips" role="group" aria-label="Период">
        ${raw([30, 90, 365].map((d) => `<button class="chip" type="button" data-act="window" data-days="${d}" aria-pressed="${window_ === d}">${d === 365 ? "год" : `${d} дней`}</button>`).join(""))}
      </div>
      <span class="toolbar-gap"></span>
      <form class="addbar addbar--flat" data-act-submit="addStore">
        <input class="field" name="name" placeholder="Добавить магазин" aria-label="Название магазина" autocomplete="off" required>
        <button class="btn btn--ghost btn--sm" type="submit">Добавить</button>
      </form>
    </div>

    <div class="split">
      ${raw(field)}
      <aside class="inspector" aria-label="Подробности">
        <div class="answer">
          <p class="answer-value">${answer.value}${raw(answer.unit ? `<span class="answer-unit">${esc(answer.unit)}</span>` : "")}</p>
          <p class="answer-note">${answer.note}</p>
        </div>
        ${raw(row ? productPane(state, row) : storesPane(state, table))}
      </aside>
    </div>
  </main>`;
}

/** Price over time, drawn from the receipts themselves rather than described. */
function sparkline(rows, currency) {
  if (rows.length < 2) return "";

  const w = 296;
  const h = 56;
  const prices = rows.map((r) => r.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;

  const points = rows.map((r, i) => {
    const x = (i / (rows.length - 1)) * (w - 8) + 4;
    const y = h - 6 - ((r.price - min) / span) * (h - 14);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = rows[rows.length - 1];
  const [lx, ly] = points[points.length - 1].split(",");

  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img"
      aria-label="Цена менялась от ${Math.round(min)} до ${Math.round(max)} ${esc(currency)}">
    <polyline points="${points.join(" ")}" fill="none" stroke="var(--ink)" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--accent-deep)"/>
  </svg>`;
}

function productPane(state, row) {
  const history = P.priceHistory(state.receipts, row.product);
  const known = row.cells.filter((c) => c.price != null);

  return html`<div class="insp-block">
    <h2 class="insp-name">${row.product}</h2>
    <div class="chips">
      <span class="chip chip--sm">${row.seen} ${M.plural(row.seen, "покупка", "покупки", "покупок")}</span>
      <span class="chip chip--sm">${known.length} ${M.plural(known.length, "магазин", "магазина", "магазинов")}</span>
    </div>
  </div>

  ${raw(history.length > 1 ? `<div class="insp-block">
    <div class="label">Как менялась цена</div>
    ${sparkline(history, state.currency)}
    <p class="prose prose--muted">${esc(fmtDate(history[0].at))} → ${esc(fmtDate(history[history.length - 1].at))}</p>
  </div>` : `<div class="insp-block">
    <div class="label">Как менялась цена</div>
    <p class="prose prose--muted">Одна покупка. Линия появится со второй.</p>
  </div>`)}

  <div class="insp-block">
    <div class="label">По магазинам</div>
    ${raw(known.length
      ? known.sort((a, b) => a.price - b.price).map((c) => `<div class="insp-row">
          <span>${esc(c.store)}</span>
          <span class="tdim num">${esc(fmtMoney(Math.round(c.price)))}${c.n > 1 ? ` · ${c.n} раз` : " · один раз"}</span>
        </div>`).join("")
      : `<p class="prose prose--muted">Цена ни разу не попадала в чек.</p>`)}
    ${raw(!row.comparable ? `<p class="prose prose--muted">Чтобы сравнить, нужна покупка ещё в одном магазине.</p>` : "")}
  </div>

  <div class="insp-foot">
    <button class="btn btn--ghost" type="button" data-act="toList" data-product="${row.product}">В список</button>
  </div>`;
}

function storesPane(state, table) {
  const rows = state.stores.map((store) => {
    const spend = P.storeSpend(state.receipts, store.name, window_);
    const visits = state.receipts.filter((r) => r.store === store.name).length;
    const wins = table.rows.filter((r) => r.comparable && r.cheapest?.store === store.name).length;
    return { store, spend, visits, wins };
  }).sort((a, b) => b.spend - a.spend);

  return html`<div class="insp-block">
    <div class="label">За период</div>
    ${raw(rows.map((r) => `<div class="insp-row">
      <span>${esc(r.store.name)}</span>
      <span class="tdim num">${r.visits ? `${esc(fmtMoney(Math.round(r.spend)))} · ${r.wins} ${esc(M.plural(r.wins, "победа", "победы", "побед"))}` : "чеков не было"}</span>
    </div>`).join(""))}
  </div>

  <div class="insp-block">
    <div class="label">Как это читать</div>
    <p class="prose">Ячейка — средняя цена по чекам за период. Жирным помечено, где дешевле; «·1» значит, что наблюдение всего одно и доверять ему рано. Правая колонка считает, во что обходится разница за год привычных покупок.</p>
  </div>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Магазины",

  render(state) {
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    cursor = -1;
    selected = null;
  },

  keys(e, state) {
    if (!wide.matches) return;
    const table = matrix(state);
    if (!table.rows.length) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, Math.min(table.rows.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
      touch();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cursor = -1;
      touch();
    }
  },

  actions: {
    pick(el) {
      cursor = Number(el.dataset.index);
      touch();
    },

    window(el) {
      window_ = Number(el.dataset.days);
      cursor = -1;
      touch();
    },

    toList(el) {
      const product = el.dataset.product;
      commit("list.fromStores", (s) => {
        const exists = s.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === product.toLowerCase());
        if (exists) return null;
        const entry = { id: uid("l"), product, qty: "", done: false, from: "manual", at: Date.now() };
        s.list.push(entry);
        return { kind: "list", id: entry.id };
      });
      toast(`${product} — в список`);
    },

    addStore(form) {
      const name = String(new FormData(form).get("name") ?? "").trim();
      if (!name) return;

      commit("stores.add", (s) => {
        if (s.stores.some((x) => x.name.toLowerCase() === name.toLowerCase())) return null;
        const store = { id: uid("st"), name, note: "", at: Date.now() };
        s.stores.push(store);
        return { kind: "stores", id: store.id };
      });

      const live = document.querySelector('[data-act-submit="addStore"]');
      live?.reset();
      live?.querySelector('[name="name"]')?.focus();
      toast(`«${name}» добавлен`);
    },
  },
};
