// Settings.
//
// Phone: a one-off form — paste the key and leave.
// Desktop: a workbench. This is the machine sitting next to the vault and the
// GitHub tab, and the only place to see what the app actually decides by:
// which shelf lives, which till strings map to what, and what is stuck in the
// outbox. So sections on the left, real tables in the middle, provenance right.

import { html, raw, icon, esc, toast, wide, fmtDate } from "../lib/dom.js";
import { commit, uid, touch, get, replace } from "../lib/state.js";
import { demoState, reset as resetStore, EMPTY_STATE, size as stateSize } from "../lib/store.js";
import * as log from "../lib/log.js";
import { copy as copyText } from "../lib/share.js";
import * as M from "../lib/model.js";
import * as gh from "../lib/github.js";
import { sync, pullReferences, pullRecipes } from "../lib/sync.js";
import { parseShelf, parseSynonyms, parseAisles, parseRecipe } from "../lib/vault.js";

let checking = false;
let checkResult = null;
let section = "connect";
let cursor = -1;

const SECTIONS = [
  { key: "connect", name: "Подключение" },
  { key: "sync", name: "Обмен" },
  { key: "people", name: "Люди" },
  { key: "shelf", name: "Сроки" },
  { key: "synonyms", name: "Синонимы" },
  { key: "aisles", name: "Отделы" },
  { key: "rules", name: "Выучено из чеков" },
  { key: "log", name: "Журнал" },
  { key: "danger", name: "Опасная зона", apart: true },
];

/** Human sizes: "812 Б" is noise, "0.8 МБ" is a decision. */
function bytes(n) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

function countOf(key, state) {
  if (key === "sync") return state.queue.length;
  if (key === "people") return state.people.length;
  if (key === "shelf") return state.shelf.length;
  if (key === "synonyms") return state.synonyms.length;
  if (key === "aisles") return state.aisles.length;
  if (key === "rules") return Object.keys(state.rules).length;
  // The count that matters in a journal is the number of things that went wrong.
  if (key === "log") return log.counts().fail + log.counts().warn;
  return null;
}

/* ---------- pieces shared by both layouts ---------- */

function connectForm(cfg, { compact = false } = {}) {
  return html`<form class="stack${compact ? " stack--tight" : ""}" data-act-submit="connect">
    <label class="fieldset">
      <span class="fieldset-label">Репозиторий</span>
      <input class="field" name="repo" value="${cfg.repo ?? ""}" placeholder="логин/kitchen-data" autocomplete="off" spellcheck="false" required>
    </label>
    <label class="fieldset">
      <span class="fieldset-label">Ключ доступа</span>
      <input class="field" name="token" type="password" value="${cfg.token ? "••••••••••••" : ""}" placeholder="github_pat_…" autocomplete="off" spellcheck="false">
    </label>
    <label class="fieldset">
      <span class="fieldset-label">Ветка</span>
      <input class="field field--qty" name="branch" value="${cfg.branch ?? "main"}" autocomplete="off" spellcheck="false">
    </label>
    <label class="fieldset">
      <span class="fieldset-label">Как тебя зовут</span>
      <input class="field" name="meName" value="${gh.identity().name}" placeholder="чтобы второй видел, кто взял" autocomplete="off">
    </label>
    <button class="btn" type="submit" ${raw(checking ? "disabled" : "")}>${checking ? "Проверяю…" : cfg.token ? "Проверить снова" : "Подключить"}</button>
  </form>`;
}

function demoWarning(state) {
  if (!state.demo) return "";
  return html`<section class="pane pane--alarm">
    <div class="label">Сейчас загружены демо-данные</div>
    <p class="prose prose--alarm">Восемь позиций склада, шесть строк списка и три выдуманных чека — они нужны, чтобы приложение было на что посмотреть до первой закупки. Синхронизация с ними заблокирована: иначе выдуманный склад уедет в репозиторий и смешается с настоящим.</p>
    <button class="btn" type="button" data-act="startClean">Очистить и начать с нуля</button>
  </section>`;
}

