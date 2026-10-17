import type { AppRelease } from "@7xen/shared";

/** true when the server has a newer APK than the one installed. */
export function isUpdateAvailable(release: AppRelease | null | undefined, currentVersionCode: number): boolean {
  return !!release && Number.isFinite(release.versionCode) && release.versionCode > currentVersionCode;
}
