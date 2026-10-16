import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
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
  /** phase 2: screenshot reader service */
  EXTRACTOR_URL: z.string().url().default("http://localhost:8090"),
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
