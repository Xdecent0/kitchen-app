// The single mutable state, with change notification and a durable outbox.
// Every mutation goes through commit() so persistence and sync stay honest.

import { load, save } from "./store.js";

let state = load();
const listeners = new Set();
let onSaveFailed = null;

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
  // takes everything with it when it closes. Surface it instead.
  if (!save(state)) onSaveFailed?.(state);

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
  save(state);
  notify(reason);
}

export function drainQueue(ids) {
  const done = new Set(ids);
  state.queue = state.queue.filter((op) => !done.has(op.id));
  save(state);
}

export function uid(prefix = "x") {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
