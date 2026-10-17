# Phase 3 QA — full tournament simulation

`scripts/simulate-tournament.ts` plays a complete 128-team tournament against a running API, end to end, through the
public HTTP API only (the same calls the web, manager and admin apps make). It prints ✓/✗ per step with timings, and
exits non-zero if any step fails.

## How to run

Never run it against production (ports 80 / 4000 / 8090, `public` schema). The script refuses those ports unless you
set `SIM_ALLOW_ANY_PORT=1`. Use a throwaway schema in the dev Postgres:

```bash
# 1. isolated schema
export SIM_DB="postgresql://sevenxen:sevenxen@localhost:5433/sevenxen?schema=sim"
cd apps/api
DATABASE_URL=$SIM_DB npx prisma migrate deploy

# 2. an admin user in that schema (the seed also imports training images, so insert the admin directly)
HASH=$(node -e "console.log(require('bcryptjs').hashSync('Admin@12345', 10))")
psql "postgresql://sevenxen:sevenxen@localhost:5433/sevenxen" -c \
  "insert into sim.\"User\" (id, username, \"passwordHash\", role, \"displayName\", \"isActive\", \"createdAt\", \"updatedAt\")
   values ('sim_admin', 'admin', '$HASH', 'ADMIN', 'Sim Admin', true, now(), now()) on conflict do nothing"

# 3. dev API on :4100 against that schema (no screenshot worker, scratch storage)
pnpm --filter @7xen/api build
DATABASE_URL=$SIM_DB PORT=4100 SCREENSHOT_WORKER=0 STORAGE_DIR=/tmp/7xen-sim-storage \
  JWT_SECRET=sim-secret-sim-secret-sim-secret NODE_ENV=development node dist/index.js

# 4. simulate (another terminal, repo root)
pnpm simulate:tournament                       # BASE_URL defaults to http://localhost:4100
SIM_SEED=abc123 pnpm simulate:tournament       # reproducible preferences/results
SIM_JSON=/tmp/sim.json pnpm simulate:tournament # also write a JSON report

# 5. clean up
psql "postgresql://sevenxen:sevenxen@localhost:5433/sevenxen" -c 'drop schema sim cascade'
```

Env: `BASE_URL`, `ADMIN_USERNAME` (default `admin`), `ADMIN_PASSWORD` (default `Admin@12345`), `SIM_SEED`, `SIM_JSON`.
Each run uses a random suffix for every account/title, so it can be re-run against the same schema.

## What it covers

