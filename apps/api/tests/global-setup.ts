import { execSync } from "node:child_process";

/**
 * Bring the isolated `test` schema up to date with the migrations (non-destructive;
 * creates the schema on first run). Each test truncates the tables it uses.
 */
export default function setup() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/[?&]schema=test\b/.test(url) && !process.env.TEST_DATABASE_URL) {
    throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  }
  try {
    execSync("pnpm exec prisma migrate deploy", {
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy failed:\n${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`);
  }
}
