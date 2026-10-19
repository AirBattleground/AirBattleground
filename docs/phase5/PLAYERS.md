# Phase 5 — Player accounts & teams

Status: **in progress** (started 2026-10-19). Every agent working on this reads this file first and keeps to its
workstream's files. Update the checklist at the bottom when you finish something.

## What changes (product)

Today a *team is a login*: admin (or an approved manager request) creates a `TEAM` user with a username/password,
and the team's players are only names on a roster. From now on **players have their own accounts** and a team is a
group of players with a **leader**. This lets us track everything at player level.

| Who | How they get an account | How they sign in |
|---|---|---|
| Admin | seeded from env (unchanged) | username + password (unchanged) |
| Manager | created by the admin (unchanged) | username + password (unchanged) |
| **Player** (new) | **signs up themselves with Google** | **"Continue with Google"** |

Decisions (agreed with the owner, 2026-10-19):

1. **Sign-up** = Google sign-in → choose an **in-game name (IGN)**. That's it — the account exists.
2. **BGMI ID** (numeric player id from the game) is saved in the player's profile. It is **required before creating or
   joining a team** (asked at that moment if missing). One BGMI ID belongs to one account (unique).
3. **One team per player**, total: a player is either the leader of the team they created, or a member of one team
   they joined. Never two.
4. **Joining**: the leader shares an **invite link / code**; the player opens it and **requests to join**; the
   **leader approves or rejects**. Leader can remove members, transfer leadership, rotate the code, disband.
5. **Only the leader registers** for scrims and tournaments (and cancels / withdraws / checks in). Members see
   everything, and instead of "Register" they get **"Ask my leader"**, which sends the leader a suggestion for that
   scrim or tournament. The leader sees suggestions on the home page and can register from there in one tap.
6. **Old team logins are deleted.** `Role.TEAM` users, `TeamRequest` (manager → admin team requests) and the
   admin "create team" flow go away. Existing teams in the DB are removed (owner OK'd it; it's test data). Take a
   `pg_dump` into `backups/` before migrating.
7. Team names stay unique (`teamNameKey`) — now only across teams (no more team requests).

Max members per team: `MAX_TEAM_MEMBERS = 6` (squad of 4 + 2 subs; same as `MAX_ROSTER_PLAYERS`).

## Data model (apps/api/prisma/schema.prisma)

```prisma
enum Role { ADMIN MANAGER PLAYER }                 // TEAM removed (migration deletes those users)
enum TeamRole { LEADER MEMBER }
enum JoinRequestStatus { PENDING APPROVED REJECTED CANCELLED }
enum SuggestionKind { SCRIM TOURNAMENT }
enum SuggestionStatus { OPEN DONE DISMISSED }

model User {
  // existing fields; username + passwordHash become OPTIONAL (players have neither)
  username     String?   @unique
  passwordHash String?
  googleSub    String?   @unique        // Google "sub" claim
  email        String?   @unique        // players: verified Google email (lowercase)
  avatarUrl    String?                  // Google picture
  ign          String?                  // in-game name (required after onboarding)
  bgmiId       String?   @unique        // digits only, 5–15 chars
  membership   TeamMember?
  ledTeam      Team?     @relation("TeamLeader")
  joinRequests TeamJoinRequest[]
  suggestions  TeamSuggestion[]
  // remove: team Team?, teamRequests, reviewedTeamRequests
}

model Team {
  // remove userId/user (no login) and captainName; keep name/nameKey/tag + all existing relations
  leaderId    String   @unique          // one team led per player
  leader      User     @relation("TeamLeader", fields: [leaderId], references: [id])
  inviteCode  String   @unique          // 8 chars, A-Z0-9 without 0/O/1/I; rotatable
  logoKey     String?                   // optional team logo (storage key under branding/), later
  members     TeamMember[]
  joinRequests TeamJoinRequest[]
  suggestions TeamSuggestion[]
}

model TeamMember {
  id       String   @id @default(cuid())
  teamId   String
  team     Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId   String   @unique              // ONE team per player
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     TeamRole @default(MEMBER)     // exactly one LEADER per team (= Team.leaderId)
  joinedAt DateTime @default(now())
  @@index([teamId])
}

model TeamJoinRequest {
  id        String   @id @default(cuid())
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  status    JoinRequestStatus @default(PENDING)
  message   String?
  decidedAt DateTime?
  createdAt DateTime @default(now())
  @@index([teamId, status])
  @@index([userId, status])
  // at most one PENDING per user: enforced in the service (and a partial unique index in SQL)
}

model TeamSuggestion {
  id          String   @id @default(cuid())
  teamId      String
  team        Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  fromUserId  String
  fromUser    User     @relation(fields: [fromUserId], references: [id], onDelete: Cascade)
  kind        SuggestionKind
  scrimId     String?          // SCRIM: scrim + date ("YYYY-MM-DD", IST)
  date        String?
  tournamentId String?         // TOURNAMENT
  note        String?
  status      SuggestionStatus @default(OPEN)
  createdAt   DateTime @default(now())
  @@index([teamId, status])
}
```

