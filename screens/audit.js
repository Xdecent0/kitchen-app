// The weekly twenty seconds. Everything the forecast thinks ran out, one card at a
// time, and each answer sharpens the model instead of just editing a number.

import { html, raw, icon, esc, toast } from "../lib/dom.js";
import { commit, uid, touch, get } from "../lib/state.js";
import * as M from "../lib/model.js";
import { auditCandidates } from "../lib/trip.js";
import { ZONE_ICON } from "./stock.js";

let cursor = 0;
let answers = [];
let candidates = null;

/**
 * Two kinds of doubt: stock the app believes is past its shelf life, and products
 * the purchase rhythm says should have run out. Both need a human yes or no.
 */
const buildCandidates = (state) => auditCandidates(state, M.today());

function card(entry, state, index, total) {
  const now = M.today();
  const glyph = ZONE_ICON[entry.item?.zone] ?? "i-shelf";

  const rows = entry.items?.length ?? (entry.item ? 1 : 0);
  const note = entry.kind === "stock"
    ? [
        rows > 1 ? `${rows} ${M.plural(rows, "запись", "записи", "записей")}` : entry.item.qty || entry.item.level || "",
        `срок вышел ${M.expiryLabel(entry.item, now)}`,
      ].filter(Boolean).join(" · ")
    : M.dueReason(entry.product, state.history, now);

  return html`<div class="audit-card">
    <div class="audit-head">
      <span class="tile tile--lg" aria-hidden="true">${raw(icon(glyph, { size: 22, stroke: "#1c3327" }))}</span>
      <span class="row-main">
        <span class="audit-name">${entry.product}</span>
        <span class="row-why">${note}</span>
      </span>
      <span class="head-sub num">${index + 1} / ${total}</span>
    </div>
    <div class="audit-answers">
      <button class="btn btn--ghost btn--grow" type="button" data-act="have">есть</button>
      <button class="btn btn--accent btn--grow" type="button" data-act="gone">нет → в список</button>
    </div>
  </div>`;
}

export default {
  title: () => "Ревизия",

  render(state) {
    if (candidates === null) {
      candidates = buildCandidates(state);
      cursor = 0;
      answers = [];
    }

    if (!candidates.length) {
      return html`<main class="screen">
        <header class="head"><h1>Ревизия не нужна</h1></header>
        <div class="body">
          <div class="empty">
            <h2>Всё сходится</h2>
            <p>Ни один продукт не просрочен и ни один не выбился из привычного ритма покупок. Загляни через неделю.</p>
            <a class="btn" href="#stock">На склад</a>
          </div>
        </div>
      </main>`;
    }

    if (cursor >= candidates.length) return done(state);

    const entry = candidates[cursor];
    const rest = candidates.slice(cursor + 1, cursor + 4);

    return html`<main class="screen">
      <header class="head">
        <h1 class="h1--sm">Ревизия · 20 секунд</h1>
        <span class="head-sub">По расчётам это кончилось. Отметь, что ещё есть.</span>
      </header>

      <div class="body">
        ${raw(card(entry, state, cursor, candidates.length))}

        ${raw(rest.length ? `<div class="audit-next">${rest.map((r) => `<span class="audit-chip">${esc(r.product)}</span>`).join("")}</div>` : "")}

        <div class="pane">
          <div class="label">Что из этого выходит</div>
          <p class="prose">Ответы уточняют не только склад. Если продукт стабильно живёт меньше справочного срока, справочник для него подтянется — и в следующий раз я не буду спрашивать зря.</p>
        </div>
      </div>

      <div class="foot">
        <button class="btn btn--ghost btn--grow" type="button" data-act="finish">Закончить</button>
      </div>
    </main>`;
  },

  leave() {
    candidates = null;
  },

  actions: {
    have() {
      answer("have");
    },
    gone() {
      answer("gone");
    },
    finish() {
      apply();
    },
    restart() {
      candidates = null;
      touch();
    },
  },
};

function answer(verdict) {
  answers.push({ ...candidates[cursor], verdict });
  cursor += 1;

  if (cursor >= candidates.length) apply();
  else touch();
}

function done(state) {
  const gone = answers.filter((a) => a.verdict === "gone");
  const kept = answers.filter((a) => a.verdict === "have");

  return html`<main class="screen">
    <header class="head"><h1>Готово</h1></header>
    <div class="body">
      <div class="figures">
        <div class="figure"><span class="figure-n num">${gone.length}</span><span class="figure-t">позиций ушло со склада и попало в список</span></div>
        <div class="figure"><span class="figure-n num">${kept.length}</span><span class="figure-t">подтверждено — прогноз для них сдвинулся</span></div>
      </div>
      <p class="prose">Следующая ревизия имеет смысл примерно через неделю.</p>
    </div>
    <div class="foot">
      <a class="btn btn--grow" href="#stock">На склад</a>
      <a class="btn btn--ghost" href="#list">В список</a>
    </div>
  </main>`;
}

/**
 * Apply the answers. "Gone" empties the item and adds it to the list.
 * "Have" is the more interesting one: it means the shelf-life guess was too short,
 * so the reference gets a little more generous for that product.
 */
function apply() {
  const now = M.today();
  const decided = [...answers];

  commit("audit.apply", (s) => {
    for (const entry of decided) {
      // One card can stand for several identical rows; the answer applies to all
      // of them, or the duplicates it just hid come back next week.
      const ids = new Set((entry.items ?? (entry.item ? [entry.item] : [])).map((i) => i.id));
      const rows = s.stock.filter((i) => ids.has(i.id));
      const stockEntry = rows[0] ?? null;

      if (entry.verdict === "gone") {
        for (const row of rows) {
          row.empty = true;
          row.outcome = "used";
          row.closedAt = now;
          row.at = Date.now();
        }

        const already = s.list.some((l) => !l.deleted && !l.done && l.product.toLowerCase() === entry.product.toLowerCase());
        if (!already) {
          s.list.push({ id: uid("l"), product: entry.product, qty: "", done: false, from: "forecast", at: Date.now() });
        }
      } else {
        // "Still have it" has to be recorded even when nothing on the shelf
        // matches, or the rhythm keeps asking the same question forever while
        // the summary claims the forecast moved.
        s.confirmed[entry.product] = now;

        if (!stockEntry) continue;

        // The oldest row is the one that proves the shelf life was understated:
        // it is the one that has actually lasted this long.
        const oldest = rows.reduce((a, b) => ((a.boughtAt ?? Infinity) <= (b.boughtAt ?? Infinity) ? a : b), stockEntry);
        const lived = oldest.boughtAt ? M.daysBetween(oldest.boughtAt, now) : null;

        // Longest match wins: "сыр" would otherwise stretch the shelf life of
        // "сырок глазированный" and vice versa.
        const ref = s.shelf
          .filter((e) => oldest.product.toLowerCase().includes(e.product))
          .sort((a, b) => b.product.length - a.product.length)[0];
        if (ref && lived && lived > ref.closed) ref.closed = lived;

        for (const row of rows) {
          if (lived) row.shelfDays = Math.max(row.shelfDays ?? 0, lived + 2);
          row.at = Date.now();
        }
      }
    }

    s.lastAudit = now;
    return { kind: "audit" };
  });

  cursor = candidates.length;
  toast(`Ревизия учтена · ${decided.filter((a) => a.verdict === "gone").length} в список`);
  touch();
}
