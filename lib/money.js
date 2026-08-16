// Money in more than one currency.
//
// Everything is recorded in hryvnia, because that is what the till printed and
// what the receipt says. The other currencies are a *view* — and a view that
// must not quietly lie: a purchase made in March converted at today's rate is
// not what that purchase cost. So rates are kept per day and each amount is
// converted at the rate of its own day, with the app saying plainly when it had
// to fall back to a later one.

export const CURRENCIES = [
  { code: "UAH", symbol: "₴", name: "гривна" },
  { code: "USD", symbol: "$", name: "доллар" },
  { code: "EUR", symbol: "€", name: "евро" },
];

export const symbolOf = (code) => CURRENCIES.find((c) => c.code === code)?.symbol ?? code;

/** Milliseconds to the YYYY-MM-DD key the rate table is written with. */
export function dayKey(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * The rate to use for a given day, and how honestly it was found.
 *
 * `exact` — the rate of that very day. `nearest` — the closest earlier day,
 * which is what a bank does for a weekend. `latest` — nothing that old is
 * known, so today's rate stands in and the interface should say so.
 */
export function rateFor(rates, code, at) {
  if (code === "UAH") return { rate: 1, basis: "exact" };

  // No table means no answer. Falling through to a rate of one would print the
  // hryvnia figure with a dollar sign on it, which is worse than saying nothing.
  const days = rates?.days;
  if (!days) return { rate: null, basis: "none" };

  const want = dayKey(at);
  const known = Object.keys(days)
    .filter((day) => typeof days[day]?.[code] === "number")
    .sort();
  if (!known.length) return { rate: null, basis: "none" };

  if (want && days[want]?.[code]) return { rate: days[want][code], basis: "exact" };

  const earlier = want ? known.filter((day) => day <= want) : [];
  if (earlier.length) {
    const day = earlier[earlier.length - 1];
    return { rate: days[day][code], basis: "nearest", day };
  }

  const day = known[known.length - 1];
  return { rate: days[day][code], basis: "latest", day };
}

/**
 * Hryvnia into another currency. The table holds hryvnia per unit, the way a
 * bank quotes it, so the conversion is a division.
 */
export function convert(amount, code, { rates, at = Date.now() } = {}) {
  if (amount == null) return null;
  if (code === "UAH") return { value: amount, basis: "exact" };

  const { rate, basis, day } = rateFor(rates, code, at);
  if (!rate) return null;
  return { value: amount / rate, basis, day };
}

const round = (value) => (Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10);

export function format(value, code) {
  if (value == null) return "";
  return `${round(value).toLocaleString("ru")} ${symbolOf(code)}`;
}

/**
 * The same sum in the currencies the person asked to see alongside.
 *
 * Returns null rather than a guess when no rate is known — an approximate
 * number with no basis is worse than no number, because it looks like an answer.
 */
export function alongside(amount, { rates, at = Date.now(), show = [] } = {}) {
  if (amount == null || !show.length) return null;

  const parts = [];
  let stale = false;

  for (const code of show) {
    if (code === "UAH") continue;
    const converted = convert(amount, code, { rates, at });
    if (!converted) continue;
    if (converted.basis === "latest") stale = true;
    parts.push(format(converted.value, code));
  }

  if (!parts.length) return null;
  return { text: `≈ ${parts.join(" · ")}`, stale };
}

/** When the table was last refreshed, for the interface to be honest about age. */
export function ratesAge(rates, now = Date.now()) {
  if (!rates?.updated) return null;
  return Math.floor((now - rates.updated) / 86400000);
}
