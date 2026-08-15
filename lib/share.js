// Getting the list out of the app: to a phone's share sheet, to Telegram, to
// the clipboard. Plain text, because that is the one format every messenger,
// notes app and person already understands.

import * as M from "./model.js";

export const STYLES = [
  { key: "checklist", name: "Список с галочками", hint: "для мессенджера" },
  { key: "plain", name: "Просто строки", hint: "чтобы вставить куда угодно" },
  { key: "aisles", name: "По отделам", hint: "как идти по залу" },
  { key: "receipt", name: "Как чек", hint: "с ценами и итогом" },
];

const dash = "—";

function money(value, currency) {
  return value == null ? "" : `${Math.round(value).toLocaleString("ru")} ${currency}`;
}

/**
 * Render the list as text. Grouping and ornament change with the style, but the
 * content never invents anything: a product without a known price prints
 * without one rather than with a guess.
 */
export function render(entries, { style = "checklist", aisles = [], currency = "₴", title = "Список покупок", groups = null } = {}) {
  const pending = entries.filter((e) => !e.deleted && !e.done);
  const done = entries.filter((e) => !e.deleted && e.done);

  if (!pending.length && !done.length) return `${title}\n${dash} пусто`;

  const line = (entry, mark) => {
    const bits = [entry.product];
    if (entry.qty) bits.push(entry.qty);
    if (style === "receipt" && entry.price != null) bits.push(money(entry.price, currency));
    return `${mark}${bits.join(" · ")}`;
  };

  const out = [];

  if (style === "plain") {
    out.push(title, "");
    for (const entry of pending) out.push(line(entry, ""));
  } else if (style === "aisles" || (style === "receipt" && !groups)) {
    out.push(title, "");
    for (const group of M.groupByAisle(pending, aisles)) {
      out.push(`${group.name.toUpperCase()}`);
      for (const entry of group.entries) out.push(line(entry, "  "));
      out.push("");
    }
  } else if (style === "receipt" && groups) {
    out.push(title, "");
    for (const group of groups) {
      out.push(group.store ?? "магазин не выбран");
      for (const row of group.rows) out.push(line({ ...row.entry, price: row.price }, "  "));
      out.push("");
    }
  } else {
    out.push(title, "");
    for (const entry of pending) out.push(line(entry, "☐ "));
  }

  if (done.length && style !== "plain") {
    out.push(`взято · ${done.length}`);
    for (const entry of done) out.push(line(entry, "☑ "));
  }

  const total = pending.reduce((sum, e) => sum + (e.price ?? 0), 0);
  if (style === "receipt" && total) {
    out.push(`${dash.repeat(3)}`, `Итого ${money(total, currency)}`);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Attach prices from the trip plan so the "receipt" style has something to show. */
export function withPrices(entries, plan) {
  const priced = new Map(plan.groups.flatMap((g) => g.rows).map((r) => [r.entry.id, r.price]));
  return entries.map((e) => ({ ...e, price: priced.get(e.id) ?? null }));
}

export const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Hand the text to the platform. The share sheet reaches Telegram and every
 * other installed app in one step; without it we fall back to the clipboard,
 * which is what a desktop actually wants anyway.
 */
export async function share(text, { title = "Список покупок" } = {}) {
  if (canShare()) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      /* fall through to the clipboard */
    }
  }

  return copy(text);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** Telegram's own share endpoint — works on desktop where there is no share sheet. */
export function telegramLink(text) {
  return `https://t.me/share/url?url=${encodeURIComponent("")}&text=${encodeURIComponent(text)}`;
}
