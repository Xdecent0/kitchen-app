// The shopping list.
//
// Phone: one column of large targets, grouped by store aisle — the job is walking
// the hall and ticking things off.
//
// Desktop: the trip is assembled, not walked. Three zones — what the app suggests,
// the list itself, and the answer panel: the trip's cost up top as one number and
// one sentence, dense context underneath.

import { html, raw, icon, esc, cap, fmtMoney, toast, wide , fmtAlso } from "../lib/dom.js";
import { commit, uid, touch } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as T from "../lib/trip.js";
import { priceHistory } from "../lib/planning.js";
import * as S from "../lib/share.js";
import * as gh from "../lib/github.js";
import { mark } from "../lib/sync.js";

const alive = (state) => state.list.filter((e) => !e.deleted);

let cursor = -1;
let selected = new Set();
let sharing = false;
let shareStyle = "checklist";
/** null — решает сам список: пустой открывает предложения, непустой сворачивает. */
let feedOpen = null;

/* ---------- shared pieces ---------- */

function reasonOf(entry, state) {
  if (entry.from === "forecast") return M.dueReason(entry.product, state.history);
  if (entry.from === "recipe") return entry.forRecipe ? `для рецепта: ${entry.forRecipe}` : "для рецепта";
  return "";
}

/**
 * Only ever names someone else. The name travels with the tick because the two
 * devices have no shared roster to look each other up in — `people` is a local
 * list of who you told this browser about, not an identity service.
 */
function whoOf(entry) {
  if (!entry.takenBy) return null;
  if (entry.takenBy === gh.identity().id) return null;
  return entry.takenName || "кто-то ещё";
}

/* ---------- share ---------- */

function shareText(state) {
  const plan = T.tripPlan(state);
  const entries = S.withPrices(alive(state), plan);

  return S.render(entries, {
    style: shareStyle,
    aisles: state.aisles,
    currency: state.currency,
    groups: plan.canSplit ? plan.groups : null,
  });
}

function shareSheet(state) {
  const text = shareText(state);

  return html`<div class="sheet" role="dialog" aria-label="Поделиться списком">
    <div class="sheet-head">
      <h2 class="sheet-title">Поделиться</h2>
      <button class="icon-btn icon-btn--sm" type="button" data-act="shareClose" aria-label="Закрыть">
        ${raw(icon("i-close", { size: 18, stroke: "#1c3327" }))}
      </button>
    </div>

    <div class="chips" role="group" aria-label="Вид списка">
      ${raw(S.STYLES.map((s) => `<button class="chip" type="button" data-act="shareStyle" data-style="${s.key}" aria-pressed="${shareStyle === s.key}" title="${esc(s.hint)}">${esc(s.name)}</button>`).join(""))}
    </div>

    <pre class="sheet-preview" aria-label="Как это будет выглядеть">${text}</pre>

    <div class="sheet-actions">
      ${raw(S.canShare() ? `<button class="btn btn--grow" type="button" data-act="shareSend">Отправить</button>` : "")}
      <button class="btn ${S.canShare() ? "btn--ghost" : "btn--grow"}" type="button" data-act="shareCopy">Скопировать</button>
      <a class="btn btn--ghost" href="${S.telegramLink(text)}" target="_blank" rel="noopener">Telegram</a>
    </div>
  </div>`;
}

/* ---------- phone ---------- */

