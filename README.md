# উত্তরবঙ্গ হেরিটেজ ফেস্ট | Uttarbanga Heritage Fest

One static Vercel deployment. The public site is at `/`, the organiser panel at
`/admin`.

| | URL | Indexed |
| --- | --- | --- |
| Public website | `/` | yes |
| Admin panel | `/admin` | **no** — `noindex` header + `Disallow: /admin` |

The admin panel is reachable from a small `অ্যাডমিন লগইন` link in the footer of
every public page (`rel="nofollow"`, and the page itself is `noindex`). It is
not in the top navigation. Read the security note below before treating any of
that as private.

---

## ⚠️ Read this before deploying

### 1. A static admin panel cannot be secured by frontend code. At all.

`/admin` has a real login form now — username, hashed password, session, change
password, logout — and none of it is security. It all runs in the visitor's
browser, so anyone can open DevTools and write the session key by hand. The
login also guards nothing real — the data lives in the visitor's own browser,
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

## Admin login

`/admin` opens on a login form. Nothing in the dashboard renders until you are
signed in.

| | |
| --- | --- |
| Default username | `admin` |
| Default password | `admin123` |
| Session | `sessionStorage` — closing the tab logs you out; reloading does not |
| Credential | `localStorage`, as a random salt plus a SHA-256 hash. The password itself is never written anywhere |
| Change password | **পাসওয়ার্ড** tab: current + new + confirm, minimum 6 characters, new salt on every change |
| Forgot it | **ডিফল্টে ফিরিয়ে নাও** in the same tab resets to `admin` / `admin123` |
| Logout | Button in the dashboard header |

A red banner sits at the top of the dashboard until the default password is
replaced.

Wrong username and wrong password return the identical error, so the form
cannot be used to discover valid usernames, and the hash comparison is
length-independent so timing leaks nothing. Both are good hygiene, neither
makes this real authentication — see the security note above.

`js/auth.js` is only shipped to `admin.html`; the public page never loads it.

## Team & sponsors

The **টিম** tab renders four tiers, largest first, from
`src/public/body.html` + the `.credit-*` / `.tier-*` / `.person` / `.sponsor`
rules in `src/shared/styles.css`:

| Tier | Card | Image |
| --- | --- | --- |
| প্রধান সমন্বয়কারী ও টাইটেল স্পন্সর | wide centred card, double brass border, 150px logo | `projonmo-logo.jpg` |
| সহ-আয়োজক | narrower card, single border, 104px logo | `normative-logo.jpg` |
| আয়োজক দল | two circular-portrait cards, 2 columns → 1 on mobile | `muhit.jpg`, `watan.jpg` |
| আমাদের পৃষ্ঠপোষকবৃন্দ | white logo cards, 3 columns → 2 on mobile | `rcc.jpg`, `dnc.jpg`, `royalty.jpg` |

Every image carries `alt`, explicit `width`/`height` (no layout shift) and
`loading="lazy"`. To swap a logo, drop the replacement into
`src/shared/images/` under the same filename and run `npm run build`.

## Exam timer control (admin-managed)

The countdown is no longer hardcoded. The organiser controls it from
**Admin → টাইমার নিয়ন্ত্রণ**:

| Control | Bengali label | Effect |
| --- | --- | --- |
| **Master switch** | পরীক্ষা সবার জন্য চালু করো | **The gate.** On = exam open for everyone. Off = everyone sees the countdown. Saves on flip |
| ON/OFF toggle | কাউন্টডাউন টাইমার দেখাও (পরীক্ষা লক করো) | Chooses the *locked* view: countdown, or your message |
| Date & time picker | পরীক্ষা শুরুর তারিখ ও সময় | The moment the exam opens (Bangladesh time) |
| Off behaviour | টাইমার বন্ধ থাকলে কী হবে? | `live` = exam open now · `message` = show a notice |
| Message (bn / en) | বার্তা | Shown when the timer is off and behaviour is `message` |
| Status badge | পরীক্ষা চালু · LIVE / লকড · COUNTDOWN / লকড · CLOSED | What a candidate sees right now, in one line |

**Shipped default: the exam is LOCKED, and it fails closed.**

This was a real bug, not a preference. The lock used to live in `localStorage`,
which is per browser and per origin — so the *only* device that knew the exam
was locked was the admin's own. Every other visitor, on every other browser and
phone, got the shipped default of "open" and could sit the exam early.

The gate is now a single field, `isUnlocked`, and **only a literal boolean
`true` from the backend opens the exam.** Everything else keeps it shut:

