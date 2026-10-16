# API reference

Human-readable companion to the contract files — if they disagree, the code wins:

- [`packages/shared/src/api.ts`](../packages/shared/src/api.ts) — endpoint catalogue
- [`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts) — request validation (Zod; shared by the API and the forms)
- [`packages/shared/src/dto.ts`](../packages/shared/src/dto.ts) — response shapes

## Conventions

| | |
| --- | --- |
| Base URL | `http://localhost:4000` in dev. Every path is under `/api`. The frontends call `/api/...` same-origin (Vite proxy in dev, nginx in the containers). |
| Format | JSON in, JSON out. Successful responses are the DTO itself — no envelope. |
| Auth | httpOnly, `SameSite=Lax` session cookie holding a JWT (TTL `SESSION_TTL_DAYS`, default 7). `sx_app` for MANAGER/TEAM, `sx_admin` for ADMIN. `Secure` in production. |
| Dates | `YYYY-MM-DD` (IST calendar date). Times of day `HH:mm` (24h, IST). Timestamps ISO-8601 UTC. See [domain.md](./domain.md#time-and-dates). |
| Ids | cuid strings. |
| Rate limit | `POST …/login` is limited to 10 requests/minute per IP → `429 RATE_LIMITED`. |

### Errors

Every error has the same body:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Please check the highlighted fields",
             "fields": { "username": "Username is required", "password": "Password is required" } } }
```

`message` is plain English and safe to show to users. `fields` (field path → message) is present only
for `VALIDATION_ERROR`; the forms map it onto inputs.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body/query failed the shared Zod schema, or body isn't valid JSON |
| 401 | `UNAUTHENTICATED` | No/expired/invalid session cookie, wrong credentials, or the account was deactivated |
| 403 | `FORBIDDEN` | Signed in but not allowed (e.g. a deactivated account trying to log in) |
| 404 | `NOT_FOUND` | Unknown route or id — including another manager's scrim or registration |
| 409 | `CONFLICT` | Duplicate username / team name, already registered, request changed concurrently |
| 409 | `SLOTS_FULL` | Approving when every slot of the session is taken |
| 409 | `REGISTRATION_CLOSED` | Registering/cancelling after the session started, or for a paused scrim |
| 413 | `VALIDATION_ERROR` | Body larger than 100 kB |
| 429 | `RATE_LIMITED` | Too many login attempts |
| 500 | `INTERNAL` | Unexpected error (logged server-side) |

### Quick try with curl

```bash
# app login (manager or team) — stores sx_app in jar.txt
curl -c jar.txt -H 'content-type: application/json' \
  -d '{"username":"soul","password":"Team@1234"}' http://localhost:4000/api/auth/login
curl -b jar.txt "http://localhost:4000/api/team/scrims?date=2026-10-17"
```

---

## Health

### `GET /api/health`
Public. `200 { "ok": true }`. Used by container health checks and CI.

---

## App auth (managers and teams — cookie `sx_app`)

### `POST /api/auth/login`
Body `LoginInput`: `{ "username": string, "password": string }` (username is trimmed + lowercased).
Only MANAGER and TEAM accounts may sign in here; admin credentials get `401`.

`200 AuthResponse`, sets `sx_app`:

```json
{
  "user": {
    "id": "cmvb9vjcg0003nwhjfb68tl0t",
    "username": "soul",
    "role": "TEAM",
    "displayName": "Team Soul",
    "team": { "id": "cmvb9vjci0005nwhj9khbirhr", "name": "Team Soul", "tag": "SOUL" }
  }
}
```

`team` is `null` for managers. Errors: `400`, `401` ("Wrong username or password"),
`403` (account disabled), `429`.

### `POST /api/auth/logout`
`204`, clears `sx_app`. Always succeeds.

### `GET /api/auth/me`
`200 AuthResponse` for the current session, else `401`.

## Admin auth (cookie `sx_admin`)

`POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, `GET /api/admin/auth/me` — identical
shapes to the app endpoints, but only ADMIN accounts are accepted and the cookie is `sx_admin`.

---

## Admin (role ADMIN)

### `GET /api/admin/stats` → `AdminStats`

```json
{
  "managers": { "total": 2, "active": 2 },
  "teams": { "total": 8, "active": 8 },
  "scrims": { "total": 4, "active": 4 },
  "registrations": { "pending": 6, "approvedUpcoming": 9 }
}
```

### `GET /api/admin/managers?q=` → `ListResponse<ManagerRow>`
`q` (optional, ≤ 60 chars) searches username / display name.

