# Household budget

A shared household budget app for two-plus users. Replaces a multi-year Excel
sheet with a mobile-first PWA that syncs live across phones and laptops.

Live: **[household-budget.pages.dev](https://household-budget.pages.dev)**

## What it does

- **Quick Add** — bottom-sheet entry with a natural-language parser ("350 coffee" →
  amount + note + auto-suggested category). Edit or delete an existing transaction
  by tapping it in the feed.
- **Today** — month-to-date spend + day-grouped feed of recent transactions,
  attributed to each member by colour chip. Realtime: partner adds show up with
  a soft highlight within ~1s.
- **Monthly** — category-by-category planned vs actual for any month, with
  inline per-category budget editing. Top-level "Available / Spent / Remaining"
  KPI strip when you set a monthly cash-inflow figure.
- **Category drill-down** — 12-month bar chart for any category, with filter
  chips (all-time / this-month / last-30-days) and the full transaction list.
- **Settings** — display name, household rename, invite-code regeneration,
  theme (system / light / dark), build date + GitHub link.
- **PWA** — installable on iOS + Android home screens via "Add to Home Screen".
  Cached app shell loads offline; new versions surface a "Update available"
  toast with one tap to apply.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Angular 21 (standalone components, signals), Tailwind v4 (`@theme` only, no config file), lucide-angular |
| Auth | Firebase Auth — Google + email/password |
| Data | Firestore (realtime via `onSnapshot`) |
| Hosting | Cloudflare Pages (auto-deploy on push to `main`) |
| Service worker | `@angular/service-worker` for offline shell + update prompts |
| Package manager | pnpm |

## Local development

```bash
pnpm install
pnpm start          # http://localhost:4200 (dev mode, no SW)
pnpm build          # production build with SW + manifest
pnpm test           # vitest

# The build/start commands chain `pnpm build:info && ng ...` so the
# Settings → About row stamps the current date + git short SHA into
# src/app/build-info.ts on every run.
```

Local dev hits the same live Firestore project as production. If you want a
separate dev project, add `environment.development.ts` with a different
`firebaseConfig` and configure `fileReplacements` in `angular.json`.

## Firebase project

- Project: `household-budget-bccb2`
- Auth: Google + email/password providers enabled, `localhost` and
  `household-budget.pages.dev` in Authorized domains
- Firestore region: `europe-west3` (Frankfurt)
- Security rules: [`firestore.rules`](firestore.rules) — deploy with
  `pnpm firebase deploy --only firestore:rules`
- Composite indexes: [`firestore.indexes.json`](firestore.indexes.json) —
  deploy with `pnpm firebase deploy --only firestore:indexes`

## Architecture

### Routes

| Path | Guards | Purpose |
|---|---|---|
| `/sign-in` | Bounces signed-in users to `/today` | Google + email/password |
| `/onboarding` | Auth + no-household | Create or join household, share invite code |
| `/today` | Auth + household | Month KPI + day-grouped feed, FAB → Quick Add |
| `/monthly` | Auth + household | Per-category breakdown with inline budget editing |
| `/category/:id` | Auth + household | 12-month chart + filtered transactions for one category |
| `/settings` | Auth + household | Profile, household, theme, about |

### Data model (Firestore)

```
users/{uid}                                     — profile (email, displayName, photoURL)
households/{hid}                                — { name, members: [uid], memberColors: { uid: '1'|'2' } }
households/{hid}/categories/{cid}               — seeded from the Excel taxonomy on creation
households/{hid}/transactions/{txid}            — { userId, amount, currency, categoryId, note, occurredOn, createdAt }
households/{hid}/budgets/{yyyymm}               — { startingAmount?, updatedAt, updatedBy }
households/{hid}/budgets/{yyyymm}/categories/{cid} — { amount } (per-category planned)
invites/{code}                                  — { householdId, createdBy, expiresAt, usedBy? }
```

Color slots are abstract (`'1'`, `'2'`) — never tied to specific names. The UI
maps them to design tokens (`bg-member-1`, `bg-member-2`).

### Design system

`src/styles.css` contains the entire Tailwind v4 `@theme` block. Every
color / radius / shadow / type token surfaces as a generated utility class
(`bg-brand-500`, `text-on-bg-muted`, `rounded-lg`, `shadow-sm`, etc.).
Dark mode is class-based via `@custom-variant dark (&:where(.dark, .dark *))`
and overrides applied at the root.

## Importing historical data

The repo ships a one-off migration script that reads the source Excel and
writes both transactions and per-category budgets into Firestore.

```bash
# 1. Download a service-account key from
#    Firebase Console → Project Settings → Service accounts → Generate new private key
# 2. Save it as firebase-admin-key.json at the repo root (gitignored).
# 3. Put the source spreadsheet at docs/Vođenje troškova.xlsx (gitignored).

pnpm migrate -- --email=<your-email> --dry-run        # preview
pnpm migrate -- --email=<your-email>                  # first run
pnpm migrate -- --email=<your-email> --clean          # iterate (preserves manual entries)
pnpm migrate -- --email=<your-email> --wipe-all       # nuclear reset
```

See [`scripts/migrate-from-excel.mjs`](scripts/migrate-from-excel.mjs) for
column-mapping, formula-expansion, and date-inference details.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm start` | Dev server at `:4200`, no service worker |
| `pnpm build` | Production build → `dist/household-budget/` (what Cloudflare Pages serves) |
| `pnpm test` | Vitest unit tests |
| `pnpm watch` | Continuous dev build |
| `pnpm build:info` | Regenerate `src/app/build-info.ts` (runs automatically before start/build) |
| `pnpm migrate` | One-off Excel → Firestore import (see above) |
| `pnpm firebase` | Firebase CLI, scoped to the local install |

## Repo layout

```
src/
├── app/
│   ├── auth/                 — AuthService + functional guards
│   ├── data/                 — HouseholdService, BudgetService, CategoryService,
│   │                            TransactionService, UpdateService, ThemeService, etc.
│   ├── pages/
│   │   ├── sign-in/
│   │   ├── onboarding/
│   │   ├── today/            — incl. quick-add-sheet
│   │   ├── monthly/
│   │   ├── category-detail/
│   │   └── settings/
│   ├── app.routes.ts
│   ├── app.config.ts         — providers: Firebase, Firestore, Auth, SW
│   └── build-info.ts         — generated, gitignored
├── environments/
│   └── environment.ts        — Firebase web SDK config (public keys, safe to commit)
└── styles.css                — Tailwind v4 @theme block (single source of truth)

public/
├── icons/                    — PWA icons (generated by scripts/gen-icons.mjs)
├── apple-touch-icon.png
├── manifest.webmanifest
└── _redirects                — Cloudflare SPA fallback → /index.html

scripts/
├── gen-build-info.mjs        — writes build-info.ts on every build
├── gen-icons.mjs             — regenerate brand-mark PWA icons from inline SVG
└── migrate-from-excel.mjs    — historical-data import

docs/                         — gitignored: source Excel + early prompt drafts
firebase.json
firestore.rules
firestore.indexes.json
ngsw-config.json              — service-worker cache groups
```

## Deployment

Push to `main` → Cloudflare Pages auto-builds → `household-budget.pages.dev`
within ~90 seconds. Build settings:

- Framework preset: Angular
- Build command: `pnpm build`
- Build output directory: `dist/household-budget/browser`
- Node version: 20 (via `NODE_VERSION` env var)

Service-worker updates surface a toast in the app. Existing tabs pick up new
versions within ~1 hour (periodic check) or immediately on focus/visibility
change.

## Conventions

- **Single git author**: commits use a GitHub `noreply` email so the repo is
  safe to make public without exposing personal addresses.
- **Public Firebase config**: web SDK keys are public-by-design — security
  lives in Firestore rules + Auth Authorized domains, not in hiding the
  config.
- **Never commit**: `firebase-admin-key.json`, `docs/`, `*.xlsx`,
  `src/app/build-info.ts`. All in [`.gitignore`](.gitignore).

## License

Personal project. No license — fork and adapt freely if useful.
