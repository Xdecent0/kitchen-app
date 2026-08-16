// Getting onto the home screen — which on Android is the whole difference
// between a bookmark and an app.
//
// Installed, Chrome gives the page its own icon in the launcher, its own window
// with no address bar, its own task in the switcher, and storage the browser
// does not clear during routine cleanup. That is what a "real app" means here;
// an APK on top would add a signing key to keep forever and a build step to the
// one project that deliberately has none, and change nothing the person feels.

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

/** Which set of instructions to show when the browser offers no prompt of its own. */
export function platform(ua = navigator.userAgent) {
  if (/android/i.test(ua)) return "android";
  if (
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  ) {
    return "ios";
  }
  return "desktop";
}

export async function prompt() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  onChange?.();
  return outcome === "accepted";
}
