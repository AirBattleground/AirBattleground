import { z } from "zod";
import { MAPS, MAX_ROOM_SLOTS, RECURRENCES, SCRIM_STATUSES, TEAM_REQUEST_STATUSES } from "./enums";
import { DATE_RE, TIME_RE } from "./schedule";
import { winCoinsSchema } from "./coins";

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "At least 3 characters")
  .max(32, "At most 32 characters")
  .regex(/^[a-z0-9_.]+$/, "Only letters, numbers, _ and .");
const password = z.string().min(8, "At least 8 characters").max(128);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));
const optionalEmail = z
  .string()
  .trim()
  .email("Enter a valid email")
  .optional()
  .or(z.literal("").transform(() => undefined));
/** For PATCH: omitted = keep, "" or null = clear, value = set. */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const clearableEmail = z
  .union([z.literal("").transform(() => null), z.string().trim().email("Enter a valid email")])
  .nullable()
  .optional();
export const dateString = z.string().regex(DATE_RE, "Use YYYY-MM-DD");
export const timeString = z.string().regex(TIME_RE, "Use HH:mm (24h)");

// ---------- auth ----------
export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- admin: managers ----------
export const createManagerSchema = z.object({
  displayName: z.string().trim().min(2, "At least 2 characters").max(60),
  username,
  password,
  email: optionalEmail,
  phone: optionalText(20),
});
export type CreateManagerInput = z.infer<typeof createManagerSchema>;

export const updateManagerSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  email: clearableEmail,
  phone: clearableText(20),
  isActive: z.boolean().optional(),
});
export type UpdateManagerInput = z.infer<typeof updateManagerSchema>;

// ---------- admin: teams ----------
export const createTeamSchema = z.object({
  teamName: z.string().trim().min(2, "At least 2 characters").max(40, "At most 40 characters"),
  tag: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "2–5 characters")
    .max(5, "2–5 characters")
    .regex(/^[A-Z0-9]+$/, "Letters and numbers only"),
  captainName: optionalText(60),
  username,
  password,
  email: optionalEmail,
  phone: optionalText(20),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  teamName: z.string().trim().min(2).max(40).optional(),
  tag: z.string().trim().toUpperCase().min(2).max(5).regex(/^[A-Z0-9]+$/).optional(),
  captainName: clearableText(60),
  email: clearableEmail,
  phone: clearableText(20),
  isActive: z.boolean().optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

/** Live availability check while typing (team name and/or username). */
export const teamAvailabilityQuerySchema = z.object({
  teamName: z.string().trim().max(40).optional(),
  username: z.string().trim().toLowerCase().max(32).optional(),
});
export type TeamAvailabilityQuery = z.infer<typeof teamAvailabilityQuerySchema>;

export const teamRequestListQuerySchema = z.object({
  status: z.enum(TEAM_REQUEST_STATUSES).default("PENDING"),
});

export const rejectTeamRequestSchema = z.object({
  reason: optionalText(200),
});
export type RejectTeamRequestInput = z.infer<typeof rejectTeamRequestSchema>;

export const resetPasswordSchema = z.object({ password });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------- manager: scrims ----------
const scrimBase = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(80),
  description: optionalText(1000),
  maps: z.array(z.enum(MAPS)).min(1, "Add at least one match").max(8, "At most 8 matches"),
  startTime: timeString,
  recurrence: z.enum(RECURRENCES),
  startDate: dateString,
  /** Ignored for ONCE. Null/omitted = runs indefinitely. */
  endDate: dateString.nullable().optional(),
  slotCount: z.number().int().min(2, "At least 2 slots").max(MAX_ROOM_SLOTS),
  /** First slot number teams get (organisers often reserve slots 1–2). */
  firstSlot: z.number().int().min(1).max(MAX_ROOM_SLOTS).default(1),
  /** phase 7: BG coins for the winner of each match (see coins.ts) */
  winCoins: winCoinsSchema.default(0),
});

export const createScrimSchema = scrimBase.superRefine((v, ctx) => {
  if (v.firstSlot + v.slotCount - 1 > MAX_ROOM_SLOTS) {
    ctx.addIssue({
      code: "custom",
      path: ["slotCount"],
      message: `Slots would go past #${MAX_ROOM_SLOTS}`,
    });
  }
  if (v.recurrence !== "ONCE" && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before start date" });
  }
});
export type CreateScrimInput = z.infer<typeof createScrimSchema>;

export const updateScrimSchema = scrimBase
  .partial()
  .extend({
    status: z.enum(SCRIM_STATUSES).optional(),
    /** phase 2: points table rules for this scrim (default DEFAULT_POINTS_SYSTEM) */
    pointsSystem: z
      .object({ placement: z.array(z.number().int().min(0).max(100)).min(1).max(25), killPoints: z.number().int().min(0).max(10) })
      .optional(),
  });
export type UpdateScrimInput = z.infer<typeof updateScrimSchema>;

export const rejectRegistrationSchema = z.object({
  reason: optionalText(200),
});
export type RejectRegistrationInput = z.infer<typeof rejectRegistrationSchema>;

// ---------- team ----------
export const createRegistrationSchema = z.object({
  scrimId: z.string().min(1),
  date: dateString,
});
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

// ---------- query params ----------
export const dateQuerySchema = z.object({ date: dateString });
/** scrim detail: a date it runs on (omitted = its next date that hasn't started) */
export const scrimDetailQuerySchema = z.object({ date: dateString.optional() });
export const searchQuerySchema = z.object({ q: z.string().trim().max(60).optional() });
export const registrationScopeSchema = z.object({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
});