Also:
- `Registration.registeredById String?` → the leader who registered (player-level audit).
- `TournamentEntry.registeredById String?` same.
- `MatchPlayer.userId String?` → linked when a lineup/result name matches a member's IGN (player-level stats).
- `TeamPlayer` (free-text roster) is **replaced by members**: rosters for lineup matching come from
  `TeamMember → User.ign/bgmiId`. Keep the table for now (old match data), stop writing to it; drop it in a later cleanup.
- `TeamRequest` model + `TeamRequestStatus` enum: **dropped**.

Migration (one Prisma migration, hand-checked SQL): backup → delete `TeamRequest`, delete teams (and their
registrations / entries / match rows via existing cascades — check each FK; set-null where history should stay),
delete `TEAM` users, alter enum, add tables/columns, partial unique index
`CREATE UNIQUE INDEX "TeamJoinRequest_one_pending" ON "TeamJoinRequest"("userId") WHERE status = 'PENDING';`.
Seed: admin + 2 managers (as now) + ~10 players (dev login emails `player1@7xen.dev`…) in 2–3 teams with leaders,
one pending join request, one open suggestion, so every screen has data.

## Auth

- **Google**: web uses Google Identity Services (button → ID token, `credential`). API verifies it
  (`google-auth-library` `OAuth2Client.verifyIdToken`, audience `GOOGLE_CLIENT_ID`, `email_verified` must be true),
  finds the user by `googleSub` (or creates a `PLAYER` with email, name, picture), sets the normal app session cookie
  (`APP_COOKIE`, same JWT as managers). New env: `GOOGLE_CLIENT_ID` (API + web reads it from `/api/auth/config`).
- **Dev login** (no Google client yet / tests): `POST /api/auth/dev-login { email, name? }`, enabled only when
  `PLAYER_DEV_LOGIN=1` and not production. Same result as Google sign-in. The web shows it under the Google button
  when `/api/auth/config` says `devLogin: true`.
- Managers keep `POST /api/auth/login` (username/password). The web login page leads with "Continue with Google"
  and has a small "Organiser? Sign in with username" toggle for managers.
