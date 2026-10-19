/**
 * Branding images (org logos, scrim/tournament posters) for any signed-in app user. File names are
 * random ids, so a URL is only known to people who could already see the scrim/tournament.
 */
import { Router } from "express";
import { APP_COOKIE } from "@7xen/shared";
import { sendStoredFile } from "../lib/storage.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { brandingFile } from "../services/branding.js";

export function mediaRouter() {
  const r = Router();
  r.use(requireAuth(["MANAGER", "PLAYER"], APP_COOKIE));
  r.get("/branding/:file", async (req, res) => {
    const { key, mime } = brandingFile(req.params.file as string);
    await sendStoredFile(res, key, mime);
  });
  return r;
}
