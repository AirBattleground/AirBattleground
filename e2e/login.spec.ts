import { expect, test } from "@playwright/test";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:5173";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:5174";

for (const [name, url] of [
  ["web (teams & managers)", WEB_URL],
  ["admin console", ADMIN_URL],
] as const) {
  test(`${name}: login page renders without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // unauthenticated visitors land on the login screen
    await page.goto(url);
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('input:not([type="password"])').first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|log in|login/i })).toBeVisible();
    expect(errors, "uncaught page errors").toEqual([]);
  });

  test(`${name}: deep link falls back to the SPA`, async ({ page }) => {
    const res = await page.goto(`${url}/some/deep/link`);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("#root")).not.toBeEmpty();
  });
}

test("admin console: wrong password shows an error", async ({ page }) => {
  await page.goto(ADMIN_URL);
  await page.locator('input:not([type="password"])').first().fill("admin");
  await page.locator('input[type="password"]').fill("definitely-wrong");
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await expect(page.getByText(/wrong username or password/i).first()).toBeVisible();
});

test("admin console: seeded admin can sign in and the session sticks across reloads", async ({ page }) => {
  await page.goto(ADMIN_URL);
  await page.locator('input:not([type="password"])').first().fill(process.env.ADMIN_USERNAME ?? "admin");
  await page.locator('input[type="password"]').fill(process.env.ADMIN_PASSWORD ?? "Admin@12345");
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("web portal: seeded team can sign in", async ({ page }) => {
  await page.goto(WEB_URL);
  await page.locator('input:not([type="password"])').first().fill(process.env.TEAM_USERNAME ?? "soul");
  await page.locator('input[type="password"]').fill(process.env.TEAM_PASSWORD ?? "Team@1234");
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
