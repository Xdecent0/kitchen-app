// Tiny DOM helpers. Everything the screens need to build markup safely.

import * as M from "./money.js";

/** Desktop is a different layout, not a restyled phone — screens branch on this. */
export const wide = window.matchMedia("(min-width: 900px)");

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/** Tagged template that escapes every interpolation. Arrays join without separators. */
export function html(strings, ...values) {
  return strings.reduce((out, chunk, i) => {
    if (i === 0) return chunk;
    const v = values[i - 1];
    const rendered = Array.isArray(v) ? v.join("") : v instanceof Raw ? v.value : esc(v);
    return out + rendered + chunk;
  }, "");
}

class Raw {
  constructor(value) {
    this.value = value;
  }
}

/** Marks an already-built HTML string as safe to embed. */
export const raw = (value) => new Raw(value ?? "");

export function icon(id, { size = 22, stroke = "currentColor", width } = {}) {
  const w = width ? ` stroke-width="${width}"` : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" stroke="${esc(stroke)}"${w} aria-hidden="true"><use href="#${esc(id)}"/></svg>`;
}

export const cap = (s) => String(s ?? "").charAt(0).toUpperCase() + String(s ?? "").slice(1);

let currency = "₴";
let rates = null;
let alsoShow = [];

/** Money is the user's, not the app's — the symbol and the extra currencies come from settings. */
export function setCurrency(symbol, options = {}) {
  if (symbol) currency = symbol;
  if ("rates" in options) rates = options.rates;
  if ("show" in options) alsoShow = options.show ?? [];
}

export function fmtMoney(value, symbol = currency) {
  if (value == null) return "";
  return `${Number(value).toLocaleString("ru")} ${symbol}`;
}

/**
 * The same sum in the other currencies, as a small line under the number.
 *
 * Only where money is the answer, never on every row: three currencies on every
 * line of a shopping list is not convenience, it is noise with a decimal point.
 * `at` matters — a purchase made in March is converted at March's rate.
 */
export function fmtAlso(value, at = Date.now()) {
  const result = M.alongside(value, { rates, at, show: alsoShow });
  if (!result) return "";
  return html`<span class="also"${raw(result.stale ? ' data-stale="1"' : "")}>${result.text}</span>`;
}

/** True when there is anything to convert into — the interface asks before offering. */
export const hasAlso = () => alsoShow.length > 0 && Boolean(rates?.days);

export function fmtDate(ts) {
  // Russian short months come back with a trailing dot that collides with
  // sentence punctuation ("11 авг.."), so it is trimmed at the source.
  return new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(/\.$/, "");
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Announce a transient result without stealing focus.
 *
 * `undo` turns it into the only safety net for bulk actions: removing a dozen
 * ticked rows is one tap and otherwise unrecoverable, and a confirmation dialog
 * before every routine clear costs more than the rare mistake.
 */
export function toast(message, tone = "calm", { undo, label = "Вернуть", ms = 3200 } = {}) {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.append(host);
  }

  const el = document.createElement("div");
  el.className = "toast";
  el.dataset.tone = tone;

  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);

  const dismiss = () => {
    el.dataset.leaving = "1";
    setTimeout(() => el.remove(), 240);
  };

  if (undo) {
    el.dataset.action = "1";
    const button = document.createElement("button");
    button.className = "toast-undo";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      undo();
      dismiss();
    });
    el.append(button);
  }

  host.append(el);
  setTimeout(dismiss, undo ? Math.max(ms, 6000) : ms);
}
