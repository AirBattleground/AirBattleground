import { useState } from "react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";

const SIZES = { sm: "size-8", md: "size-10", lg: "size-14", xl: "size-20" } as const;

/** Google profile picture, falling back to gradient initials. */
export function PlayerAvatar({
  name,
  url,
  size = "md",
  className,
}: {
  name: string;
  url: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-xl object-cover ring-1 ring-border", SIZES[size], className)}
      />
    );
  }
  return <TeamAvatar name={name || "?"} size={size === "xl" ? "lg" : size} className={cn(SIZES[size], size === "xl" && "text-xl", className)} />;
}
