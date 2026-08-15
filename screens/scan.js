// Receipt intake, four stages in one screen: camera, waiting, disputed lines, summary.
// The waiting stage is honest about taking half a minute and lets you walk away.

import { html, raw, icon, esc, toast, fmtMoney } from "../lib/dom.js";
import { commit, uid, touch, get } from "../lib/state.js";
import * as M from "../lib/model.js";
import * as R from "../lib/receipt.js";
import * as gh from "../lib/github.js";

let stage = "camera";
let stopCamera = null;
let job = null;
let parsed = null;
let queue = [];
let cursor = 0;
let learned = [];
let summary = null;
let abort = null;
let jobAbort = null;

function reset() {
  stage = "camera";
  job = null;
  parsed = null;
  queue = [];
  cursor = 0;
  learned = [];
  summary = null;
}

/* ---------- stages ---------- */

function camera() {
  const qr = R.qrSupported();

  return html`<main class="screen screen--dark">
    <header class="head head--onblack">
      <div class="head-row">
        <h1>Скан чека</h1>
        <a class="icon-btn icon-btn--sm icon-btn--onblack" href="#list" aria-label="Закрыть">${raw(icon("i-close", { size: 15, stroke: "#c9c4b6" }))}</a>
      </div>
    </header>

    <div class="viewfinder">
      <video data-video playsinline muted aria-label="Изображение с камеры"></video>
      <div class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="reticle-line"></span></div>
      <div class="viewfinder-copy">
        <strong>${qr ? "Наведи на QR в подвале чека" : "Сфотографируй чек целиком"}</strong>
        <span>${qr ? "так данные чистые — правки почти не нужны" : "этот браузер не умеет читать QR, пойдём через распознавание фото"}</span>
      </div>
      <p class="viewfinder-error" data-cam-error hidden></p>
    </div>

    ${raw(gh.isConfigured() ? "" : `<div class="notice notice--onblack">Репозиторий данных не подключён — можно прогнать <button class="linkbtn" type="button" data-act="demo">демонстрационный чек</button> и посмотреть, как выглядит разбор.</div>`)}

    <div class="foot foot--onblack">
      <button class="btn btn--ghost btn--onblack btn--grow" type="button" data-act="photo">
        ${qr ? "QR не читается — снять фото" : "Снять фото"}
      </button>
      <label class="btn btn--ghost btn--onblack">
        Выбрать файл
        <input type="file" accept="image/*" class="sr-only" data-act="file" aria-label="Выбрать фото чека файлом">
      </label>
    </div>
  </main>`;
}

function waiting() {
  const steps = [
    { name: "Чек получен", note: job?.kindLabel ?? "отправлен на разбор", state: "done" },
    { name: "Разбираю строки", note: "GitHub Action работает", state: "busy" },
    { name: "Сопоставляю со складом", note: "сроки и синонимы", state: "idle" },
  ];

  return html`<main class="screen">
    <header class="head">
      <h1>Чек в обработке</h1>
      <span class="head-sub">${job?.startedLabel ?? ""}</span>
    </header>

    <div class="body">
      <ol class="timeline">
        ${raw(steps.map((s) => `<li class="tl" data-state="${s.state}">
          <span class="tl-dot" aria-hidden="true"></span>
          <span class="tl-main"><span class="tl-name">${esc(s.name)}</span><span class="tl-note">${esc(s.note)}</span></span>
        </li>`).join(""))}
      </ol>

      <div class="pane pane--calm">
        <strong>Осталось около полминуты</strong>
        <p class="prose">Можно закрыть и уйти в список — вернусь сам, ничего не потеряется.</p>
      </div>
    </div>

    <div class="foot">
      <a class="btn btn--grow" href="#list">В список</a>
      <button class="btn btn--ghost" type="button" data-act="cancel">Отменить</button>
    </div>
  </main>`;
}

