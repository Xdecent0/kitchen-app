// The app's own black box.
//
// There is no server to read logs from and no devtools in a shop aisle, so the
// only place a failure can be seen after the fact is inside the app itself.
// A bounded ring in localStorage survives the reload that follows a crash,
// which is exactly the moment the evidence is otherwise lost.

const KEY = "kitchen.log.v1";
const CAP = 400;

/** Levels are one letter on disk: a full log is ~40 KB, and every byte is shared with state. */
const LEVELS = { i: "инфо", w: "внимание", e: "сбой" };

const hasStorage = () => typeof localStorage !== "undefined";

let ring = read();
let dirty = false;
let flushTimer = null;
let listeners = new Set();

function read() {
  if (!hasStorage()) return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-CAP) : [];
  } catch {
    return [];
  }
}

/* Writing the journal on every line would cost more than the thing it measures,
   so it lands on a timer — and on page hide, because a crash is the one entry
   that must not be the one that got away. */
function flush() {
  if (!dirty || !hasStorage()) return;
  dirty = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(ring));
  } catch {
    // A full quota drops the journal rather than the groceries: halve and retry once.
    ring = ring.slice(-Math.floor(CAP / 2));
    try {
      localStorage.setItem(KEY, JSON.stringify(ring));
    } catch {
      /* give up quietly — the journal is never worth breaking the app for */
    }
  }
}

function schedule() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 2000);
  // A pending journal write should never be the reason a process stays alive.
  // In a browser the handle is a number and this is a no-op.
  flushTimer?.unref?.();
}

/** Keep payloads small and always printable — a log entry must never itself throw. */
function shrink(data) {
  if (data == null) return undefined;
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  } catch {
    return String(data).slice(0, 240);
  }
}

function push(level, src, msg, data) {
  const entry = { t: Date.now(), l: level, s: src, m: String(msg) };
  const d = shrink(data);
  if (d !== undefined) entry.d = d;

  ring.push(entry);
  if (ring.length > CAP) ring = ring.slice(-CAP);

  schedule();
  for (const fn of listeners) fn(entry);
  return entry;
}

export const info = (src, msg, data) => push("i", src, msg, data);
export const warn = (src, msg, data) => push("w", src, msg, data);
export const fail = (src, msg, data) => push("e", src, msg, data);

export const entries = ({ level, src, limit = CAP } = {}) => {
  let out = ring;
  if (level) out = out.filter((e) => e.l === level);
  if (src) out = out.filter((e) => e.s === src);
  return out.slice(-limit);
};

export const counts = () => ({
  all: ring.length,
  warn: ring.filter((e) => e.l === "w").length,
  fail: ring.filter((e) => e.l === "e").length,
});

export function clear() {
  ring = [];
  dirty = true;
  flush();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const levelName = (l) => LEVELS[l] ?? l;

/**
 * Measure a span. `warnAfter` keeps the journal about problems: a save that takes
 * two milliseconds is not news, and four hundred lines saying so would bury the
 * one line that is.
 */
export function time(src, label, { warnAfter = 0 } = {}) {
  const t0 = performance.now();
  return (data) => {
    const ms = Math.round(performance.now() - t0);
    if (!warnAfter) info(src, `${label} · ${ms} мс`, data);
    else if (ms >= warnAfter) warn(src, `${label} · ${ms} мс`, data);
    return ms;
  };
}

/** The journal as text, newest last — meant to be pasted into a message. */
export function asText() {
  const stamp = (t) =>
    new Date(t).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return ring
    .map((e) => `${stamp(e.t)} ${e.l.toUpperCase()} [${e.s}] ${e.m}${e.d ? ` — ${e.d}` : ""}`)
    .join("\n");
}

/**
 * Catch what nothing else catches. An unhandled rejection inside a sync round
 * trip used to vanish into `catch(() => null)`; now it leaves a trace even when
 * the interface says nothing.
 */
export function captureGlobals(scope = window) {
  scope.addEventListener("error", (e) => {
    fail("код", e.message || "ошибка без описания", `${e.filename ?? "?"}:${e.lineno ?? "?"}`);
  });

  scope.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    fail("код", reason?.message ?? String(reason ?? "отклонённое обещание"), reason?.stack?.slice(0, 240));
  });

  scope.addEventListener("pagehide", flush);
  scope.document?.addEventListener("visibilitychange", () => {
    if (scope.document.visibilityState === "hidden") flush();
  });
}
