// Router and chrome. Screens own their markup; this file decides which one is on
// screen, keeps the nav honest, and funnels every click to the right handler.

import { $, html, raw, icon, toast, wide, setCurrency } from "./lib/dom.js";
import { get, subscribe, guardUnload, whenSaveFails } from "./lib/state.js";
import * as log from "./lib/log.js";
import { demoState, isFresh, stripDemo } from "./lib/store.js";
import { replace } from "./lib/state.js";
import * as M from "./lib/model.js";
import * as gh from "./lib/github.js";
import { sync, syncing, autoSync } from "./lib/sync.js";

import list from "./screens/list.js";
import stock from "./screens/stock.js";
import item from "./screens/item.js";
import scan from "./screens/scan.js";
import audit from "./screens/audit.js";
import recipes from "./screens/recipes.js";
import recipe from "./screens/recipe.js";
import cook from "./screens/cook.js";
import menu from "./screens/menu.js";
import stores from "./screens/stores.js";
import tracking from "./screens/tracking.js";
import receiptsScreen from "./screens/receipts.js";
import settings from "./screens/settings.js";

const SCREENS = {
  list,
  stock,
  item,
  scan,
  audit,
  recipes,
  recipe,
  cook,
  menu,
  stores,
  tracking,
  receipts: receiptsScreen,
  settings,
};

const NAV = [
  { route: "list", label: "Список", icon: "i-list" },
  { route: "stock", label: "Склад", icon: "i-stock" },
  { route: "recipes", label: "Рецепты", icon: "i-recipes" },
  { route: "menu", label: "Меню", icon: "i-menu" },
  { route: "stores", label: "Магазины", icon: "i-store" },
  { route: "tracking", label: "Трекинг", icon: "i-track" },
  { route: "receipts", label: "Чеки", icon: "i-receipts" },
];

let current = { name: "list", arg: null };

/* Nothing catches what happens before this line, so it runs before anything else
   that can throw — including the demo seed below. */
log.captureGlobals();
guardUnload();

/**
 * Persistence stopped working. Until now this was reported to nobody: the hook
 * existed and nothing was hung on it, so the app kept accepting edits it could
 * no longer keep, while the status line cheerfully counted a queue that would
 * not survive the tab. The one thing that can still save the data is a sync, so
 * the banner offers exactly that.
 */
whenSaveFails((ok, state) => {
  const el = $("[data-alert]");
  if (!el) return;

  if (ok) {
    el.hidden = true;
    el.innerHTML = "";
    log.info("хранилище", "запись снова работает");
    return;
  }

  const configured = gh.isConfigured();
  el.hidden = false;
  el.innerHTML = html`<span class="alert-text">Не удаётся сохранить: место в браузере кончилось. Всё, что ты меняешь сейчас, живёт только до закрытия вкладки.</span>
    ${raw(configured
      ? `<button class="btn btn--sm" type="button" data-act="rescue">Отправить в репозиторий</button>`
      : `<a class="btn btn--sm" href="#settings">Подключить репозиторий</a>`)}`;

  log.fail("хранилище", "данные только в памяти", { очередь: state.queue.length, подключено: configured });
});
log.info("приложение", "запуск", { экран: location.hash || "#list", офлайн: !navigator.onLine });

/* First run has nothing to judge the interface by, so seed the demo once —
   keyed on "nothing was ever saved", not on "the arrays are empty". Keyed on
   emptiness, a deliberate "start clean" was undone by the next reload. */
{
  const s = get();
  if (isFresh() && !s.stock.length && !s.list.length && !s.receipts.length) {
    replace({ ...demoState(M.today()), recipes: s.recipes, stores: s.stores }, "seed");
  } else if (s.demo && s.receipts.some((r) => !String(r.id).startsWith("rc_"))) {
    // A real receipt landed on top of the demo: drop the invented rows rather
    // than making the person choose between their data and a working sync.
    replace(stripDemo(s), "demo.strip");
  }
  setCurrency(get().currency);
}

function parseHash() {
  const raw = location.hash.slice(1) || "list";
  const [name, arg] = raw.split("/");
  return SCREENS[name] ? { name, arg: arg ?? null } : { name: "list", arg: null };
}

