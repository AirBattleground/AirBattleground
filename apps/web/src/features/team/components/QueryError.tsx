import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { cn } from "@7xen/ui/lib/utils";

export function QueryError({ error, onRetry, className, title = "Couldn't load this" }: { error: unknown; onRetry: () => void; className?: string; title?: string }) {
  const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center", className)}>
      <div className="rounded-2xl bg-destructive/10 p-3 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div>
        <p className="font-display text-lg font-bold">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RotateCw /> Try again
      </Button>
    </div>
  );
}