```json
{ "items": [ {
  "id": "cmvb9vj8l0001nwhjd4g60ysr", "username": "manager1", "displayName": "Rahul (Scrim Host)",
  "email": null, "phone": null, "isActive": true, "scrimCount": 3,
  "lastLoginAt": "2026-10-16T18:02:11.000Z", "createdAt": "2026-10-16T17:59:38.000Z"
} ] }
```

### `POST /api/admin/managers` → `201 ManagerRow`
Body `CreateManagerInput`:

| Field | Rules |
| --- | --- |
| `displayName` | 2–60 chars |
| `username` | 3–32 chars, `a-z 0-9 _ .`, stored lowercase |
| `password` | 8–128 chars |
| `email` | optional, valid email (`""` = none) |
| `phone` | optional, ≤ 20 chars |

`409 CONFLICT` "That username is already taken".

### `PATCH /api/admin/managers/:id` → `ManagerRow`
Body `UpdateManagerInput` — any of `displayName`, `email`, `phone`, `isActive`. Setting
`isActive: false` blocks login and revokes existing sessions immediately.

### `POST /api/admin/managers/:id/reset-password` → `204`
Body `{ "password": "NewPass@123" }` (8–128 chars).

### `GET /api/admin/teams?q=` → `ListResponse<TeamRow>`
`q` searches team name / tag / username.

```json
{ "items": [ {
  "id": "cmvb9vjci0005nwhj9khbirhr", "userId": "cmvb9vjcg0003nwhjfb68tl0t",
  "name": "Team Soul", "tag": "SOUL", "captainName": "Mortal", "username": "soul",
  "email": null, "phone": null, "isActive": true, "registrationCount": 5,
  "lastLoginAt": null, "createdAt": "2026-10-16T17:59:38.000Z"
} ] }
```

### `POST /api/admin/teams` → `201 TeamRow`
Creates the team **and** its login. Body `CreateTeamInput`:

| Field | Rules |
| --- | --- |
| `teamName` | 2–40 chars; unique ignoring case and repeated spaces |
| `tag` | 2–5 chars, letters/digits, uppercased |
| `captainName` | optional, ≤ 60 chars |
| `username`, `password`, `email`, `phone` | as for managers |

```json
{ "teamName": "Team Soul", "tag": "soul", "captainName": "Mortal", "username": "soul", "password": "Team@1234" }
```

`409 CONFLICT` "That team name is already taken" (e.g. `"team  SOUL"` after `"Team Soul"`) or
"That username is already taken".

### `PATCH /api/admin/teams/:id` → `TeamRow`
`:id` is the **team** id. Body `UpdateTeamInput` — any of `teamName`, `tag`, `captainName`, `email`,
`phone`, `isActive`. Renaming re-checks uniqueness (`409`).

### `POST /api/admin/teams/:id/reset-password` → `204`
Body `{ "password": "..." }`.

---

### `GET /api/admin/teams/availability?teamName=&username=` → `TeamAvailability`

Live check used by the create forms. Each field present in the query gets `{ available, message }`;
`message` is `"Already taken"` or `"Already requested — waiting for admin approval"`.

### `GET /api/admin/team-requests?status=PENDING|APPROVED|REJECTED` → `ListResponse<TeamRequestRow>`

Teams registered by managers. Default `PENDING`, oldest first (a queue); other statuses are newest
decision first, max 200.

### `POST /api/admin/team-requests/:id/approve` → `TeamRow`

Creates the team's `User` + `Team` from the request in one transaction. `TeamRow.requestedBy` names
the manager. `409 CONFLICT` if it was already reviewed, or if the name/username got taken meanwhile.

### `POST /api/admin/team-requests/:id/reject` → `TeamRequestRow`

Body `{ "reason"?: string }` (≤ 200 chars, shown to the manager). Frees the name and username.
`409` if already reviewed.

## Manager (role MANAGER — only their own scrims)

Another manager's scrim or registration id returns `404 NOT_FOUND`.

### `GET /api/manager/dashboard` → `ManagerDashboard`

```json
{
  "today": "2026-10-16",
  "todaySessions": [ /* ScrimOnDate[] for today */ ],
  "pendingCount": 4,
  "activeScrims": 3,
  "upcomingApproved": 7
}
```

### `GET /api/manager/scrims` → `ListResponse<Scrim>`
All of the manager's scrims (ACTIVE first, ARCHIVED last).

`Scrim`:

```json
{
  "id": "cmvb9vjqa000snwhjm3vs0atw",
  "title": "Daily Evening Showdown",
  "description": "4 matches every evening. Be in the lobby 15 minutes early.",
  "maps": ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"],
  "startTime": "18:00",
  "recurrence": "DAILY",
  "startDate": "2026-10-09",
  "endDate": null,
  "slotCount": 16,
  "firstSlot": 3,
  "status": "ACTIVE",
  "manager": { "id": "cmvb9vj8l0001nwhjd4g60ysr", "displayName": "Rahul (Scrim Host)" },
  "createdAt": "2026-10-16T17:59:38.914Z"
}
```