function disputed() {
  const line = queue[cursor];
  if (!line) return summaryStage();

  const pct = Math.round(line.confidence * 100);
  const life = M.shelfLife(line.product, get().shelf, {});

  return html`<main class="screen">
    <header class="head">
      <div class="head-row">
        <h1 class="h1--sm">Спорные строки</h1>
        <span class="head-sub num">${cursor + 1} из ${queue.length}</span>
      </div>
      <div class="steps" role="img" aria-label="Строка ${cursor + 1} из ${queue.length}">
        ${raw(queue.map((_, i) => `<i data-on="${i <= cursor ? 1 : 0}"></i>`).join(""))}
      </div>
    </header>

    <div class="body">
      <div class="pane pane--calm">
        <div class="label">Напечатано в чеке</div>
        <code class="mono">${line.raw}</code>
      </div>

      <div class="pane">
        <div class="label">Похоже на</div>
        <form class="guess" data-act-submit="confirm">
          <input class="field field--big" name="product" value="${line.product ?? ""}" aria-label="Название продукта" autocomplete="off" required>
          <div class="chips">
            ${raw(line.qty ? `<span class="chip num">${esc(line.qty)}</span>` : "")}
            ${raw(line.price ? `<span class="chip num">${esc(fmtMoney(line.price))}</span>` : "")}
            ${raw(life ? `<span class="chip chip--dashed">срок ${life.days} ${esc(M.plural(life.days, "день", "дня", "дней"))}</span>` : `<span class="chip chip--dashed">срок неизвестен</span>`)}
          </div>
        </form>
      </div>

      <div class="pane pane--alarm">
        <div class="meter meter--wide" data-tone="warn" role="img" aria-label="Уверенность ${pct} процентов"><i style="width:${pct}%"></i></div>
        <p class="prose prose--alarm">Такого в справочнике не было — уверен на ${pct}%</p>
      </div>

      <p class="prose prose--muted">Остальные ${parsed.accepted.length} ${M.plural(parsed.accepted.length, "строку", "строки", "строк")} принял молча: они совпали с прошлыми чеками.</p>
    </div>

    <div class="foot">
      <button class="icon-btn" type="button" data-act="skip" aria-label="Пропустить строку">${raw(icon("i-close", { size: 20, stroke: "#5e7365" }))}</button>
      <button class="btn btn--accent btn--grow" type="button" data-act="confirmBtn">Верно</button>
    </div>
  </main>`;
}

function summaryStage() {
  const s = summary ?? { added: 0, removedFromList: 0, discarded: 0, learned: [] };

  return html`<main class="screen">
    <header class="head">
      <h1>Сохранено</h1>
      <span class="head-sub">${job?.storeLabel ?? "чек разобран"}</span>
    </header>

    <div class="body">
      <div class="figures">
        <div class="figure"><span class="figure-n num">+${s.added}</span><span class="figure-t">позиций на складе, сроки посчитаны от даты чека</span></div>
        <div class="figure"><span class="figure-n num">−${s.removedFromList}</span><span class="figure-t">позиций ушло из списка покупок</span></div>
        <div class="figure"><span class="figure-n num">${s.discarded}</span><span class="figure-t">строк отброшено: пакеты, скидки, итоги</span></div>
      </div>

      ${raw(s.learned.length ? `<div class="pane pane--calm">
        <div class="label">Запомнил ${s.learned.length} ${esc(M.plural(s.learned.length, "правило", "правила", "правил"))}</div>
        <code class="mono mono--block">${s.learned.map((r) => `${esc(r.raw)} → ${esc(r.product)}`).join("<br>")}</code>
        <p class="prose">В следующий раз спрошу на ${s.learned.length} ${esc(M.plural(s.learned.length, "строку", "строки", "строк"))} меньше.</p>
      </div>` : "")}
    </div>

    <div class="foot">
      <a class="btn btn--grow" href="#stock">На склад</a>
      <button class="btn btn--ghost" type="button" data-act="again">Ещё чек</button>
    </div>
  </main>`;
}