/**
 * The phone is where the failures actually happen — in a shop, on one bar of
 * signal — and it is the one device with no way to open devtools. So the trouble
 * comes to the surface here, and the whole journal is one tap from a message.
 */
function journalPane(state) {
  const c = log.counts();
  const trouble = log.entries({ limit: 200 }).filter((e) => e.l !== "i").slice(-5).reverse();

  return html`<section class="pane">
    <div class="head-row">
      <div class="label">Журнал</div>
      <span class="head-sub num">${bytes(stateSize())} данных</span>
    </div>
    ${raw(trouble.length
      ? `<p class="prose">${c.fail ? `Сбоев: ${c.fail}. ` : ""}${c.warn ? `Предупреждений: ${c.warn}.` : ""} Последнее:</p>
         ${trouble.map((e) => `<div class="insp-row" data-level="${esc(e.l)}"><span>${esc(e.m)}</span><span class="tdim num">${esc(new Date(e.t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }))}</span></div>`).join("")}`
      : `<p class="prose prose--muted">За ${c.all} ${M.plural(c.all, "записанное событие", "записанных события", "записанных событий")} ничего не сломалось.</p>`)}
    <div class="rowbtns">
      <button class="btn btn--ghost btn--grow" type="button" data-act="copyLog">Скопировать журнал</button>
      <button class="btn btn--ghost" type="button" data-act="clearLog">Очистить</button>
    </div>
  </section>`;
}

/* ---------- phone ---------- */

function phone(state) {
  const cfg = gh.config();
  const others = state.people.filter((p) => !p.self);

  return html`<main class="screen">
    <header class="head"><h1>Настройки</h1></header>

    <div class="body">
      ${raw(demoWarning(state))}

      <section class="pane">
        <div class="label">Репозиторий данных</div>
        <p class="prose">Приложение хранит склад, список и справочники в твоём приватном репозитории на GitHub. Ключ доступа живёт только в этом браузере и никуда больше не уходит.</p>
        ${raw(connectForm(cfg))}
        ${raw(checkResult ? `<p class="prose ${checkResult.ok ? "" : "prose--alarm"}">${esc(checkResult.text)}</p>` : "")}
        <details class="note">
          <summary>Как сделать ключ</summary>
          <p class="prose">На GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens. Доступ дай только репозиторию с данными, права Contents: Read and write. Ключ создаёшь и вставляешь ты сам; я его не вижу и не запрашиваю.</p>
        </details>
      </section>

      <section class="pane">
        <div class="head-row">
          <div class="label">Синхронизация</div>
          <span class="head-sub num">${state.queue.length ? `${state.queue.length} правок в очереди` : "очередь пуста"}</span>
        </div>
        <p class="prose">${state.syncedAt ? `Последний обмен: ${new Date(state.syncedAt).toLocaleString("ru")}.` : "Обмена ещё не было."} Правки копятся офлайн и уходят при первой возможности.</p>
        <div class="rowbtns">
          <button class="btn btn--grow" type="button" data-act="syncNow" ${raw(gh.isConfigured() ? "" : "disabled")}>Синхронизировать</button>
          <button class="btn btn--ghost" type="button" data-act="pullRefs" ${raw(gh.isConfigured() ? "" : "disabled")}>Обновить справочники</button>
        </div>
      </section>

      <section class="pane">
        <div class="label">Кто ещё видит список</div>
        <p class="prose">Второй человек добавляется коллаборатором того же приватного репозитория.</p>
        ${raw(others.length
          ? others.map((p) => `<div class="ing" data-have="1"><span class="ing-name">${esc(p.name)}</span><button class="chip" type="button" data-act="removePerson" data-id="${esc(p.id)}">убрать</button></div>`).join("")
          : `<p class="prose prose--muted">Пока список видишь только ты.</p>`)}
        <form class="addbar" data-act-submit="addPerson">
          <input class="field" name="name" placeholder="Имя" aria-label="Имя человека" autocomplete="off" required>
          <button class="icon-btn" type="submit" aria-label="Добавить человека">${raw(icon("i-plus", { size: 22, stroke: "#1c3327" }))}</button>
        </form>
      </section>

      <section class="pane">
        <div class="label">Справочники</div>
        <p class="prose">Сроки, синонимы касс и порядок отделов лежат markdown-таблицами в волте. Правь их в Obsidian, приложение подтянет.</p>
        <div class="figures figures--tight">
          <div class="figure"><span class="figure-n num">${state.shelf.length}</span><span class="figure-t">строк в сроках</span></div>
          <div class="figure"><span class="figure-n num">${state.synonyms.length}</span><span class="figure-t">масок синонимов</span></div>
          <div class="figure"><span class="figure-n num">${Object.keys(state.rules).length}</span><span class="figure-t">правил из чеков</span></div>
        </div>
      </section>

      ${raw(journalPane(state))}

      <section class="pane pane--alarm">
        <div class="label">Опасная зона</div>
        <p class="prose prose--alarm">Сброс стирает всё, что накопилось в этом браузере. Если репозиторий подключён, данные вернутся при следующей синхронизации; если нет, исчезнут насовсем. Ключ доступа сбросом не затрагивается — его отцепляют отдельно.</p>
        <div class="rowbtns">
          <button class="btn btn--ghost" type="button" data-act="loadDemo">Загрузить демо-данные</button>
          <button class="btn btn--ghost btn--danger" type="button" data-act="wipe">Стереть всё</button>
        </div>
        ${raw(gh.isConfigured()
          ? `<button class="btn btn--ghost btn--danger" type="button" data-act="forgetKey">Забыть ключ доступа</button>`
          : "")}
      </section>
    </div>
  </main>`;
}

