/**
 * Endpoint catalogue — the single source of truth both frontends and the API follow.
 * All paths are relative to the API origin and served under /api.
 *
 * Auth uses an httpOnly session cookie (JWT). Two separate cookies so admin and app
 * sessions never mix:  sx_app (MANAGER | TEAM)  and  sx_admin (ADMIN).
 *
 * APP AUTH (cookie sx_app)
 *   POST   /api/auth/login                 LoginInput            → AuthResponse   (MANAGER|TEAM only)
 *   POST   /api/auth/logout                                      → 204
 *   GET    /api/auth/me                                          → AuthResponse
 *
 * ADMIN AUTH (cookie sx_admin)
 *   POST   /api/admin/auth/login           LoginInput            → AuthResponse   (ADMIN only)
 *   POST   /api/admin/auth/logout                                → 204
 *   GET    /api/admin/auth/me                                    → AuthResponse
 *
 * ADMIN (role ADMIN)
 *   GET    /api/admin/stats                                      → AdminStats
 *   GET    /api/admin/managers?q=                                → ListResponse<ManagerRow>
 *   POST   /api/admin/managers             CreateManagerInput    → ManagerRow     (409 CONFLICT username taken)
 *   PATCH  /api/admin/managers/:id         UpdateManagerInput    → ManagerRow
 *   POST   /api/admin/managers/:id/reset-password ResetPasswordInput → 204
 *   GET    /api/admin/teams?q=                                   → ListResponse<TeamRow>
 *   POST   /api/admin/teams                CreateTeamInput       → TeamRow        (409 CONFLICT name/username taken; error.fields says which: teamName | username)
 *   PATCH  /api/admin/teams/:id            UpdateTeamInput       → TeamRow        (:id = team id)
 *   POST   /api/admin/teams/:id/reset-password ResetPasswordInput → 204
 *   GET    /api/admin/teams/availability?teamName=&username=        → TeamAvailability
 *   GET    /api/admin/team-requests?status=PENDING|APPROVED|REJECTED → ListResponse<TeamRequestRow> (default PENDING; oldest first for PENDING)
 *   POST   /api/admin/team-requests/:id/approve                     → TeamRow  (creates the login; 409 CONFLICT if name/username got taken meanwhile)
 *   POST   /api/admin/team-requests/:id/reject   RejectTeamRequestInput → TeamRequestRow (frees the name/username)
 *
 * MANAGER (role MANAGER; only sees own scrims)
 *   GET    /api/manager/dashboard                                → ManagerDashboard
 *   GET    /api/manager/scrims                                   → ListResponse<Scrim>
 *   POST   /api/manager/scrims             CreateScrimInput      → Scrim
 *   GET    /api/manager/scrims/:id                               → Scrim
 *   PATCH  /api/manager/scrims/:id         UpdateScrimInput      → Scrim
 *   GET    /api/manager/schedule?date=                           → ListResponse<ScrimOnDate>   (own scrims running that date)
 *   GET    /api/manager/scrims/:id/sessions/:date                → SessionDetail  (404 if scrim doesn't run that date)
 *   GET    /api/manager/requests                                 → ListResponse<PendingRequest> (all PENDING for upcoming sessions, soonest first)
 *   POST   /api/manager/registrations/:id/approve                → Registration   (409 SLOTS_FULL; auto-allots lowest free slot)
 *   POST   /api/manager/registrations/:id/reject  RejectRegistrationInput → Registration (works on PENDING or APPROVED; frees slot)
 *   GET    /api/manager/team-requests                            → ListResponse<TeamRequestRow> (own requests, newest first)
 *   POST   /api/manager/team-requests      CreateTeamInput       → TeamRequestRow (201; 409 CONFLICT + fields teamName|username if taken or pending elsewhere)
 *   DELETE /api/manager/team-requests/:id                        → 204 (withdraw; PENDING only)
 *   GET    /api/manager/teams?q=                                   → ListResponse<TeamSummary> (active teams, max 20; for tournament invites)
 *   GET    /api/manager/teams/availability?teamName=&username=   → TeamAvailability
 *
 * BRANDING (images; multipart field "file", PNG/JPEG/WebP, max MAX_BRANDING_IMAGE_BYTES)
 *   GET    /api/manager/branding                                 → ImageUrlResponse (own org logo)
 *   PUT    /api/manager/branding/logo      multipart file        → ImageUrlResponse
 *   DELETE /api/manager/branding/logo                            → ImageUrlResponse ({ url: null })
 *   PUT    /api/manager/scrims/:id/poster  multipart file        → ImageUrlResponse
 *   DELETE /api/manager/scrims/:id/poster                        → ImageUrlResponse
 *   PUT    /api/manager/tournaments/:id/poster multipart file    → ImageUrlResponse
 *   DELETE /api/manager/tournaments/:id/poster                   → ImageUrlResponse
 *   GET    /api/media/branding/:file       (any signed-in user)  → the image. Scrim.posterUrl, TournamentSummary.posterUrl
 *                                          and manager.logoUrl point here.
 *
 * TEAM (role TEAM)
 *   GET    /api/team/dashboard                                   → TeamDashboard
 *   GET    /api/team/scrims?date=                                → ListResponse<TeamScrimOnDate> (ACTIVE scrims of all managers on that date)
 *   POST   /api/team/registrations         CreateRegistrationInput → TeamRegistration (409 CONFLICT already registered; 409 REGISTRATION_CLOSED;
 *                                          re-registering after REJECTED/CANCELLED reuses the same registration id, back to PENDING)
 *   GET    /api/team/registrations?scope=upcoming|past           → ListResponse<TeamRegistration>
 *   DELETE /api/team/registrations/:id                           → 204  (cancel; PENDING or APPROVED, before start; frees slot)
 *
 *   GET    /api/health                                           → { ok: true }
 *
 * PHASE 2 (matches from screenshots, points table, rosters, training center) — full list with inputs and
 * DTOs in the header of ./phase2.ts. Summary:
 *   MANAGER  GET  /api/manager/scrims/:id/sessions/:date/matches | /standings
 *            GET  /api/manager/matches/:matchId · PUT …/lineup · PUT …/results · POST …/publish · POST …/unpublish
 *            POST /api/manager/matches/:matchId/screenshots (multipart files[] + kind)
 *                 → 201 { items: ScreenshotRow[], skipped: number }   (skipped = duplicates by sha256)
 *            GET  /api/manager/screenshots/:id/image · POST …/retry · DELETE /api/manager/screenshots/:id
 *            PATCH /api/manager/scrims/:id { pointsSystem }  (stored points of published matches are recomputed)
 *   TEAM     GET  /api/team/results · /api/team/sessions/:scrimId/:date/standings · /api/team/matches/:matchId
 *            GET|PUT /api/team/roster          (dashboard gains `results`)
 *   ADMIN    /api/admin/training/samples[/:id[/image|/prefill]] · /api/admin/training/preview
 *            /api/admin/extractor/status
 *   Errors: publish 400 VALIDATION_ERROR with fields keyed "teams.<slotNumber>.placement"; 413 VALIDATION_ERROR for
 *   an image over MAX_SCREENSHOT_BYTES; 503 EXTRACTOR_OFFLINE when preview/prefill can't run the reader (claude CLI missing / not logged in / failed).
 *
 * PHASE 3 (tournaments) — full list with inputs and DTOs in the header of ./phase3.ts. Summary:
 *   MANAGER  /api/manager/tournaments[/:id[/publish|/close-registration|/reopen-registration|/cancel|/complete]]
 *            /api/manager/tournaments/:id/entries[/:entryId] · /invites · /matches/:matchId/schedule
 *            /api/manager/tournaments/:id/stages/:stageId[/schedule|/draw|/redraw|/groups|/start|/promotion|/promote|/teams/:teamId/disqualify]
 *            Group matches use the match center above (MatchDetail.tournament is set for them).
 *   TEAM     GET /api/team/tournaments?scope= · GET /api/team/tournaments/:id · POST|PUT|DELETE /api/team/tournaments/:id/entry
 *            GET /api/team/tournaments/:id/stages/:stageId · GET /api/team/matches/:matchId (published tournament matches: any team)
 *   ADMIN    GET /api/admin/tournaments (all) + every manager tournament path under /api/admin/tournaments/... (any owner)
 *            Match center for ANY match (scrim or tournament): GET /api/admin/matches/:matchId · PUT …/lineup · PUT …/results ·
 *            POST …/publish · POST …/unpublish · POST …/screenshots · GET /api/admin/screenshots/:id/image · POST …/retry ·
 *            DELETE /api/admin/screenshots/:id   (same bodies/responses as the manager routes)
 */
export const API_PREFIX = "/api";
export const APP_COOKIE = "sx_app";
export const ADMIN_COOKIE = "sx_admin";
/** Max size of an org logo / poster upload. */
export const MAX_BRANDING_IMAGE_BYTES = 5 * 1024 * 1024;