function badgeFor(route, state) {
  const now = M.today();
  if (route === "list") return state.list.filter((e) => !e.done && !e.deleted).length;
  if (route === "stock") return state.stock.filter((i) => !i.deleted && M.isBurning(i, now)).length;
  if (route === "recipes") return 0;
  return 0;
}

function renderNav(state) {
  $("[data-tabs]").innerHTML = NAV.map((entry) => {
    const n = badgeFor(entry.route, state);
    const on = current.name === entry.route;
    const hint = n > 0 ? `${entry.label} · ${n}` : entry.label;
    return html`<a class="tab" href="#${entry.route}" data-route="${entry.route}" title="${hint}"${raw(on ? ' aria-current="page"' : "")}>
      ${raw(icon(entry.icon))}
      <span class="tab-label">${entry.label}</span>
      ${raw(n > 0 ? `<span class="tab-badge">${n}</span>` : "")}
    </a>`;
  }).join("");

  const settingsTab = $('[data-route="settings"]');
  if (settingsTab) settingsTab.toggleAttribute("aria-current", current.name === "settings");
}

function renderSyncStatus() {
  const el = $("[data-sync-status]");
  const state = get();
  const pending = state.queue.length;

  if (!gh.isConfigured()) {
    el.hidden = false;
    el.dataset.tone = "idle";
    el.innerHTML = `<a href="#settings">Репозиторий не подключён</a>`;
    return;
  }

  el.hidden = false;
  if (syncing()) {
    el.dataset.tone = "busy";
    el.textContent = "Синхронизация…";
  } else if (!navigator.onLine) {
    el.dataset.tone = "offline";
    el.textContent = pending ? `Офлайн · ${pending} правок ждут` : "Офлайн";
  } else if (pending) {
    el.dataset.tone = "busy";
    el.textContent = `${pending} правок не отправлено`;
  } else {
    el.dataset.tone = "idle";
    el.textContent = state.syncedAt
      ? `Синхронизировано в ${new Date(state.syncedAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}`
      : "Готово к синхронизации";
  }
}

let mounted = null;
let previous = null;
let previousArg = null;

function render() {
  const state = get();
  const screen = SCREENS[current.name];
  const stage = $("[data-stage]");

  // leave() tears down screen-local state, so it must fire only on a real
  // departure — calling it on every re-render resets wizards mid-flow.
  if (mounted && mounted !== current.name) SCREENS[mounted].leave?.();
  mounted = current.name;

  // Every tap rebuilds the screen, and the scroller dies with it. Ticking five
  // items in the meat aisle meant scrolling back five times, one-handed, with a
  // trolley — so the position is carried across a re-render of the same screen.
  const sameScreen = previous === current.name && previousArg === current.arg;
  const keep = sameScreen ? [...stage.querySelectorAll(".body, .table, .feed, .inspector")].map((el) => el.scrollTop) : null;

  // Every tap rebuilds the screen from scratch. That is fine at fifty items and
  // not fine at five hundred, and the difference is invisible until someone is
  // standing in a queue — so the slow ones say so in the journal.
  const stop = log.time("отрисовка", current.name, { warnAfter: 60 });

  try {
    stage.innerHTML = screen.render(state, current.arg);
  } catch (err) {
    // A screen that throws used to leave a blank app with no way back.
    log.fail("отрисовка", `${current.name} не собрался`, err?.stack?.slice(0, 240) ?? err?.message);
    stage.innerHTML = html`<div class="pane pane--alarm">
      <h2 class="pane-title">Экран не собрался</h2>
      <p class="pane-note">${err?.message ?? "неизвестная ошибка"}</p>
      <p class="pane-note">Данные целы. Запись есть в журнале: Настройки → Журнал.</p>
      <a class="btn btn--ghost btn--sm" href="#list">К списку</a>
    </div>`;
    stop({ ошибка: true });
    previous = current.name;
    previousArg = current.arg;
    return;
  }

  if (keep) {
    [...stage.querySelectorAll(".body, .table, .feed, .inspector")].forEach((el, i) => {
      if (keep[i]) el.scrollTop = keep[i];
    });
  }

  try {
    screen.mount?.(stage, state, current.arg);
  } catch (err) {
    log.fail("отрисовка", `${current.name}: mount упал`, err?.message);
  }

  stop({ строк: stage.querySelectorAll(".row, .trow, .card").length });
  previous = current.name;
  previousArg = current.arg;

  renderNav(state);
  renderSyncStatus();
  document.title = screen.title ? `${screen.title(state, current.arg)} · Кухня` : "Кухня";
}

