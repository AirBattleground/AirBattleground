# 7xen — competitive Battlegrounds scrim platform

pnpm monorepo (pnpm 11, Node 24, TypeScript strict).

```
apps/api     Express 5 + Prisma 6 + Postgres. REST under /api. Port 4000.
apps/web     Vite + React 18 + Tailwind v4 + shadcn/ui. Team & Manager portal. Port 5173.
apps/admin   Same stack. Admin console (creates manager + team logins). Served at /admin-ui (dev: :5174, proxied via web :5173).
packages/shared  Zod schemas, enums, DTO types, endpoint catalogue (src/api.ts), schedule helpers, fetch client.
packages/ui      shadcn/ui components + 7xen theme (light/dark), brand components, ThemeProvider, guided tour.
```

## Phase 1 domain
- Roles: ADMIN (owner, seeded from env), MANAGER, TEAM. Admin creates manager logins. Teams: admin creates them directly, or a manager submits a `TeamRequest` that the admin approves (login only exists after approval). No self sign-up yet.
- Team names are unique (case/space-insensitive via `teamNameKey`), across teams AND pending team requests.
- Manager creates **scrims**: title, maps (one per match), start time (IST, "HH:mm"), recurrence ONCE | DAILY | WEEKENDS, start/end date, slotCount, firstSlot.
- A scrim "occurs" on a date per `occursOn()`; one `ScrimSession` row per (scrim, date), created lazily.
- Team picks a date → sees scrims that day → registers (PENDING). Manager approves → **lowest free slot auto-allotted** (firstSlot..firstSlot+slotCount-1). Reject/cancel frees the slot. Registration closes at session start.
- Phase 2 (NOT now): room id/password, match results via screenshot OCR, leaderboards.

## Contracts — read before coding
- `packages/shared/src/api.ts` — every endpoint, method, input schema, response DTO, error codes.
- `packages/shared/src/dto.ts` — response shapes. `schemas.ts` — request validation (shared by API and forms).
- Errors: `{ error: { code, message, fields? } }`. Messages are user-facing, plain English, short.
- Change a contract only if truly necessary, and keep it backward compatible; note it in your final report.

## Frontend conventions
- Import shadcn components from `@7xen/ui/components/ui/<name>` (button, input, label, textarea, card, badge, dialog, alert-dialog, select, tabs, dropdown-menu, tooltip, switch, skeleton, sonner, avatar, separator, table, popover, calendar, sheet, scroll-area, checkbox, radio-group, form, progress, command, toggle, toggle-group).
- Brand components: `@7xen/ui/components/brand/{logo,animated-background,theme-toggle,status,page}` → Logo, LogoMark, AnimatedBackground, ThemeToggle, Pill, StatusBadge, SlotChip, TeamAvatar, PageHeader, StatCard, EmptyState, FullPageLoader.
- `cn` from `@7xen/ui/lib/utils`. Theme: `useTheme` from `@7xen/ui/theme`. Tour: `usePageTour`, `useTour` from `@7xen/ui/tour`. Toasts: `toast` from `sonner`.
- **Only use theme tokens** (bg-background, bg-card, text-muted-foreground, border, bg-primary, text-success, bg-warning/15, …) so light AND dark both look right. Never hardcode zinc/gray/black/white surfaces. `font-display` for headings/numbers. Utilities: `bg-grid`, `text-gradient-brand`, `shadow-glow`, `animate-rise`, `animate-float`, `animate-aurora`.
- Do not edit `packages/ui` or `packages/shared` unless your task says so — put app-specific components in the app.
- Data fetching: TanStack Query + `api` from `@/lib/api` (methods get/post/patch/del, throws `ApiError` with `.code`, `.message`, `.fields`). Forms: react-hook-form + zodResolver with the shared schema; map `ApiError.fields` onto form errors.
- UX bar: professional esports look, but dead simple for non-technical users. One primary action per screen, plain words ("Register for this scrim", "Waiting for manager approval"), big readable slot numbers, empty states that tell the user what to do next, skeletons while loading, toasts on success/failure, confirmation dialogs for destructive actions, mobile responsive.
- Every page registers a guided tour: `usePageTour("<area>.<page>", STEPS)` with STEPS a module-level const; target elements via `data-tour="..."` attributes. Auto-runs on first visit; replay via topbar "Take a tour" button.
- Layouts own the page container (padding/max-width). Pages render `<PageHeader>` + content only.
- Dates: always "YYYY-MM-DD" strings in IST; use helpers from `@7xen/shared` (`todayInAppTz`, `addDays`, `weekdayOf`). Format for display with date-fns (`format(parseISO(d), "EEE, d MMM")`).

## Commands
- `pnpm db:up` (docker-compose Postgres on :5433) · `pnpm db:migrate` · `pnpm db:seed`
- `pnpm dev` (all apps) · `pnpm typecheck` · `pnpm build`
- Dev uses Vite proxy `/api → :4000`, so session cookies are same-origin.
- Do not run `pnpm add` casually — multiple people work in this tree; if you must add a dependency use `pnpm --filter <pkg> add <dep>` and retry if the lockfile is busy.
