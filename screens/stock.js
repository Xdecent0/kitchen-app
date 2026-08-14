// Stock. Zones on top, then everything sorted by what spoils first.

import { html, raw, icon, esc, cap } from "../lib/dom.js";
import { touch } from "../lib/state.js";
import * as M from "../lib/model.js";

export const ZONES = ["холодильник", "морозилка", "полка", "овощи"];

export const ZONE_ICON = {
  холодильник: "i-carton",
  морозилка: "i-freezer",
  полка: "i-shelf",
  овощи: "i-veg",
};

let filter = "all";
let zoneFilter = null;

export const alive = (state) => state.stock.filter((i) => !i.deleted && !i.empty);

export function stockRow(itemEntry, now = M.today()) {
  const f = M.freshness(itemEntry, now);
  const burning = M.isBurning(itemEntry, now);
  const glyph = ZONE_ICON[itemEntry.zone] ?? "i-shelf";

  const meter = f.share == null
    ? `<span class="row-qty">срок ?</span>`
    : `<span class="meter" data-tone="${f.tone}" role="img" aria-label="${esc(M.expiryLabel(itemEntry, now))}"><i style="width:${Math.round(f.share * 100)}%"></i></span>`;

  return html`<a class="row" href="#item/${itemEntry.id}" data-burning="${burning ? 1 : 0}">
    <span class="tile" aria-hidden="true">${raw(icon(glyph, { size: 19, stroke: burning ? "#c1481f" : "#1c3327" }))}</span>
    <span class="row-main">
      <span class="row-name">${itemEntry.product}</span>
      <span class="row-why">${[itemEntry.qty || itemEntry.level, M.expiryLabel(itemEntry, now)].filter(Boolean).join(" · ")}</span>
    </span>
    ${raw(meter)}
  </a>`;
}

export default {
  title: () => "Склад",

  render(state) {
    const now = M.today();
    const items = alive(state);
    const burning = items.filter((i) => M.isBurning(i, now));

    const auditText = state.lastAudit == null
      ? "ревизии ещё не было"
      : (() => {
          const d = M.daysBetween(state.lastAudit, now);
          return d === 0 ? "ревизия сегодня" : `ревизия ${d} ${M.plural(d, "день", "дня", "дней")} назад`;
        })();

    if (!items.length) {
      return html`<main class="screen">
        <header class="head head--dark"><h1>Склад</h1><span class="head-sub">пусто</span></header>
        <div class="body">
          <div class="empty">
            <h2>О запасах ничего не знаю</h2>
            <p>Склад заполняется сам из чеков: отсканируй QR в подвале чека, и позиции со сроками появятся здесь.</p>
            <a class="btn" href="#scan">Сканировать чек</a>
          </div>
        </div>
      </main>`;
    }

    let shown = items;
    if (filter === "burning") shown = burning;
    if (filter === "low") shown = items.filter((i) => {
      const s = M.freshness(i, now).share;
      return s !== null && s < 0.34;
    });
    if (zoneFilter) shown = shown.filter((i) => i.zone === zoneFilter);

    const zoneCards = ZONES.map((zone) => {
      const inZone = items.filter((i) => i.zone === zone);
      const hot = inZone.filter((i) => M.isBurning(i, now)).length;
      return html`<button class="zone" type="button" data-act="zone" data-zone="${zone}"
          aria-pressed="${zoneFilter === zone}">
        ${raw(icon(ZONE_ICON[zone], { size: 22, stroke: "#1c3327" }))}
        <span class="zone-name">${cap(zone)}</span>
        <span class="zone-meta num">${inZone.length} · ${hot ? `${hot} ${M.plural(hot, "горит", "горят", "горят")}` : "спокойно"}</span>
      </button>`;
    }).join("");

    const heading = [
      filter === "all" ? "всё" : filter === "burning" ? "горит" : "кончается",
      zoneFilter ?? "по сроку",
    ].join(" · ");

    const rows = shown.length
      ? M.sortByUrgency(shown, now).map((i) => stockRow(i, now)).join("")
      : html`<div class="empty">
          <h2>Здесь пусто</h2>
          <p>По этому фильтру ничего нет — редкий случай, когда пустой экран означает, что всё в порядке.</p>
        </div>`;

    return html`<main class="screen">
      <header class="head head--dark">
        <div>
          <h1>Склад</h1>
          <span class="head-sub num">${items.length} ${M.plural(items.length, "позиция", "позиции", "позиций")} · ${burning.length} ${M.plural(burning.length, "горит", "горят", "горят")} · ${auditText}</span>
        </div>
        <div class="chips" role="group" aria-label="Фильтр склада">
          <button class="chip" type="button" data-act="filter" data-filter="all" aria-pressed="${filter === "all"}">всё</button>
          <button class="chip" type="button" data-act="filter" data-filter="burning" aria-pressed="${filter === "burning"}">горит</button>
          <button class="chip" type="button" data-act="filter" data-filter="low" aria-pressed="${filter === "low"}">кончается</button>
        </div>
      </header>

      <div class="body">
        <div class="zones">${raw(zoneCards)}</div>
        <div class="aisle">${heading}</div>
        ${raw(rows)}
      </div>

      <div class="foot">
        <a class="btn btn--grow" href="#audit">Ревизия · 20 сек</a>
        <a class="btn btn--ghost" href="#scan">Чек</a>
      </div>
    </main>`;
  },

  actions: {
    filter(el) {
      filter = el.dataset.filter;
      touch();
    },
    zone(el) {
      zoneFilter = zoneFilter === el.dataset.zone ? null : el.dataset.zone;
      touch();
    },
  },
};
