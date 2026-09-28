# E-Raporto

**A citizen problem-reporting platform for Bashkia Elbasan, Albania.** A citizen photographs a pothole,
a broken streetlight, an overflowing bin — the system classifies it with AI, checks it against nearby
open reports so the same pothole doesn't become forty tickets, routes it to the right municipal
department and person, and pushes every status change back to the citizen and the staff dashboard in
real time.

![.NET](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet&logoColor=white)
![C#](https://img.shields.io/badge/C%23-ASP.NET_Core-239120?logo=csharp&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-57-000020?logo=expo&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)
![SignalR](https://img.shields.io/badge/Realtime-SignalR-512BD4)
![Claude](https://img.shields.io/badge/AI-Claude-D97757?logo=anthropic&logoColor=white)

---

## How a report moves through the system

```
Citizen submits (photo + sentence + location)
   │
   ├─ persisted immediately — a slow AI call must never cost a citizen their report
   ├─ classified by Claude (structured output) ──fails──▶ deterministic keyword classifier
   ├─ routed to the category's owning department, then to that department's default officer
   ├─ checked against nearby open reports (haversine radius + text similarity + category match)
   └─ auto-acknowledged — but ONLY above a 65% confidence floor; below that, a human decides
   │
   ▼
Every change — status, assignment, category, a new duplicate suggestion — broadcasts over SignalR
to the citizen's phone and the staff dashboard the instant it happens. No polling, no manual refresh.
   │
   ▼
Staff mark it resolved
   │
   └─ the reporter is asked "is it actually fixed?" — instantly if their app is open, as a push if not
      │
      ├─ confirmed  ──▶ counts toward the municipality's verified-resolution rate
      └─ disputed   ──▶ permanent history entry under the reporter's handle, flagged in the staff
                        queue, subtracted from that rate — a human decides whether to reopen
```

## Highlights

- **Reporting only works from inside the municipality.** The mobile app checks the reporter's live GPS
  fix against Bashkia Elbasan's real administrative boundary — a 221-point polygon pulled from
  OpenStreetMap, not a circle — before a report can be submitted. The report's own pin can be dragged
  anywhere afterward (someone who found a problem and had to rush off submits later from wherever they
  ended up), but the device has to have actually been inside the municipality to submit at all.
- **Eight-signal fraud review queue, none of them a black-box "is this fake" verdict.** Six automated
  checks (a perceptual photo hash, a GPS-metadata distance check, and four calibrated Claude vision
  questions) plus a clerk's own manual flag, unified into one staff review queue. See
  [Fraud & abuse detection](#fraud--abuse-detection) below for what each one actually checks and why the
  design deliberately avoids the one AI capability that doesn't hold up: a model directly judging intent.
- **The citizen closes the case, not the clerk.** When the municipality marks a report resolved, the
  person who reported it is asked whether that is actually true — with a camera and a GPS check against
  the original pin. The dashboard publishes both numbers side by side: *cases resolved* and *cases the
  reporter confirmed were resolved*. The gap between them is the point.
- **Real-time everywhere.** A status change made on the dashboard reaches the citizen's phone and every
  other open dashboard tab within milliseconds, over a typed SignalR hub — not a polling loop.
- **The staff dashboard's session never touches JavaScript.** The web dashboard's JWT rides an httpOnly
  cookie set on login — a browser-side XSS bug has nothing to steal, because the token is never in
  `localStorage` or readable by page script at all. The mobile app is unaffected: it keeps using a
  bearer header from `AsyncStorage`, which isn't exposed to injected web JS the way browser storage is.
- **AI with a real fallback, not a fake one.** No API key configured degrades to a deterministic
  Albanian keyword classifier automatically; every response honestly reports which engine actually ran.
- **Duplicate detection that shows its work.** Distance, text overlap and category match are shown as a
  legible score breakdown — a human confirms or rejects, nothing is merged silently.
- **Auto-routing to a department *and* a specific person**, reconfigurable per category without a code
  change — onboarding a new municipality is a seed script, not a fork.
- **One-click Word dossier export** — a formatted `.docx` case file (description, photos, timeline
  against SLA, AI reasoning, full audit trail) generated server-side, identical from either client.
- **Real push notifications** via Expo's push service, with an in-app fallback layer so nothing breaks
  when push permission is denied or the runtime doesn't support it.
- **Status is an append-only history, not a mutable column** — the citizen's timeline, the
  resolution-time analytics and every notification all derive from the same audit trail.

## Fraud & abuse detection

A single staff queue ("Mashtrime të mundshme" — Potential Fraud) unifies eight reasons a report might be
worth a second look. Nothing here ever merges, blocks, or auto-rejects a report — every flag only asks a
clerk to look, exactly like duplicate and pattern detection do. The queue is filterable by kind, shows
score/confidence where one exists, and pairs the two reports side by side for the two kinds that compare
against another report.

| Kind | How it's checked | Deterministic or AI |
|---|---|---|
| Reused photo | Perceptual hash (dHash) against every other report's photos | Deterministic |
| Photo's GPS doesn't match the pin | The photo's own EXIF GPS (read once at upload, before it's stripped for privacy) vs. the reported location | Deterministic |
| Copied text | Word-overlap against every other report's description, city-wide, excluding anything close enough to be a genuine duplicate | Deterministic |
| Description doesn't match the photo | Claude vision | AI, calibrated |
| Exaggerated severity | Claude vision — does the text claim a danger the photo doesn't support | AI, calibrated |
| Looks like a stock photo | Claude vision — composition/lighting typical of stock imagery, not a phone snapshot | AI, calibrated |
| Photo of a photo or screen | Claude vision — a bezel, moiré, or glare typical of re-photographing a screen | AI, calibrated |
| Staff-flagged | A clerk's own judgement call, any report, any reason | Manual |

**Why not just ask Claude "is this fraud?"** No current model can honestly answer that — it's a judgement
about intent, not a checkable fact. Every automated check here is instead a narrow, answerable question
("does this photo plausibly show what the text describes?", "is this photo's GPS near the pin?") with a
real, explainable reason attached — the same discipline the duplicate-detection score breakdown already
uses. The four Claude checks run as **one combined call per report**, not four, reusing the same
downscaled photo already sent to the classifier — and only surface a flag above a 60% confidence floor,
since a wrong accusation against an honest citizen costs the system's trust more than a missed one costs
a clerk's time.

**Stats only, by design.** A confirmed flag has no automatic effect on the reporter's account — it only
moves a number in Analytics. The reporter is pseudonymous everywhere in this system (see below); a fraud
flag doesn't get to be the one channel that undermines that.

## Stack

| Layer | Technology |
|---|---|
| Backend API | ASP.NET Core 10, EF Core, PostgreSQL, SignalR |
| Staff dashboard | React 19, TypeScript, Vite, TanStack Query |
| Citizen + staff mobile app | Expo (React Native), TypeScript, expo-router |
| AI classification & fraud signals | Claude (Anthropic), structured outputs, with a deterministic fallback |
| Auth | JWT, two account kinds (citizen / staff); staff dashboard rides an httpOnly cookie, mobile a bearer header |
| Realtime | SignalR hub, group-scoped per citizen / per department / per report |
| Geofencing | Point-in-polygon against a real OSM administrative boundary (no external service at request time) |

## Design decisions worth knowing about

- **The AI's original suggestion is kept even after a human overrides it.** That's what makes the
  dashboard's AI-agreement metric an honest measurement instead of a number nobody can audit.
- **Low confidence is a workflow state, not a log line.** Below the confidence floor, a report is never
  auto-routed — it surfaces in a dedicated "AI unsure" filter as work for a person.
- **Multi-tenant at the schema level.** Every operational table carries a municipality id; categories,
  departments, routing rules and SLAs are data, not code. A second municipality is a seed script.
- **One confirmation per citizen per report, enforced by a database unique index** — not just an API
  check, so two rapid taps racing each other cannot double-count.
- **The municipality boundary is a real polygon, not a radius.** Bashkia Elbasan absorbed a dozen rural
  former communes in Albania's 2015 territorial reform, so its shape is large and irregular — a circle
  centered on the city would either cut off legitimate outlying villages or bleed into a neighbouring
  municipality's territory. The boundary check compares against the actual 221-point OSM polygon instead.
- **CORS fails closed outside Development, not open.** Once the dashboard's session became a cookie that
  a browser attaches automatically, an unconfigured origin allowlist would mean any website could fire
  credentialed requests against the API on a signed-in clerk's behalf. A missing `Cors:AllowedOrigins`
  now refuses to start outside Development, the same fail-fast treatment the JWT signing key already got.
- **Attribution comes from the auth token, never the request body.** A caller cannot file a report, or
  a case note, as another account.
- **Accounts are required; names are never shown.** A report is attributed to a pseudonymous handle,
  and no role in the system — clerk, supervisor, admin — can see who filed it. Nothing is anonymous to
  the *system*: every report has a real, verified account behind it, and one confirmation per person is
  still enforced. It is anonymous to *people*, which is the only place retaliation comes from.
- **The verified-resolution rate is measured against every closed case, not against everyone who
  replied.** Silence counts as unverified, so the number cannot be improved by asking fewer people —
  only by fixing more things. Proof is optional when disagreeing, for the same reason: requiring a photo
  to say "no" would quietly drop every citizen with no signal and flatter the result.
- **A disputed resolution does not reopen the case on its own.** One account able to flip a closed
  report back to open on its own word is a veto the first bad-faith user would ruin for everyone. It
  goes into the permanent case history under the reporter's handle, into a dedicated dashboard filter,
  and into the rate — and a human decides.

---

## Run it locally

### Prerequisites

| Tool | Version used |
|---|---|
| .NET SDK | 10.0.202 |
| Node.js | 24.x (npm 11+) |
| PostgreSQL | 18 |
| Expo Go | latest, on a physical phone (optional — only needed for the mobile app) |

### 1 · Database

Create an empty database named `E-Raporto`. The password is never committed — it goes into .NET
user-secrets:

```bash
cd E-RaportoBackend/E-RaportoBackend
dotnet user-secrets set "ConnectionStrings:Default" \
  "Host=localhost;Port=5432;Database=E-Raporto;Username=postgres;Password=YOUR_PASSWORD"
```

### 2 · Backend API

```bash
cd E-RaportoBackend/E-RaportoBackend
dotnet run --launch-profile http
```

On first boot the API applies its EF Core migrations and seeds its own configuration — municipality,
directorates, categories with routing rules, and staff accounts. No manual SQL, no fixture import.
Reports are not seeded: the map starts empty and fills with reports genuinely submitted through the app.

- API → <http://localhost:5216> · Swagger → `/swagger` · Health → `/health`

### 3 · Staff dashboard

```bash
cd admin-dashboard
npm install && npm run dev
```

→ <http://localhost:5173> · sign in with **admin@elbasan.gov.al** / **`Elbasan2026!`**

### 4 · Citizen / staff mobile app

```bash
cd mobile-app
npm install && npx expo start
```

Scan the QR code with **Expo Go**. No native build, no `.env` — the app finds the API on the LAN
automatically. (If your Wi-Fi isolates clients from each other, copy `.env.example` to `.env` and set
`EXPO_PUBLIC_API_URL` to your machine's LAN IP.)

### Enabling the real AI classifier

The app runs fully **without an AI key** — every response then honestly reports
`classificationSource: "RuleBased"`, and the four Claude-based fraud checks simply don't run (the
deterministic ones — photo reuse, GPS mismatch, copied text — still do). To turn on the real Claude calls:

```bash
dotnet user-secrets set "Anthropic:ApiKey" "sk-ant-..."
```

`GET /health` reports `aiProvider: "Configured"` or `"Fallback"` so it's always visible which engine is
actually live. The same key powers both classification and the fraud-signal checks.

---

## Demo accounts

| Email | Role |
|---|---|
| `admin@elbasan.gov.al` | Admin — sees everything, plus the duplicate review queue |
| `i.meta@elbasan.gov.al` | Supervisor — Infrastructure |
| `b.dervishi@elbasan.gov.al` | Supervisor — Public services |
| `g.rama@elbasan.gov.al` | Field agent — Public lighting |
| `e.brahimi@ukelbasan.al` | Supervisor — Water & sewage |

Password for all: `Elbasan2026!` (demo data only — reset with `dotnet ef database drop -f && dotnet ef database update`).

---

## Known limitations

Stated plainly rather than discovered the hard way:

- **`aiAgreementRate` is not accuracy** — it's the share of classifications staff did *not* override.
  There's no labelled ground-truth set behind it yet.
- **Duplicate detection uses geo + token overlap, not embeddings** — explainable and
  infrastructure-free; embeddings are the natural upgrade path.
- **Photos are stored on local disk** behind a swappable `IPhotoStorage` — an S3/Blob implementation is
  a single class, not a refactor.
- **Maps on mobile are Leaflet in a WebView**, not a native map SDK — deliberate, since
  `react-native-maps` needs a Google Maps API key to render on Android and this needs none.
- **Push notifications need one manual step** (`eas init`) to link a build to a real push-capable
  Expo project — everything else (registration, delivery, in-app fallback) is already wired.
- **GPS-mismatch coverage is low by nature, not by bug.** Most phones don't tag photos with location by
  default any more, and anything that passed through another app first (a gallery pick, a forward)
  usually already lost it. Silence from this check proves nothing either way — it only fires as a bonus
  signal on the minority of photos that happen to still carry the data.
- **The photo-upload GPS bridge is an in-memory cache**, not a table — the EXIF coordinate has to survive
  from the upload call to the later report-submission call, and a short-lived, self-expiring cache was a
  simpler fit than a migration for genuinely ephemeral data. Same single-instance assumption
  `LocalPhotoStorage` already makes for the files themselves; a real multi-instance pilot moving photos
  to blob storage would want this alongside it.
- **The four Claude vision fraud checks are calibrated, not certain** — same honesty rule as the category
  classifier. A flag is a clerk's cue to look, never a verdict, and confidence is shown as the model's own
  number, not dressed up as ground truth.

---

## Origin

Built in 30 hours for the **AI4Society Youth Innovation Hackathon** (Tirana, September 2026), then
carried past the hackathon with real push notifications, live SignalR sync across both clients, municipal
boundary enforcement, the unified fraud-review system, cookie-based dashboard auth, and a
production-readiness pass end to end.
