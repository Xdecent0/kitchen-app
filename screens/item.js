// One stock item. Says how much is left, where the number came from,
// and what to cook so it does not become rubbish.

import { html, raw, icon, esc, cap, fmtDate, fmtMoney, toast } from "../lib/dom.js";
import { commit, uid } from "../lib/state.js";
import * as M from "../lib/model.js";
import { rank, LEVELS, lineMatchesProduct } from "../lib/recipes.js";
import { ZONE_ICON, ZONES } from "./stock.js";

const find = (state, id) => state.stock.find((i) => i.id === id);

export default {
  title: (state, id) => find(state, id)?.product ?? "Запас",

  render(state, id) {
    const entry = find(state, id);
    if (!entry) {
      return html`<main class="screen">
        <header class="head"><h1>Позиция не найдена</h1></header>
        <div class="body"><div class="empty"><h2>Её больше нет</h2><p>Позицию списали или удалили. На складе её уже не показываем.</p><a class="btn" href="#stock">На склад</a></div></div>
      </main>`;
    }

    const now = M.today();
    const f = M.freshness(entry, now);
    const burning = M.isBurning(entry, now);
    const receipt = state.receipts.find((r) => (r.lines ?? []).some((l) => lineMatchesProduct(l, entry.product)));

    const cookable = rank(state.recipes, [entry, ...state.stock.filter((i) => i.id !== entry.id && !i.deleted)], { now })
      .filter((r) => r.match.have.some((h) => h.item.id === entry.id))
      .slice(0, 3);

    const provenance = [
      receipt ? `Из чека «${receipt.store}» ${fmtDate(receipt.at)}${entry.price ? `, ${fmtMoney(entry.price)}` : ""}.` : "Добавлено руками.",
      entry.shelfDays ? `Срок ${entry.shelfDays} ${M.plural(entry.shelfDays, "день", "дня", "дней")} — из справочника, правится в волте.` : "Срок неизвестен: продукта нет в справочнике.",
      entry.opened ? "Отмечен как открытый — срок считается по короткой колонке." : null,
    ].filter(Boolean).join(" ");

    return html`<main class="screen">
      <header class="head">
        <div class="head-row">
          <a class="icon-btn icon-btn--sm" href="#stock" aria-label="Назад на склад">${raw(icon("i-back", { size: 18, stroke: "#1c3327" }))}</a>
          <span class="head-sub">${cap(entry.zone)}</span>
        </div>
        <h1>${entry.product}</h1>
        <div class="chips">
          ${raw(burning ? `<span class="chip chip--alarm">${esc(M.expiryLabel(entry, now))}</span>` : `<span class="chip" aria-hidden="false">${esc(M.expiryLabel(entry, now))}</span>`)}
          ${raw(entry.opened ? `<span class="chip">открыт</span>` : "")}
          ${raw(entry.qty ? `<span class="chip num">${esc(entry.qty)}</span>` : "")}
        </div>
      </header>

      <div class="body">
        ${raw(f.share == null ? "" : `<div class="strip"><div class="bar" data-tone="${f.tone === "calm" ? "" : "accent"}"><i style="transform:scaleX(${f.share})"></i></div></div>`)}

        <section class="pane">
          <div class="label">Сколько осталось</div>
          <div class="seg" role="group" aria-label="Сколько осталось">
            ${raw(LEVELS.map((level) => `<button class="seg-btn" type="button" data-act="level" data-level="${esc(level)}" aria-pressed="${(entry.level ?? "много") === level}">${esc(level)}</button>`).join(""))}
          </div>
        </section>

        <section class="pane">
          <div class="label">Откуда знаю</div>
          <p class="prose">${provenance}</p>
        </section>

        <section class="pane">
          <div class="label">Где лежит</div>
          <div class="chips">
            ${raw(ZONES.map((z) => `<button class="chip" type="button" data-act="zone" data-zone="${esc(z)}" aria-pressed="${entry.zone === z}">${esc(z)}</button>`).join(""))}
          </div>
        </section>

        ${raw(cookable.length ? `<section class="pane">
          <div class="label">Успеть съесть</div>
          ${cookable.map((r) => `<a class="row row--tight" href="#recipe/${esc(r.recipe.id)}">
            <span class="row-main"><span class="row-name">${esc(r.recipe.name)}</span>
            <span class="row-why">${r.recipe.minutes ? `${r.recipe.minutes} мин · ` : ""}${r.match.ready ? "всё есть" : `не хватает ${r.match.missing.length}`}</span></span>
          </a>`).join("")}
        </section>` : "")}
      </div>

      <div class="foot foot--wrap">
        <button class="btn btn--grow" type="button" data-act="toList">В список</button>
        <button class="btn btn--ghost" type="button" data-act="opened">${entry.opened ? "Закрыт" : "Открыл"}</button>
        <button class="btn btn--ghost" type="button" data-act="ate">Съел</button>
        <button class="btn btn--ghost btn--danger" type="button" data-act="threw">Выбросил</button>
      </div>
    </main>`;
  },

  actions: {
    level(el) {
      const level = el.dataset.level;
      commit("stock.level", (s) => {
        const entry = s.stock.find((i) => i.id === currentId());
        if (!entry) return null;
        entry.level = level;
        entry.empty = level === "кончился";
        entry.at = Date.now();
        return { kind: "stock", id: entry.id };
      });
      if (level === "кончился") location.hash = "stock";
    },

    zone(el) {
      commit("stock.zone", (s) => {
        const entry = s.stock.find((i) => i.id === currentId());
        if (!entry) return null;
        entry.zone = el.dataset.zone;
        entry.at = Date.now();
        return { kind: "stock", id: entry.id };
      });
    },

    opened() {
      commit("stock.opened", (s) => {
        const entry = s.stock.find((i) => i.id === currentId());
        if (!entry) return null;
        entry.opened = !entry.opened;
        const life = M.shelfLife(entry.product, s.shelf, { opened: entry.opened, zone: entry.zone });
        if (life) {
          entry.shelfDays = life.days;
          entry.boughtAt = entry.opened ? M.today() : entry.boughtAt;
        }
        entry.at = Date.now();
        return { kind: "stock", id: entry.id };
      });
    },

    toList(_el, state) {
      const entry = find(state, currentId());
      if (!entry) return;

      commit("list.fromStock", (s) => {
        const line = { id: uid("l"), product: entry.product, qty: entry.qty ?? "", done: false, from: "manual", at: Date.now() };
        s.list.push(line);
        return { kind: "list", id: line.id };
      });
      toast(`${entry.product} — в список`);
    },

    ate() {
      finish("ate", "Съедено");
    },

    threw() {
      finish("threw", "Выброшено — учту, чтобы такое не повторялось");
    },
  },
};

function currentId() {
  return location.hash.split("/")[1] ?? null;
}

/**
 * Closing a product out records what actually happened to it. Thrown-away food
 * is the signal that a shelf-life guess was too generous, so it is worth keeping.
 */
function finish(outcome, message) {
  const id = currentId();

  commit(`stock.${outcome}`, (s) => {
    const entry = s.stock.find((i) => i.id === id);
    if (!entry) return null;

    entry.empty = true;
    entry.outcome = outcome;
    entry.closedAt = M.today();
    entry.at = Date.now();

    if (outcome === "threw" && entry.boughtAt) {
      const lived = M.daysBetween(entry.boughtAt, M.today());
      const ref = s.shelf.find((e) => entry.product.toLowerCase().includes(e.product));
      if (ref && lived > 0 && lived < ref.closed) ref.closed = lived;
    }

    return { kind: "stock", id: entry.id };
  });

  toast(message);
  location.hash = "stock";
}