/* ---------- desktop ---------- */

/** Same placeholder as the stock table: an unknown cell, not prose punctuation. */
const none = '<span class="tnone" aria-label="нет">–</span>';

function rows(state) {
  if (section === "shelf") {
    return state.shelf.map((e, i) => ({
      id: `shelf-${i}`,
      cells: [e.product, e.zone, e.closed ? `${e.closed} дн` : none, e.opened ? `${e.opened} дн` : none],
      html: [false, false, !e.closed, !e.opened],
      detail: e,
    }));
  }
  if (section === "synonyms") {
    return state.synonyms.map((e, i) => ({ id: `syn-${i}`, cells: [e.mask, e.product], detail: e }));
  }
  if (section === "aisles") {
    return state.aisles.map((e, i) => ({
      id: `aisle-${i}`,
      cells: [String(e.order), e.name, e.items.slice(0, 6).join(", ")],
      detail: e,
    }));
  }
  if (section === "rules") {
    return Object.entries(state.rules).map(([raw_, product], i) => ({
      id: `rule-${i}`,
      cells: [raw_, product],
      detail: { raw: raw_, product },
    }));
  }
  if (section === "sync") {
    return state.queue.map((op) => ({
      id: op.id,
      cells: [op.kind, op.bulk ? "пачкой" : op.id?.slice(0, 8) ?? "", new Date(op.at).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })],
      detail: op,
    }));
  }
  if (section === "people") {
    return state.people.map((p) => ({ id: p.id, cells: [p.name, p.self ? "это я" : "коллаборатор"], detail: p }));
  }
  if (section === "log") {
    // Newest first: a journal is read from the thing that just happened backwards.
    return log
      .entries({ limit: 200 })
      .slice()
      .reverse()
      .map((e, i) => ({
        id: `log-${i}`,
        cells: [
          new Date(e.t).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          e.s,
          e.m,
        ],
        tone: e.l,
        detail: e,
      }));
  }
  return [];
}

const HEADS = {
  shelf: ["продукт", "зона", "закрыт", "открыт"],
  synonyms: ["маска в чеке", "продукт"],
  aisles: ["№", "отдел", "что внутри"],
  rules: ["строка чека", "продукт"],
  sync: ["что", "метка", "когда"],
  people: ["имя", "роль"],
  log: ["время", "источник", "что произошло"],
};

