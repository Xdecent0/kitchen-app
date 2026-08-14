// Wiring: state in, DOM out. All domain decisions live in lib/model.js.

import * as M from "./lib/model.js";
import { load, save, demoState } from "./lib/store.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let state = load();

// First run has nothing to judge the interface by, so seed the demo once.
if (!state.stock.length && !state.list.length) {
  state = demoState(M.today());
  save(state);
}

const ZONE_ICON = {
  холодильник: "#i-carton",
  морозилка: "#i-freezer",
  полка: "#i-shelf",
  овощи: "#i-veg",
};

let stockFilter = "all";

/* ---------- list ---------- */

function renderList() {
  const body = $("[data-list-body]");
  const pending = state.list.filter((e) => !e.done);
  const done = state.list.filter((e) => e.done);

  $("[data-list-count]").textContent = `${done.length} / ${state.list.length}`;
  $("[data-list-bar]").style.transform =
    `scaleX(${state.list.length ? done.length / state.list.length : 0})`;

  const badge = $("[data-badge-list]");
  badge.hidden = pending.length === 0;
  badge.textContent = String(pending.length);

  if (!state.list.length) {
    body.innerHTML = `
      <div class="empty">
        <h2>Список пуст</h2>
        <p>Либо всё куплено, либо приложение ещё не знает твоих привычек. Отсканируй чек — по нему станет видно, что и как часто ты берёшь.</p>
        <button class="btn" data-act="scan">Сканировать чек</button>
      </div>`;
    return;
  }

  const groups = M.groupByAisle(pending, state.aisles);
  const parts = [];

  for (const group of groups) {
    parts.push(`<div class="aisle">${esc(group.name)} · отдел ${group.order}</div>`);
    for (const entry of group.entries) parts.push(listRow(entry));
  }

  if (done.length) {
    parts.push(`<div class="aisle">взято · ${done.length}</div>`);
    for (const entry of done) parts.push(listRow(entry));
  }

  body.innerHTML = parts.join("");
}

function listRow(entry) {
  const why = entry.from === "forecast" ? M.dueReason(entry.product, state.history) : "";
  return `
    <button class="row" data-done="${entry.done ? 1 : 0}" data-toggle="${esc(entry.id)}"
            aria-pressed="${entry.done}">
      <span class="tick" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="#fcfaf2"><use href="#i-check"/></svg>
      </span>
      <span class="row-main">
        <span class="row-name">${esc(entry.product)}</span>
        ${why ? `<span class="row-why">${esc(why)}</span>` : ""}
      </span>
      ${entry.qty ? `<span class="row-qty num">${esc(entry.qty)}</span>` : ""}
    </button>`;
}

/* ---------- stock ---------- */

function renderStock() {
  const body = $("[data-stock-body]");
  const now = M.today();
  const burning = state.stock.filter((i) => M.isBurning(i, now));

  const auditAgo = state.lastAudit == null
    ? "ревизии ещё не было"
    : `ревизия ${M.daysBetween(state.lastAudit, now)} ${M.plural(M.daysBetween(state.lastAudit, now), "день", "дня", "дней")} назад`;

  $("[data-stock-sub]").textContent = state.stock.length
    ? `${state.stock.length} ${M.plural(state.stock.length, "позиция", "позиции", "позиций")} · ${burning.length} ${M.plural(burning.length, "горит", "горят", "горят")} · ${auditAgo}`
    : "пусто";

  const badge = $("[data-badge-stock]");
  badge.hidden = burning.length === 0;
  badge.textContent = String(burning.length);

  if (!state.stock.length) {
    body.innerHTML = `
      <div class="empty">
        <h2>О запасах ничего не знаю</h2>
        <p>Склад заполняется сам из чеков: отсканируй QR в подвале чека, и позиции со сроками появятся здесь.</p>
        <button class="btn" data-act="scan">Сканировать чек</button>
      </div>`;
    return;
  }

  const zones = ["холодильник", "морозилка", "полка", "овощи"];
  const zoneCards = zones
    .map((zone) => {
      const items = state.stock.filter((i) => i.zone === zone);
      const hot = items.filter((i) => M.isBurning(i, now)).length;
      return `
        <button class="zone" data-filter-zone="${esc(zone)}">
          <svg width="22" height="22" viewBox="0 0 24 24" stroke="#1c3327" aria-hidden="true"><use href="${ZONE_ICON[zone]}"/></svg>
          <span class="zone-name">${esc(cap(zone))}</span>
          <span class="zone-meta num">${items.length} · ${hot ? `${hot} ${M.plural(hot, "горит", "горят", "горят")}` : "спокойно"}</span>
        </button>`;
    })
    .join("");

  let items = state.stock;
  if (stockFilter === "burning") items = burning;
  if (stockFilter === "low") items = state.stock.filter((i) => M.freshness(i, now).share !== null && M.freshness(i, now).share < 0.34);

  const rows = M.sortByUrgency(items, now).map(stockRow).join("");
  const heading = stockFilter === "all" ? "всё · по сроку" : `${stockFilter === "burning" ? "горит" : "кончается"} · ${items.length}`;

  const nothing = items.length
    ? ""
    : `<div class="empty"><h2>Ничего не горит</h2><p>По этому фильтру пусто — редкий случай, когда пустой экран означает, что всё хорошо.</p></div>`;

  body.innerHTML = `<div class="zones">${zoneCards}</div><div class="aisle">${esc(heading)}</div>${rows}${nothing}`;
}