/* ---------- screen ---------- */

export default {
  title: () => "Скан чека",

  render(state) {
    if (stage === "camera") return camera();
    if (stage === "waiting") return waiting();
    if (stage === "disputed") return disputed();
    return summaryStage();
  },

  async mount(root) {
    if (stage !== "camera" || stopCamera) return;

    const video = root.querySelector("[data-video]");
    const errorEl = root.querySelector("[data-cam-error]");
    if (!video) return;

    try {
      stopCamera = await R.openCamera(video);
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = `Камера недоступна: ${err.message}. Можно загрузить фото чека файлом в настройках.`;
      return;
    }

    if (!R.qrSupported()) return;

    abort = new AbortController();
    R.scanQr(video, { signal: abort.signal })
      .then((url) => startJob("receipt-qr", () => R.submitQr(url), "QR прочитан"))
      .catch(() => {});
  },

  leave() {
    abort?.abort();
    abort = null;
    stopCamera?.();
    stopCamera = null;
    if (stage === "summary") reset();
  },

  actions: {
    async photo() {
      const video = document.querySelector("[data-video]");
      if (!video?.videoWidth) {
        return toast("Камера недоступна — выбери фото чека файлом", "alarm");
      }

      const blob = await R.grabPhoto(video);
      startJob("receipt-ocr", () => R.submitPhoto(blob), "Фото снято");
    },

    file(input) {
      const blob = input.files?.[0];
      if (!blob) return;
      startJob("receipt-ocr", () => R.submitPhoto(blob), `Файл ${blob.name}`);
    },

    demo() {
      abort?.abort();
      abort = null;
      stopCamera?.();
      stopCamera = null;
      stage = "waiting";
      job = { kind: "demo", kindLabel: "демонстрационный чек", startedLabel: "без обращения наружу" };
      touch();
      setTimeout(() => acceptLines(DEMO_LINES, { store: "АТБ", total: 1842 }), 600);
    },

    cancel() {
      // Without aborting the poll the receipt still lands a minute later, while
      // the person is on another screen and believes they refused it.
      abort?.abort();
      jobAbort?.abort();
      jobAbort = null;
      reset();
      location.hash = "list";
    },

    again() {
      reset();
      touch();
    },

    skip() {
      // Dropping the guess is the whole point of the button: without this the
      // line still lands on the shelf and in the purchase history, and a few
      // receipts later the list starts suggesting it.
      queue[cursor] = { ...queue[cursor], product: null };
      cursor += 1;
      if (cursor >= queue.length) finishReceipt();
      else touch();
    },

    confirmBtn() {
      const form = document.querySelector(".guess");
      if (form) form.requestSubmit();
    },

    confirm(form) {
      const product = String(new FormData(form).get("product") ?? "").trim();
      if (!product) return;

      const line = queue[cursor];
      learned.push({ raw: line.raw.toUpperCase(), product });
      queue[cursor] = { ...line, product, confidence: 1 };

      cursor += 1;
      if (cursor >= queue.length) finishReceipt();
      else touch();
    },
  },
};

/* ---------- flow ---------- */

async function startJob(kind, submit, label) {
  abort?.abort();
  abort = null;

  stage = "waiting";
  job = {
    kind,
    kindLabel: label,
    startedLabel: new Date().toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }),
  };
  touch();

  if (!gh.isConfigured()) {
    toast("Репозиторий не подключён — разбираю демонстрационный чек");
    return acceptLines(DEMO_LINES, { store: "АТБ", total: 1842 });
  }

  try {
    const id = await submit();
    jobAbort = new AbortController();
    const answer = await gh.awaitJob(id, { signal: jobAbort.signal });
    if (answer.error) throw new Error(answer.error);

    // Scanning the same QR twice — or the second phone scanning it — used to add
    // a second receipt, second shelf entries and a doubled month.
    if (answer.source && get().receipts.some((r) => r.source === answer.source)) {
      toast("Этот чек уже разобран", "alarm");
      reset();
      touch();
      return;
    }

    acceptLines(answer.lines ?? [], {
      store: answer.store ?? "магазин",
      total: answer.total ?? null,
      at: answer.at ?? null,
      source: answer.source ?? null,
    });
  } catch (err) {
    if (err.message !== "отменено") toast(`Чек не разобрался: ${err.message}`, "alarm");
    reset();
    touch();
  } finally {
    jobAbort = null;
  }
}

