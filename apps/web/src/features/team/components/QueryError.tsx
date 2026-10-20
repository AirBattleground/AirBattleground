import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";
import { common } from "@/i18n/common";
import { useT } from "@/i18n/core";
import { scrimUi } from "@/i18n/scrims";

export function QueryError({ error, onRetry, className, title }: { error: unknown; onRetry: () => void; className?: string; title?: string }) {
  const t = useT(scrimUi);
  const tc = useT(common);
  const message = error instanceof Error ? error.message : tc("something_wrong");
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center", className)}>
      <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div>
        <p className="font-display text-lg font-bold">{title ?? t("couldnt_load")}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RotateCw /> {tc("retry")}
      </Button>
    </div>
  );
}
