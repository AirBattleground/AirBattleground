import { Building2, Image as ImageIcon } from "lucide-react";
import { useOrgLogo, useRemoveOrgLogo, useScrimPoster, useTournamentPoster, useUploadOrgLogo } from "../branding";
import { BrandingImageCard } from "./BrandingImageCard";

/** The manager's organisation logo (one per manager). */
export function OrgLogoCard({ className, tour }: { className?: string; tour?: string }) {
  const q = useOrgLogo();
  const upload = useUploadOrgLogo();
  const remove = useRemoveOrgLogo();
  return (
    <BrandingImageCard
      title="Organisation logo"
      icon={<Building2 />}
      description="Teams see this logo on your scrims and tournaments. A square PNG works best."
      aspect="logo"
      url={q.isError ? null : q.data?.url}
      pending={upload.isPending || remove.isPending}
      onUpload={(f) => upload.mutate(f)}
      onRemove={() => remove.mutate()}
      className={className}
      tour={tour}
    />
  );
}

export function ScrimPosterCard({ scrimId, url, compact, className, tour }: { scrimId: string; url: string | null; compact?: boolean; className?: string; tour?: string }) {
  const p = useScrimPoster(scrimId);
  return (
    <BrandingImageCard
      title="Scrim poster"
      icon={<ImageIcon />}
      description="Teams see this poster when they browse and register. Square artwork looks best."
      aspect="square"
      compact={compact}
      url={url}
      pending={p.pending}
      onUpload={(f) => p.upload.mutate(f)}
      onRemove={() => p.remove.mutate()}
      className={className}
      tour={tour}
    />
  );
}

export function TournamentPosterCard({ tournamentId, url, compact, className, tour }: { tournamentId: string; url: string | null; compact?: boolean; className?: string; tour?: string }) {
  const p = useTournamentPoster(tournamentId);
  return (
    <BrandingImageCard
      title="Tournament poster"
      icon={<ImageIcon />}
      description="Teams see this poster on the tournament page. Square artwork looks best."
      aspect="square"
      compact={compact}
      url={url}
      pending={p.pending}
      onUpload={(f) => p.upload.mutate(f)}
      onRemove={() => p.remove.mutate()}
      className={className}
      tour={tour}
    />
  );
}
