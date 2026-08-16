// Getting a receipt into the app: QR when the till printed one, a photo when it did not.
// Neither path decodes anything here — the browser cannot reach the tax service,
// and OCR belongs where it can run for free, so both end up as jobs for an Action.

import * as gh from "./github.js";
import * as M from "./model.js";

export const qrSupported = () => "BarcodeDetector" in window;

/**
 * The stream, not the element.
 *
 * The screen is rebuilt from scratch on every render, so the <video> the camera
 * was opened against is thrown away constantly — by any edit, by an autosync
 * landing, by crossing the desktop breakpoint. Handing back a stop function tied
 * to that one element meant the viewfinder went black and stayed black until the
 * person left the screen, while "Снять фото" insisted the camera was
 * unavailable. The stream outlives the elements; attach() re-marries them.
 */
export async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 } },
    audio: false,
  });
}

export async function attach(video, stream) {
  if (video.srcObject !== stream) video.srcObject = stream;
  if (video.paused) await video.play().catch(() => {});
  return video;
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Watch the camera for a QR code. Resolves with its payload; caller stops the camera. */
export function scanQr(video, { signal, onFrame } = {}) {
  if (!qrSupported()) return Promise.reject(new Error("камера этого браузера не умеет читать QR"));

  const detector = new BarcodeDetector({ formats: ["qr_code"] });

  return new Promise((resolve, reject) => {
    let stopped = false;

    signal?.addEventListener("abort", () => {
      stopped = true;
      reject(new Error("отменено"));
    });

    const tick = async () => {
      if (stopped) return;
      try {
        const found = await detector.detect(video);
        if (found.length) {
          stopped = true;
          resolve(found[0].rawValue);
          return;
        }
        onFrame?.();
      } catch {
        /* a dropped frame is not a failure */
      }
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

export async function grabPhoto(video, { maxWidth = 1400 } = {}) {
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  return blob;
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export async function submitQr(url) {
  return gh.submitJob("receipt-qr", { url });
}

export async function submitPhoto(blob) {
  return gh.submitJob("receipt-ocr", { image: await toBase64(blob), mime: blob.type });
}

/**
 * The QR path for browsers that cannot read one.
 *
 * Safari has no BarcodeDetector, so on an iPhone the live viewfinder never had a
 * QR path at all and everything fell through to OCR over the whole receipt —
 * dirty lines, lost quantities, a disputed pile every time. The code is still
 * printed on the paper; photographing it and decoding it where a decoder can run
 * costs one round trip and gives the clean path back.
 */
export async function submitQrPhoto(blob) {
  return gh.submitJob("receipt-qr-photo", { image: await toBase64(blob), mime: blob.type });
}

/* ---------- turning raw lines into stock ---------- */

/**
 * Run every raw line through normalization and split it three ways:
 * accepted silently, needing a human, and discarded as till noise.
 */
export function classify(rawLines, refs) {
  const accepted = [];
  const disputed = [];
  const discarded = [];

  for (const raw of rawLines) {
    const text = typeof raw === "string" ? raw : raw.name;
    const line = M.normalize(text, refs);
    const enriched = {
      ...line,
      qty: typeof raw === "object" ? raw.qty ?? null : null,
      price: typeof raw === "object" ? raw.price ?? null : null,
    };

    if (line.source === "junk" || !line.product) discarded.push(enriched);
    else if (M.needsReview(line)) disputed.push(enriched);
    else accepted.push(enriched);
  }

  return { accepted, disputed, discarded };
}

/** A confirmed line becomes stock, with its shelf life read from the reference table. */
export function toStockItem(line, { shelf, boughtAt, id }) {
  const life = M.shelfLife(line.product, shelf, { zone: line.zone });

  return {
    id,
    product: line.product,
    qty: line.qty ? String(line.qty) : "",
    price: line.price ?? null,
    zone: line.zone ?? life?.zone ?? "полка",
    boughtAt,
    shelfDays: life?.days ?? null,
    level: "много",
    opened: false,
    at: Date.now(),
  };
}

/** What the summary screen reports after a receipt lands. */
export function summarize({ accepted, disputed, discarded }, { listRemoved, learned }) {
  // A line the person skipped keeps its raw text but loses its product, and
  // only lines with a product reach the shelf — so only those are "added".
  const kept = disputed.filter((l) => l.product);

  return {
    added: accepted.length + kept.length,
    removedFromList: listRemoved,
    discarded: discarded.length + (disputed.length - kept.length),
    learned,
  };
}