function sectionBody(state) {
  const cfg = gh.config();

  if (section === "connect") {
    return html`<div class="setpane">
      <p class="prose">Приложение хранит склад, список и справочники в твоём приватном репозитории. Ключ живёт только в этом браузере и никуда больше не уходит. Создаёшь и вставляешь его ты сам.</p>
      ${raw(connectForm(cfg, { compact: true }))}
      ${raw(checkResult ? `<p class="prose ${checkResult.ok ? "" : "prose--alarm"}">${esc(checkResult.text)}</p>` : "")}
      <details class="note">
        <summary>Где взять ключ</summary>
        <p class="prose">GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens. Доступ дай только репозиторию с данными, права Contents: Read and write.</p>
      </details>
    </div>`;
  }

  if (section === "danger") {
    return html`<div class="setpane">
      <p class="prose">Сброс стирает всё, что накопилось в этом браузере. Если репозиторий подключён, данные вернутся при следующей синхронизации; если нет, исчезнут насовсем.</p>
      <div class="rowbtns">
        <button class="btn btn--ghost" type="button" data-act="loadDemo">Загрузить демо-данные</button>
        <button class="btn btn--ghost btn--danger" type="button" data-act="wipe">Стереть всё</button>
      </div>
      <p class="prose">Ключ доступа сбросом не затрагивается: он лежит отдельно и переживает «Стереть всё». Отцепить его — значит лишить этот браузер права писать в репозиторий; сами данные там останутся.</p>
      <div class="rowbtns">
        <button class="btn btn--ghost btn--danger" type="button" data-act="forgetKey" ${raw(gh.isConfigured() ? "" : "disabled")}>Забыть ключ доступа</button>
      </div>
    </div>`;
  }

  const list = rows(state);
  const head = HEADS[section] ?? [];

  if (!list.length) {
    const empty = {
      sync: "Очередь пуста: всё, что менялось, уже уехало.",
      people: "Список видишь только ты.",
      rules: "Правил ещё нет. Они появляются сами: каждый раз, когда подтверждаешь спорную строку чека, приложение запоминает соответствие.",
      shelf: "Справочник сроков пуст. Подтяни его из волта кнопкой «Обновить справочники».",
      synonyms: "Словарь масок пуст. Подтяни его из волта.",
      aisles: "Порядок отделов не задан. Подтяни его из волта.",
      log: "Журнал пуст — приложение ещё ничего не записало в этом браузере.",
    }[section];

    return html`<div class="setpane"><p class="prose">${empty}</p>
      ${raw(section === "people" ? `<form class="addbar" data-act-submit="addPerson"><input class="field" name="name" placeholder="Имя" aria-label="Имя человека" autocomplete="off" required><button class="btn btn--ghost btn--sm" type="submit">Добавить</button></form>` : "")}
    </div>`;
  }

  const cols = `grid-template-columns:${head.map((_, i) => (i === 0 ? "1.4fr" : "1fr")).join(" ")}`;

  return html`<div class="table" role="table">
    <div class="trow trow--head" role="row" style="${cols}">
      ${raw(head.map((h) => `<span role="columnheader">${esc(h)}</span>`).join(""))}
    </div>
    ${raw(list.map((row, i) => `<div class="trow" role="row" style="${cols}" data-act="pick" data-index="${i}" data-focused="${i === cursor ? 1 : 0}"${row.tone ? ` data-level="${esc(row.tone)}"` : ""}>
      ${row.cells.map((c, j) => `<span class="${j === 0 ? "tname" : "tdim"}">${row.html?.[j] ? c : esc(c)}</span>`).join("")}
    </div>`).join(""))}
    ${raw(section === "people" ? `<form class="addbar" data-act-submit="addPerson"><input class="field" name="name" placeholder="Имя" aria-label="Имя человека" autocomplete="off" required><button class="btn btn--ghost btn--sm" type="submit">Добавить</button></form>` : "")}
  </div>`;
}

