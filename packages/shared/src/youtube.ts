/**
 * Phase 7b — site YouTube channel. The admin connects ONE YouTube channel (Google OAuth, scope youtube). While
 * "Stream every match" is on, every broadcast output that is showing a match (manager → device → Start output) is also
 * streamed to that channel as its own YouTube live broadcast, titled from the match (organiser, event, stage/match, map).
 * The broadcast starts when video arrives and ends when the output stops. Settings live in AppSetting "youtube".
 *
 * ADMIN (role ADMIN)
 *   GET    /api/admin/youtube                                 → YoutubeStatus
 *   PATCH  /api/admin/youtube           UpdateYoutubeInput    → YoutubeStatus
 *   POST   /api/admin/youtube/connect                         → { url }  (Google consent page; 409 when not configured)
 *   GET    /api/admin/youtube/callback?code=&state=           → 302 /admin-ui/youtube?connected=1 | ?error=<message>
 *   DELETE /api/admin/youtube                                 → YoutubeStatus (disconnect; the Google grant is revoked)
 * Server env: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (a "Web application" OAuth client with redirect URI
 * <PUBLIC_URL>/api/admin/youtube/callback) and PUBLIC_URL (e.g. https://airbattleground.com).
 *
 * DeviceOutput gains (optional) `youtube`: the match's YouTube broadcast while the output runs.
 */
import { z } from "zod";

export const YOUTUBE_PRIVACY = ["public", "unlisted", "private"] as const;
export type YoutubePrivacy = (typeof YOUTUBE_PRIVACY)[number];
export const YOUTUBE_PRIVACY_LABELS: Record<YoutubePrivacy, string> = {
  public: "Public — anyone can find it",
  unlisted: "Unlisted — only people with the link",
  private: "Private — only the channel",
};

/** {org} organiser · {event} scrim / tournament name · {details} date or stage + match number · {map} map name */
export const YOUTUBE_TITLE_TOKENS = ["{org}", "{event}", "{details}", "{map}"] as const;
export const DEFAULT_YOUTUBE_TITLE = "{org} · {event} · {details} · {map}";
/** YouTube's limit */
export const YOUTUBE_TITLE_MAX = 100;

export const updateYoutubeSchema = z.object({
  autoStream: z.boolean().optional(),
  privacy: z.enum(YOUTUBE_PRIVACY).optional(),
  titleTemplate: z.string().trim().min(3, "Write a title").max(200).optional(),
});
export type UpdateYoutubeInput = z.infer<typeof updateYoutubeSchema>;

export interface YoutubeStatus {
  /** the server has a Google client id + secret (otherwise Connect can't work) */
  configured: boolean;
  /** what to add as "Authorised redirect URI" in Google Cloud */
  redirectUri: string;
  connected: boolean;
  channel: { id: string; title: string; thumbnailUrl: string | null; url: string } | null;
  connectedAt: string | null;
  autoStream: boolean;
  privacy: YoutubePrivacy;
  titleTemplate: string;
  /** example title for a sample match */
  titlePreview: string;
  /** last problem talking to YouTube (plain English), cleared on the next success */
  lastError: string | null;
}

/** The YouTube broadcast of a running device output. */
export interface OutputYoutube {
  title: string;
  /** null when the broadcast couldn't be created (see error) */
  watchUrl: string | null;
  /** false while YouTube couldn't be reached (error says why) */
  ok: boolean;
  error: string | null;
}

/** Fill a title template; result trimmed to YouTube's 100 characters. */
export function youtubeTitle(template: string, v: { org: string; event: string; details: string; map: string }): string {
  const out = template
    .replaceAll("{org}", v.org)
    .replaceAll("{event}", v.event)
    .replaceAll("{details}", v.details)
    .replaceAll("{map}", v.map)
    .replace(/[<>]/g, "") // YouTube rejects angle brackets in titles
    .replace(/\s+/g, " ")
    .trim();
  return (out || v.event).slice(0, YOUTUBE_TITLE_MAX);
}