function phoneRow(entry, state) {
  const why = reasonOf(entry, state);
  const who = whoOf(entry);

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

/**
 * The whole point of the app, finally on the device it was built for.
 *
 * The candidates and the two actions have existed since the first week; the only
 * thing missing was a call from the phone layout, so the forecast ran every
 * render and was shown to nobody. Open by default when the list is empty — that
 * is the moment the suggestions *are* the screen — and collapsed once there is a
 * list, because in the shop the list is the screen and everything else is noise.
 */
function phoneFeeder(state, listEmpty) {
  const sources = T.candidates(state);
  const total = T.candidateCount(sources);
  if (!total) return "";

  const open = feedOpen ?? listEmpty;

  const head = html`<button class="suggest-head" type="button" data-act="feedPhone" aria-expanded="${open}">
    <span class="suggest-title">Предлагаю</span>
    <span class="feed-count">${total}</span>
    <span class="suggest-hint">${open ? "свернуть" : "посмотреть"}</span>
  </button>`;

  if (!open) return html`<div class="suggest">${raw(head)}</div>`;

  const blocks = SOURCES.filter((s) => sources[s.key].length).map((s) => {
    const rows = sources[s.key].map((c) => html`<button class="feed-row" type="button" data-act="take"
        data-product="${c.product}" data-qty="${c.qty ?? ""}" data-from="${s.key}">
      <span class="feed-main">
        <span class="feed-name">${c.product}</span>
        <span class="feed-why" data-tone="${s.tone}">${c.reason}</span>
      </span>
      <span class="feed-plus" aria-hidden="true">${raw(icon("i-plus", { size: 16, stroke: "#5f7468" }))}</span>
    </button>`).join("");

    return html`<div class="feed-group">
      <div class="feed-head">
        <span>${s.title}</span>
        <button class="linkbtn" type="button" data-act="takeAll" data-source="${s.key}">взять все · ${sources[s.key].length}</button>
      </div>
      ${raw(rows)}
    </div>`;
  }).join("");

  return html`<div class="suggest" data-open="1">${raw(head)}${raw(blocks)}</div>`;
}

/** Twenty seconds that keep the forecast honest — and no way in when the shelf is empty. */
function auditInvite(state) {
  const now = M.today();
  const since = state.lastAudit == null ? null : M.daysBetween(state.lastAudit, now);
  if (since != null && since < 7) return "";
  if (!T.auditCandidates(state, now).length) return "";

  return html`<a class="notice notice--link" href="#audit">
    ${since == null ? "Ревизии ещё не было" : `Ревизия была ${since} ${M.plural(since, "день", "дня", "дней")} назад`} — двадцать секунд, и прогноз снова знает, что у тебя есть
  </a>`;
}

function phone(state) {
  const entries = alive(state);
  const pending = entries.filter((e) => !e.done);
  const done = entries.filter((e) => e.done);
  const share = entries.length ? done.length / entries.length : 0;
  const others = state.people.filter((p) => !p.self);

  const suggested = T.candidateCount(T.candidates(state));

  const body = !entries.length
    ? suggested
      // Saying "список пуст, отсканируй чек" above a list of things the app
      // already knows you need would be the app arguing with itself.
      ? html`<div class="empty empty--tight">
          <p class="prose prose--muted">Список пуст, но приложение уже знает, что тебе, скорее всего, нужно — выше. Нажми на строку, чтобы взять её в список.</p>
        </div>`
      : html`<div class="empty">
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
        <span class="toolbar-gap"></span>
        <span class="head-sub num">${done.length} / ${entries.length}</span>
        <button class="icon-btn icon-btn--sm" type="button" data-act="share" aria-label="Поделиться списком">
          ${raw(icon("i-share", { size: 18, stroke: "#1c3327" }))}
        </button>
      </div>
      <div class="bar"><i style="transform:scaleX(${share})"></i></div>
    </header>

    ${raw(others.length ? `<div class="notice">${esc(others.map((p) => p.name).join(", "))} тоже видит этот список — отметки сливаются, ничего не теряется</div>` : "")}
    ${raw(auditInvite(state))}

    <form class="addbar" data-act-submit="add">
      <input class="field" name="product" placeholder="Добавить продукт" aria-label="Добавить продукт" autocomplete="off" required>
      <input class="field field--qty" name="qty" placeholder="сколько" aria-label="Количество" autocomplete="off">
      <button class="icon-btn" type="submit" aria-label="Добавить">${raw(icon("i-plus", { size: 22, stroke: "#1c3327" }))}</button>
    </form>

    <div class="body">
      ${raw(phoneFeeder(state, !entries.length))}
      ${raw(body)}
    </div>

    <div class="foot">
      <a class="btn btn--grow" href="#scan">Сканировать чек</a>
      ${raw(done.length ? `<button class="btn btn--ghost" type="button" data-act="clearDone">Убрать взятое · ${done.length}</button>` : "")}
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

const SOURCES = [
  { key: "burning", title: "горит на складе", tone: "alarm" },
  { key: "rhythm", title: "кончилось по ритму", tone: "" },
  { key: "menu", title: "нет для меню недели", tone: "" },
];

function feedToggle(total) {
  return html`<button class="feed-toggle" type="button" data-act="feed"
      aria-label="Свернуть предложения">
    <span class="feed-toggle-text">Предлагаю</span>
    <span class="feed-count">${total}</span>
  </button>`;
}

function feeder(state) {
  const sources = T.candidates(state);
  const total = T.candidateCount(sources);

  if (!total) {
    return html`${raw(feedToggle(0))}
    <div class="feed">
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

  return html`${raw(feedToggle(total))}<div class="feed">${raw(blocks)}</div>`;
}

function tripRow(row, state, index) {
  const { entry } = row;
  const why = reasonOf(entry, state);
  const who = whoOf(entry);
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
  const answer = T.tripAnswer(plan, state.currency);

  return html`<div class="answer">
    <p class="answer-value">${answer.value}${raw(answer.unit ? `<span class="answer-unit">${esc(answer.unit)}</span>` : "")}</p>
    ${raw(answer.money != null ? fmtAlso(answer.money) : "")}
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
    <button class="btn btn--ghost" type="button" data-act="clearDone">Убрать взятое · ${plan.done.length}</button>
  </div>`;
}

function desk(state) {
  const plan = T.tripPlan(state);
  const rows = [...plan.pending.map((e) => wrap(e, plan)), ...plan.done.map((e) => wrap(e, plan))];
  cursor = cursor < 0 ? -1 : Math.min(cursor, rows.length - 1);
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
        <button class="btn btn--ghost btn--sm" type="button" data-act="share">Поделиться</button>
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
    const screen = wide.matches ? desk(state) : phone(state);
    return sharing ? screen + shareSheet(state) : screen;
  },

  leave() {
    cursor = -1;
    selected.clear();
    sharing = false;
    feedOpen = null;
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
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cursor = -1;
      touch();
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

    share() {
      sharing = true;
      touch();
    },

    shareClose() {
      sharing = false;
      touch();
    },

    shareStyle(el) {
      shareStyle = el.dataset.style;
      touch();
    },

    async shareSend(_el, state) {
      const result = await S.share(shareText(state));
      if (result === "copied") toast("Скопировано — вставь куда нужно");
      if (result === "failed") toast("Не вышло поделиться — скопируй руками", "alarm");
      if (result === "shared") sharing = false;
      touch();
    },

    async shareCopy(_el, state) {
      const result = await S.copy(shareText(state));
      toast(result === "copied" ? "Скопировано" : "Буфер недоступен", result === "copied" ? "calm" : "alarm");
    },

    feed() {
      const app = document.querySelector(".app");
      const off = app.dataset.feed !== "off";
      app.dataset.feed = off ? "off" : "on";
      localStorage.setItem("kitchen.feed.off", off ? "1" : "0");
    },

    remove(el) {
      removeEntry(el.dataset.id);
    },

    take(el) {
      addEntry(el.dataset.product, el.dataset.qty, el.dataset.from === "menu" ? "recipe" : "forecast");
      toast(`${el.dataset.product} — в список`);
    },

    /* Phone only. Once touched, the choice sticks for this visit — the automatic
       rule stops guessing the moment the person has said what they want. */
    feedPhone(_el, state) {
      feedOpen = !(feedOpen ?? !alive(state).length);
      touch();
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

      const ids = done.map((e) => e.id);

      commit("list.clearDone", (s) => {
        for (const entry of s.list) {
          if (ids.includes(entry.id)) mark(entry, "deleted", true);
        }
        return { kind: "list", bulk: true };
      });

      toast(`Убрано ${done.length}`, "calm", {
        undo() {
          commit("list.clearDone.undo", (s) => {
            for (const entry of s.list) {
              if (ids.includes(entry.id)) mark(entry, "deleted", false);
            }
            return { kind: "list", bulk: true };
          });
        },
      });
    },
  },
};

