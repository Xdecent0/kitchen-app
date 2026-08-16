// The eating log.
//
// Phone: recording. You are in a cafe, you tap, you put the phone away.
// Desktop: reading a rhythm. A month at once shows the Friday you always give
// in to delivery, which a scrollable list of days cannot; and the staples it
// finds are the one thing here that feeds the core — products worth never
// running out of go straight into the list.

import { html, raw, icon, esc, fmtMoney, toast, wide , fmtAlso } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as P from "../lib/planning.js";
import { alive } from "./stock.js";

let window_ = 30;
let adding = false;
let pickedDay = null;

const SOURCE_TONE = { дома: "home", заведение: "out", доставка: "out" };

/* ---------- phone ---------- */

function phone(state) {
  const now = M.today();
  const s = P.trackingSummary(state.meals, window_, now);
  const top = P.staples(state.meals, { days: window_, now });
  const days = Array.from({ length: Math.min(window_, 14) }, (_, i) => now - (Math.min(window_, 14) - 1 - i) * M.DAY);

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
        <span class="head-sub num">${fmtMoney(s.spent)} вне дома</span>
      </div>
      <div class="chips" role="group" aria-label="Период">
        ${raw([7, 30, 90].map((d) => `<button class="chip" type="button" data-act="window" data-days="${d}" aria-pressed="${window_ === d}">${d === 7 ? "неделя" : d === 30 ? "месяц" : "три месяца"}</button>`).join(""))}
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
      </section>` : "")}

      ${raw(adding ? addForm(state) : `<div class="pane"><button class="btn btn--grow" type="button" data-act="add">Записать приём пищи</button></div>`)}

      <div class="aisle">последние дни</div>
      ${raw(timeline)}
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

/** Weeks as rows, weekdays as columns — the shape a rhythm is visible in. */
function calendar(state, now) {
  const start = P.weekStart(now - (window_ - 1) * M.DAY);
  const weeks = Math.ceil((now - start) / (7 * M.DAY)) + 1;
  const heads = P.WEEKDAYS.map((d) => `<span class="cal-head">${esc(d)}</span>`).join("");

  const rows = Array.from({ length: weeks }, (_, w) => {
    const cells = P.WEEKDAYS.map((_, i) => {
      const date = start + (w * 7 + i) * M.DAY;
      if (date > now) return `<span class="cal-cell cal-cell--void"></span>`;

      const meals = P.mealsOn(state.meals, date);
      const cost = meals.reduce((sum, m) => sum + (m.cost ?? 0), 0);
      const dots = P.SLOTS.map((slot) => {
        const meal = meals.find((m) => m.slot === slot);
        const tone = meal ? SOURCE_TONE[meal.source] ?? "out" : "none";
        return `<i data-tone="${tone}"></i>`;
      }).join("");

      return `<button class="cal-cell" type="button" data-act="day" data-date="${date}"
          data-picked="${pickedDay === date ? 1 : 0}" data-today="${date === now ? 1 : 0}"
          aria-label="${new Date(date).toLocaleDateString("ru", { day: "numeric", month: "long" })}, ${meals.length} приёмов">
        <span class="cal-num num">${new Date(date).getUTCDate()}</span>
        <span class="cal-dots" aria-hidden="true">${dots}</span>
        ${cost ? `<span class="cal-cost num">${esc(fmtMoney(Math.round(cost)))}</span>` : ""}
      </button>`;
    }).join("");

    return `<div class="cal-row">${cells}</div>`;
  }).join("");

  return html`<div class="calendar">
    <div class="cal-row cal-row--head">${raw(heads)}</div>
    ${raw(rows)}
    <div class="cal-legend">
      <span><i data-tone="home"></i> дома</span>
      <span><i data-tone="out"></i> вне дома</span>
      <span><i data-tone="none"></i> не записано</span>
    </div>
  </div>`;
}

/** Groceries and eating out in the same frame — the only place both numbers meet. */
function moneyStrip(state, now) {
  const start = P.weekStart(now - (window_ - 1) * M.DAY);
  const weeks = Math.ceil((now - start) / (7 * M.DAY)) + 1;

  const bars = Array.from({ length: weeks }, (_, w) => {
    const from = start + w * 7 * M.DAY;
    const to = from + 7 * M.DAY;

    const groceries = state.receipts.filter((r) => r.at >= from && r.at < to).reduce((sum, r) => sum + (r.total ?? 0), 0);
    const out = state.meals.filter((m) => m.date >= from && m.date < to).reduce((sum, m) => sum + (m.cost ?? 0), 0);
    return { from, to, groceries, out, total: groceries + out };
  });

  const peak = Math.max(1, ...bars.map((b) => b.total));

  return html`<div class="strip">
    <div class="label">Деньги по неделям</div>
    <div class="strip-bars">
      ${raw(bars.map((b) => `<div class="strip-bar" title="${esc(fmtMoney(Math.round(b.total)))}">
        <span class="strip-stack">
          <i class="strip-groceries" style="height:${Math.round((b.groceries / peak) * 100)}%"></i>
          <i class="strip-out" style="height:${Math.round((b.out / peak) * 100)}%"></i>
        </span>
        <span class="strip-label num">${new Date(b.from).getUTCDate()}</span>
      </div>`).join(""))}
    </div>
    <div class="cal-legend">
      <span><i data-tone="groceries"></i> продукты</span>
      <span><i data-tone="out"></i> вне дома</span>
    </div>
  </div>`;
}

function railDay(state, date) {
  const meals = P.mealsOn(state.meals, date);
  const label = new Date(date).toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" });

  return html`<div class="insp-block">
    <h2 class="insp-name">${label}</h2>
    ${raw(meals.length
      ? meals.map((m) => `<div class="insp-row">
          <span>${esc(m.slot)} · ${esc(m.title)}</span>
          <span class="tdim num">${m.cost ? esc(fmtMoney(m.cost)) : esc(m.source)}</span>
        </div>`).join("")
      : `<p class="prose prose--muted">За этот день ничего не записано.</p>`)}
  </div>

  <div class="insp-foot">
    <button class="btn btn--ghost" type="button" data-act="add">Записать приём</button>
    <button class="btn btn--ghost" type="button" data-act="clearDay">Снять выбор</button>
  </div>`;
}

function railPeriod(state, now) {
  const s = P.trackingSummary(state.meals, window_, now);
  const prev = P.trackingSummary(
    state.meals.filter((m) => m.date < now - (window_ - 1) * M.DAY),
    window_,
    now - window_ * M.DAY
  );

  const groceries = state.stores.reduce((sum, st) => sum + P.storeSpend(state.receipts, st.name, window_, now), 0);
  const all = P.staples(state.meals, { days: window_, now, limit: 8 });
  // Only things actually cooked at home can be "kept in stock".
  const top = all.filter((t) => t.kind === "product" && t.home).slice(0, 6);
  const outside = all.filter((t) => t.kind !== "product" || !t.home);
  const stock = alive(state);

  const delta = Math.round((s.homeShare - prev.homeShare) * 100);
  const answer = s.total
    ? {
        value: Math.round(groceries + s.spent).toLocaleString("ru"),
        unit: state.currency,
        money: groceries + s.spent,
        note: `${Math.round(groceries).toLocaleString("ru")} продукты · ${Math.round(s.spent).toLocaleString("ru")} вне дома`,
      }
    : { value: "Нет записей", note: "Отметь пару приёмов пищи, и здесь появится ритм и сумма." };

  return html`<div class="answer">
    <p class="answer-value">${answer.value}${raw(answer.unit ? `<span class="answer-unit">${esc(answer.unit)}</span>` : "")}</p>
    ${raw(answer.money != null ? fmtAlso(answer.money) : "")}
    <p class="answer-note">${answer.note}</p>
  </div>

  ${raw(s.total ? `<div class="insp-block">
    <div class="label">Доля еды дома</div>
    <div class="insp-row">
      <span>${Math.round(s.homeShare * 100)}%</span>
      <span class="tdim num">${prev.total ? (delta === 0 ? "как в прошлом периоде" : `${delta > 0 ? "+" : ""}${delta} к прошлому`) : "не с чем сравнить"}</span>
    </div>
  </div>` : "")}

  ${raw(top.length ? `<div class="insp-block">
    <div class="label">Опоры рациона</div>
    ${top.map((t) => {
      const have = stock.some((i) => i.product.toLowerCase().includes(t.product.toLowerCase()));
      const every = Math.round(window_ / t.times);
      return `<div class="insp-row">
        <span>${esc(t.product)}</span>
        <span class="tdim num">${every > 1 ? `раз в ${every} ${esc(M.plural(every, "день", "дня", "дней"))}` : `${t.times} раз`}${have ? "" : " · нет"}</span>
      </div>`;
    }).join("")}
    <button class="btn btn--ghost" type="button" data-act="staplesToList">Держать всегда</button>
    <p class="prose prose--muted">Кладёт в список то, что ты ешь чаще всего и чего сейчас нет на складе.</p>
  </div>` : "")}

  ${raw(outside.length ? `<div class="insp-block">
    <div class="label">Чаще всего вне дома</div>
    <div class="chips">${outside.slice(0, 5).map((t) => `<span class="chip chip--sm">${esc(t.product)} · ${t.times}</span>`).join("")}</div>
    <p class="prose prose--muted">Это не продукты, а места и заказы, поэтому в список они не идут.</p>
  </div>` : "")}

  <div class="insp-foot">
    <button class="btn btn--ghost" type="button" data-act="add">Записать приём пищи</button>
  </div>`;
}

function desk(state) {
  const now = M.today();

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Трекинг еды</h1>
          <span class="head-sub num">${P.trackingSummary(state.meals, window_, now).total} ${M.plural(P.trackingSummary(state.meals, window_, now).total, "приём", "приёма", "приёмов")} за период</span>
        </div>
      </div>
    </header>

    <div class="toolbar">
      <div class="chips" role="group" aria-label="Период">
        ${raw([30, 90, 180].map((d) => `<button class="chip" type="button" data-act="window" data-days="${d}" aria-pressed="${window_ === d}">${d === 30 ? "месяц" : d === 90 ? "три месяца" : "полгода"}</button>`).join(""))}
      </div>
      <span class="toolbar-gap"></span>
      <button class="btn btn--ghost btn--sm" type="button" data-act="add">Записать приём</button>
    </div>

    <div class="split">
      <div class="table">
        ${raw(calendar(state, now))}
        ${raw(moneyStrip(state, now))}
        ${raw(adding ? addForm(state) : "")}
      </div>
      <aside class="inspector" aria-label="Период">
        ${raw(pickedDay ? railDay(state, pickedDay) : railPeriod(state, now))}
      </aside>
    </div>
  </main>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Трекинг еды",

  render(state) {
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    pickedDay = null;
    adding = false;
  },

  keys(e) {
    if (e.key === "Escape" && (pickedDay || adding)) {
      e.preventDefault();
      pickedDay = null;
      adding = false;
      touch();
    }
  },

  actions: {
    window(el) {
      window_ = Number(el.dataset.days);
      pickedDay = null;
      touch();
    },

    day(el) {
      const date = Number(el.dataset.date);
      pickedDay = pickedDay === date ? null : date;
      touch();
    },

    clearDay() {
      pickedDay = null;
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
          date: pickedDay ?? M.today(),
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

    /** The one place this screen feeds the core: what you eat most, always in stock. */
    staplesToList(_el, state) {
      const now = M.today();
      const top = P.staples(state.meals, { days: window_, now, limit: 8 })
        .filter((t) => t.kind === "product" && t.home);
      const stock = alive(state);
      const missing = top.filter((t) => !stock.some((i) => i.product.toLowerCase().includes(t.product.toLowerCase())));

      if (!missing.length) return toast("Всё, что ты ешь чаще всего, уже на складе");

      let added = 0;
      commit("tracking.staplesToList", (s) => {
        for (const t of missing) {
          const exists = s.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === t.product.toLowerCase());
          if (exists) continue;
          s.list.push({ id: uid("l"), product: t.product, qty: "", done: false, from: "forecast", at: Date.now() });
          added += 1;
        }
        return { kind: "list", bulk: true };
      });

      toast(added ? `${added} ${M.plural(added, "опора", "опоры", "опор")} в списке` : "Уже были в списке");
    },
  },
};

function addForm(state) {
  return html`<section class="pane">
    <div class="head-row">
      <div class="label">Что съел${pickedDay ? ` · ${new Date(pickedDay).toLocaleDateString("ru", { day: "numeric", month: "long" })}` : ""}</div>
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
        <input class="field field--qty" id="meal-cost" name="cost" type="number" min="0" step="10" placeholder="${esc(state.currency)}" inputmode="numeric">
      </div>
      <button class="btn btn--grow" type="submit">Записать</button>
    </form>
  </section>`;
}
