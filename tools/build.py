#!/usr/bin/env python3
"""
build.py — generate the single deployable site from src/, into the repo root.

  src/  ->  index.html      public site  (served at /)
            admin.html      admin panel  (served at /admin via cleanUrls)
            404.html
            css/ js/ images/ robots.txt

Everything is emitted at the repo root so Vercel needs NO Root Directory
setting: import the repo, click Deploy, done. tools/, src/ and supabase/ are
kept out of the deployment by .vercelignore.

index.html and admin.html sit at the same depth, so both use the identical
relative asset paths (./css/…, ./js/…, ./images/…) and nothing needs rewriting.

Run:  python3 tools/build.py     (or: npm run build)
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

LOGO = "heritage-fest-logo-708214d0.jpg"

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Tiro+Bangla:ital@0;1'
    "&family=Hind+Siliguri:wght@400;500;600;700"
    "&family=Spectral:ital,wght@0,400;0,600;0,700;1,400"
    "&family=Inter:wght@400;500;600;700"
    '&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">'
)

# supabase-js is only pulled in when a backend is actually configured, so an
# unconfigured build makes zero third-party requests.
SUPABASE_CDN = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>'


def supabase_configured() -> bool:
    """True when src/shared/config.js has a non-empty SUPABASE_URL."""
    cfg = (SRC / "shared" / "config.js").read_text(encoding="utf-8")
    m = re.search(r"SUPABASE_URL:\s*'([^']*)'", cfg)
    return bool(m and m.group(1).strip())


PUBLIC_HEAD = f"""<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>উত্তরবঙ্গ হেরিটেজ ফেস্ট | Uttarbanga Heritage Fest</title>
<meta name="description" content="উত্তরবঙ্গ হেরিটেজ ফেস্ট — প্রজন্ম ফাউন্ডেশন আয়োজিত অনলাইন হেরিটেজ কুইজ ও উৎসব। রেজিস্ট্রেশন, পরীক্ষা ও লিডারবোর্ড।">
<meta name="theme-color" content="#A6461E">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="উত্তরবঙ্গ হেরিটেজ ফেস্ট | Uttarbanga Heritage Fest">
<meta property="og:description" content="প্রজন্ম ফাউন্ডেশন আয়োজিত অনলাইন হেরিটেজ কুইজ ও উৎসব।">
<meta property="og:image" content="./images/{LOGO}">
<link rel="icon" href="./images/{LOGO}">
{FONTS}
<link rel="stylesheet" href="./css/styles.css">"""

ADMIN_HEAD = f"""<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>এডমিন প্যানেল | Heritage Fest Admin</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
<meta name="googlebot" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#242C3F">
<link rel="icon" href="./images/{LOGO}">
{FONTS}
<link rel="stylesheet" href="./css/styles.css">"""

# Admin nav: brand + language toggle. No tab bar. There is deliberately no link
# from the public navigation to here, even though both now live on one domain.
ADMIN_NAV = f"""<nav class="topnav">
  <div class="nav-inner">
    <div class="brand">
      <img src="./images/{LOGO}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;object-position:50% 42%;border:2px solid var(--brass);box-shadow:0 0 0 2px var(--indigo-deep);flex:0 0 auto;">
      <span class="bn">হেরিটেজ ফেস্ট — এডমিন</span><span class="en">Heritage Fest — Admin</span>
    </div>
    <button class="lang-toggle" id="langToggle">EN / বাং</button>
  </div>