### `POST /api/manager/scrims` → `201 Scrim`
Body `CreateScrimInput`:

| Field | Rules |
| --- | --- |
| `title` | 3–80 chars |
| `description` | optional, ≤ 1000 chars |
| `maps` | 1–8 of `ERANGEL MIRAMAR SANHOK VIKENDI LIVIK KARAKIN NUSA RONDO` — one per match, in order |
| `startTime` | `HH:mm` 24h, IST |
| `recurrence` | `ONCE` \| `DAILY` \| `WEEKENDS` |
| `startDate` | `YYYY-MM-DD` |
| `endDate` | optional / `null` (= indefinitely); ignored for `ONCE`; must be ≥ `startDate` |
| `slotCount` | integer ≥ 2 |
| `firstSlot` | integer ≥ 1, default 1; `firstSlot + slotCount − 1 ≤ 25` |

```json
{ "title": "VR1 Showdown", "maps": ["ERANGEL", "MIRAMAR", "ERANGEL"], "startTime": "21:00",
  "recurrence": "WEEKENDS", "startDate": "2026-10-17", "endDate": null, "slotCount": 16, "firstSlot": 3 }
```

### `GET /api/manager/scrims/:id` → `Scrim`

### `PATCH /api/manager/scrims/:id` → `Scrim`
Body `UpdateScrimInput` — any subset of the create fields plus `status`
(`ACTIVE` \| `PAUSED` \| `ARCHIVED`).

### `GET /api/manager/schedule?date=YYYY-MM-DD` → `ListResponse<ScrimOnDate>`
The manager's scrims running on `date`, with live counts.

`ScrimOnDate`:

```json
{
  "scrim": { /* Scrim */ },
  "date": "2026-10-17",
  "startsAt": "2026-10-17T12:30:00.000Z",
  "registrationOpen": true,
  "counts": { "pending": 2, "approved": 3, "slotsLeft": 13 }
}
```

### `GET /api/manager/scrims/:id/sessions/:date` → `SessionDetail`
One scrim on one date: every registration plus a slot board. `404` if the scrim doesn't run on that
date.

```json
{
  "scrim": { /* Scrim */ }, "date": "2026-10-17", "startsAt": "2026-10-17T15:30:00.000Z",
  "registrationOpen": true, "counts": { "pending": 0, "approved": 1, "slotsLeft": 1 },
  "registrations": [
    { "id": "reg_c", "status": "APPROVED", "slotNumber": 3, "rejectionReason": null,
      "createdAt": "…", "decidedAt": "…",
      "team": { "id": "team_c", "name": "Team C", "tag": "TC", "captainName": "Captain C" } },
    { "id": "reg_b", "status": "CANCELLED", "slotNumber": null, "…": "…" }
  ],
  "slots": [
    { "slotNumber": 3, "team": { "id": "team_c", "name": "Team C", "tag": "TC" }, "registrationId": "reg_c" },
    { "slotNumber": 4, "team": null, "registrationId": null }
  ]
}
```

### `GET /api/manager/requests` → `ListResponse<PendingRequest>`
Approvals inbox: every `PENDING` registration for the manager's upcoming sessions, soonest first.

```json
{ "items": [ {
  "registration": { "id": "cmvb9vjqx001knwhjcysai8dx", "status": "PENDING", "slotNumber": null,
    "rejectionReason": null, "createdAt": "2026-10-16T17:59:38.937Z", "decidedAt": null,
    "team": { "id": "cmvb9vjob000nnwhj2ov7wbk7", "name": "Team XSpark", "tag": "TX", "captainName": "Scout" } },
  "scrim": { "id": "cmvb9vjqa000snwhjm3vs0atw", "title": "Daily Evening Showdown", "startTime": "18:00", "slotCount": 16 },
  "date": "2026-10-17",
  "startsAt": "2026-10-17T12:30:00.000Z",
  "counts": { "approved": 3, "slotsLeft": 13 }
} ] }
```

