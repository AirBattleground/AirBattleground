import { useRef } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { MAX_BRANDING_IMAGE_BYTES } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { useTeamLogo } from "../api";
import { TeamLogo } from "./TeamLogo";
import { useT } from "@/i18n/core";
import { squadMsg } from "@/i18n/team";

const MB = Math.round(MAX_BRANDING_IMAGE_BYTES / (1024 * 1024));

/** Leader: the team logo with a camera button to upload / replace it, and a link to remove it. */
export function TeamLogoEditor({ name, tag, logoUrl }: { name: string; tag: string; logoUrl: string | null }) {
  const t = useT(squadMsg);
  const input = useRef<HTMLInputElement>(null);
  const { upload, remove, pending } = useTeamLogo();

  const onPick = (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return void toast.error(t("logo_type"));
    if (file.size > MAX_BRANDING_IMAGE_BYTES) return void toast.error(t("logo_size", { mb: MB }));
    upload.mutate(file);
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5" data-tour="team-logo">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        aria-label={logoUrl ? t("change_logo") : t("upload_logo")}
        className="group relative rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <TeamLogo name={name} tag={tag} logoUrl={logoUrl} size="lg" className="shadow-glow" />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow">
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Camera className="size-3" />}
        </span>
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
      {logoUrl ? (
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] text-muted-foreground" disabled={pending} onClick={() => remove.mutate()}>
          <Trash2 className="size-3" /> {t("remove")}
        </Button>
      ) : (
        <span className="text-[11px] text-muted-foreground">{t("add_logo")}</span>
      )}
    </div>
  );
}