/** The rail leads with the state of the connection, because that is what everything else depends on. */
function railAnswer(state) {
  const connected = gh.isConfigured();

  if (!connected) {
    return { value: "Не подключено", note: "Пока ключа нет, всё живёт только в этом браузере и не переживёт его очистки." };
  }
  if (state.demo) {
    return { value: "Демо", note: "Синхронизация заблокирована, пока загружены выдуманные данные." };
  }
  if (state.queue.length) {
    return { value: String(state.queue.length), unit: M.plural(state.queue.length, "правка", "правки", "правок"), note: "ждут отправки, уедут сами при первой возможности" };
  }
  return {
    value: "Всё уехало",
    note: state.syncedAt ? `Последний обмен ${new Date(state.syncedAt).toLocaleString("ru")}` : "Обмена ещё не было",
  };
}

function railContext(state) {
  const list = rows(state);
  const row = list[cursor];

  if (row && section === "shelf") {
    const affected = state.stock.filter((i) => !i.deleted && !i.empty && i.product.toLowerCase().includes(row.detail.product));
    return html`<div class="insp-block">
      <h2 class="insp-name">${row.detail.product}</h2>
      <p class="prose">Закрытым живёт ${row.detail.closed} ${M.plural(row.detail.closed, "день", "дня", "дней")}${row.detail.opened ? `, вскрытым — ${row.detail.opened}` : ""}. Зона по умолчанию: ${row.detail.zone}.</p>
    </div>
    <div class="insp-block">
      <div class="label">Что сейчас под этой строкой</div>
      ${raw(affected.length
        ? affected.map((i) => `<div class="insp-row"><span>${esc(i.product)}</span><span class="tdim num">${esc(M.expiryLabel(i))}</span></div>`).join("")
        : `<p class="prose prose--muted">Ни одной позиции на складе под это правило сейчас не подпадает.</p>`)}
    </div>`;
  }

  if (row && section === "synonyms") {
    return html`<div class="insp-block">
      <h2 class="insp-name">${row.detail.product}</h2>
      <p class="prose">Любая строка чека, содержащая <code class="mono">${row.detail.mask}</code>, распознаётся как этот продукт. Порядок важен: более длинная маска должна стоять выше короткой, иначе «СЫР» съест «СЫРОК».</p>
    </div>`;
  }

  if (row && section === "rules") {
    return html`<div class="insp-block">
      <h2 class="insp-name">${row.detail.product}</h2>
      <p class="prose">Выучено из чека: <code class="mono">${row.detail.raw}</code>. Такие правила появляются, когда подтверждаешь спорную строку, и с каждым чеком приложение спрашивает всё реже.</p>
    </div>
    <div class="insp-foot">
      <button class="btn btn--ghost" type="button" data-act="forgetRule" data-raw="${row.detail.raw}">Забыть правило</button>
    </div>`;
  }

  if (row && section === "people") {
    return html`<div class="insp-block">
      <h2 class="insp-name">${row.detail.name}</h2>
      <p class="prose">${row.detail.self ? "Это ты." : "Видит тот же список. Отметки сливаются по каждой позиции отдельно, так что двое в магазине не затирают друг друга."}</p>
    </div>
    ${raw(row.detail.self ? "" : `<div class="insp-foot"><button class="btn btn--ghost" type="button" data-act="removePerson" data-id="${esc(row.detail.id)}">Убрать</button></div>`)}`;
  }

  if (row && section === "log") {
    return html`<div class="insp-block">
      <h2 class="insp-name">${row.detail.m}</h2>
      <p class="prose">${log.levelName(row.detail.l)} · ${row.detail.s} · ${new Date(row.detail.t).toLocaleString("ru")}</p>
      ${raw(row.detail.d ? `<pre class="mono logdump">${esc(row.detail.d)}</pre>` : "")}
    </div>`;
  }

  if (row && section === "aisles") {
    return html`<div class="insp-block">
      <h2 class="insp-name">${row.detail.name}</h2>
      <p class="prose">Отдел ${row.detail.order} в порядке обхода. Список группируется по этой таблице, чтобы зал проходился один раз.</p>
    </div>`;
  }

  /* Nothing picked — the section's own summary. */
  const summaries = {
    connect: html`<div class="insp-block">
      <div class="label">Что сейчас известно</div>
      ${raw(gh.isConfigured()
        ? `<div class="insp-row"><span>Репозиторий</span><span class="tdim">${esc(gh.config().repo)}</span></div>
           <div class="insp-row"><span>Ветка</span><span class="tdim">${esc(gh.config().branch ?? "main")}</span></div>
           <div class="insp-row"><span>Ключ</span><span class="tdim">хранится в этом браузере</span></div>`
        : `<p class="prose prose--muted">Ключа нет. Данные лежат только здесь и пропадут вместе с данными сайта.</p>`)}
    </div>`,
    sync: html`<div class="insp-block">
      <div class="label">Что уезжает</div>
      <p class="prose">Склад, список, чеки, меню, трекинг, магазины, выученные правила и история покупок. Каждая коллекция сливается по позициям, а не файлом целиком, поэтому двое могут править одновременно.</p>
    </div>
    <div class="insp-foot">
      <button class="btn" type="button" data-act="syncNow" ${raw(gh.isConfigured() ? "" : "disabled")}>Синхронизировать</button>
      <button class="btn btn--ghost" type="button" data-act="pullRefs" ${raw(gh.isConfigured() ? "" : "disabled")}>Обновить справочники из волта</button>
    </div>`,
    shelf: html`<div class="insp-block">
      <div class="label">Откуда это</div>
      <p class="prose">Таблица из <code class="mono">Справочники/Сроки.md</code> в волте. Правь её в Obsidian, приложение подтянет. Ответ «ещё есть» на ревизии тоже растягивает срок, если продукт стабильно живёт дольше.</p>
    </div>`,
    synonyms: html`<div class="insp-block">
      <div class="label">Откуда это</div>
      <p class="prose">Таблица из <code class="mono">Справочники/Синонимы.md</code>. Первое совпадение выигрывает, поэтому частные маски стоят выше общих.</p>
    </div>`,
    aisles: html`<div class="insp-block">
      <div class="label">Откуда это</div>
      <p class="prose">Таблица из <code class="mono">Справочники/Отделы.md</code>. Порядок строк повторяет порядок, в котором ты идёшь по залу.</p>
    </div>`,
    rules: html`<div class="insp-block">
      <div class="label">Как это копится</div>
      <p class="prose">Каждое подтверждение спорной строки чека становится правилом. Чем их больше, тем меньше вопросов при следующем чеке.</p>
    </div>`,
    people: html`<div class="insp-block">
      <div class="label">Как добавить</div>
      <p class="prose">Сделай человека коллаборатором приватного репозитория на GitHub, дальше он открывает то же приложение и вводит свой ключ.</p>
    </div>`,
    log: html`<div class="insp-block">
      <div class="label">Сколько всего весит</div>
      <div class="insp-row"><span>Состояние в браузере</span><span class="tdim num">${bytes(stateSize())}</span></div>
      <div class="insp-row"><span>Чеков</span><span class="tdim num">${state.receipts.length}</span></div>
      <div class="insp-row"><span>Приёмов пищи</span><span class="tdim num">${state.meals.length}</span></div>
      <div class="insp-row"><span>Продуктов в истории</span><span class="tdim num">${Object.keys(state.history).length}</span></div>
    </div>
    <div class="insp-block">
      <div class="label">Что записано</div>
      <div class="insp-row"><span>Строк в журнале</span><span class="tdim num">${log.counts().all}</span></div>
      <div class="insp-row"><span>Предупреждений</span><span class="tdim num">${log.counts().warn}</span></div>
      <div class="insp-row"><span>Сбоев</span><span class="tdim num">${log.counts().fail}</span></div>
      <p class="prose">Журнал живёт только в этом браузере, никуда не уходит и обрезается до четырёхсот последних строк. Если что-то сломалось — скопируй и пришли.</p>
    </div>
    <div class="insp-foot">
      <button class="btn" type="button" data-act="copyLog">Скопировать журнал</button>
      <button class="btn btn--ghost" type="button" data-act="clearLog">Очистить</button>
    </div>`,
    danger: html`<div class="insp-block">
      <div class="label">Что именно сотрётся</div>
      <p class="prose">Склад, список, чеки, история и очередь — всё, что лежит в этом браузере. Справочники и рецепты живут в волте и вернутся при следующем обновлении.</p>
    </div>`,
  };

  return summaries[section] ?? "";
}