function acceptLines(rawLines, meta) {
  const state = get();
  parsed = R.classify(rawLines, { rules: state.rules, synonyms: state.synonyms, junk: state.junk });
  queue = parsed.disputed;
  cursor = 0;
  learned = [];
  job = { ...job, storeLabel: `${meta.store}${meta.total ? ` · ${fmtMoney(meta.total)}` : ""}` };
  job.meta = meta;

  if (!queue.length) finishReceipt();
  else {
    stage = "disputed";
    touch();
  }
}

/** Write everything the receipt produced: stock, list removals, learned rules, history. */
function finishReceipt() {
  const meta = job?.meta ?? { store: "магазин", total: null };
  // The summary says "сроки посчитаны от даты чека", so use it when the till
  // gave one — a receipt scanned a day late would otherwise date from today.
  const stamped = meta.at ? M.today(Date.parse(meta.at)) : null;
  const boughtAt = Number.isFinite(stamped) ? stamped : M.today();
  const lines = [...parsed.accepted, ...queue.filter((l) => l.product)];
  let listRemoved = 0;

  commit("receipt.apply", (s) => {
    for (const rule of learned) s.rules[rule.raw] = rule.product;

    for (const line of lines) {
      s.stock.push(R.toStockItem(line, { shelf: s.shelf, boughtAt, id: uid("s") }));

      const key = line.product;
      s.history[key] = [...new Set([...(s.history[key] ?? []), boughtAt])].sort((a, b) => a - b);

      for (const entry of s.list) {
        if (entry.deleted || entry.done) continue;
        if (entry.product.toLowerCase() === key.toLowerCase()) {
          entry.done = true;
          entry.takenBy = "me";
          entry.at = Date.now();
          listRemoved += 1;
        }
      }
    }

    s.receipts.unshift({
      id: uid("rc"),
      store: meta.store,
      source: meta.source ?? null,
      at: boughtAt,
      total: meta.total,
      lines: lines.map((l) => ({ product: l.product, qty: l.qty, price: l.price })),
    });

    return { kind: "receipt" };
  });

  summary = R.summarize({ ...parsed, disputed: queue }, { listRemoved, learned });
  stage = "summary";
  touch();
}

/* Used when no data repo is connected yet, so the flow can be seen end to end. */
const DEMO_LINES = [
  { name: "МЛК ПРОСТ 2,5% 900МЛ", qty: "1 шт", price: 89 },
  { name: "Т/В СЛ 82,5% 180Г", qty: "1 шт", price: 214 },
  { name: "ТВОРОГ 5% 400Г", qty: "1 шт", price: 212 },
  { name: "КУР ФИЛЕ ОХЛ", qty: "0.9 кг", price: 389 },
  { name: "ХЛЕБ БОРОДИНСКИЙ", qty: "1 шт", price: 62 },
  { name: "ЯЙЦО С1 10ШТ", qty: "1 уп", price: 129 },
  { name: "ПОМИДОР РОЗ ВЕС", qty: "0.6 кг", price: 180 },
  { name: "ПАКЕТ МАЙКА", qty: "1 шт", price: 8 },
  { name: "СКИДКА ПО КАРТЕ", qty: "", price: -120 },
  { name: "СЫРОК ГЛАЗИР ВАН", qty: "3 шт", price: 96 },
  { name: "ПЕРЕЦ СЛАД ВЕС", qty: "0.4 кг", price: 148 },
  { name: "МОРС КЛЮКВ 1Л", qty: "1 шт", price: 119 },
];
