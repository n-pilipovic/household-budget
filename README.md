# Household budget

Shared household budget app — replaces a multi-year Serbian/Croatian expense-tracking spreadsheet. Multi-user, mobile-first PWA, realtime sync.

## Stack

- **Angular 21** (standalone components, signals)
- **Tailwind v4** with a CSS-first `@theme` block (no `tailwind.config.js`)
- **Firebase Auth** (Google + email/password) — coming in Phase 2
- **Firestore** for data + realtime — coming in Phase 2
- **Cloudflare Pages** for hosting (auto-deploys from `main`)
- **pnpm** for package management

## Local development

```bash
pnpm install
pnpm start          # http://localhost:4200
pnpm build          # production build → dist/household-budget
pnpm test           # vitest
```

## Design system

Design tokens live inside `src/styles.css` as a Tailwind v4 `@theme` block. Every color, radius, shadow, and font token surfaces as a generated utility (`bg-brand-500`, `text-on-bg-muted`, `rounded-lg`, etc.).

The visual design system and screen mockups are in [`mockups/`](mockups/) — open `mockups/index.html` via a local server to browse:

```bash
cd mockups && python3 -m http.server 8765
```

## Roadmap

- **Phase 1** (current): scaffold, design tokens, deploy pipeline
- **Phase 2**: Firebase Auth, household creation, invite-code flow
- **Phase 3**: Today / Quick Add / Monthly / Category drill-down screens
- **Phase 4**: PWA install + offline cache
- **Phase 5**: Firestore security rules, lock down + ship
