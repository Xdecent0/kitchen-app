"""Round-trip check for lib/qr.js: encode here, decode with someone else's decoder.

A QR encoder is exactly the kind of code that looks right and scans as garbage —
one wrong table entry and the matrix is a plausible-looking picture. The only
honest test is to hand the result to an independent decoder and see the original
text come back.

Node produces the matrices, OpenCV reads them. Both are already needed elsewhere
in this project, so this adds no dependency of its own.

Usage:  py -3 tools/verify_qr.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CASES = [
    "kitchen:1",
    "Xdecent0/kitchen-data",
    # The real thing: a pairing payload with a token-shaped secret in it.
    "kitchen1\tXdecent0/kitchen-data\tmain\t"
    + "github_pat_11ABCDEFG0" + "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWX"
    + "\tТимофій",
    # Cyrillic, because the product names in this app are not ASCII.
    "Молоко, творог, хлеб — и ещё двадцать позиций для проверки длины",
    "x" * 200,
]

SCRIPT = """
import { encode } from "../lib/qr.js";
const cases = JSON.parse(process.argv[2]);
const out = cases.map((text) => {
  const code = encode(text);
  const rows = [];
  for (let y = 0; y < code.size; y += 1) {
    let row = "";
    for (let x = 0; x < code.size; x += 1) row += code.get(x, y) ? "1" : "0";
    rows.push(row);
  }
  return { version: code.version, size: code.size, rows };
});
process.stdout.write(JSON.stringify(out));
"""


def main() -> int:
    try:
        import cv2
        import numpy as np
    except ImportError as err:
        print(f"нужен {err.name}: pip install opencv-python-headless numpy", file=sys.stderr)
        return 2

    runner = ROOT / "tools" / "_qr_dump.mjs"
    runner.write_text(SCRIPT, encoding="utf-8")

    try:
        proc = subprocess.run(
            ["node", str(runner), json.dumps(CASES, ensure_ascii=False)],
            capture_output=True,
            cwd=ROOT / "tools",
            check=True,
        )
        codes = json.loads(proc.stdout.decode("utf-8"))
    finally:
        runner.unlink(missing_ok=True)

    detector = cv2.QRCodeDetector()
    failed = 0

    for text, code in zip(CASES, codes):
        size = code["size"]
        quiet = 4
        scale = 8

        canvas = np.ones((size + quiet * 2, size + quiet * 2), dtype=np.uint8) * 255
        for y, row in enumerate(code["rows"]):
            for x, ch in enumerate(row):
                if ch == "1":
                    canvas[y + quiet, x + quiet] = 0

        image = cv2.resize(canvas, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        got, *_ = detector.detectAndDecode(image)

        label = text if len(text) <= 40 else text[:37] + "..."
        if got == text:
            print(f"ok   v{code['version']} {size}x{size}  {label}")
        else:
            failed += 1
            print(f"FAIL v{code['version']} {size}x{size}  {label}", file=sys.stderr)
            print(f"     прочитано: {got!r}", file=sys.stderr)

    print(f"\n{len(CASES) - failed} из {len(CASES)} кодов прочитаны сторонним декодером")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
