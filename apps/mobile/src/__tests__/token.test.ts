import { daysLeft, isExpired, parseStoredSession } from "@/lib/token";

const now = Date.parse("2026-10-17T10:00:00Z");
describe("token", () => {
  it("detects expiry with skew", () => {
    expect(isExpired(null, now)).toBe(true);
    expect(isExpired({ token: "", expiresAt: "2027-01-01T00:00:00Z" }, now)).toBe(true);
    expect(isExpired({ token: "t", expiresAt: "2026-10-17T10:00:30Z" }, now)).toBe(true); // within 60s skew
    expect(isExpired({ token: "t", expiresAt: "2026-10-18T10:00:00Z" }, now)).toBe(false);
    expect(isExpired({ token: "t", expiresAt: "garbage" }, now)).toBe(false);
  });
  it("counts days left", () => {
    expect(daysLeft({ token: "t", expiresAt: "2026-10-27T11:00:00Z" }, now)).toBe(10);
    expect(daysLeft({ token: "t", expiresAt: "2026-10-01T00:00:00Z" }, now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
  it("parses stored sessions defensively", () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession("{bad")).toBeNull();
    expect(parseStoredSession(JSON.stringify({ expiresAt: "x" }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ token: "abc", expiresAt: "2026-11-01T00:00:00Z" }))).toEqual({ token: "abc", expiresAt: "2026-11-01T00:00:00Z" });
  });
});
