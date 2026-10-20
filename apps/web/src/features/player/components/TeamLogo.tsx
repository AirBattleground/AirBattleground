import { useState } from "react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { squadMsg } from "@/i18n/team";

const SIZES = { sm: "size-8", md: "size-10", lg: "size-14", xl: "size-20" } as const;

/** The team's uploaded logo, falling back to gradient tag initials. */
export function TeamLogo({
  name,
  tag,
  logoUrl,
  size = "md",
  className,
}: {
  name: string;
  tag?: string;
  logoUrl: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const t = useT(squadMsg);
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={t("logo_alt", { name })}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-xl bg-background object-cover ring-1 ring-border", SIZES[size], className)}
      />
    );
  }
  return <TeamAvatar name={name} tag={tag} size={size === "xl" ? "lg" : size} className={cn(SIZES[size], size === "xl" && "text-xl", className)} />;
}