function stockRow(item) {
  const now = M.today();
  const f = M.freshness(item, now);
  const burning = M.isBurning(item, now);
  const icon = ZONE_ICON[item.zone] ?? "#i-shelf";

  const meter = f.share == null
    ? `<span class="row-qty">срок ?</span>`
    : `<span class="meter" data-tone="${f.tone}" role="img" aria-label="${esc(M.expiryLabel(item, now))}"><i style="width:${Math.round(f.share * 100)}%"></i></span>`;

  return `
    <div class="row" data-burning="${burning ? 1 : 0}">
      <span class="tile" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 24 24" stroke="${burning ? "#c1481f" : "#1c3327"}"><use href="${icon}"/></svg>
      </span>
      <span class="row-main">
        <span class="row-name">${esc(item.product)}</span>
        <span class="row-why">${esc(item.qty)} · ${esc(M.expiryLabel(item, now))}</span>
      </span>
      ${meter}
    </div>`;
}

/* ---------- receipts ---------- */

function renderReceipts() {
  const body = $("[data-receipts-body]");
  if (!state.receipts.length) {
    body.innerHTML = `
      <div class="empty">
        <h2>Чеков ещё нет</h2>
        <p>QR в подвале фискального чека даёт чистые позиции — правки почти не нужны. Если QR нет, приложение распознает фото, но строки придётся поправить руками.</p>
        <button class="btn" data-act="scan">Сканировать чек</button>
      </div>`;
    return;
  }
  body.innerHTML = state.receipts.map((r) => `<div class="row"><span class="row-main"><span class="row-name">${esc(r.shop)}</span><span class="row-why">${esc(r.date)} · ${r.lines} строк</span></span></div>`).join("");
}

/* ---------- shell ---------- */

function show(tab) {
  $$(".screen").forEach((s) => s.toggleAttribute("data-active", s.id === `screen-${tab}`));
  $$(".tab").forEach((t) => {
    const on = t.dataset.tab === tab;
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  location.hash = tab;
}

function renderAll() {
  renderList();
  renderStock();
  renderReceipts();
}

function tickClock() {
  const el = $("[data-clock]");
  if (el) el.textContent = new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}

function setConn() {
  const el = $("[data-conn]");
  const online = navigator.onLine;
  el.dataset.state = online ? "online" : "offline";
  el.textContent = online ? "на связи" : "офлайн · отметки копятся";
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) return show(tab.dataset.tab);

  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const entry = state.list.find((x) => x.id === toggle.dataset.toggle);
    if (entry) {
      entry.done = !entry.done;
      save(state);
      renderList();
    }
    return;
  }

  const filter = e.target.closest("[data-filter]");
  if (filter) {
    stockFilter = filter.dataset.filter;
    $$("[data-filter]").forEach((c) => c.setAttribute("aria-pressed", String(c === filter)));
    renderStock();
    return;
  }

  const zone = e.target.closest("[data-filter-zone]");
  if (zone) {
    stockFilter = "all";
    $$("[data-filter]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.filter === "all")));
    renderStock();
    return;
  }

  const act = e.target.closest("[data-act]");
  if (act) console.info("action pending implementation:", act.dataset.act);
});

window.addEventListener("online", setConn);
window.addEventListener("offline", setConn);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

show(location.hash.slice(1) || "list");
renderAll();
setConn();
tickClock();
setInterval(tickClock, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
