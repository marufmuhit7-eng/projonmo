# উত্তরবঙ্গ হেরিটেজ ফেস্ট | Uttarbanga Heritage Fest

Two independent static deployments built from one source tree.

| | Folder | Deploys to | Indexed |
| --- | --- | --- | --- |
| **A. Public website** | `public-site/` | e.g. `heritagefest.example.com` | yes |
| **B. Admin panel** | `admin-panel/` | e.g. `admin.heritagefest.example.com` | **no** — `noindex` + `Disallow: /` |

The admin panel is **not linked from the public site**, and the public bundle
ships no admin markup, no admin JavaScript, and no admin password.

---

## ⚠️ Read this before deploying

### 1. A static admin panel cannot be secured by frontend code. At all.

`js/admin.js` checks a password held in a JavaScript constant. Anyone can press
F12, open `js/admin.js`, and read it. Worse, the password guards nothing real —
the data lives in the visitor's own browser, so a curious visitor can skip the
login entirely and type this in the console:

```js
await storage.list('participant:')   // every registration
```

Frontend code runs on the attacker's machine. A secret shipped to the browser is
not a secret. This is a property of the web, not a flaw in this code. The fix is
architectural, not a better password — see [Recommended architecture](#recommended-architecture).

Until then, the real gate is **Vercel Deployment Protection**, which runs at
Vercel's edge before any file is served. See [Security](#5-security).

### 2. Splitting into two deployments breaks the admin panel's data. Today.

The app stores data in `localStorage`, which the browser scopes to a single
**origin** (scheme + host + port). Two deployments are two origins, so:

> A registration made on `heritagefest.example.com` is **invisible** to
> `admin.heritagefest.example.com`. The admin panel will show an empty table.

`tools/apps.test.js` proves it rather than asserting it — section C saves a
record on the public origin and lists from the admin origin:

```
public origin keys : ["participant:UHF-CROSS1"]
admin  origin keys : []
```

This was already true before the split (data never left the one device that
typed it in); splitting just makes it unmissable. **The admin panel becomes
useful only once a shared backend exists.**

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
| ON/OFF toggle | কাউন্টডাউন টাইমার দেখাও | Off hides the countdown box completely |
| Date & time picker | পরীক্ষা শুরুর তারিখ ও সময় | The moment the exam opens (Bangladesh time) |
| Off behaviour | টাইমার বন্ধ থাকলে কী হবে? | `live` = exam open now · `message` = show a notice |
| Message (bn / en) | বার্তা | Shown when the timer is off and behaviour is `message` |
| Status badge | টাইমার চালু / টাইমার বন্ধ | Current state at a glance |

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
all three exam-gate states against the localStorage backend (101 assertions).
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
│   │   ├── storage.js                    storage adapter (see below)
│   │   ├── common.js                     QUESTIONS, CATEGORY_LABELS, getCategoryKey, lang toggle
│   │   ├── footer.html
│   │   └── images/heritage-fest-logo-708214d0.jpg
│   ├── public/
│   │   ├── body.html                     nav (no admin tab) + 6 sections + footer
│   │   └── app.js                        registration, exam, leaderboard
│   └── admin/
│       ├── section.html                  the admin UI
│       └── admin.js                      ADMIN_PASSWORD, login, question editor, registrations table
│
├── public-site/                          ← GENERATED. Vercel project A, Root Directory = public-site
│   ├── index.html
│   ├── css/styles.css
│   ├── js/{config.js, settings.js, storage.js, common.js, app.js}
│   ├── images/heritage-fest-logo-708214d0.jpg
│   ├── 404.html                          branded, Bengali (generated)
│   ├── robots.txt                        Allow: /
│   ├── vercel.json
│   └── package.json
│
├── admin-panel/                          ← GENERATED. Vercel project B, Root Directory = admin-panel
│   ├── index.html
│   ├── css/styles.css
│   ├── js/{config.js, settings.js, storage.js, common.js, admin.js}
│   ├── images/heritage-fest-logo-708214d0.jpg
│   ├── 404.html                          bare, reveals nothing (generated)
│   ├── robots.txt                        Disallow: /
│   ├── vercel.json                       + X-Robots-Tag, no-store, DENY framing
│   └── package.json
│
├── vercel.json                           root fallback -> serves public-site/ (generated)
├── supabase/
│   └── schema.sql                        table + RLS policies + realtime
├── tools/
│   ├── build.py                          src/ → public-site/ + admin-panel/
│   ├── carve.py                          one-time migration, kept for provenance
│   ├── storage.test.js                   storage contract (9 assertions)
│   ├── settings.test.js                  timer settings + date/TZ edges (27 assertions)
│   └── apps.test.js                      both apps, origin proof, timer UI, vercel config, 404s (70 assertions)
└── package.json
```

Shared files are **copied** into both folders, not linked, because a Vercel
project's Root Directory cannot read files above itself. Never edit
`public-site/` or `admin-panel/` by hand — edit `src/` and run `npm run build`,
or your change will be overwritten.

## 2. File moves that were made

| Was | Now |
| --- | --- |
| `index.html` nav, `data-tab="admin"` button (line 34) | deleted from the public build |
| `index.html` `<section id="admin">` (lines 357–426) | `src/admin/section.html` → `admin-panel/index.html`, with `class="active"` added so it renders without a tab router |
| `js/app.js` lines 501–606 (admin block) | `src/admin/admin.js` |
| `js/app.js` line 249 `ADMIN_PASSWORD` | `src/admin/admin.js` — **removed from the public bundle** |
| `js/app.js` lines 60–247 `QUESTIONS`, 303–307 `CATEGORY_LABELS`, 309–315 `getCategoryKey`, 11–14 lang toggle | `src/shared/common.js` (both apps need these) |
| `js/app.js` everything else | `src/public/app.js` |
| `css/styles.css`, `js/storage.js`, `images/` | `src/shared/` → copied into both builds |
| root `index.html`, `css/`, `js/`, `images/`, `vercel.json` | deleted (superseded; recover with `git checkout 6a203b4 -- <path>`) |

Line accounting is asserted in `tools/carve.py`: all 607 lines of the old
`js/app.js` land in exactly one of the three outputs (common 204, public 296,
admin 107).

## 3. The two `vercel.json` files

Both set `framework: null`, `outputDirectory: "."`, `cleanUrls: true`,
`trailingSlash: false`, and `nosniff` / `Referrer-Policy` / `Permissions-Policy`.
Images get a one-year `immutable` cache because their filename carries a content
hash; CSS and JS get `max-age=0, must-revalidate` because theirs do not, and a
long cache would strand users on stale code after a deploy.

`admin-panel/vercel.json` adds, on every response:

| Header | Why |
| --- | --- |
| `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` | Keeps the panel out of search results even if someone links to it. `robots.txt` alone does not prevent indexing of a linked URL; this header does. |
| `Cache-Control: no-store, max-age=0, must-revalidate` | Registration data must never sit in a CDN or browser cache. |
| `X-Frame-Options: DENY` | No clickjacking the admin UI. |
| `Referrer-Policy: no-referrer` | The admin URL never leaks in a `Referer` header. |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy: same-origin` | Isolates the panel from other browsing contexts. |

`routes` is deliberately unused — Vercel rejects a config containing `routes`
alongside `cleanUrls`, `headers`, `redirects`, `rewrites` or `trailingSlash`.

## 4. Deployment steps

Both projects come from the **same GitHub repo**, differing only in Root Directory.

### Project A — public site

1. <https://vercel.com/new> → Import `marufmuhit7-eng/projonmo`.
2. **Project Name:** `heritage-fest` · **Framework Preset:** `Other`
3. **Root Directory:** `public-site` ← click Edit and select the folder.
4. Build Command, Output Directory, Install Command: leave default;
   `public-site/vercel.json` already sets them.
5. **Deploy**, then add your domain under Settings → Domains.

### Project B — admin panel

1. <https://vercel.com/new> → Import **the same repo again**.
2. **Project Name:** `heritage-fest-admin` · **Framework Preset:** `Other`
3. **Root Directory:** `admin-panel`
4. **Deploy.**
5. **Before sharing the URL:** Settings → Deployment Protection → enable
   protection (see below).
6. Optional: Settings → Domains → `admin.yourdomain.com`. Read the plan caveat
   in Security first — on Hobby, attaching a custom domain can *remove* the
   protection.

### CLI alternative

```bash
npm i -g vercel
vercel login

cd public-site && vercel --prod
cd ../admin-panel && vercel --prod
```

Each folder links to its own Vercel project the first time you run it.

### Verify after deploying

```bash
curl -sI https://YOUR-PUBLIC-DOMAIN/        | grep -Ei 'HTTP|x-content-type|cache-control'
curl -sI https://YOUR-ADMIN-DOMAIN/         | grep -Ei 'HTTP|x-robots-tag|cache-control'
curl -s  https://YOUR-ADMIN-DOMAIN/robots.txt
```

Expected: public → `HTTP/2 200` with `nosniff`; admin → `x-robots-tag: noindex, …`,
`cache-control: no-store, …`, and `Disallow: /`. If Deployment Protection is on,
the admin URL returns `HTTP/2 401` to an unauthenticated `curl` — that is the
correct result.

### Troubleshooting

**`No Output Directory named "public" found after the Build completed.`**

The project's **Root Directory is not set**, so Vercel is building from the repo
root instead of `public-site/` or `admin-panel/`. Vercel's rule: when the root
holds a `package.json`, has no `api/` folder and no `vercel.json`, it expects the
build script to emit a folder called `public`
([error list](https://vercel.com/docs/errors/error-list)).

Fix it in the dashboard:

1. Project → **Settings** → **Build and Deployment**
2. Scroll to **Root Directory** → **Edit**
3. Enter `public-site` (or `admin-panel` for the admin project) → **Save**
4. **Deployments** tab → latest → **⋯** → **Redeploy**

A root `vercel.json` now also ships as a safety net: if the Root Directory is
left empty, the deploy serves the public site instead of failing. It is
generated by `tools/build.py` from `public-site/vercel.json`, so the two never
drift. Setting the Root Directory is still the correct thing to do — without it
the admin project would deploy the public site.

**`404: NOT_FOUND` when opening `/admin` on the public domain**

This is correct, not a bug. `admin-panel/` is a **separate deployment**; the
public site contains no `admin.html` and no `/admin` route, which is exactly the
separation this project was restructured for. `/admin.html` returns a 308 first
(that is `cleanUrls` redirecting to `/admin`), then 404.

The fix is to deploy the admin panel as its own Vercel project, not to add a
rewrite:

1. <https://vercel.com/new> → import **the same repo again**
2. Project Name: `heritage-fest-admin`, Framework Preset: `Other`
3. **Root Directory: `admin-panel`** ← this is the step that is usually missed
4. Deploy → Settings → Deployment Protection → enable it **before sharing the URL**

You then reach the panel at `heritage-fest-admin.vercel.app`, and `/admin` on
the public domain keeps 404-ing on purpose.

> Do **not** add `{"rewrites": [{"source": "/(.*)", "destination": "/"}]}`. That
> advice is everywhere online, but it is for client-side routers. On this site
> it would make every mistyped URL silently render the homepage — bad for search
> engines, and it hides real 404s. This project has no client-side router; its
> tabs are buttons, not URLs.

If you genuinely want the admin panel back on the public domain, say so and it
is a one-line change — but it undoes the separation, re-exposes the panel to
anyone who guesses the URL, and Deployment Protection can then no longer cover
the admin panel separately from the public site.

**Custom 404 page.** Both deployments ship a `404.html`, which Vercel serves
automatically when no static file matches. The public one is branded in Bengali
with a link home; the admin one is a bare `404` that reveals nothing about what
the deployment is.

**Both projects deployed the same site.** They share a repo, so they must differ
by Root Directory. Check step 3 above on each project separately.

**Changes do not appear after a push.** Confirm the deploy used the commit you
expect (Deployments → the entry shows the SHA), and remember `public-site/` and
`admin-panel/` are generated: run `npm run build` and commit the result, or your
edits in `src/` never reach Vercel.

## 5. Security

**Turn on Vercel Deployment Protection for the admin project.** It runs at the
edge, before any file is served, so it covers static assets that application-level
checks cannot. Plan gating as of this writing:

- **Vercel Authentication** — restricts access to members of your Vercel team.
  Available on all plans including Hobby. Under the default *Standard Protection*
  scope it covers every deployment **except your production custom domain**.
- **Password Protection** — a shared password for people without Vercel accounts.
  Enterprise, or Pro plus the $150/month Advanced Deployment Protection add-on.
  Not available on Hobby.
  ([Vercel KB](https://vercel.com/kb/guide/how-do-i-add-password-protection-to-my-vercel-deployment))

**Practical consequence on the Hobby plan:** enable Vercel Authentication and
access the panel at its generated `*.vercel.app` URL. Do **not** attach
`admin.yourdomain.com`, because Standard Protection leaves a production custom
domain public and you would be undoing the gate you just enabled. Covering a
custom domain needs the *All Deployments* scope, which is Pro/Enterprise.

Checklist:

- [ ] Deployment Protection enabled on the admin project **before** the URL is shared
- [ ] `ADMIN_PASSWORD` changed from the committed default `UHF2026Admin`
- [ ] Admin URL kept out of the public site, sitemaps, and social posts
- [ ] `X-Robots-Tag: noindex` confirmed with `curl -sI`
- [ ] Understood that steps above gate the *page*, not the *data* — until the
      backend exists, anyone who reaches the panel sees everything in it
- [ ] Real fix scheduled: server-side auth + shared database

---

## Development

```bash
npm run build     # regenerate both folders from src/
npm run dev       # public on :8000, admin on :8001
npm test          # 9 + 27 + 70 assertions (needs both dev servers + jsdom)
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