### `POST /api/manager/registrations/:id/approve` → `Registration`
Approves a `PENDING` (or previously `REJECTED`) registration and **allots the lowest free slot**
(see [slot allotment](./domain.md#slot-allotment)). Idempotent for an already approved registration.

```json
{ "id": "cmvb…", "status": "APPROVED", "slotNumber": 3, "rejectionReason": null,
  "createdAt": "…", "decidedAt": "2026-10-16T18:05:00.000Z",
  "team": { "id": "…", "name": "Team Soul", "tag": "SOUL", "captainName": "Mortal" } }
```

Errors: `409 SLOTS_FULL`, `409 CONFLICT` (team cancelled / request changed), `404`.

### `POST /api/manager/registrations/:id/reject` → `Registration`
Body `RejectRegistrationInput`: `{ "reason"?: string }` (≤ 200 chars, shown to the team).
Works on `PENDING` or `APPROVED` (frees the slot). `409 CONFLICT` if the team already cancelled.

---

### `GET /api/manager/team-requests` → `ListResponse<TeamRequestRow>`

The manager's own team registrations, newest first, with status and any rejection reason.

### `POST /api/manager/team-requests` → `201 TeamRequestRow`

Body: `CreateTeamInput` (same as the admin's create team). No login is created until the admin
approves. `409 CONFLICT` with `fields.teamName` / `fields.username` when the name or username is
taken by a team or by another pending request. Signing in with these details before approval →
`403` "Your team is waiting for admin approval…"; after a rejection → `403` with the reason.

### `DELETE /api/manager/team-requests/:id` → `204`

Withdraw a PENDING request (`409` once reviewed, `404` if it isn't yours).

### `GET /api/manager/teams/availability?teamName=&username=` → `TeamAvailability`

Same as the admin availability check.

## Team (role TEAM)

### `GET /api/team/dashboard` → `TeamDashboard`

```json
{
  "team": { "id": "…", "name": "Team Soul", "tag": "SOUL", "captainName": "Mortal" },
  "today": "2026-10-16",
  "nextMatch": { /* TeamRegistration | null — next APPROVED session */ },
  "upcoming": [ /* TeamRegistration[] */ ],
  "counts": { "approvedUpcoming": 2, "pending": 1, "totalPlayed": 5 }
}
```

### `GET /api/team/scrims?date=YYYY-MM-DD` → `ListResponse<TeamScrimOnDate>`
`ACTIVE` scrims of all active managers running on `date`. Each item is a `ScrimOnDate` plus the
team's own registration:

```json
{ "items": [ {
  "scrim": { /* Scrim */ }, "date": "2026-10-17", "startsAt": "2026-10-17T12:30:00.000Z",
  "registrationOpen": true, "counts": { "pending": 2, "approved": 3, "slotsLeft": 13 },
  "myRegistration": { "id": "cmvb9vjqr001enwhjiuh2hjo0", "status": "APPROVED", "slotNumber": 3, "rejectionReason": null }
} ] }
```

### `POST /api/team/registrations` → `201 TeamRegistration`
Body `CreateRegistrationInput`: `{ "scrimId": "…", "date": "2026-10-17" }`. Creates a `PENDING`
registration (or re-opens a rejected/cancelled one).

Errors: `409 CONFLICT` "You're already registered for this scrim", `409 REGISTRATION_CLOSED`
(session started or scrim paused), `404` (unknown scrim or it doesn't run that date).

### `GET /api/team/registrations?scope=upcoming|past` → `ListResponse<TeamRegistration>`
`scope` defaults to `upcoming`.

```json
{ "items": [ {
  "id": "cmvb9vjqr001enwhjiuh2hjo0", "status": "APPROVED", "slotNumber": 3, "rejectionReason": null,
  "date": "2026-10-17", "startsAt": "2026-10-17T12:30:00.000Z",
  "createdAt": "2026-10-16T17:59:38.932Z", "decidedAt": "2026-10-16T17:59:38.931Z",
  "scrim": { "id": "cmvb9vjqa000snwhjm3vs0atw", "title": "Daily Evening Showdown",
    "maps": ["ERANGEL", "MIRAMAR", "SANHOK", "ERANGEL"], "startTime": "18:00", "slotCount": 16, "firstSlot": 3,
    "manager": { "id": "cmvb9vj8l0001nwhjd4g60ysr", "displayName": "Rahul (Scrim Host)" } }
} ] }
```

### `DELETE /api/team/registrations/:id` → `204`
Cancels a `PENDING` or `APPROVED` registration before the session starts; frees the slot.
Errors: `409 REGISTRATION_CLOSED` (already started), `409 CONFLICT` (already cancelled/rejected),
`404` (not this team's registration).

---

## Enums

| Enum | Values |
| --- | --- |
| `Role` | `ADMIN` `MANAGER` `TEAM` |
| `Recurrence` | `ONCE` `DAILY` `WEEKENDS` |
| `ScrimStatus` | `ACTIVE` `PAUSED` `ARCHIVED` |
| `RegistrationStatus` | `PENDING` `APPROVED` `REJECTED` `CANCELLED` |
| `GameMap` | `ERANGEL` `MIRAMAR` `SANHOK` `VIKENDI` `LIVIK` `KARAKIN` `NUSA` `RONDO` |

Limits: `MAX_ROOM_SLOTS = 25`; 1–8 maps per scrim.
