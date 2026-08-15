"""Static server for local work that never lets the browser cache anything.

Python's http.server sends Last-Modified and nothing else, so browsers keep
heuristically caching ES modules and quietly serve an edit-old build — which
looks exactly like "the fix does not work". no-store removes the question.
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        if "GET" in (args[0] if args else ""):
            return
        super().log_message(fmt, *args)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8779
    root = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent

    handler = partial(NoCacheHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)

    print(f"kitchen dev server: http://localhost:{port}  (no-store)  root={root}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
