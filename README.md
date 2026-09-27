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

- **The citizen closes the case, not the clerk.** When the municipality marks a report resolved, the
  person who reported it is asked whether that is actually true — with a camera and a GPS check against
  the original pin. The dashboard publishes both numbers side by side: *cases resolved* and *cases the
  reporter confirmed were resolved*. The gap between them is the point.
- **Real-time everywhere.** A status change made on the dashboard reaches the citizen's phone and every
  other open dashboard tab within milliseconds, over a typed SignalR hub — not a polling loop.
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

## Stack

| Layer | Technology |
|---|---|
| Backend API | ASP.NET Core 10, EF Core, PostgreSQL, SignalR |
| Staff dashboard | React 19, TypeScript, Vite, TanStack Query |
| Citizen + staff mobile app | Expo (React Native), TypeScript, expo-router |
| AI classification | Claude (Anthropic), structured outputs, with a deterministic fallback |
| Auth | JWT, two account kinds (citizen / staff) on one token scheme |
| Realtime | SignalR hub, group-scoped per citizen / per department / per report |

## Design decisions worth knowing about

- **The AI's original suggestion is kept even after a human overrides it.** That's what makes the
  dashboard's AI-agreement metric an honest measurement instead of a number nobody can audit.
- **Low confidence is a workflow state, not a log line.** Below the confidence floor, a report is never
  auto-routed — it surfaces in a dedicated "AI unsure" filter as work for a person.
- **Multi-tenant at the schema level.** Every operational table carries a municipality id; categories,
  departments, routing rules and SLAs are data, not code. A second municipality is a seed script.
- **One confirmation per citizen per report, enforced by a database unique index** — not just an API
  check, so two rapid taps racing each other cannot double-count.
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
`classificationSource: "RuleBased"`. To turn on the real Claude call:

```bash
dotnet user-secrets set "Anthropic:ApiKey" "sk-ant-..."
```

`GET /health` reports `aiProvider: "Configured"` or `"Fallback"` so it's always visible which engine is
actually live.

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

---

## Origin

Built in 30 hours for the **AI4Society Youth Innovation Hackathon** (Tirana, September 2026)
