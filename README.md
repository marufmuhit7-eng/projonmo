# উত্তরবঙ্গ হেরিটেজ ফেস্ট | Uttarbanga Heritage Fest

Static bilingual (বাংলা / English) event site — registration, category-wise quiz, leaderboard and an organizer panel. Presented by Projonmo Foundation.

No framework, no build step. Plain HTML + CSS + JavaScript, deployed as static files.

---

## Project structure

```
.
├── index.html                              # the whole page (markup only)
├── css/
│   └── styles.css                          # was an inline <style> block
├── js/
│   ├── storage.js                          # storage adapter — MUST load before app.js
│   └── app.js                              # was an inline <script> block
├── images/
│   └── heritage-fest-logo-708214d0.jpg     # was a base64 data-URI, embedded twice
├── vercel.json                             # routing, clean URLs, cache + security headers
├── package.json                            # metadata + dev/test scripts (no dependencies)
├── .vercelignore                           # keeps tools/ out of the deployment
└── tools/                                  # dev-only, not deployed
    ├── split.py                            # the one-shot inline → files extractor
    ├── storage.test.js                     # storage.js contract tests
    └── page.test.js                        # full page-boot test (jsdom)
```

`index.html` went from **328,912 bytes to 31,624 bytes** (−90%) because the logo — previously
inlined twice as base64 — is now a single cacheable file.

---

## Local development

```bash
npm run dev
```

Serves the site at `http://localhost:8000`. No `npm install` needed for this.

To run the tests (needs jsdom once, and the dev server running in another terminal):

```bash
npm install --no-save jsdom
npm test
```

Expected output: `9 passed, 0 failed` then `13 passed, 0 failed`.

---

## Deploying to Vercel

### Option A — GitHub (recommended, auto-deploys on every push)

1. Push this repo to GitHub (already at `marufmuhit7-eng/projonmo`).
2. Go to <https://vercel.com/new> and sign in with GitHub.
3. Click **Import** next to the `projonmo` repository.
4. On the configure screen:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - **Build Command:** leave blank (or let it use the no-op `build` script)
   - **Output Directory:** `.`
   - Everything else: default. `vercel.json` already sets these, so you normally
     do not have to touch anything.
5. Click **Deploy**.

Every later `git push` to `main` triggers a production deploy. Pushes to other
branches get their own preview URL.

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel login
```

Preview deploy (safe, gives a throwaway URL):

```bash
vercel
```

Production deploy:

```bash
vercel --prod
```

Verify the result:

```bash
curl -sI https://YOUR-PROJECT.vercel.app/ | head -20
```

Expected: `HTTP/2 200`, `content-type: text/html`, and the security headers from
`vercel.json` (`x-content-type-options: nosniff`, etc.).

---

## What `vercel.json` does

| Setting | Effect |
| --- | --- |
| `framework: null`, `outputDirectory: "."` | No framework detection; serve the repo root as-is. |
| `cleanUrls: true` | `/about.html` → served at `/about`; the `.html` URL 308-redirects to the clean one. Only `index.html` exists today, so this matters when you add more pages. |
| `trailingSlash: false` | `/page/` redirects to `/page`, so Google does not index duplicates. |
| `headers` → `/images/:path*` | Cached one year, `immutable` — safe because the filename contains a content hash (`-708214d0`). Change the image, the hash changes, the URL changes. |
| `headers` → `/css/:path*`, `/js/:path*` | `max-age=0, must-revalidate`. These filenames are **not** hashed, so long caching would strand users on stale CSS/JS after a deploy. |
| `headers` → `/(.*)` | `nosniff`, `SAMEORIGIN`, a referrer policy, and a permissions policy denying camera/mic/geolocation. |

Note: `routes` is deliberately **not** used. Vercel rejects a config that
contains `routes` together with `cleanUrls`, `headers`, `redirects`, `rewrites`
or `trailingSlash`.

---

## Replacing the storage layer

`js/app.js` was written against a `window.storage` object supplied by the
sandbox it was authored in. That object does not exist in a real browser, so
`js/storage.js` reimplements the same three methods on top of `localStorage`:

```js
await storage.set(key, valueString, shared)  // -> true
await storage.get(key, shared)               // -> { value: string }, throws if absent
await storage.list(prefix, shared)           // -> { keys: string[] }
```

**Important limitation:** `localStorage` is per-browser and per-device. A student
who registers on their phone will not appear in the leaderboard or the admin
panel on your laptop. For a real multi-device event you need a shared backend.

To swap it in, rewrite only those three methods in `js/storage.js` — `app.js`
needs no changes. Options, cheapest first:

1. **Vercel KV / Upstash Redis** + three functions under `api/` — stays on Vercel.
2. **Supabase** — a free Postgres table plus its JS client.
3. **Google Apps Script** bound to a Sheet — good if the organizers want to read
   registrations in a spreadsheet.

---

## Known issues, not yet fixed

- **`ADMIN_PASSWORD` is hardcoded** in `js/app.js` (line 249). On a static site
  anyone can open DevTools and read it, so the admin panel keeps out casual
  visitors only — it is not authentication. The page itself says so. Real
  protection needs the backend from the section above, or Vercel's
  [password protection](https://vercel.com/docs/deployment-protection) on a
  separate deployment.
- **Data does not survive a browser-data clear**, for the same `localStorage`
  reason described above.
