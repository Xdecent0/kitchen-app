// Domain logic: normalization, shelf life, consumption forecast, list assembly.
// Pure functions only — no DOM, no storage. Everything here is testable in isolation.

export const DAY = 86400000;

export function today(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(from, to) {
  return Math.round((to - from) / DAY);
}

/** Receipt line -> product, in three escalating steps. Confidence drives the review queue. */
export function normalize(rawLine, { rules = {}, synonyms = [], junk = [] } = {}) {
  const raw = rawLine.trim();
  const key = raw.toUpperCase();

  if (junk.some((j) => key.includes(j))) {
    return { raw, product: null, confidence: 1, source: "junk" };
  }

  const learned = rules[key];
  if (learned) {
    return { raw, product: learned, confidence: 1, source: "rule" };
  }

  for (const { mask, product } of synonyms) {
    if (key.includes(mask)) {
      return { raw, product, confidence: 0.9, source: "synonym" };
    }
  }

  return { raw, product: guessProduct(raw), confidence: 0.4, source: "guess" };
}

/**
 * Last-resort guess. Tills print the noun first and pile abbreviations after it
 * ("МОРС КЛЮКВ 1Л"), so the leading word is the one worth keeping — picking the
 * longest instead yields truncated adjectives like "Клюкв".
 */
function guessProduct(raw) {
  const words = raw
    .replace(/\d+[.,]?\d*\s*(Г|КГ|МЛ|Л|ШТ|УП|G|KG|ML|L)\b/giu, " ")
    .replace(/\d+[.,]?\d*\s*%/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (!words.length) return null;
  const word = words[0].toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export const CONFIDENCE_FLOOR = 0.8;

export function needsReview(line) {
  return line.product !== null && line.confidence < CONFIDENCE_FLOOR;
}

/** Shelf life from the reference table, falling back to a cautious default. */
export function shelfLife(product, shelf, { opened = false, zone } = {}) {
  const key = product.toLowerCase();
  const matches = shelf.filter((e) => key.includes(e.product) || e.product.includes(key));
  if (!matches.length) return null;

  const entry = matches.find((e) => !zone || e.zone === zone) ?? matches[0];
  const days = opened && entry.opened ? entry.opened : entry.closed;
  return { days, zone: entry.zone };
}

export function expiryOf(item) {
  if (item.expires) return item.expires;
  if (!item.boughtAt || item.shelfDays == null) return null;
  return item.boughtAt + item.shelfDays * DAY;
}

/**
 * The full run the meter measures against.
 *
 * Usually the reference table's figure. But a date read off the packet is the
 * better authority and can be set without the product being in the table at
 * all, so the span from purchase to that date stands in — otherwise a hand-set
 * expiry would show its days and no bar.
 */
function span(item) {
  if (item.shelfDays) return item.shelfDays;
  if (item.expires && item.boughtAt) return Math.max(1, daysBetween(item.boughtAt, item.expires));
  return null;
}

/** Freshness as a 0..1 share of shelf life left, plus the tone the UI paints it in. */
export function freshness(item, now = today()) {
  const expires = expiryOf(item);
  const total = span(item);
  if (expires == null || !total) return { left: null, share: null, tone: "calm" };

  const left = daysBetween(now, expires);
  const share = Math.max(0, Math.min(1, left / total));
  const tone = left <= 1 ? "bad" : left <= 3 ? "warn" : "calm";
  return { left, share, tone };
}

export function isBurning(item, now = today()) {
  const { left } = freshness(item, now);
  return left != null && left <= 1;
}

export function expiryLabel(item, now = today()) {
  const { left } = freshness(item, now);
  if (left == null) return "срок неизвестен";
  if (left < 0) return "просрочено";
  if (left === 0) return "сегодня последний день";
  if (left === 1) return "до завтра";
  return `${left} ${plural(left, "день", "дня", "дней")}`;
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Purchase rhythm: the median gap between buys of one product.
 * Median, not mean — one stock-up trip should not double the estimate.
 */
export function purchaseRhythm(purchaseDates) {
  if (purchaseDates.length < 2) return null;
  const sorted = [...purchaseDates].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((d, i) => daysBetween(sorted[i], d)).filter((g) => g > 0);
  if (!gaps.length) return null;

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

/**
 * A product is due when more time has passed since the last buy than its usual
 * rhythm — but not forever. Answering "still have it" at an audit silences it
 * for a full cycle, otherwise the same question returns every week; and a gap
 * far past the rhythm means the habit stopped, not that the need piled up.
 */
export function isDue(product, history, now = today(), confirmed = {}) {
  const dates = history[product];
  if (!dates?.length) return false;

  const rhythm = purchaseRhythm(dates);
  if (rhythm == null) return false;

  const since = daysBetween(Math.max(...dates), now);
  if (since < rhythm) return false;

  // Seasonal things: a watermelon bought every 4 days in July should not turn up
  // in December claiming it ran out 124 days ago.
  if (since > Math.max(rhythm * 3, rhythm + 30)) return false;

  const okSince = confirmed[product];
  if (okSince != null && daysBetween(okSince, now) < rhythm) return false;

  return true;
}

export function dueReason(product, history, now = today()) {
  const dates = history[product] ?? [];
  const rhythm = purchaseRhythm(dates);
  if (rhythm == null) return "";

  const since = daysBetween(Math.max(...dates), now);
  const over = since - rhythm;
  const rhythmText = `берёшь каждые ${rhythm} ${plural(rhythm, "день", "дня", "дней")}`;
  if (over < 0) return rhythmText;
  if (over === 0) return `кончилось сегодня · ${rhythmText}`;
  if (over === 1) return `кончилось вчера · ${rhythmText}`;
  return `кончилось ${over} ${plural(over, "день", "дня", "дней")} назад · ${rhythmText}`;
}

/** Aisle lookup, so the list walks the store in one pass. */
export function aisleOf(product, aisles) {
  const key = product.toLowerCase();
  const hit = aisles.find((a) => a.items.some((i) => key.includes(i)));
  return hit ?? { order: 99, name: "прочее" };
}

/**
 * The aisle for a record rather than for a name.
 *
 * A person who has said where something belongs has said it about that jar, and
 * the table does not get to argue: the guess only runs when nobody has answered.
 */
export function aisleOfEntry(entry, aisles) {
  if (!entry?.aisle) return aisleOf(entry?.product ?? "", aisles);
  const known = aisles.find((a) => a.name === entry.aisle);
  return known ?? { order: 98, name: entry.aisle };
}

export function groupByAisle(entries, aisles) {
  const groups = new Map();

  for (const entry of entries) {
    const aisle = aisleOfEntry(entry, aisles);
    if (!groups.has(aisle.name)) groups.set(aisle.name, { ...aisle, entries: [] });
    groups.get(aisle.name).entries.push(entry);
  }

  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/**
 * Records of the same thing, folded into one line that opens.
 *
 * Two tubs of ice cream are two records — they can be different flavours, bought
 * on different days, with different dates on them — and flattening them into a
 * single "2 шт" would throw all of that away. So the shelf shows one line per
 * name and the line opens; the count and the nearest date live on the outside,
 * because the nearest date is the one that decides whether anything is burning.
 */
export function collapseSame(entries, now = today()) {
  const groups = new Map();

  for (const entry of entries) {
    const key = (entry.product ?? "").trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, product: entry.product, entries: [] });
    groups.get(key).entries.push(entry);
  }

  return [...groups.values()].map((g) => {
    const sorted = sortByUrgency(g.entries, now);
    return { ...g, entries: sorted, head: sorted[0], count: sorted.length };
  });
}

/** Sort stock so what is about to spoil is impossible to miss. */
export function sortByUrgency(items, now = today()) {
  return [...items].sort((a, b) => {
    const la = freshness(a, now).left;
    const lb = freshness(b, now).left;
    if (la == null && lb == null) return a.product.localeCompare(b.product, "ru");
    if (la == null) return 1;
    if (lb == null) return -1;
    return la - lb;
  });
}