function desk(state) {
  const answer = railAnswer(state);

  const rail = SECTIONS.map((s) => {
    const n = countOf(s.key, state);
    return html`<button class="setnav-item${s.apart ? " setnav-item--apart" : ""}" type="button"
        data-act="section" data-section="${s.key}" aria-pressed="${section === s.key}">
      <span>${s.name}</span>
      ${raw(n != null ? `<span class="setnav-count num">${n}</span>` : "")}
    </button>`;
  }).join("");

  const current = SECTIONS.find((s) => s.key === section);

  return html`<main class="screen">
    <header class="head head--dark">
      <div class="head-row">
        <div>
          <h1>Настройки</h1>
          <span class="head-sub">${current?.name ?? ""}</span>
        </div>
      </div>
    </header>

    ${raw(state.demo ? `<div class="notice notice--alarm">Загружены демо-данные, синхронизация заблокирована. <button class="linkbtn" type="button" data-act="startClean">Очистить и начать с нуля</button></div>` : "")}

    <div class="split">
      <nav class="setnav" aria-label="Разделы настроек">${raw(rail)}</nav>
      <div class="setbody">${raw(sectionBody(state))}</div>
      <aside class="inspector" aria-label="Подробности">
        <div class="answer">
          <p class="answer-value">${answer.value}${raw(answer.unit ? `<span class="answer-unit">${esc(answer.unit)}</span>` : "")}</p>
          <p class="answer-note">${answer.note}</p>
        </div>
        ${raw(railContext(state))}
      </aside>
    </div>
  </main>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Настройки",

  render(state) {
    return wide.matches ? desk(state) : phone(state);
  },

  leave() {
    cursor = -1;
    checkResult = null;
  },

  keys(e, state) {
    if (!wide.matches) return;
    const list = rows(state);
    if (!list.length) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, Math.min(list.length - 1, cursor + (e.key === "ArrowDown" ? 1 : -1)));
      touch();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cursor = -1;
      touch();
    }
  },

  actions: {
    section(el) {
      section = el.dataset.section;
      cursor = -1;
      touch();
    },

    pick(el) {
      cursor = Number(el.dataset.index);
      touch();
    },

    forgetRule(el) {
      commit("rules.forget", (s) => {
        delete s.rules[el.dataset.raw];
        return null;
      }, { sync: false });
      cursor = -1;
      toast("Правило забыто, в следующий раз спрошу снова");
    },

    async connect(form) {
      const data = new FormData(form);
      const repo = String(data.get("repo") ?? "").trim();
      const rawToken = String(data.get("token") ?? "").trim();
      const branch = String(data.get("branch") ?? "main").trim() || "main";
      const token = rawToken.startsWith("•") ? gh.config().token : rawToken;

      // Device-local, deliberately: two people sharing one repository are two
      // people, and the name is what the other one sees next to a ticked row.
      gh.setName(String(data.get("meName") ?? ""));

      if (!repo || !token) {
        checkResult = { ok: false, text: "Нужны и репозиторий, и ключ доступа." };
        return touch();
      }

      checking = true;
      checkResult = null;
      touch();

      try {
        const info = await gh.check({ token, repo });
        gh.setConfig({ token, repo, branch });
        checkResult = {
          ok: true,
          text: `Подключено: ${info.name}${info.private ? " (приватный)" : " — репозиторий публичный, личные данные лучше держать в приватном"}.`,
        };
        toast("Репозиторий подключён");
      } catch (err) {
        checkResult = { ok: false, text: `Не вышло: ${err.message}` };
      } finally {
        checking = false;
        touch();
      }
    },

    async syncNow() {
      try {
        const report = await sync();
        toast(
          report.pushed === 0
            ? "Всё уже совпадает — писать было нечего"
            : `Отправлено ${report.pushed} ${report.pushed === 1 ? "раздел" : "разделов"}${report.skipped ? ` · ${report.skipped} без изменений` : ""}`
        );
      } catch (err) {
        toast(`Не прошло: ${err.message}`, "alarm");
      }
    },

    async copyLog() {
      const text = log.asText();
      if (!text) return toast("Журнал пуст");
      const ok = await copyText(text);
      toast(ok ? `Журнал скопирован · ${log.counts().all} строк` : "Не удалось скопировать", ok ? "calm" : "alarm");
    },

    clearLog() {
      const n = log.counts().all;
      log.clear();
      touch();
      toast(`Журнал очищен · было ${n} строк`);
    },

    async pullRefs() {
      try {
        const [refs, recipeFiles] = await Promise.all([pullReferences(), pullRecipes()]);
        const parsedRecipes = recipeFiles.map((f) => parseRecipe(f.name, f.text)).filter((r) => r.ingredients.length);

        commit("refs.pull", (s) => {
          if (refs.shelf) s.shelf = parseShelf(refs.shelf);
          if (refs.synonyms) {
            const { synonyms, junk } = parseSynonyms(refs.synonyms);
            s.synonyms = synonyms;
            s.junk = junk;
          }
          if (refs.aisles) s.aisles = parseAisles(refs.aisles);
          if (parsedRecipes.length) s.recipes = parsedRecipes;
          return null;
        }, { sync: false });

        toast(`Справочники обновлены${parsedRecipes.length ? ` · ${parsedRecipes.length} рецептов` : ""}`);
      } catch (err) {
        toast(`Не удалось прочитать волт: ${err.message}`, "alarm");
      }
    },

    addPerson(form) {
      const name = String(new FormData(form).get("name") ?? "").trim();
      if (!name) return;

      commit("people.add", (s) => {
        s.people.push({ id: uid("p"), name, self: false, at: Date.now() });
        return null;
      }, { sync: false });

      const live = document.querySelector('[data-act-submit="addPerson"]');
      live?.reset();
      live?.querySelector('[name="name"]')?.focus();
      toast(`${name} теперь видит список`);
    },

    removePerson(el) {
      commit("people.remove", (s) => {
        s.people = s.people.filter((p) => p.id !== el.dataset.id);
        return null;
      }, { sync: false });
      cursor = -1;
    },

    loadDemo() {
      const s = get();
      replace({ ...demoState(M.today()), recipes: s.recipes, stores: s.stores, people: s.people }, "demo");
      toast("Демо-данные загружены");
    },

    /** Keeps what came from the vault, drops everything the app invented. */
    startClean() {
      const s = get();
      replace(
        {
          ...structuredClone(EMPTY_STATE),
          demo: false,
          recipes: s.recipes,
          shelf: s.shelf,
          synonyms: s.synonyms,
          junk: s.junk,
          aisles: s.aisles,
          stores: s.stores,
          people: s.people,
          rules: s.rules,
        },
        "clean"
      );
      toast("Демо-данные убраны · склад и список пусты");
    },

    wipe() {
      if (!confirm("Стереть весь локальный склад, список и историю?")) return;
      resetStore();
      replace({ ...structuredClone(EMPTY_STATE), demo: false }, "wipe");
      log.warn("настройки", "локальные данные стёрты вручную");
      toast(gh.isConfigured() ? "Стёрто · ключ доступа остался" : "Стёрто");
    },

    /**
     * "Стереть всё" cleared the data and left the key. A token with write access
     * to a private repository outliving the data it was for is the one thing in
     * here worth handling separately — so it gets its own button and its own
     * confirmation, and says out loud that nothing in the repository is touched.
     */
    forgetKey() {
      if (!gh.isConfigured()) return toast("Ключа и так нет");
      if (!confirm("Отцепить ключ доступа от этого браузера? Данные в репозитории останутся на месте.")) return;

      gh.clearConfig();
      checkResult = null;
      log.warn("настройки", "ключ доступа отцеплён");
      touch();
      toast("Ключ забыт · этот браузер больше не может писать в репозиторий");
    },
  },
};
