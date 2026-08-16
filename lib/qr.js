// A QR encoder, because pairing a phone should not mean typing a token.
//
// A fine-grained GitHub key is ninety-odd characters of random base62. Typing it
// on a phone keyboard is the single worst minute in this app, and it is the very
// first minute — so the desktop, which already holds the key, shows it as a code
// and the phone reads it with the camera it already uses for receipts.
//
// Written here rather than pulled in because the project's premise is no runtime
// dependencies, and because a pairing code carries a live credential: it must
// never travel through anything but the screen and the lens.
//
// Byte mode, error correction level L, versions 1–9 (230 bytes at v9, and the
// payload is about 140). Verified by round trip: encoded here, rendered to a
// PNG, decoded by an independent decoder, compared.

/* ---------- GF(256), the field Reed-Solomon lives in ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error-correction codewords. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    // Multiply by (x + α^i): the x term shifts a coefficient up a degree, the
    // constant term scales it. Swapping these two lines produces a polynomial
    // that looks plausible and encodes to something no scanner can read.
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function remainder(data, degree) {
  const gen = generator(degree);
  const out = new Array(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    for (let i = 0; i < degree; i += 1) out[i] ^= mul(gen[i + 1], factor);
  }

  return out;
}

/* ---------- the tables that cannot be computed ---------- */

/** Per version at EC level L: [ecCodewordsPerBlock, [blockCount, dataCodewords], …]. */
const BLOCKS_L = {
  1: [7, [[1, 19]]],
  2: [10, [[1, 34]]],
  3: [15, [[1, 55]]],
  4: [20, [[1, 80]]],
  5: [26, [[1, 108]]],
  6: [18, [[2, 68]]],
  7: [20, [[2, 78]]],
  8: [24, [[2, 97]]],
  9: [30, [[2, 116]]],
};

const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
};

/** Versions 2–6 leave seven unused bits at the end; 7–9 leave none. */
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0 };

/** 18-bit version information, only present from version 7. */
const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99 };

const dataCodewords = (version) =>
  BLOCKS_L[version][1].reduce((sum, [count, data]) => sum + count * data, 0);

/** Byte-mode payload capacity: four bits of mode plus eight of length. */
const capacity = (version) => Math.floor((dataCodewords(version) * 8 - 12) / 8);

/* ---------- bit stream ---------- */

class Bits {
  constructor() {
    this.bits = [];
  }

  push(value, length) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1);
  }

  get length() {
    return this.bits.length;
  }

  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) out[i >> 3] |= 0x80 >> (i & 7);
    });
    return out;
  }
}

/* ---------- format information ---------- */

/** BCH(15,5) over the five bits of "EC level + mask", masked by 0x5412. */
function formatBits(mask) {
  const data = (0b01 << 3) | mask; // 01 = error correction level L
  let rest = data << 10;

  for (let i = 4; i >= 0; i -= 1) {
    if (rest & (1 << (i + 10))) rest ^= 0b10100110111 << i;
  }

  return ((data << 10) | rest) ^ 0b101010000010010;
}

/* ---------- matrix ---------- */

function newMatrix(size) {
  return {
    size,
    modules: new Int8Array(size * size).fill(-1), // -1 = free
    at(x, y) {
      return this.modules[y * this.size + x];
    },
    set(x, y, value) {
      this.modules[y * this.size + x] = value;
    },
  };
}

function placeFinder(m, x0, y0) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;

      const edge = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      m.set(x, y, edge === 2 || edge > 3 ? 0 : 1);
    }
  }
}

function placeFunctionPatterns(m, version) {
  placeFinder(m, 0, 0);
  placeFinder(m, m.size - 7, 0);
  placeFinder(m, 0, m.size - 7);

  // Timing patterns run between the finders, alternating from their edges.
  for (let i = 8; i < m.size - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    m.set(i, 6, bit);
    m.set(6, i, bit);
  }

  for (const cy of ALIGN[version]) {
    for (const cx of ALIGN[version]) {
      // The three corners already hold finders.
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === m.size - 7) || (cx === m.size - 7 && cy === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          m.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1);
        }
      }
    }
  }

  m.set(8, m.size - 8, 1); // the one module that is always dark

  // Reserve the format areas so data placement skips them.
  for (let i = 0; i < 9; i += 1) {
    if (m.at(i, 8) === -1) m.set(i, 8, 0);
    if (m.at(8, i) === -1) m.set(8, i, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    if (m.at(m.size - 1 - i, 8) === -1) m.set(m.size - 1 - i, 8, 0);
    if (m.at(8, m.size - 1 - i) === -1) m.set(8, m.size - 1 - i, 0);
  }

  if (VERSION_INFO[version] !== undefined) {
    const info = VERSION_INFO[version];
    for (let i = 0; i < 18; i += 1) {
      const bit = (info >> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + m.size - 11;
      m.set(a, b, bit);
      m.set(b, a, bit);
    }
  }
}

function placeFormat(m, mask) {
  const bits = formatBits(mask);

  for (let i = 0; i < 15; i += 1) {
    const bit = (bits >> i) & 1;

    // Around the top-left finder, skipping the timing row and column.
    if (i < 6) m.set(8, i, bit);
    else if (i === 6) m.set(8, 7, bit);
    else if (i === 7) m.set(8, 8, bit);
    else if (i === 8) m.set(7, 8, bit);
    else m.set(14 - i, 8, bit);

    // And the copy split between the other two finders.
    if (i < 8) m.set(m.size - 1 - i, 8, bit);
    else m.set(8, m.size - 15 + i, bit);
  }
}

/** Which of the eight masks applies at this cell. */
function maskAt(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function placeData(m, bytes, version) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);
  }
  for (let i = 0; i < REMAINDER_BITS[version]; i += 1) bits.push(0);

  let index = 0;
  let upward = true;

  for (let right = m.size - 1; right >= 1; right -= 2) {
    // Column six is the vertical timing pattern and is not part of the zig-zag.
    const col = right <= 6 ? right - 1 : right;

    for (let step = 0; step < m.size; step += 1) {
      const y = upward ? m.size - 1 - step : step;
      for (const x of [col, col - 1]) {
        if (m.at(x, y) !== -1) continue;
        m.set(x, y, index < bits.length ? bits[index] : 0);
        index += 1;
      }
    }

    upward = !upward;
  }
}

