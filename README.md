# উত্তরবঙ্গ হেরিটেজ ফেস্ট | Uttarbanga Heritage Fest

One static Vercel deployment. The public site is at `/`, the organiser panel at
`/admin`.

| | URL | Indexed |
| --- | --- | --- |
| Public website | `/` | yes |
| Admin panel | `/admin` | **no** — `noindex` header + `Disallow: /admin` |

The admin panel is not linked from anywhere on the public site, but it lives on
the same domain now. Read the security note below before treating that as
private.

---

## ⚠️ Read this before deploying

### 1. A static admin panel cannot be secured by frontend code. At all.

`js/admin.js` checks a password held in a JavaScript constant, and that file is
downloadable from your public domain at `/js/admin.js`. Anyone can read it. The
password also guards nothing real — the data lives in the visitor's own browser,
so anyone can skip the login and type:

```js
await storage.list('participant:')   // every registration
```

Frontend code runs on the attacker's machine. A secret shipped to the browser is
not a secret. The fix is architectural — see
[Recommended architecture](#recommended-architecture).

### 2. Merging cost you Vercel's Deployment Protection

While the admin panel was its own project you could put Vercel Deployment
Protection in front of it and leave the public site open. On one project that is
no longer possible: protection applies to the whole deployment, so switching it
on would lock out your visitors too.

What you still have on `/admin`: it is unlinked, `noindex`ed by both header and
`robots.txt`, never cached, and cannot be framed. That is obscurity plus hygiene,
not access control. If you need a real gate, use the Supabase Auth login
described below, or split the panel back out —
`git checkout f3e2ae4 -- public-site admin-panel` restores the two-project layout.

### 3. localStorage is shared between `/` and `/admin` now — but still per device

Same origin, so a registration made on this browser is visible in the admin
table on this browser. Another visitor's phone still shows nothing. For a real
multi-device event you need the shared backend below.

---

## Recommended architecture

```
   Public site (Vercel)            Admin panel (Vercel)
   heritagefest.example.com        admin.heritagefest.example.com
            |                                |
            |  POST /api/register            |  GET /api/registrations
            |  GET  /api/leaderboard         |  PUT /api/questions
            v                                v
        +-----------------------------------------+
        |   API — Vercel Functions in api/         |
        |   auth: session cookie or JWT, checked   |
        |   SERVER-SIDE on every admin route       |
        +-----------------------------------------+
                          |
                    +-----------+
                    |  Database |   Vercel KV / Upstash / Supabase
                    +-----------+
```

Three rules that make it actually secure:

1. **The admin password is verified on the server**, never in the browser. Store
   a hash in an environment variable (`ADMIN_PASSWORD_HASH`), never in a file.
2. **Every admin API route re-checks the session** on each request. Hiding the
   UI is cosmetic; the endpoint is the thing being protected.
3. **The browser never receives data it isn't allowed to see.** The public
   leaderboard endpoint returns names and scores; it must not return phone
   numbers or emails just because the UI hides them.

Cheapest path from here, in order:

1. **Vercel KV / Upstash Redis** + a few functions under `api/` — same platform,
   free tier, and `js/storage.js` becomes `fetch()` calls with no change to
   `app.js` or `admin.js`.
2. **Supabase** — Postgres, auth and a JS client on the free tier.
3. **Google Apps Script bound to a Sheet** — good if organizers want the
   registrations in a spreadsheet. Weakest auth story of the three.

---

## Exam timer control (admin-managed)

The countdown is no longer hardcoded. The organiser controls it from
**Admin → টাইমার নিয়ন্ত্রণ**:

| Control | Bengali label | Effect |
| --- | --- | --- |
| ON/OFF toggle | কাউন্টডাউন টাইমার দেখাও (পরীক্ষা লক করো) | **Off = exam LIVE now.** On = locked until the date below |
| Date & time picker | পরীক্ষা শুরুর তারিখ ও সময় | The moment the exam opens (Bangladesh time) |
| Off behaviour | টাইমার বন্ধ থাকলে কী হবে? | `live` = exam open now · `message` = show a notice |
| Message (bn / en) | বার্তা | Shown when the timer is off and behaviour is `message` |
| Status badge | পরীক্ষা চালু · LIVE / লকড · COUNTDOWN / লকড · CLOSED | What a candidate sees right now, in one line |

**Shipped default: the exam is LIVE.** A fresh visitor sees the rules and the
"পরীক্ষা শুরু করো" button, not a countdown. Lock it by switching the countdown
on in the admin panel.

Behaviour on the exam page:

| Setting | Countdown box | Exam form |
| --- | --- | --- |
| ON, date in the future | visible, ticking to the date | hidden |
| ON, date passed | hidden | **open** |
| OFF + `live` | hidden | **open**, regardless of the date |
| OFF + `message` | hidden | hidden, organiser's message shown instead |

The দিন / ঘণ্টা / মিনিট / সেকেন্ড boxes, their colours and their element ids are
untouched — only what drives them changed.

### localStorage or Supabase? — Supabase, and it is not close

Your own reasoning was right, and the split into two deployments makes it
decisive. localStorage is scoped to one **origin**, so a setting saved at
`admin.yourdomain.com` is not merely "admin-only", it is *unreachable* from
`yourdomain.com`. The public countdown would never change no matter what the
organiser clicks. For a feature whose entire purpose is "one person changes it,
everyone sees it", localStorage cannot work at all.

Supabase over Firebase, for this project:

- Row Level Security expresses exactly the rule you need — *everyone reads, one
  signed-in organiser writes* — in two SQL policies, enforced by the server.
- Supabase Auth replaces the fake `ADMIN_PASSWORD` constant with a real account,
  so the admin gate stops being decorative.
- Postgres means the registrations table can move to the same database later
  with no second vendor.
- It works from static HTML over a CDN script tag; no build step, no bundler.

Firebase Realtime Database would also work; it is a reasonable second choice if
your team already knows it. Vercel KV is ruled out — reaching it needs a server
function, which this project deliberately does not have.

**The code supports both today.** `src/shared/settings.js` has two backends and
picks one at load time. With no configuration it uses localStorage and the admin
panel prints a red warning saying the setting is not shared. Fill in
`src/shared/config.js` and it switches to Supabase, with realtime push, and the
warning turns green. Nothing else in the codebase changes.

### Turning on Supabase

1. Create a free project at <https://supabase.com>.
2. SQL Editor → paste [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   It creates the `settings` table, seeds row 1, enables RLS with the two
   policies, and adds the table to the realtime publication.
3. Authentication → Users → **Add user**: one organiser email + strong password.
4. Authentication → Providers → **turn email signups off**. Skip this and the
   public can register themselves an account that is allowed to write.
5. Project Settings → API → copy the Project URL and the anon/publishable key
   into `src/shared/config.js`.
6. `npm run build && npm test`, then commit and push. Vercel redeploys both
   projects.

Verify RLS actually holds before the event — the second command **must** fail:

```bash
curl -s "$SUPABASE_URL/rest/v1/settings?select=*" -H "apikey: $ANON_KEY"

curl -s -X PATCH "$SUPABASE_URL/rest/v1/settings?id=eq.1" \
     -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
     -d '{"timer_enabled": false}'
```

Putting the anon key in public JavaScript is correct and expected: it only lets
a browser *ask*, and RLS decides the answer. Never put the `service_role` key
there — that one bypasses RLS entirely.

### Real-time updates

On Supabase the exam page subscribes to `postgres_changes` on the `settings`
table, so flipping the toggle updates visitors **already sitting on the page**,
no reload. A 60-second poll (`POLL_INTERVAL_MS`) backs it up if the websocket
drops. On the localStorage fallback, only other tabs of the same origin get the
`storage` event.

### Untested

The Supabase code path could not be exercised here — there is no live project to
point it at. Verified instead: API shapes against the current supabase-js v2
docs, and every branch of the settings layer, the date/timezone conversion and
all three exam-gate states against the localStorage backend (102 assertions).
Run step 6's `curl` checks after configuring, before the event.

---

## Folder structure

```
.
├── src/                                  ← EDIT HERE. Not deployed.
│   ├── shared/
│   │   ├── config.js                     ← Supabase URL + anon key go HERE
│   │   ├── settings.js                   exam-timer settings, swappable backend
│   │   ├── styles.css
│   │   ├── storage.js
│   │   ├── common.js                     QUESTIONS, CATEGORY_LABELS, getCategoryKey
│   │   ├── footer.html
│   │   └── images/
│   ├── public/{body.html, app.js}
│   └── admin/{section.html, admin.js}
│
├── index.html                            ← GENERATED  served at /
├── admin.html                            ← GENERATED  served at /admin
├── 404.html                              ← GENERATED
├── robots.txt                            ← GENERATED  Disallow: /admin
├── vercel.json                           ← GENERATED  cleanUrls + headers
├── .vercelignore                         ← GENERATED  hides src/ tools/ supabase/
├── css/styles.css                        ← GENERATED
├── js/                                   ← GENERATED
│   ├── config.js  settings.js  storage.js  common.js
│   ├── app.js                            public page
│   └── admin.js                          admin page
├── images/
│
├── supabase/schema.sql                   table + RLS policies + realtime
├── tools/
│   ├── build.py                          src/ → the root deployment
│   ├── serve.py                          dev server that mirrors vercel.json
│   ├── carve.py                          one-time migration, kept for provenance
│   ├── storage.test.js                   9 assertions
│   ├── settings.test.js                  32 assertions
│   └── apps.test.js                      61 assertions
└── package.json
```

Everything is emitted at the repo root, so **Vercel needs no Root Directory
setting**. Never edit `index.html`, `admin.html`, `css/`, `js/` or `vercel.json`
by hand — edit `src/` and run `npm run build`, or your change is overwritten.

## File moves in this merge

| Was (two deployments) | Now (one deployment) |
| --- | --- |
| `public-site/index.html` | `index.html` |
| `admin-panel/index.html` | `admin.html`, served at `/admin` by `cleanUrls` |
| `public-site/css/`, `admin-panel/css/` (two copies) | `css/` (one copy) |
| `public-site/js/`, `admin-panel/js/` (two copies) | `js/` (one copy, plus `admin.js`) |
| `public-site/images/`, `admin-panel/images/` | `images/` |
| two `vercel.json`, two `package.json`, two `robots.txt` | one of each at the root |
| root `vercel.json` pointing at `public-site` | root `vercel.json` with `outputDirectory: "."` |

`admin.html` sits at the same depth as `index.html`, so both use identical
relative paths (`./css/…`, `./js/…`, `./images/…`). No asset path needed
rewriting. Recover the old layout with
`git checkout f3e2ae4 -- public-site admin-panel`.

## `vercel.json`

`cleanUrls: true` is what makes `/admin` work: Vercel serves `admin.html` at
`/admin`, and 308-redirects `/admin.html` to `/admin`. **No `rewrites` entry is
needed** — `{"source": "/admin", "destination": "/admin.html"}` is a no-op next
to `cleanUrls`, so it is left out rather than shipped as decoration.

Per-route headers:

| Route | Headers | Why |
| --- | --- | --- |
| everything | `nosniff`, `Permissions-Policy` | baseline |
| everything except `/admin*` | `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin` | the negative-lookahead source `/:path((?!admin).*)` keeps this from also matching `/admin`, which would emit the header twice with conflicting values |
| `/admin`, `/admin.html` | `X-Robots-Tag: noindex…`, `Cache-Control: no-store`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` | keep it out of search, out of caches, out of iframes |
| `/js/admin.js` | `X-Robots-Tag: noindex`, `no-store` | the admin logic should not be indexed either |
| `/images/*` | 1-year `immutable` | filename carries a content hash |
| `/css/*`, `/js/*` | `max-age=0, must-revalidate` | filenames are not hashed |

`routes` is unused — Vercel rejects it alongside `cleanUrls`/`headers`. A
catch-all rewrite is also deliberately absent: this site routes with buttons,
not URLs, so `{"source":"/(.*)","destination":"/"}` would only make every
mistyped URL silently render the homepage and hide real 404s.

## Deployment

One project, no Root Directory to set.

1. <https://vercel.com/new> → Import `marufmuhit7-eng/projonmo`
2. Framework Preset: **Other**. Leave everything else alone — `vercel.json`
   sets `buildCommand`, `installCommand` and `outputDirectory` itself.
3. **Deploy**
4. Settings → Domains → add your domain

CLI alternative:

```bash
npm i -g vercel
vercel login
vercel --prod
```

### Verify after deploying

```bash
curl -sI https://YOUR-DOMAIN/        | grep -Ei 'HTTP|x-frame|x-content'
curl -sI https://YOUR-DOMAIN/admin   | grep -Ei 'HTTP|x-robots-tag|cache-control|x-frame'
curl -sI https://YOUR-DOMAIN/admin.html | grep -Ei 'HTTP|location'
curl -s  https://YOUR-DOMAIN/robots.txt
```

Expected:

| Request | Expected |
| --- | --- |
| `/` | `200`, `x-frame-options: SAMEORIGIN` |
| `/admin` | `200`, `x-robots-tag: noindex, …`, `cache-control: no-store, …`, `x-frame-options: DENY` |
| `/admin.html` | `308` → `/admin` |
| `/robots.txt` | contains `Disallow: /admin` |
| anything else | `404` with the Bengali ৪০৪ page |

`npm run dev` reproduces all of this locally — `tools/serve.py` implements the
same `cleanUrls`, `trailingSlash` and header rules, so a route that works on
`localhost:8000` works on Vercel.

### Troubleshooting

**`404: NOT_FOUND` on `/admin`.** Confirm the deployment actually contains
`admin.html` (Deployments → the build → Source tab) and that `vercel.json` has
`"cleanUrls": true`. If you edited `src/admin/` but did not run `npm run build`,
the change never reached `admin.html`.

**`No Output Directory named "public" found`.** Something overrode
`outputDirectory`. This repo sets `"."` in `vercel.json`; check Settings → Build
and Deployment for a leftover dashboard override, and clear **Root Directory**
back to empty — with the merged layout it must be blank.

**Changes do not appear after a push.** `index.html`, `admin.html`, `css/` and
`js/` are generated. Run `npm run build`, commit the result, then push.

**A wrong URL shows the homepage instead of a 404.** Someone added a catch-all
rewrite. Remove it; see the `vercel.json` section for why it does not belong here.

## Security

With one deployment, Vercel Deployment Protection is all-or-nothing, so the
practical options are:

1. **Supabase Auth (recommended).** `supabase/schema.sql` already restricts
   writes to a signed-in organiser through Row Level Security. Add the login and
   the admin panel stops relying on a constant in JavaScript. This is the only
   option here that is real access control.
2. **Split the panel back out** and put Deployment Protection on it:
   `git checkout f3e2ae4 -- public-site admin-panel`. Password Protection needs
   Enterprise or Pro + the $150/month add-on; Vercel Authentication is on all
   plans but its default scope leaves a production custom domain public
   ([Vercel KB](https://vercel.com/kb/guide/how-do-i-add-password-protection-to-my-vercel-deployment)).
3. **Accept obscurity.** What ships today: unlinked, `noindex` by header and
   `robots.txt`, `no-store`, `DENY` framing. Fine for a small event where the
   registration data is not sensitive; not fine for phone numbers and emails,
   which this panel displays.

Checklist:

- [ ] `ADMIN_PASSWORD` changed from the committed default `UHF2026Admin`
- [ ] `/admin` kept out of sitemaps, social posts and the public nav
- [ ] `x-robots-tag: noindex` confirmed with `curl -sI`
- [ ] Understood that `/js/admin.js` is publicly downloadable and contains that password
- [ ] Real fix scheduled: Supabase Auth + server-side checks

## Development

```bash
npm run build     # regenerate index.html, admin.html and assets from src/
npm run dev       # site on :8000, /admin included (mirrors vercel.json)
npm test          # 9 + 32 + 61 assertions (needs the dev server + jsdom)
```

```bash
npm install --no-save jsdom     # one-time, for the tests
```

## The storage adapter

`app.js` and `admin.js` were written against a `window.storage` object supplied
by the sandbox the page was authored in. It does not exist in a browser, so
`src/shared/storage.js` reimplements the contract on `localStorage`:

```js
await storage.set(key, valueString, shared)  // -> true
await storage.get(key, shared)               // -> { value: string }, throws if absent
await storage.list(prefix, shared)           // -> { keys: string[] }
```

When you move to a backend, rewrite **only these three methods** to call your
API. `app.js` and `admin.js` need no changes.
