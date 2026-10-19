import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** phase 4: lifetime of the manager app's bearer token (POST /api/auth/token) */
  MOBILE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  /** send session cookies as Secure (needs https). Defaults to on in production; set 0 for plain-http LAN use */
  COOKIE_SECURE: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  /** phase 2: where screenshots and training images live (default <repo>/storage) */
  STORAGE_DIR: z.string().optional(),
  /** phase 2: screenshot reader = the `claude` CLI (default ~/.local/bin/claude, else PATH); must be logged in */
  CLAUDE_BIN: z.string().optional(),
  /** model alias or full id passed to `claude --model` */
  CLAUDE_MODEL: z.string().default("sonnet"),
  /** phase 4: where match videos live (default <STORAGE_DIR>/videos); can point to a bigger disk */
  VIDEO_DIR: z.string().optional(),
  /** phase 4: ffmpeg binary used for video duration/size + poster */
  FFMPEG_PATH: z.string().default("ffmpeg"),
  /** phase 4b: the AirBattleground Station service on the host PC (read lazily by lib/stationClient.ts so tests can override) */
  STATION_URL: z.string().url().default("http://127.0.0.1:4500"),
  /** shared secret for API ↔ station calls (X-Station-Token); empty = station features disabled */
  STATION_TOKEN: z.string().default(""),
  /** phase 6: MediaMTX HLS output, read by the API only (it proxies HLS to managers) */
  MEDIA_HLS_URL: z.string().url().default("http://127.0.0.1:8888"),
  /** phase 6: the host's /proc for the admin health gauges (Docker mounts it at /host/proc) */
  HOST_PROC: z.string().default("/proc"),
  /** phase 6: MediaMTX control API (kick a phone's stream) */
  MEDIA_API_URL: z.string().url().default("http://127.0.0.1:9997"),
  /** phase 6b: MediaMTX RTMP as the API reaches it (compositor reads the phone, publishes the output) */
  MEDIA_RTMP_INTERNAL: z.string().default("rtmp://127.0.0.1:1935"),
  /** phase 6: RTMP base URL phones publish to (what /api/device/stream/start hands out) */
  MEDIA_RTMP_URL: z.string().default("rtmp://localhost:1935/live"),
  /** phase 5: Google OAuth client id for "Continue with Google" (players). Empty/unset = Google sign-in off */
  GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : null)),
  /** phase 5b: Google sign-in with this (verified) email = the ADMIN account (lowercase compare) */
  ADMIN_EMAIL: z
    .string()
    .default("airbattleground@gmail.com")
    .transform((s) => s.trim().toLowerCase()),
  /** the seeded admin's username (prisma/seed.ts); Google sign-in as ADMIN_EMAIL attaches to this account */
  ADMIN_USERNAME: z
    .string()
    .default("admin")
    .transform((s) => s.trim().toLowerCase()),
  /** phase 5b: Google OAuth client secret — optional, unused for now (ID-token sign-in needs only the client id) */
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : null)),
  /** phase 5: dev-only email login for players (POST /api/auth/dev-login). Never active in production */
  PLAYER_DEV_LOGIN: z
    .string()
    .default("0")
    .transform((s) => s === "1" || s.toLowerCase() === "true"),
  /** run the in-process screenshot worker (index.ts); set to 0 to disable */
  SCREENSHOT_WORKER: z
    .string()
    .default("1")
    .transform((s) => s !== "0" && s.toLowerCase() !== "false"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