| Area | Checks |
|---|---|
| Setup | admin login; 2 managers; 131 teams (130 + 1 invitee) created by the admin; every team logs in and saves a 4-player roster |
| Create | manager creates **Sim Cup**: Qualifier 8×16 (4 matches, top 4) → Semi-final 2×16 (6 matches, top 7 + 1 wildcard) → Final 16 (6 matches, 1 invited slot); stage-1 schedule = two 3-hour windows × 2 lobbies over 2 days (4 time slots × 32). DRAFT, 3 stages, no format errors, semi `teamsOut` = 15 |
| Visibility | DRAFT invisible to teams; another manager gets 403/404 on read and publish |
| Publish | REGISTRATION_OPEN, ≥ 2 slot options, capacity ≥ 128; plan days/suggestions printed |
| Registration | 130 concurrent `POST entry` with random ranked time preferences (15 % "any time") → exactly **128 CONFIRMED + 2 WAITLISTED**; entries list ordered (confirmed by `registeredAt`, then waitlist #1, #2); FCFS (no waitlisted team registered before a confirmed one); duplicate → 409; waitlisted `me` = WAITLISTED #1 |
| Withdrawal | a confirmed team withdraws → waitlist #1 auto-confirmed, waitlist #2 becomes #1, still 128 confirmed; withdrawn team's `me` state |
| Preferences | `PUT entry` changes preferences |
| Invites | stage 1 invite rejected (400); invitee into the Final accepted (INVITED, entryStage 3) |
| Admin | `GET /api/admin/tournaments` lists it with live counts + manager; **admin** closes registration via the mirror endpoint; late sign-up → 409 REGISTRATION_CLOSED |
| Draw (stage 1) | 8 groups × 16; slot numbers unique and within `firstSlot..firstSlot+15`; every confirmed team exactly once; no waitlisted/withdrawn/invited team; 4 matches per group |
| Preferences honoured | maps each group to its time slot; counts 1st-choice / any-choice / unmet; API `unmetPreferences` count = computed; **first-come guarantee** (simulating the greedy queue, every team gets the slot its registration order entitles it to) |
| Determinism | redraw with the same seed gives the identical draw |
| Start | stage LIVE, tournament LIVE; playing team's `me`: PLAYING, group, slot, nextGoal (mentions top 4), nextMatch #1, assignedSlot |
| Play | every group match through the match center: `PUT lineup` (confirm, roster names; checks slot → team mapping) → `PUT results` (random placements 1..16 + kills) → `POST publish`. Group A is engineered so ranks 4 and 5 tie on points, wins, placement points and kills |
| Blockers | with one match unpublished, preview is `ready=false` with a blocker, and promote is refused |
| Standings | every team's points/kills/wins/matches in every stage equal the locally computed values (default points system); sorted |
| Promotion 1 | ready; 32 qualified (all TOP, group rank ≤ 4), 96 eliminated; next stage teamsIn 32; **tie at Group A cut-off flagged**; promote → stage COMPLETED, 32 ADVANCED / 96 ELIMINATED |
| Team views | qualified (QUALIFIED/PLAYING + nextGoal), eliminated (ELIMINATED), waitlisted (WAITLISTED, can't register) |
| Snake seeding | semi seeds are 1..32; seed s sits in the snake group (A1, B2, B3, A4, A5, …); seeds 1–8 are qualifier group winners, 9–16 runners-up, …, each band ordered by points |
| Promotion 2 | 14 TOP + 1 WILDCARD; the wildcard has the best points-per-match among teams ranked 8+; invitee listed for the Final |
| Final | 16 teams, **invited team gets seed 1**; 6 matches; last-stage preview `nextStage = null`; promote → all stages COMPLETED |
| Complete | **admin** completes → COMPLETED, champion = Final rank 1 |
| After | champion `me` = CHAMPION, last place = ELIMINATED; `scope=completed` and `scope=mine` lists; public stage view + scorecard visible to a non-participant; admin detail (champion, nextAction DONE), entries and every stage via admin endpoints |
| Admin cancel | admin cancels another manager's draft → CANCELLED |
| Admin actions | close → reopen → close registration; reopen after the draw refused; admin removes the waitlisted entry (DELETE) |
| Guards | after the draw: withdraw, `PUT entry`, stage-2 draw and complete are all refused; promoting twice is refused; another manager can't read or write a tournament match; invalid time-slot id → 400 |
| Concurrency | double-click promote (one 200), double-click stage-2 draw (one draw, 32 placed), double-click registration (one entry), 2 simultaneous withdrawals with 2 waitlisted (both promoted, still full) |
| Broken format | a stage whose teamsIn doesn't match → format errors in `issues`, publish 400 |
| Top fraggers | per-player kills saved with results → stage `topFraggers[0]` matches the computed best player |

## Latest results

**2026-10-17 · PASSED 46/46** · `SIM_SEED=qa-final` · latest API build against a fresh `sim` schema · 33 s, 824 HTTP requests.
(Earlier runs with seeds `qa1`–`qa4` also passed.)

```
7xen tournament simulation → http://localhost:4100  (suffix euclf, SIM_SEED=qa-final)

✓  1. API health 38ms
✓  2. admin signs in 176ms
✓  3. admin creates 2 managers — sim_mgr_euclf 378ms
✓  4. admin creates 131 teams (130 + 1 invitee) — 131 teams 11945ms
✓  5. all teams sign in and save a 4-player roster 11805ms
✓  6. manager creates "Sim Cup" (DRAFT, 3 stages) — nextAction PUBLISH; warnings 0 20ms
✓  7. DRAFT is invisible to teams (404) 14ms
✓  8. another manager can't see or act on it 12ms
✓  9. manager publishes → REGISTRATION_OPEN with time slots — 4 slots (Tue, 20 Oct · 12:00 PM:32, Tue, 20 Oct · 6:00 PM:32, Wed, 21 Oct · 12:00 PM:32, Wed, 21 Oct · 6:00 PM:32); plan 2 days; tips: Extend each time window by 3h to finish in 1 day instead of 2. 14ms
✓ 10. 130 teams register concurrently → 128 CONFIRMED + 2 WAITLISTED — 898ms for 130 requests; waitlisted: Sim Team 129 euclf, Sim Team 130 euclf 899ms
✓ 11. entries list: confirmed by registration time, then waitlist #1, #2 31ms
✓ 12. duplicate registration → 409 CONFLICT 12ms
✓ 13. waitlisted team sees WAITLISTED (position 1) — nextGoal: "You're #1 on the waitlist. You'll get a spot automatically if a team drops out before the draw." 17ms
✓ 14. a confirmed team withdraws → waitlist #1 auto-confirmed — Sim Team 009 euclf out, Sim Team 129 euclf in; withdrawn sees WITHDRAWN 43ms
✓ 15. team changes its time preferences (PUT entry) 13ms
✓ 16. invites: stage 1 rejected, invitee into the Final accepted — invitee state INVITED 36ms
✓ 17. admin list shows Sim Cup with live counts — 1 tournaments visible to admin 9ms
✓ 18. admin closes registration (admin mirror) → late sign-up 409 — close → reopen → close 52ms
✓ 19. draw Qualifier → 8 groups × 16, unique slots, every confirmed team once — seed sim-qa-final; reopen after draw refused 81ms
✓ 20. time preferences honoured (stats + first-come guarantee) — 110 teams with preferences: 74 got 1st choice, 91 got a ranked choice, 19 unmet (83%) 2ms
✓ 21. guards after the draw: withdraw refused, stage 2 draw refused, complete refused 33ms
✓ 22. redraw with the same seed is identical (deterministic draw) 85ms
✓ 23. start Qualifier → stage LIVE, tournament LIVE 35ms
✓ 24. playing team: PLAYING, group, slot, nextGoal, nextMatch — nextGoal: "Finish in the top 4 of Group C to reach the Semi-final" 18ms
✓ 25. play Qualifier: 31 of 32 matches (lineup → results → publish), group A engineered tie — 31 matches in 2533ms 2533ms
✓ 26. promotion preview blocks while a match is unpublished — blocker: "Group H match 4 isn't published" 121ms
✓ 27. play the last Qualifier match 510ms
✓ 28. Qualifier standings match locally computed points (all 128 teams) 72ms
✓ 29. promotion preview: ready, 32 qualified (top 4 × 8), tie at cut-off flagged in Group A — ties: ["Group A: Sim Team 045 euclf (in) and Sim Team 046 euclf (out) are tied for 4th place on 18 points, 0 wins, 10 placement points and 8 kills. Check the tie-break before promoting."] 51ms
✓ 30. promote Qualifier (double-click: 2 concurrent requests) → COMPLETED, ADVANCED/ELIMINATED — nextAction DRAW 239ms
✓ 31. promote twice → refused; other manager can't open a tournament match 55ms
✓ 32. team views: qualified / eliminated / waitlisted (state + nextGoal) — qualified=QUALIFIED "You're through to the Semi-final. Wait for the draw."; eliminated nextGoal=null; waitlisted nextGoal="You're #1 on the waitlist. You'll get a spot automatically if a team drops out before the draw." 25ms
✓ 33. admin removes the waitlisted team's entry (admin mirror DELETE) — removed team now sees NOT_REGISTERED 65ms
✓ 34. draw Semi-final → snake seeding (A1,B1,B2,A2,…) by qualifier rank — A seeds 1,4,5,8,9,12,13,16,17,20,21,24,25,28,29,32 46ms
✓ 35. play Semi-final (12 matches) + verify standings 1584ms
✓ 36. promotion preview: 14 TOP + 1 WILDCARD = best 8th-or-lower by points per match — wildcard Sim Team 036 euclf (B8, 5.50 ppm) 115ms
✓ 37. draw Final → 16 teams, invited team takes seed 1 26ms
✓ 38. play Final (6 matches) + verify standings 1249ms
✓ 39. finish Final (promote last stage) → COMPLETED, nextAction COMPLETE — nextAction COMPLETE 43ms
✓ 40. admin completes the tournament → champion = Final #1 — 🏆 Sim Team 128 euclf (47 pts) 13ms
✓ 41. team views after the final: CHAMPION / ELIMINATED, completed list 45ms
✓ 42. public stage view + published scorecard visible to any team — top fragger T120_P3 9 kills; 10 fraggers, 10 top teams 54ms
✓ 43. admin views: detail, entries, every stage 100ms
✓ 44. admin can cancel any manager's tournament (separate draft) 31ms
✓ 45. broken format → issues with errors, publish refused (400) — Semi-final is set for 30 teams but the tournament takes 32 teams. 15ms
✓ 46. race: 2 simultaneous withdrawals with 2 waitlisted → both promoted, still full 154ms

Timings
  create teams                   11.95s
  130 concurrent registrations   0.90s
  draw stage 1                   0.07s
  play stage 1                   2.53s
  play stage 2                   1.54s
  total                          32.93s  (824 HTTP requests)

PASSED  46 passed, 0 failed
```

### Findings

No functional API bugs found. Verified under concurrency: 130 simultaneous registrations, double-click promote
(exactly one 200), double-click draw (exactly one draw, 32 teams placed), double-click registration (one entry),
and two simultaneous withdrawals with two waitlisted teams (both promoted, still full).

Cosmetic / notes for the API owner:
- Tie warning text says "1 wins" when a team has one win (e.g. `... on 24 points, 1 wins, 10 placement points ...`).
- In the last stage, the champion's `GroupTeam.status` is `ADVANCED` and everyone else `ELIMINATED`. UIs should
  show these as "Champion" / "Finished", not "Qualified" / "Out" (the admin console does this).
- `topFraggers` is empty unless the per-player kills are saved with the results (team kills alone are not enough).
  This is expected, but managers who only type team kills will see no fraggers.
- An eliminated team gets `nextGoal = null`. That is fine, but a short line like "Eliminated in the Qualifier" would help the team.

### Admin console check (Playwright against the sim API, desktop 1366 px + phone 390 px)
The dashboard Tournaments card, the list (status/manager filters, search), and the completed Sim Cup detail page
(stage flow, champion banner, stage groups and standings, registrations) all rendered with no page errors. The open
"Sim Race" page shows Close registration and Cancel, and Cancel opens the confirmation dialog.
