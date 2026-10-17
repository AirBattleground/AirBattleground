# Phase 3 — Tournaments

A tournament is a chain of **stages** (Qualifier → Semi-final → Final …). Each stage splits its teams
into **groups** (one BGMI lobby each, default 16 teams), each group plays N matches, and the top
teams of every group (+ wildcards, + invited teams) move to the next stage. Every group match is a
normal 7xen `Match`, so screenshot reading, review, publish and points are reused unchanged.

## Owner decisions (2026-10-17)
| Topic | Decision |
|---|---|
| Who creates | Any **manager**; no approval. **Admin** sees all tournaments and can act on any. |
| Registration | **First-come-first-served** up to `maxTeams`; extra teams join a **waitlist** (auto-promoted when a spot frees, until the draw). |
| Lobby size | Default **16**, max 25. |
| Advancement | **Top N per group** + **wildcards** (best non-qualifiers across all groups by points-per-match) + **invited teams** placed directly into a later stage. |
| Seeding after stage 1 | **Snake seeding by results** (invited teams take the top seeds by default). |
| Time preferences | **v1**: stage-1 schedule is fixed before registration opens; teams rank the time slots they can play; the draw honours them in registration order. |

## Worked example
```
Registration ─▶ QUALIFIER ───────────▶ SEMI-FINAL ──────────▶ FINAL ─────────▶ 🏆
 128 slots      8 groups × 16          2 groups × 16          1 lobby × 16
                4 matches each         6 matches each         6 matches
                top 4/group → 32       top 8/group → 16       champion
```
Flow rule: `stage[k].teamsIn = stage[k-1].groupCount × advancePerGroup + stage[k-1].wildcardCount + stage[k].invitedSlots`.

## Lifecycle
Tournament: `DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → LIVE → COMPLETED` (or `CANCELLED`).
Stage: `PENDING → DRAWN → LIVE → COMPLETED`.
Manager control center = one big "next action" button per step:
`Publish → (registrations) → Close registration → Draw groups → Start stage → play matches (match center) → Promote → next stage: Draw (snake) → … → Complete (champion)`.
Registration closes automatically when the first stage starts (or at `registrationClosesAt`).

## Algorithms (pure, in `packages/shared/src/tournament/engine.ts`, heavily tested)
1. **Format** — `suggestFormat(totalTeams, lobbySize)` proposes stages (presets: 16 final-only; 32/64 qualifier→final; 96/128 qualifier→semi→final; >128 adds a round); `validateFormat` checks the flow rule, lobby ≤ 25, maps length = matches, advance ≤ smallest group, wildcards ≤ eliminated pool, final = 1 group (warning otherwise).
2. **Balanced groups** — `groupCount = ceil(teams / lobbySize)`, sizes differ by at most 1.
3. **Schedule** — inputs: date range, daily windows (e.g. 18:00–23:00), excluded dates, minutes per match (default 40 incl. setup), break (default 5), parallel lobbies (1–4). Each group's matches form **one contiguous block** in one lobby. Greedy packing, day by day, lobby by lobby. Output: blocks with per-match times, number of days, unscheduled groups (if the range is too short) and **suggestions** ("extend the window to 23:30 to finish in 2 days instead of 4", "add a lobby", "add N days").
4. **Time-slot options** — distinct block start times (parallel lobbies at the same time merge into one option); capacity = sum of those groups' sizes. Option id = ISO start instant.
5. **Draw (stage 1)** — seeded RNG (seed stored & shown for transparency). Teams in registration order take their highest-ranked preference slot with free capacity (random group within that slot); teams with no free preference (or "any time") fill remaining space; unmet preferences are reported. Slot numbers inside a group are shuffled (seeded) starting at `firstSlot`.
6. **Snake seeding (later stages)** — previous stage ranking: group rank first, then points per match, then shared tie-breakers; invited teams first (configurable). Seeds 1..n snake across groups (A1,B1,…,B2,A2,…).
7. **Promotion** — per-group standings via `computeStandings`; top N per group advance (`via=TOP`), then `wildcardCount` best of the rest by points-per-match (`via=WILDCARD`); ties exactly at the cut-off are flagged for the manager; overrides (include/exclude/disqualify) applied before confirming.

## Data model (Prisma)
`Tournament`, `TournamentStage`, `TournamentEntry` (registration or invite; status CONFIRMED/WAITLISTED/WITHDRAWN/REMOVED; timePreferences), `TournamentGroup`, `GroupTeam` (slot, seed, status ACTIVE/ADVANCED/ELIMINATED/DISQUALIFIED, advancedVia). `Match` now belongs to a scrim session **or** a tournament group (`sessionId?`, `groupId?`) and has `scheduledAt` + `lobbyIndex`.

## What teams see
Tournament list (open / live / mine / completed) → tournament hub: hero (prize, dates, status, "97/128 registered"), **animated stage flow chart** (current stage pulses, "YOU ARE HERE" marker, next goal, countdown to your next match), register button with time-slot picker (or "Registration closed" once play starts — details stay visible). Expand a stage → groups, schedule, live standings, qualified/eliminated badges, top teams and top fraggers → any match → scorecard.

## Contract
`packages/shared/src/phase3.ts` (endpoints in its header, DTOs, zod schemas) and the engine signatures in `packages/shared/src/tournament/engine.ts`.

## Ownership for parallel work
| Workstream | Owns |
|---|---|
| Engine | `packages/shared/src/tournament/**` (implementations + tests) |
| API | `apps/api/**` |
| Manager UI | `apps/web/src/pages/manager/tournaments/**`, `apps/web/src/features/tournaments/manager/**`, manager nav entry |
| Team UI | `apps/web/src/pages/team/tournaments/**`, `apps/web/src/features/tournaments/team/**`, `apps/web/src/features/tournaments/shared/**`, team nav entry |
| Admin + QA | `apps/admin/src/**` (tournaments section), `scripts/simulate-tournament.ts`, `docs/phase3/**` additions |
