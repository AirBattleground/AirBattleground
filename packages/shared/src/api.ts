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
 */
export const API_PREFIX = "/api";
export const APP_COOKIE = "sx_app";
export const ADMIN_COOKIE = "sx_admin";