/* ---------- mask penalty ---------- */

function penalty(m) {
  const { size } = m;
  const get = (x, y) => m.at(x, y);
  let score = 0;

  // Rule 1: runs of five or more of the same colour.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      let prev = horizontal ? get(0, i) : get(i, 0);
      for (let j = 1; j < size; j += 1) {
        const value = horizontal ? get(j, i) : get(i, j);
        if (value === prev) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          prev = value;
          run = 1;
        }
      }
    }
  }

  // Rule 2: every 2×2 block of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = get(x, y);
      if (v === get(x + 1, y) && v === get(x, y + 1) && v === get(x + 1, y + 1)) score += 3;
    }
  }

  // Rule 3: the finder-like sequence, which a scanner could mistake for one.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (const horizontal of [true, false]) {
        const fits = (pattern) =>
          pattern.every((bit, k) => {
            const px = horizontal ? x + k : x;
            const py = horizontal ? y : y + k;
            return px < size && py < size && get(px, py) === bit;
          });
        if (fits(A) || fits(B)) score += 40;
      }
    }
  }

  // Rule 4: overall imbalance between dark and light.
  let dark = 0;
  for (let i = 0; i < size * size; i += 1) if (m.modules[i] === 1) dark += 1;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ---------- the whole thing ---------- */

/** Smallest version that holds `length` bytes, or null if it does not fit. */
export function versionFor(length) {
  for (let v = 1; v <= 9; v += 1) if (capacity(v) >= length) return v;
  return null;
}

/**
 * Encode text as a QR matrix.
 * Returns `{ size, get(x, y) }` where `get` answers 1 for a dark module.
 */
export function encode(text) {
  const payload = new TextEncoder().encode(text);
  const version = versionFor(payload.length);
  if (!version) throw new Error(`${payload.length} байт не помещается в код — нужен код версии выше девятой`);

  const [ecPerBlock, groups] = BLOCKS_L[version];
  const totalData = dataCodewords(version);

  const stream = new Bits();
  stream.push(0b0100, 4); // byte mode
  stream.push(payload.length, 8);
  for (const byte of payload) stream.push(byte, 8);

  // Terminator, then pad to a byte boundary, then the two alternating pad bytes.
  stream.push(0, Math.min(4, totalData * 8 - stream.length));
  while (stream.length % 8 !== 0) stream.push(0, 1);

  const data = Array.from(stream.toBytes());
  for (let i = 0; data.length < totalData; i += 1) data.push(i % 2 === 0 ? 0xec : 0x11);

  // Split into blocks, compute error correction, then interleave both — a burst
  // of damage then lands across many blocks instead of destroying one.
  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const chunk = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: chunk, ec: remainder(chunk, ecPerBlock) });
    }
  }

  const interleaved = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.data.length) interleaved.push(block.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of blocks) interleaved.push(block.ec[i]);
  }

  const size = version * 4 + 17;
  let best = null;

  for (let mask = 0; mask < 8; mask += 1) {
    const m = newMatrix(size);
    placeFunctionPatterns(m, version);

    const reserved = Int8Array.from(m.modules);
    placeData(m, interleaved, version);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (reserved[y * size + x] === -1 && maskAt(mask, x, y)) {
          m.set(x, y, m.at(x, y) ^ 1);
        }
      }
    }

    placeFormat(m, mask);

    const score = penalty(m);
    if (!best || score < best.score) best = { score, m };
  }

  return {
    size,
    version,
    get: (x, y) => (best.m.at(x, y) === 1 ? 1 : 0),
  };
}

/** The matrix as an SVG string — quiet zone included, because scanners need it. */
export function toSvg(text, { scale = 4, quiet = 4, dark = "#1c3327", light = "#ffffff" } = {}) {
  const code = encode(text);
  const side = (code.size + quiet * 2) * scale;

  let path = "";
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (code.get(x, y)) path += `M${(x + quiet) * scale} ${(y + quiet) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" role="img" aria-label="Код для подключения телефона">
  <rect width="${side}" height="${side}" fill="${light}"/>
  <path d="${path}" fill="${dark}"/>
</svg>`;
}
