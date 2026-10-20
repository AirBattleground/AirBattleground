import { Router } from "express";
import * as uiSkin from "../services/uiSkin.js";

/** Public site info (no sign-in): the web portal's look. */
export function siteRouter() {
  const r = Router();
  r.get("/skin", async (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.json(await uiSkin.getUiSkin());
  });
  return r;
}
