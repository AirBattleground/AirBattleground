import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

/** Tests run against the same Postgres but in an isolated `test` schema. */
function testDatabaseUrl(): string {
  const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "");
  if (!process.env.TEST_DATABASE_URL) url.searchParams.set("schema", "test");
  return url.toString();
}

const DATABASE_URL = testDatabaseUrl();
process.env.DATABASE_URL = DATABASE_URL;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-test-secret-test-secret",
      CORS_ORIGINS: "http://localhost:5173",
      // phase 2: files go to a throwaway dir; the extractor is deliberately unreachable (tests stub it)
      STORAGE_DIR: path.join(tmpdir(), "7xen-api-test-storage"),
      EXTRACTOR_URL: "http://127.0.0.1:9",
      SCREENSHOT_WORKER: "0",
    },
  },
});