</nav>"""

# Vercel serves 404.html from the output directory whenever no static file
# matches. Without it the visitor gets Vercel's raw plain-text "404: NOT_FOUND".
NOT_FOUND = f"""<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>পাতা পাওয়া যায়নি | Page not found</title>
<meta name="robots" content="noindex, follow">
<link rel="icon" href="/images/{LOGO}">
{FONTS}
<link rel="stylesheet" href="/css/styles.css">
</head>
<body class="lang-bn" style="display:flex;flex-direction:column;min-height:100vh;">
<main class="wrap" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 24px;">
  <img src="/images/{LOGO}" alt="" style="width:72px;height:72px;border-radius:50%;object-fit:cover;object-position:50% 42%;border:2px solid var(--brass);box-shadow:0 0 0 3px var(--indigo-deep);">
  <div style="font-family:var(--f-mono);font-size:3.2rem;font-weight:700;color:var(--clay);margin:22px 0 6px;">৪০৪</div>
  <h1 style="margin:0 0 14px;font-size:1.5rem;">
    <span class="bn">এই পাতাটি খুঁজে পাওয়া যায়নি</span><span class="en">This page could not be found</span>
  </h1>
  <p style="margin:0 0 30px;max-width:460px;color:rgba(36,28,21,0.72);">
    <span class="bn">ঠিকানাটি হয়তো ভুল, নয়তো পাতাটি সরিয়ে ফেলা হয়েছে। নিচের বোতামে চাপ দিয়ে হোমে ফিরে যাও।</span>
    <span class="en">The address may be wrong, or the page has moved. Use the button below to go back home.</span>
  </p>
  <a href="/" class="btn btn-primary" style="text-decoration:none;">
    <span class="bn">হোমে ফিরে যাও</span><span class="en">Back to home</span>
  </a>
  <button class="lang-toggle" style="margin-top:26px;" onclick="document.body.classList.toggle('lang-bn');document.body.classList.toggle('lang-en');">EN / বাং</button>
</main>
<footer>
  <div class="wrap">
    <span class="bn">উত্তরবঙ্গ হেরিটেজ ফেস্ট © ২০২৬</span>
    <span class="en">Uttarbanga Heritage Fest © 2026</span>
  </div>
</footer>
</body>
</html>
"""

# Crawlers are told to stay out of the admin route. This is a request, not a
# control — see the security notes in README.
ROBOTS = """User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin.html
"""

VERCEL_JSON = {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "framework": None,
    "buildCommand": 'echo "Static site — nothing to build."',
    "installCommand": 'echo "No dependencies."',
    "outputDirectory": ".",
    # cleanUrls alone maps /admin -> admin.html and 308-redirects /admin.html
    # to /admin. No rewrite is needed, and a catch-all rewrite must NOT be added:
    # this site routes with buttons, not URLs, so it would only mask real 404s.
    "cleanUrls": True,
    "trailingSlash": False,
    "headers": [
        # Applies everywhere. Only carries headers that no other rule overrides,
        # so nothing is ever sent twice with conflicting values.
        {
            "source": "/(.*)",
            "headers": [
                {"key": "X-Content-Type-Options", "value": "nosniff"},
                {"key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()"},
            ],
        },
        # Framing and referrer policy for everything EXCEPT the admin route,
        # which needs stricter values. The negative lookahead keeps the two
        # rules from both matching /admin and emitting duplicate headers.
        {
            "source": "/:path((?!admin).*)",
            "headers": [
                {"key": "X-Frame-Options", "value": "SAMEORIGIN"},
                {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"},
            ],
        },
        # The admin route is hardened even though it shares the domain.
        {
            "source": "/admin",
            "headers": [
                {"key": "X-Robots-Tag", "value": "noindex, nofollow, noarchive, nosnippet, noimageindex"},
                {"key": "Cache-Control", "value": "no-store, max-age=0, must-revalidate"},
                {"key": "X-Frame-Options", "value": "DENY"},
                {"key": "Referrer-Policy", "value": "no-referrer"},
            ],
        },
        {
            "source": "/admin.html",
            "headers": [
                {"key": "X-Robots-Tag", "value": "noindex, nofollow, noarchive, nosnippet, noimageindex"},
                {"key": "Cache-Control", "value": "no-store, max-age=0, must-revalidate"},
                {"key": "X-Frame-Options", "value": "DENY"},
                {"key": "Referrer-Policy", "value": "no-referrer"},
            ],
        },
        # admin.js carries the admin logic; keep it out of search results too.
        {
            "source": "/js/admin.js",
            "headers": [
                {"key": "X-Robots-Tag", "value": "noindex, nofollow"},
                {"key": "Cache-Control", "value": "no-store, max-age=0, must-revalidate"},
            ],
        },
        {
            "source": "/images/:path*",
            "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}],
        },
        {
            "source": "/css/:path*",
            "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}],
        },
        {
            "source": "/js/:path*",
            "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}],
        },
        {
            "source": "/index.html",
            "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}],
        },
    ],
}

VERCEL_IGNORE = """src
tools
supabase
node_modules
README.md
.gitignore
"""


def page(head: str, body: str, scripts: list[str], vendor: str = "") -> str:
    tags = "\n".join(f'<script src="./js/{s}" defer></script>' for s in scripts)
    if vendor:
        # Must execute BEFORE settings.js, which looks for window.supabase.
        tags = vendor + "\n" + tags
    return f"""<!DOCTYPE html>
