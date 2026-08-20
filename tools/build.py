#!/usr/bin/env python3
"""
build.py — generate the two deployable folders from src/.

  src/  ->  public-site/     (deployment A, e.g. heritagefest.example.com)
        ->  admin-panel/     (deployment B, e.g. admin.heritagefest.example.com)

Shared assets (styles.css, storage.js, common.js, images/) are COPIED into both
folders rather than referenced across them, because a Vercel project's Root
Directory cannot read files above itself. src/ stays the single place you edit;
run this script after every change so the two folders never drift.

Run:  python3 tools/build.py     (or: npm run build)
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Tiro+Bangla:ital@0;1'
    "&family=Hind+Siliguri:wght@400;500;600;700"
    "&family=Spectral:ital,wght@0,400;0,600;0,700;1,400"
    "&family=Inter:wght@400;500;600;700"
    '&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">'
)

LOGO = "heritage-fest-logo-708214d0.jpg"

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

# Admin nav: brand + language toggle only. No tab bar, and deliberately no link
# back to the public site (and the public site has no link here either).
ADMIN_NAV = f"""<nav class="topnav">
  <div class="nav-inner">
    <div class="brand">
      <img src="./images/{LOGO}" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;object-position:50% 42%;border:2px solid var(--brass);box-shadow:0 0 0 2px var(--indigo-deep);flex:0 0 auto;">
      <span class="bn">হেরিটেজ ফেস্ট — এডমিন</span><span class="en">Heritage Fest — Admin</span>
    </div>
    <button class="lang-toggle" id="langToggle">EN / বাং</button>
  </div>
</nav>"""


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


def copy_shared(dest: pathlib.Path, app_script: str, app_src: pathlib.Path) -> None:
    (dest / "css").mkdir(parents=True, exist_ok=True)
    (dest / "js").mkdir(parents=True, exist_ok=True)
    (dest / "images").mkdir(parents=True, exist_ok=True)

    shutil.copy2(SRC / "shared" / "styles.css", dest / "css" / "styles.css")
    shutil.copy2(SRC / "shared" / "config.js", dest / "js" / "config.js")
    shutil.copy2(SRC / "shared" / "settings.js", dest / "js" / "settings.js")
    shutil.copy2(SRC / "shared" / "storage.js", dest / "js" / "storage.js")
    shutil.copy2(SRC / "shared" / "common.js", dest / "js" / "common.js")
    shutil.copy2(app_src, dest / "js" / app_script)
    for img in (SRC / "shared" / "images").iterdir():
        shutil.copy2(img, dest / "images" / img.name)


def main() -> None:
    # ---------------- A. public site ----------------
    pub = ROOT / "public-site"
    for sub in ("css", "js", "images"):
        shutil.rmtree(pub / sub, ignore_errors=True)
    copy_shared(pub, "app.js", SRC / "public" / "app.js")

    body = (SRC / "public" / "body.html").read_text(encoding="utf-8").strip()
    (pub / "index.html").write_text(
        page(PUBLIC_HEAD, body,
             ["config.js", "settings.js", "storage.js", "common.js", "app.js"],
             vendor=SUPABASE_CDN if supabase_configured() else ""),
        encoding="utf-8",
    )
    (pub / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")

    # ---------------- B. admin panel ----------------
    adm = ROOT / "admin-panel"
    for sub in ("css", "js", "images"):
        shutil.rmtree(adm / sub, ignore_errors=True)
    copy_shared(adm, "admin.js", SRC / "admin" / "admin.js")

    section = (SRC / "admin" / "section.html").read_text(encoding="utf-8").strip()
    # Standalone page: there is no tab router here, so the section must start visible.
    section = section.replace('<section id="admin">', '<section id="admin" class="active">', 1)
    footer = (SRC / "shared" / "footer.html").read_text(encoding="utf-8").strip()
    (adm / "index.html").write_text(
        page(ADMIN_HEAD, f"{ADMIN_NAV}\n\n{section}\n\n{footer}",
             ["config.js", "settings.js", "storage.js", "common.js", "admin.js"],
             vendor=SUPABASE_CDN if supabase_configured() else ""),
        encoding="utf-8",
    )
    (adm / "robots.txt").write_text(
        "# Admin panel — must never be indexed.\nUser-agent: *\nDisallow: /\n", encoding="utf-8"
    )

    # ---------------- root fallback ----------------
    # If someone imports this repo into Vercel WITHOUT setting the Root
    # Directory, Vercel builds from the repo root. With a package.json present
    # and no vercel.json there, it then hunts for an output folder named
    # "public", does not find one, and fails the deploy. This file removes that
    # trap: a root-level import now serves the public site.
    #
    # Generated from public-site/vercel.json so the headers cannot drift.
    root_cfg = json.loads((pub / "vercel.json").read_text(encoding="utf-8"))
    root_cfg["buildCommand"] = 'echo "Static site — public-site/ is already built and committed."'
    root_cfg["installCommand"] = 'echo "No dependencies."'
    root_cfg["outputDirectory"] = "public-site"
    (ROOT / "vercel.json").write_text(json.dumps(root_cfg, indent=2) + "\n", encoding="utf-8")
    print('vercel.json (root fallback -> serves public-site/)\n')

    # ---------------- report ----------------
    for name, d in (("public-site", pub), ("admin-panel", adm)):
        files = sorted(p for p in d.rglob("*") if p.is_file())
        total = sum(p.stat().st_size for p in files)
        print(f"{name}/  ({len(files)} files, {total:,} bytes)")
        for p in files:
            print(f"   {p.relative_to(d)}  ({p.stat().st_size:,})")
        print()


if __name__ == "__main__":
    main()