/* ---------- mutations ---------- */

/** A tick is a purchase. Recorded here so the forecast learns from unscanned trips too. */
function markBought(s, product, day) {
  const seen = s.history[product] ?? [];
  s.history[product] = [...new Set([...seen, day])].sort((a, b) => a - b);
  delete s.confirmed[product];

  // No longer a removal, if it ever was.
  if (s.gone?.[product]) {
    s.gone[product] = s.gone[product].filter((d) => d !== day);
    if (!s.gone[product].length) delete s.gone[product];
  }
}

/** Unticking is a correction, and a correction has to travel or the repository undoes it. */
function unmarkBought(s, product, day) {
  const seen = s.history[product] ?? [];
  s.history[product] = seen.filter((d) => d !== day);
  if (!s.history[product].length) delete s.history[product];

  s.gone = s.gone ?? {};
  s.gone[product] = [...new Set([...(s.gone[product] ?? []), day])].sort((a, b) => a - b);
}

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

    mark(entry, "done", !entry.done);
    const me = gh.identity();
    entry.takenBy = entry.done ? me.id : null;
    entry.takenName = entry.done ? me.name || null : null;

    // Not every receipt gets scanned, so the tick itself is evidence that the
    // product was bought today — without it the forecast only ever learns from
    // scans and keeps asking for what is already in the bag.
    const today = M.today();
    if (entry.done) markBought(s, entry.product, today);
    else unmarkBought(s, entry.product, today);

    return { kind: "list", id: entry.id };
  });
}

function removeEntry(id) {
  if (!id) return;
  commit("list.remove", (s) => {
    const entry = s.list.find((x) => x.id === id);
    if (!entry) return null;
    mark(entry, "deleted", true);
    return { kind: "list", id: entry.id };
  });
}
