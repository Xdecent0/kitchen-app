// The single mutable state, with change notification and a durable outbox.
// Every mutation goes through commit() so persistence and sync stay honest.

import { load, save } from "./store.js";
import * as log from "./log.js";

let state = load();
const listeners = new Set();
let onSaveFailed = null;

/* Every save rewrites the entire state, and ticking five items off in the meat
   aisle is five of them inside a couple of seconds. Coalescing turns that burst
   into one write; the flush on page hide is what makes it safe to defer at all. */
const COALESCE_MS = 300;
let saveTimer = null;
let unsaved = false;

function writeNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!unsaved) return;
  unsaved = false;
  if (!save(state)) onSaveFailed?.(state);
}

function writeSoon() {
  unsaved = true;
  if (saveTimer) return;
  saveTimer = setTimeout(writeNow, COALESCE_MS);
}

/** Force the pending write out — before a sync, on page hide, in tests. */
export const flush = writeNow;

/** True while a change exists only in memory. */
export const dirty = () => unsaved;

export function guardUnload(scope = window) {
  scope.addEventListener("pagehide", writeNow);
  scope.document?.addEventListener("visibilitychange", () => {
    if (scope.document.visibilityState === "hidden") writeNow();
  });
}

/** Called when persistence fails, so the shell can say so out loud. */
export function whenSaveFails(fn) {
  onSaveFailed = fn;
}

export const get = () => state;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(reason) {
  for (const fn of listeners) fn(state, reason);
}

/**
 * Apply a mutation, persist, and queue it for the next sync.
 * `mutate` receives the live state and may return a sync op to enqueue.
 */
export function commit(reason, mutate, { sync = true } = {}) {
  const op = mutate(state);
  if (sync && op) state.queue.push({ ...op, at: Date.now(), id: crypto.randomUUID() });

  // A full quota fails silently: the app keeps working from memory and the tab
  // takes everything with it when it closes. Surface it instead — writeNow()
  // reports the failure whenever the deferred write actually lands.
  writeSoon();

  notify(reason);
  return op;
}

/** Re-render without changing anything — for view-local state like filters. */
export function touch(reason = "ui") {
  notify(reason);
}

/** Replace whole state — used by sync when the remote wins. */
export function replace(next, reason = "sync") {
  state = next;
  unsaved = true;
  writeNow();
  log.info("состояние", `замена целиком · ${reason}`);
  notify(reason);
}

export function drainQueue(ids) {
  const done = new Set(ids);
  const before = state.queue.length;
  state.queue = state.queue.filter((op) => !done.has(op.id));
  unsaved = true;
  writeNow();
  log.info("состояние", `очередь очищена · ${before} → ${state.queue.length}`);
}

export function uid(prefix = "x") {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
