import { useRef } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { useAvatar } from "../api";
import { squareAvatar } from "../avatarImage";
import { PlayerAvatar } from "./PlayerAvatar";
import { useT } from "@/i18n/core";
import { profileMsg } from "@/i18n/team";

/** An uploaded photo is served from our media route; anything else is the Google picture (or none). */
const isOwnPhoto = (url: string | null | undefined) => !!url && url.startsWith("/api/media/branding/");

/** My profile: the player's picture with a camera button to upload / replace it, and a link to remove an uploaded one. */
export function PlayerAvatarEditor({ name, url, className }: { name: string; url: string | null | undefined; className?: string }) {
  const t = useT(profileMsg);
  const input = useRef<HTMLInputElement>(null);
  const { upload, remove, pending } = useAvatar();

  const onPick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return void toast.error(t("photo_type"));
    let small: File;
    try {
      small = await squareAvatar(file);
    } catch {
      return void toast.error(t("photo_read_fail"));
    }
    upload.mutate(small);
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1" data-tour="player-photo">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        aria-label={url ? t("change_photo") : t("add_photo")}
        className="group relative rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <PlayerAvatar name={name} url={url} size="xl" className={cn("size-16 rounded-2xl shadow-glow", className)} />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow transition-transform group-hover:scale-110">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onPick(e.target.files?.[0])} />
      {isOwnPhoto(url) && (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground" disabled={pending} onClick={() => remove.mutate()}>
          <Trash2 className="size-3" /> {t("remove_photo")}
        </Button>
      )}
    </div>
  );
}
