// Pairing a second device.
//
// The key is ninety-odd characters of random base62, and typing it on a phone
// keyboard is the first thing the app ever asks anyone to do. The machine that
// already holds the key shows it as a code; the phone reads it with the camera
// it already uses for receipts. Nothing leaves the two devices — the payload
// travels through a screen and a lens and nowhere else.

const MAGIC = "kitchen1";
const SEP = "\t";

/** Tabs are the separator, so they cannot survive inside a field. */
const clean = (value) => String(value ?? "").replace(/[\t\n\r]/g, " ").trim();

export function encodePairing({ repo, branch = "main", token, name = "" }) {
  if (!repo || !token) throw new Error("нечего передавать: нет репозитория или ключа");
  return [MAGIC, clean(repo), clean(branch) || "main", clean(token), clean(name)].join(SEP);
}

/**
 * Read a pairing payload, or refuse it.
 *
 * The camera sees whatever is in front of it — a receipt QR, a poster, a
 * parcel label. Anything that is not ours is not a failure to report, it is
 * simply not a pairing code, and the scanner keeps looking.
 */
export function parsePairing(text) {
  const parts = String(text ?? "").split(SEP);
  if (parts[0] !== MAGIC) return null;

  const [, repo, branch, token, name = ""] = parts;
  if (!repo || !token) return null;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;

  return { repo, branch: branch || "main", token, name };
}

/** True for anything that even claims to be one, so a wrong version can be named. */
export const looksLikePairing = (text) => String(text ?? "").startsWith("kitchen");