| Situation | Result |
| --- | --- |
| Fresh browser, never seen the admin panel | 🔒 countdown |
| The settings row does not exist yet | 🔒 countdown |
| Offline, or the fetch failed | 🔒 countdown |
| SDK blocked by a firewall / ad-blocker | 🔒 countdown |
| `isUnlocked` is `"true"` (string), `1`, `null`, or missing | 🔒 countdown |
| `examStartDate` has passed but nobody unlocked it | 🔒 countdown |
| `isUnlocked === true` | ✅ exam open |

Two deliberate consequences:

- **A passing date no longer opens the exam by itself.** The clock reaching
  25 Sep 2026 is not consent; an organiser flips the switch. This prevents a
  wrong date, or a visitor's wrong device clock, from opening the exam.
- **Locking mid-exam takes effect immediately.** the realtime listener pushes the change
  and any in-progress attempt is torn down on every screen at once.

The exam section also *starts* locked in the HTML, before any JavaScript runs,
so a slow network cannot flash the questions on screen.

The দিন / ঘণ্টা / মিনিট / সেকেন্ড boxes, their colours and their element ids are
untouched — only what drives them changed.

### Turning on Supabase

The exam lock, questions, registrations and leaderboard all sync globally
through Supabase (Postgres + Realtime). One row drives the gate:

```
settings (id = 'exam')
  is_unlocked false, exam_date '2026-09-25T00:00:00+06',
  registration_start '2026-08-25', registration_end '2026-09-20'
```

1. Supabase → new project (region: Southeast Asia / Singapore).
2. **SQL Editor** → paste `supabase/schema.sql` from this repo → **Run**.
   Tables, RLS policies, RPCs and the realtime publication are created in one
   go. RLS is the part that actually protects you: the world may read and
   register, only a signed-in organiser may flip the lock or edit questions.
3. **Authentication → Users → Add user**: create ONE organiser account, and
   keep public sign-ups off. Sign in with it in the admin panel's ☁️ box
   before flipping the master switch.
4. Project Settings → API: copy the Project URL and the **anon** key into
   `src/shared/supabase-config.js`. (The anon key is safe in public JS — RLS
   decides what it may do. The service_role key must never enter the repo.)
5. `npm run build && npm test`, then commit and push; Vercel redeploys.

Verify RLS actually holds before the event — the second command **must** fail:

```bash
curl -s "$SUPABASE_URL/rest/v1/settings?select=*" -H "apikey: $ANON_KEY"      # read: OK

curl -s -X PATCH "$SUPABASE_URL/rest/v1/settings?id=eq.exam" \
     -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
     -d '{"is_unlocked":true}'                                                # write: 403
```

Leave `SUPABASE_URL` empty and no third-party script loads at all — the site
stays on fail-closed defaults and **the exam stays locked** in every
fallback, so a misconfiguration can never open it.

### Why Supabase (and not localStorage or Firebase)

localStorage is scoped to one **origin** — for a feature whose entire purpose
is "one person changes it, everyone sees it", it cannot work at all. Firebase
would work, but this project is static with no build step, and Supabase
gives us:

- Row Level Security expressing exactly the rule we need — *everyone reads,
  one signed-in organiser writes* — in SQL, enforced by the database itself.
- Supabase Auth for the organiser account, so the admin write gate is real.
- Postgres: registrations, questions, scores and settings live in one
  database — one vendor, one dashboard.
- A CDN script tag and client-side SDK only; static hosting stays static.

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
│   │   ├── auth.js                       admin login gate (admin page only)
│   │   ├── styles.css
│   │   ├── storage.js
│   │   ├── common.js                     QUESTIONS, CATEGORY_LABELS, getCategoryKey
│   │   ├── footer.html
│   │   └── images/                       logos + committee photos
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
│   ├── auth.test.js                      41 assertions
│   └── apps.test.js                      114 assertions
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

- [ ] Admin password changed from the default `admin` / `admin123` (the panel
      shows a red banner until you do)
- [ ] `/admin` kept out of sitemaps and social posts. It is linked from the
      footer by request; the link is `rel="nofollow"` and the page is `noindex`,
      but a footer link means anyone can find it
- [ ] `x-robots-tag: noindex` confirmed with `curl -sI`
- [ ] Understood that the login runs client-side and can be bypassed from DevTools
- [ ] Real fix scheduled: Supabase Auth + server-side checks

## Development

```bash
npm run build     # regenerate index.html, admin.html and assets from src/
npm run dev       # site on :8000, /admin included (mirrors vercel.json)
npm test          # 9 + 32 + 41 + 114 assertions (needs the dev server + jsdom)
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
