/**
 * Lets the shell tell an explicit "Sign out" apart from the session expiring (401),
 * so only the latter shows a "session expired" toast.
 */
let explicitLogoutAt = 0;

export function markExplicitLogout() {
  explicitLogoutAt = Date.now();
}

export function wasExplicitLogout() {
  return Date.now() - explicitLogoutAt < 10_000;
}
