import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@7xen/ui/lib/utils";
import { useT } from "@/i18n/core";
import { homeMsg } from "@/i18n/home";

/** Home section title: small brand eyebrow, big display title, optional "See all" link on the right. */
export function SectionHeader({
  eyebrow,
  title,
  icon,
  to,
  linkLabel,
  description,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  icon?: ReactNode;
  to?: string;
  linkLabel?: string;
  /** one plain line under the title */
  description?: ReactNode;
  className?: string;
}) {
  const t = useT(homeMsg);
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-primary uppercase">
          <span aria-hidden className="h-px w-6 bg-gradient-to-r from-transparent to-primary" />
          {eyebrow}
        </p>
        <h2 className="mt-1 flex items-center gap-2 font-display text-2xl leading-tight font-bold sm:text-3xl [&_svg]:size-6 [&_svg]:text-primary">
          {icon}
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {to && (
        <Link
          to={to}
          className="group inline-flex shrink-0 items-center gap-1 rounded-full border bg-card/70 px-3 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur transition-colors outline-none hover:border-primary/50 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:text-sm"
        >
          {linkLabel ?? t("see_all")} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
