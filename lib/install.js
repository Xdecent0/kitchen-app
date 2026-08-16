// Getting onto the home screen — which is not cosmetics.
//
// Safari treats an ordinary website's storage as disposable: seven days without
// a visit and Intelligent Tracking Prevention clears it, taking the list, the
// stock and the access token with it. Installed to the home screen the same
// origin is exempt. So the app has to say this out loud, and offer the shortest
// path it can — a real prompt where the browser gives one, honest instructions
// where it does not.

let deferred = null;
let onChange = null;

export function watch(scope = window) {
  scope.addEventListener("beforeinstallprompt", (e) => {
    // Chrome shows its own bar at a moment of its choosing; holding the event
    // lets the offer live where the explanation is.
    e.preventDefault();
    deferred = e;
    onChange?.();
  });

  scope.addEventListener("appinstalled", () => {
    deferred = null;
    onChange?.();
  });
}

export function whenChanged(fn) {
  onChange = fn;
}

export const canPrompt = () => Boolean(deferred);

export const installed = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac; the touch points give it away.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export async function prompt() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  onChange?.();
  return outcome === "accepted";
}