<html lang="bn">
<head>
{head}
</head>
<body class="lang-bn">

{body}

{tags}
</body>
</html>
"""


def main() -> None:
    vendor = SUPABASE_CDN if supabase_configured() else ""

    # ---------------- shared assets, once ----------------
    for sub in ("css", "js", "images"):
        shutil.rmtree(ROOT / sub, ignore_errors=True)
        (ROOT / sub).mkdir(parents=True, exist_ok=True)

    shutil.copy2(SRC / "shared" / "styles.css", ROOT / "css" / "styles.css")
    for name in ("config.js", "settings.js", "storage.js", "common.js"):
        shutil.copy2(SRC / "shared" / name, ROOT / "js" / name)
    shutil.copy2(SRC / "public" / "app.js", ROOT / "js" / "app.js")
    shutil.copy2(SRC / "admin" / "admin.js", ROOT / "js" / "admin.js")
    for img in (SRC / "shared" / "images").iterdir():
        shutil.copy2(img, ROOT / "images" / img.name)

    # ---------------- index.html (public) ----------------
    body = (SRC / "public" / "body.html").read_text(encoding="utf-8").strip()
    (ROOT / "index.html").write_text(
        page(PUBLIC_HEAD, body, ["config.js", "settings.js", "storage.js", "common.js", "app.js"], vendor),
        encoding="utf-8",
    )

    # ---------------- admin.html ----------------
    section = (SRC / "admin" / "section.html").read_text(encoding="utf-8").strip()
    # Standalone page: there is no tab router here, so the section must start visible.
    section = section.replace('<section id="admin">', '<section id="admin" class="active">', 1)
    footer = (SRC / "shared" / "footer.html").read_text(encoding="utf-8").strip()
    (ROOT / "admin.html").write_text(
        page(ADMIN_HEAD, f"{ADMIN_NAV}\n\n{section}\n\n{footer}",
             ["config.js", "settings.js", "storage.js", "common.js", "admin.js"], vendor),
        encoding="utf-8",
    )

    # ---------------- static extras ----------------
    (ROOT / "404.html").write_text(NOT_FOUND, encoding="utf-8")
    (ROOT / "robots.txt").write_text(ROBOTS, encoding="utf-8")
    (ROOT / "vercel.json").write_text(json.dumps(VERCEL_JSON, indent=2) + "\n", encoding="utf-8")
    (ROOT / ".vercelignore").write_text(VERCEL_IGNORE, encoding="utf-8")

    # ---------------- report ----------------
    deployed = ["index.html", "admin.html", "404.html", "robots.txt", "vercel.json"]
    files = [ROOT / f for f in deployed]
    files += sorted(p for sub in ("css", "js", "images") for p in (ROOT / sub).rglob("*") if p.is_file())
    total = sum(p.stat().st_size for p in files)
    print(f"single deployment at repo root  ({len(files)} files, {total:,} bytes)")
    for p in files:
        print(f"   {p.relative_to(ROOT)}  ({p.stat().st_size:,})")


if __name__ == "__main__":
    main()
