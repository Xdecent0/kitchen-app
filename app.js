// Router and chrome. Screens own their markup; this file decides which one is on
// screen, keeps the nav honest, and funnels every click to the right handler.

import { $, html, raw, icon, toast, wide } from "./lib/dom.js";
import { get, subscribe } from "./lib/state.js";
import { demoState } from "./lib/store.js";
import { replace } from "./lib/state.js";
import * as M from "./lib/model.js";
import * as gh from "./lib/github.js";
import { sync, syncing } from "./lib/sync.js";

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

/* First run has nothing to judge the interface by, so seed the demo once. */
{
  const s = get();
  if (!s.stock.length && !s.list.length && !s.receipts.length) {
    replace({ ...demoState(M.today()), recipes: s.recipes, stores: s.stores }, "seed");
  }
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

function render() {
  const state = get();
  const screen = SCREENS[current.name];
  const stage = $("[data-stage]");

  // leave() tears down screen-local state, so it must fire only on a real
  // departure — calling it on every re-render resets wizards mid-flow.
  if (mounted && mounted !== current.name) SCREENS[mounted].leave?.();
  mounted = current.name;

  stage.innerHTML = screen.render(state, current.arg);
  stage.scrollTop = 0;
  screen.mount?.(stage, state, current.arg);

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

subscribe(() => render());
window.addEventListener("online", renderSyncStatus);
window.addEventListener("offline", renderSyncStatus);

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
    toast(`Синхронизировано · ${report.collections.length} разделов`);
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
  rail: () => {
    const mini = localStorage.getItem(NAV_KEY) !== "1";
    localStorage.setItem(NAV_KEY, mini ? "1" : "0");
    applyNavMode(mini);
  },
};

applyNavMode(localStorage.getItem(NAV_KEY) === "1");

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