- Onboarding: a player with no `ign` is sent to `/welcome` (choose IGN; optional BGMI ID) before anything else.
- `Role.PLAYER` replaces `Role.TEAM` everywhere (`requireAuth("PLAYER", APP_COOKIE)`, web route guards, `toUser`).
  `AuthUser` gains `player?: { ign, bgmiId, avatarUrl, team: { id, name, tag, role: "LEADER"|"MEMBER" } | null }`
  (additive) and keeps `team` (the player's team summary or null) so existing team pages keep working.

## API (contract lives in packages/shared — `src/players.ts` + catalogue lines in `api.ts`)

New, all `requireAuth("PLAYER", APP_COOKIE)` unless noted:

```
GET    /api/auth/config                                   (public) → { googleClientId: string|null, devLogin: boolean }
POST   /api/auth/google        { credential }             (public) → AuthResponse
POST   /api/auth/dev-login     { email, name? }           (public, dev only) → AuthResponse

GET    /api/player/me                                     → PlayerProfile
PATCH  /api/player/me          UpdatePlayerProfileInput   → PlayerProfile   (ign, bgmiId, displayName)

POST   /api/player/team        CreateTeamInput            → PlayerTeam (201)  needs bgmiId + no team; caller = leader
GET    /api/player/team                                   → PlayerTeam        404 NO_TEAM when not in a team
PATCH  /api/player/team        UpdateTeamInput            → PlayerTeam        leader
DELETE /api/player/team                                   → 204               leader; 409 if live registrations/entries
POST   /api/player/team/invite-code                       → PlayerTeam        leader: rotate code
POST   /api/player/team/leave                             → 204               member (leader must transfer first, or disband)
DELETE /api/player/team/members/:userId                   → PlayerTeam        leader removes a member
POST   /api/player/team/transfer   { userId }             → PlayerTeam        leader → member becomes leader
POST   /api/player/team/join-requests/:id/approve         → PlayerTeam        leader; 409 TEAM_FULL / ALREADY_IN_TEAM
POST   /api/player/team/join-requests/:id/reject          → PlayerTeam        leader

GET    /api/player/invites/:code                          → TeamInvitePreview (name, tag, leader ign/avatar, members count, full?)
POST   /api/player/join-requests   { code, message? }     → MyJoinRequest (201) needs bgmiId + no team; 1 pending max
GET    /api/player/join-requests                          → ListResponse<MyJoinRequest>
DELETE /api/player/join-requests/:id                      → 204               cancel own pending

GET    /api/player/team/suggestions?status=OPEN           → ListResponse<TeamSuggestionRow>
POST   /api/player/team/suggestions  CreateSuggestionInput → TeamSuggestionRow (201) any member; dedupe open per target
POST   /api/player/team/suggestions/:id/dismiss           → TeamSuggestionRow leader
```

Existing `/api/team/*` (dashboard, scrims, registrations, results, roster, tournaments, live, rooms) **keep their
paths and response shapes**. Changes:
- guard `requireAuth("PLAYER", APP_COOKIE)`; `teamId(req)` = the player's membership team; no team →
  `403 NO_TEAM` "Create or join a team first."
- **leader-only** mutations (registrations POST/DELETE, roster PUT, tournament register/withdraw/check-in, …) →
  `403 LEADER_ONLY` "Only your team leader can do this — tap “Ask my leader” instead."
- registering marks matching OPEN suggestions `DONE`.
- `TeamScrimOnDate` / tournament list items gain (additive) `mySuggestion?: { id, status } | null` and the team
  dashboard gains `openSuggestions: number` + `myTeamRole: "LEADER"|"MEMBER"`.

Admin (`/api/admin/*`): remove team create / team-requests endpoints; add `GET /api/admin/players?q=`,
`PATCH /api/admin/players/:id { isActive }`, team list shows leader + member count, `GET /api/admin/teams/:id`
shows members, `DELETE /api/admin/teams/:id` (disband). Manager: remove team-request endpoints; manager team search
keeps working (teams are still teams).

New error codes: `NO_TEAM`, `LEADER_ONLY`, `ALREADY_IN_TEAM`, `TEAM_FULL`, `BGMI_ID_REQUIRED`, `BGMI_ID_TAKEN`,
`INVITE_INVALID`, `JOIN_REQUEST_PENDING`.

## Web (apps/web)

- `/login`: "Continue with Google" (GIS button; dev-login form under it when enabled) + "Organiser? Use your
  username" toggle for managers. Players land on `/team` (unchanged area URL; it's the player hub now).
- `/welcome`: pick IGN (+ optional BGMI ID). Required once.
- `/join/:code`: invite preview → "Request to join" (asks BGMI ID inline if missing; sign-in first if logged out,
  then come back).
- Player with **no team**: `/team` home shows "Create your team" / "Join with a code" (and pending request state).
- `/team/my-team` (new nav item "My team"): members (avatar, IGN, BGMI ID, leader crown), invite link + code with
  Copy / Share / WhatsApp, pending join requests (Approve / Reject), leader actions (remove, make leader, rotate
  code, rename, disband), member action (leave).
- Leader gating everywhere a team acts: `ScrimCard`, tournament register/withdraw/check-in, roster editing — leader
  sees the normal buttons; members see **"Ask my leader"** (→ suggestion; shows "Asked · waiting for leader").
- Leader sees an **"Asked by your team"** panel on the home page (and a badge on the nav) listing open suggestions
  with Register / Dismiss.
- `/team/profile`: player profile (IGN, BGMI ID, Google avatar/email) + team summary.
- Every new page: `usePageTour`, skeletons, empty states, toasts, mobile first. Dark theme only for now.

## Admin (apps/admin)

Remove "Create team" and "Team requests" UI + routes. Add **Players** page (search, active toggle, which team).
Teams page: leader + members, disband (confirm dialog). Managers page unchanged.

## Workstreams (run in parallel after W0)

| # | Workstream | Owns (only edit these) | Depends on |
|---|---|---|---|
| W0 | Contracts | `packages/shared/src/{players.ts,api.ts,dto.ts,schemas.ts,enums*,index.ts}` | — |
| W1 | DB | `apps/api/prisma/**` (schema, migration, seed), `backups/` | W0 |
| W2 | API | `apps/api/src/**`, `apps/api/tests/**`, `apps/api/package.json` (google-auth-library), `.env.example` | W0, W1 |
| W3 | Web (player) | `apps/web/src/**`, `apps/web/index.html` | W0 |
| W4 | Admin + manager web cleanup | `apps/admin/src/**`; in `apps/web/src` only manager team-request bits (coordinate: W3 owns the rest) | W0 |

W1+W2 are done by one agent (schema and services move together). W3 and W4 build against the W0 contract and can
start immediately; they finish integration once W2 lands. Shared/ui changes outside W0 go through the W0 owner.

## Checklist

- [x] Plan agreed and saved (this file)
- [x] W0 contracts in packages/shared (players.ts; ROLES PLAYER; SessionUser.player; TeamRow reshaped; new error codes)
- [x] W1 backup + schema + migration + seed (backup `backups/pre-phase5-20261019-023330.dump`, migration `20261019000000_phase5_players`)
- [x] W2 auth (Google + dev login), player/team/membership/join/suggestion services + routes, leader guards on
      `/api/team/*`, admin/manager removals, tests (90/90 API tests pass; new suite `apps/api/tests/players.test.ts`)
- [x] W3 web: login, welcome, join link, no-team home, My team, leader gating + Ask my leader, suggestions panel, profile (verified e2e via dev login, 2026-10-19)
- [x] W4 admin: players page, teams with members, remove team create/requests; manager: remove team requests (verified with Playwright route mocks; re-check against the live API once W2 lands)
- [ ] End-to-end check with dev login: sign up → IGN → BGMI ID → create team → second player joins by link →
      leader approves → member asks leader about a scrim → leader registers → manager approves → slot shown to both
- [ ] Google OAuth client ID from the owner (`GOOGLE_CLIENT_ID`) — until then dev login is used locally

## Phase 5b — Google-only sign-in, role by email, manager invitations (2026-10-19)

Contract: `packages/shared/src/access.ts`.

- The only sign-in button anywhere is **"Continue with Google"** (web `/login` and the admin console login).
- Role comes from the verified Google email:
  - `ADMIN_EMAIL` (API env, default `airbattleground@gmail.com`) → **ADMIN** → admin console `/admin-ui/`
    (`/api/auth/google` also sets the admin cookie for this user).
  - an email with a **pending manager invitation** (or an existing manager) → **MANAGER** → `/manager`.
  - anyone else → **PLAYER** → `/welcome` (first time) or `/team`.
- **Manager invitations**: admin → Managers → *Invite manager* (Name, Organisation name, Email) → *Send the invite*
  (Send email = `mailto:` with a prepared message, WhatsApp, Copy). The invitee signs in with Google using that
  email and lands on the manager dashboard. A player with no team is converted; a player in a team must leave first.
  Pending invites can be revoked. (Automatic email sending needs an SMTP service — not set up yet.)
- Username/password endpoints remain in the API only (Android manager app, emergency admin access); no UI uses them.
- Dev email login stays dev-only (`PLAYER_DEV_LOGIN=1`) and follows the same email → role rules; off in the owner's env.
- Google OAuth client: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `apps/api/.env`; the client must list
  `http://localhost:5173` (and the production origin) under *Authorised JavaScript origins*.

- [x] 5b API: role resolution, admin Google login, manager invites, migration, tests
- [x] 5b UI: Google-only web + admin login, role landing, Invite manager + pending invites
- [ ] Owner: add `http://localhost:5173` to the OAuth client's authorised JavaScript origins

## Phase 5c — browse without a team (2026-10-19)

Owner: "Only registering for a tournament/scrim should require creating or joining a team."

- **API** (`/api/team/*`, no contract changes): reads work for a player with no team and answer with the team parts
  empty — `GET scrims?date=` (every scrim, `myRegistration: null`, `mySuggestion: null`), `GET registrations` →
  `{ items: [] }`, `GET results` → `{ items: [] }`, `GET roster` → `{ players: [], suggestions: [] }`, `GET rooms` /
  `GET live` → `{ items: [] }`, `GET tournaments?scope=` (normal lists; `mine` → `[]`), `GET tournaments/:id` (hub
  with `me` = `NOT_REGISTERED`, `entry: null`, `canRegister` = registration open, `rosterWarning: null`),
  `GET tournaments/:id/stages/:stageId` and published tournament scorecards (public anyway). Scrim session standings /
  scrim scorecards answer `403 FORBIDDEN` "Your team didn't play in this scrim" (not `NO_TEAM`).
  `GET dashboard` keeps `403 NO_TEAM`; every mutation keeps `NO_TEAM` / `LEADER_ONLY`.
- **Web**: no page is gated any more. Teamless players see the real Find scrims, Tournaments (hub/stages/matches),
  My registrations, Results and Live pages; team-only sections show a quiet line with a small “Create or join a team”
  link. Home shows the normal hub (player hero greeting by IGN, featured tournaments, scrims you can join, organisers)
  plus one slim “Play in scrims with your squad” banner (or the pending join request).
- **Register without a team** (scrim card, tournament registration panel): opens “You need a team to register” →
  *Create a team* (BGMI ID asked if missing) continues straight into the normal register confirmation (the creator is
  the leader), or *Join with a code* (code → team preview → request inside the dialog; then “the leader approves, then
  tap Ask my leader”).
- **My team** (nav) is the one place with the full create / join UI for a teamless player.

## Phase 5d — team logo + invite by BGMI ID (2026-10-19)

- **Team logo**: the leader taps the logo on My team to upload (png/jpg/webp, ≤ 5 MB) or remove it. Stored under
  `branding/` like org logos (`Team.logoKey`), served by `/api/media/branding/:file`; `PlayerTeam.logoUrl`.
  Endpoints: `PUT|DELETE /api/player/team/logo`. Deleted with the team on disband.
- **Invite by BGMI ID**: leader enters a player's BGMI ID → `TeamInvite` (PENDING). The player sees "You're invited"
  on My team (no-team view) and taps Accept / Decline; the leader can take an invite back. Joining or creating any team
  revokes the player's other pending invites. Endpoints: `POST /api/player/team/invites`, `DELETE .../invites/:id`,
  `GET /api/player/team-invites`, `POST /api/player/team-invites/:id/accept|decline`.
- Contract additions are backward compatible (`PlayerTeam.logoUrl`, `PlayerTeam.invites`, new DTOs in players.ts).
- Not yet: logo shown outside My team (scrim cards, leaderboards, admin).
