// Reading the pairing code off the other machine's screen.
//
// One job, one screen: point the camera, get connected. It exists separately
// from the receipt scanner because what it accepts is different — a receipt QR
// pointed at this screen must be ignored, not misread as a key.

import { html, raw, icon, toast } from "../lib/dom.js";
import { touch } from "../lib/state.js";
import * as R from "../lib/receipt.js";
import * as gh from "../lib/github.js";
import { parsePairing } from "../lib/pair.js";
import * as log from "../lib/log.js";

let camStream = null;
let abort = null;
let state = "camera"; // camera | checking | done
let note = null;

function reset() {
  state = "camera";
  note = null;
}

export default {
  title: () => "Подключение",

  render() {
    if (state === "done") {
      return html`<main class="screen">
        <header class="head"><h1>Подключено</h1></header>
        <div class="body">
          <div class="empty">
            <h2>${note ?? ""}</h2>
            <p>Ключ и репозиторий перенесены с компьютера. Этот телефон теперь пишет в тот же репозиторий — список и склад общие.</p>
            <a class="btn" href="#list">К списку</a>
          </div>
        </div>
      </main>`;
    }

    return html`<main class="screen screen--dark">
      <header class="head head--onblack">
        <div class="head-row">
          <h1>Подключение</h1>
          <a class="icon-btn icon-btn--sm icon-btn--onblack" href="#settings" aria-label="Закрыть">${raw(icon("i-close", { size: 15, stroke: "#c9c4b6" }))}</a>
        </div>
      </header>

      <div class="viewfinder">
        <video data-video playsinline muted aria-label="Изображение с камеры"></video>
        <div class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="reticle-line"></span></div>
        <div class="viewfinder-copy">
          <strong>${state === "checking" ? "Проверяю доступ…" : "Наведи на код с компьютера"}</strong>
          <span>${note ?? "На компьютере: Настройки → Подключение → «Показать код для телефона»"}</span>
        </div>
        <p class="viewfinder-error" data-cam-error hidden></p>
      </div>

      <div class="foot foot--onblack">
        <a class="btn btn--ghost btn--onblack btn--grow" href="#settings">Ввести ключ руками</a>
      </div>
    </main>`;
  },

  async mount(root) {
    if (state !== "camera") return;

    const video = root.querySelector("[data-video]");
    const errorEl = root.querySelector("[data-cam-error]");
    if (!video) return;

    if (!R.qrSupported()) {
      errorEl.hidden = false;
      errorEl.textContent = "Этот браузер не умеет читать QR — ключ придётся ввести руками в настройках.";
      return;
    }

    if (!camStream) {
      try {
        camStream = await R.openCamera();
      } catch (err) {
        errorEl.hidden = false;
        errorEl.textContent = `Камера недоступна: ${err.message}`;
        return;
      }
    }

    await R.attach(video, camStream);

    // The element is rebuilt on every render, so the watcher follows the live one.
    abort?.abort();
    abort = new AbortController();
    watch(video, abort.signal);
  },

  leave() {
    abort?.abort();
    abort = null;
    R.closeCamera(camStream);
    camStream = null;
    reset();
  },

  actions: {},
};

/**
 * Keep looking until a code turns out to be ours. The camera sees receipts,
 * posters and parcel labels; none of those are a reason to stop or complain.
 */
async function watch(video, signal) {
  while (!signal.aborted) {
    let text;
    try {
      text = await R.scanQr(video, { signal });
    } catch {
      return;
    }

    const config = parsePairing(text);
    if (!config) {
      note = "Это не код подключения — ищу дальше";
      touch();
      continue;
    }

    await apply(config);
    return;
  }
}

async function apply(config) {
  state = "checking";
  note = null;
  touch();

  try {
    const info = await gh.check({ token: config.token, repo: config.repo });
    gh.setConfig({ token: config.token, repo: config.repo, branch: config.branch });
    if (config.name) gh.setName(config.name);

    state = "done";
    note = info.name;
    log.info("подключение", "ключ принят с кода", info.name);
    toast("Телефон подключён");
  } catch (err) {
    state = "camera";
    note = `Ключ не подошёл: ${err.message}`;
    log.fail("подключение", "ключ из кода отвергнут", err?.message);
  }

  touch();
}
