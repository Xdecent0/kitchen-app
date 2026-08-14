// Stores and prices. Every claim here is backed by receipts already scanned —
// with fewer than two observations the app says it does not know yet.

import { html, raw, icon, esc, fmtMoney, fmtDate, toast } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as P from "../lib/planning.js";

let selected = null;

export default {
  title: () => "Магазины",

  render(state) {
    const list = state.list.filter((e) => !e.deleted && !e.done);
    const plan = P.splitByStore(list, state.receipts, state.stores);
    const totalSaves = plan.reduce((sum, p) => sum + p.saves, 0);

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

    const storeCards = state.stores.map((store) => {
      const spend = P.storeSpend(state.receipts, store.name);
      const visits = state.receipts.filter((r) => r.store === store.name).length;
      return html`<button class="scard" type="button" data-act="select" data-store="${store.name}" aria-pressed="${selected === store.name}">
        <span class="scard-name">${store.name}</span>
        <span class="scard-meta num">${visits} ${M.plural(visits, "чек", "чека", "чеков")} · ${fmtMoney(spend)} за месяц</span>
        ${raw(store.note ? `<span class="scard-note">${esc(store.note)}</span>` : "")}
      </button>`;
    }).join("");

    const planBlocks = plan.map((p) => html`<section class="pane">
      <div class="head-row">
        <div class="label">${p.store}</div>
        <span class="head-sub num">${p.entries.length} ${M.plural(p.entries.length, "позиция", "позиции", "позиций")}${p.saves ? ` · выгода ${fmtMoney(p.saves)}` : ""}</span>
      </div>
      ${raw(p.entries.map((e) => `<div class="ing" data-have="0">
        <span class="ing-name">${esc(e.product)}</span>
        <span class="ing-qty num">${e.best ? `${esc(fmtMoney(e.best.price))}${e.best.saves ? ` · дешевле на ${esc(fmtMoney(e.best.saves))}` : ""}` : "цену не знаю"}</span>
      </div>`).join(""))}
    </section>`).join("");

    const detail = selected ? storeDetail(state, selected) : "";

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <h1>Магазины</h1>
          <span class="head-sub num">${totalSaves ? `план закупки экономит ${fmtMoney(totalSaves)}` : "разницы в ценах пока не видно"}</span>
        </div>
      </header>

      <div class="body">
        <div class="scards">${raw(storeCards)}</div>
        ${raw(detail)}

        ${raw(list.length ? `<div class="aisle">план закупки</div>${planBlocks}` : `<section class="pane pane--calm"><div class="label">Список пуст</div><p class="prose">Когда в списке что-то появится, я разложу его по магазинам — туда, где каждый продукт выходил дешевле.</p></section>`)}

        <section class="pane">
          <div class="label">Добавить магазин</div>
          <form class="addbar" data-act-submit="addStore">
            <input class="field" name="name" placeholder="Название" aria-label="Название магазина" autocomplete="off" required>
            <input class="field field--qty" name="note" placeholder="заметка" aria-label="Заметка" autocomplete="off">
            <button class="icon-btn" type="submit" aria-label="Добавить магазин">${raw(icon("i-plus", { size: 22, stroke: "#1c3327" }))}</button>
          </form>
        </section>
      </div>
    </main>`;
  },

  actions: {
    select(el) {
      selected = selected === el.dataset.store ? null : el.dataset.store;
      touch();
    },

    addStore(form) {
      const data = new FormData(form);
      const name = String(data.get("name") ?? "").trim();
      if (!name) return;

      commit("stores.add", (s) => {
        if (s.stores.some((x) => x.name.toLowerCase() === name.toLowerCase())) return null;
        const store = { id: uid("st"), name, note: String(data.get("note") ?? "").trim(), at: Date.now() };
        s.stores.push(store);
        return { kind: "stores", id: store.id };
      });

      form.reset();
      toast(`«${name}» добавлен`);
    },
  },
};

function storeDetail(state, storeName) {
  const receipts = state.receipts.filter((r) => r.store === storeName).slice(0, 4);
  const products = new Map();

  for (const receipt of state.receipts) {
    for (const line of receipt.lines ?? []) {
      if (!line.product) continue;
      products.set(line.product, true);
    }
  }

  const comparisons = [...products.keys()]
    .map((product) => ({ product, best: P.bestStore(state.receipts, product) }))
    .filter((c) => c.best)
    .slice(0, 8);

  const cheapestHere = comparisons.filter((c) => c.best.store === storeName);

  return html`<section class="pane">
    <div class="head-row">
      <div class="label">${storeName}</div>
      <button class="chip" type="button" data-act="select" data-store="${storeName}">свернуть</button>
    </div>

    ${raw(cheapestHere.length
      ? `<p class="prose">Здесь дешевле: ${cheapestHere.map((c) => `${esc(c.product.toLowerCase())} (на ${esc(fmtMoney(c.best.saves))})`).join(", ")}.</p>`
      : `<p class="prose prose--muted">Ни по одному продукту этот магазин пока не выигрывает по цене — или чеков слишком мало, чтобы судить.</p>`)}

    <div class="label">Последние чеки</div>
    ${raw(receipts.length
      ? receipts.map((r) => `<div class="ing" data-have="1">
          <span class="ing-name">${esc(fmtDate(r.at))}</span>
          <span class="ing-qty num">${(r.lines ?? []).length} ${esc(M.plural((r.lines ?? []).length, "позиция", "позиции", "позиций"))} · ${esc(fmtMoney(r.total))}</span>
        </div>`).join("")
      : `<p class="prose prose--muted">Чеков из этого магазина ещё не было.</p>`)}
  </section>`;
}
