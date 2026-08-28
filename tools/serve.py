#!/usr/bin/env python3
"""
serve.py — local dev server that mirrors the Vercel config in vercel.json.

python -m http.server does NOT understand cleanUrls, so /admin 404s locally
while working in production — the exact class of mismatch that wastes an
afternoon. This server reproduces the rules that matter:

  cleanUrls: true      /admin        -> serves admin.html
                       /admin.html   -> 308 redirect to /admin
  trailingSlash: false /admin/       -> 308 redirect to /admin
  404.html             anything else -> 404.html with status 404
  .vercelignore        src/, tools/, firebase/ are not served

Run:  python3 tools/serve.py [port]     (or: npm run dev)
"""
from __future__ import annotations

import functools
import http.server
import json
import pathlib
import re
import socketserver
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

BLOCKED = {"src", "tools", "firebase", "node_modules", ".git"}


class VercelLikeHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _redirect(self, location: str) -> None:
        self.send_response(308)
        self.send_header("Location", location)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._route()

    def do_HEAD(self) -> None:  # noqa: N802
        # Same routing as GET, otherwise `curl -I /admin` reports a false 404
        # and header checks look broken when they are not.
        self._route(head=True)

    def _route(self, head: bool = False) -> None:
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        top = path.strip("/").split("/", 1)[0]

        if top in BLOCKED:
            self.send_error(404, "Not Found")
            return

        # trailingSlash: false
        if len(path) > 1 and path.endswith("/"):
            self._redirect(path.rstrip("/"))
            return

        # cleanUrls: /foo.html -> 308 -> /foo
        if path.endswith(".html") and path != "/404.html":
            self._redirect(path[: -len(".html")])
            return

        # cleanUrls: /foo -> foo.html
        if path != "/" and "." not in path.rsplit("/", 1)[-1]:
            candidate = ROOT / (path.lstrip("/") + ".html")
            if candidate.is_file():
                self.path = path + ".html"
                return super().do_HEAD() if head else super().do_GET()

        target = ROOT / path.lstrip("/")
        if path == "/":
            target = ROOT / "index.html"
        if not target.is_file():
            body = (ROOT / "404.html").read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)
            return

        return super().do_HEAD() if head else super().do_GET()

    def end_headers(self) -> None:
        # Apply the same response headers vercel.json declares, so what you see
        # locally is what the browser gets in production.
        for rule in HEADER_RULES:
            if rule["match"](self.path):
                for h in rule["headers"]:
                    self.send_header(h["key"], h["value"])
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def _matcher(source: str):
    if source == "/(.*)":
        return lambda p: True
    # Vercel/path-to-regexp negative lookahead, e.g. "/:path((?!admin).*)"
    m = re.match(r"^/:[a-zA-Z]+\(\(\?!([^)]+)\)\.\*\)$", source)
    if m:
        excluded = m.group(1)
        return lambda p, e=excluded: not p.split("?")[0].lstrip("/").startswith(e)
    if source.endswith("/:path*"):
        prefix = source[: -len("/:path*")]
        return lambda p, prefix=prefix: p.startswith(prefix + "/")
    return lambda p, s=source: p.split("?")[0] == s


cfg = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
HEADER_RULES = [{"match": _matcher(h["source"]), "headers": h["headers"]} for h in cfg.get("headers", [])]


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer(("0.0.0.0", PORT), VercelLikeHandler) as httpd:
        print(f"serving {ROOT} on http://0.0.0.0:{PORT}")
        print("  /        -> index.html")
        print("  /admin   -> admin.html   (cleanUrls)")
        httpd.serve_forever()