export function go(route) {
  location.hash = route;
}

window.addEventListener("hashchange", () => {
  current = parseHash();
  render();
});

subscribe(() => {
  setCurrency(get().currency);
  render();
});
/* The queue has to leave on its own: the shop is the last place anyone opens
   settings, and until it does, every per-entry merge runs empty. */
function tryAutoSync() {
  const started = autoSync(get());
  if (started) started.then(renderSyncStatus);
  renderSyncStatus();
}

window.addEventListener("online", tryAutoSync);
window.addEventListener("offline", renderSyncStatus);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tryAutoSync();
});

/* Phone and desktop are different structures, not the same one restyled,
   so crossing the breakpoint has to re-render rather than reflow. */
wide.addEventListener("change", () => render());

document.addEventListener("keydown", (e) => {
  if (e.target?.closest?.("input, textarea, select")) return;
  SCREENS[current.name].keys?.(e, get());
});

/* One delegated listener for every screen action. */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.matches("input[type=file]")) return;

  const screen = SCREENS[current.name];
  const handler = screen.actions?.[el.dataset.act] ?? GLOBAL_ACTIONS[el.dataset.act];
  if (!handler) return;

  e.preventDefault();
  handler(el, get());
});

document.addEventListener("change", (e) => {
  const el = e.target.closest("input[type=file][data-act]");
  if (!el) return;

  const handler = SCREENS[current.name].actions?.[el.dataset.act];
  handler?.(el, get());
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-act-submit]");
  if (!form) return;

  const screen = SCREENS[current.name];
  const handler = screen.actions?.[form.dataset.actSubmit];
  if (!handler) return;

  e.preventDefault();
  handler(form, get());
});

export async function runSync() {
  if (!gh.isConfigured()) {
    toast("Сначала подключи репозиторий данных в настройках");
    go("settings");
    return;
  }

  renderSyncStatus();
  try {
    const report = await sync();
    // "Синхронизировано · 8 разделов" was said even when all eight were identical.
    toast(
      report.pushed === 0
        ? "Всё уже совпадает — писать было нечего"
        : `Отправлено ${report.pushed} ${report.pushed === 1 ? "раздел" : "разделов"}${report.skipped ? ` · ${report.skipped} без изменений` : ""}`
    );
  } catch (err) {
    toast(`Синхронизация не прошла: ${err.message}`, "alarm");
  } finally {
    renderSyncStatus();
  }
}

/* Sidebar width is a preference, so it outlives the session. */
const NAV_KEY = "kitchen.nav.mini";

function applyNavMode(mini) {
  $(".app").dataset.nav = mini ? "mini" : "full";
  const rail = $(".rail");
  if (!rail) return;
  rail.setAttribute("aria-expanded", String(!mini));
  rail.setAttribute("aria-label", mini ? "Развернуть боковую панель" : "Свернуть боковую панель");
}

const GLOBAL_ACTIONS = {
  back: () => history.back(),
  go: (el) => go(el.dataset.to),
  sync: () => runSync(),
  /* Nothing can be written locally, so the repository is the only place the
     edits can still go. Not a normal sync button: this one is the exit. */
  rescue: () => runSync(),
  rail: () => {
    const mini = localStorage.getItem(NAV_KEY) !== "1";
    localStorage.setItem(NAV_KEY, mini ? "1" : "0");
    applyNavMode(mini);
  },
};

applyNavMode(localStorage.getItem(NAV_KEY) === "1");
$(".app").dataset.feed = localStorage.getItem("kitchen.feed.off") === "1" ? "off" : "on";

current = parseHash();
render();

/**
 * Register the worker and say something when a new build lands. A silent update
 * that only applies on the next cold start means the person keeps using the
 * version that had the bug they just reported.
 */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./sw.js")
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const fresh = reg.installing;
        if (!fresh) return;

        fresh.addEventListener("statechange", () => {
          if (fresh.state === "installed" && navigator.serviceWorker.controller) {
            toast("Обновление готово — перезагрузи страницу");
          }
        });
      });
    })
    .catch(() => {});
}
