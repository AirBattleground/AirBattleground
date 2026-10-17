// Copies the release APK to storage/apps/manager/ and writes latest.json for GET /api/app/manager/latest.
// Usage: npm run publish:apk -- "What's new in this version"
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = (await import(join(root, "app.json"), { with: { type: "json" } })).default.expo;
const version = app.version;
const versionCode = app.android.versionCode;
const src = join(root, "android/app/build/outputs/apk/release/app-release.apk");
const outDir = resolve(root, "../../storage/apps/manager");
const file = `7xen-manager-${version}.apk`;
statSync(src);
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, file));
const notes = process.argv.slice(2).join(" ") || null;
const latest = { version, versionCode, file, notes, publishedAt: new Date().toISOString() };
writeFileSync(join(outDir, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
console.log(`Published ${file} (${(statSync(join(outDir, file)).size / 1048576).toFixed(1)} MB) →`, outDir);
console.log(latest);
