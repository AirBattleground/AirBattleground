import { useEffect, useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@7xen/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { copyText } from "@/lib/format";

/** Icon button that copies `value` and briefly shows a tick. */
export function CopyButton({
  value,
  label = "Copy",
  onCopied,
  ...rest
}: { value: string; label?: string; onCopied?: () => void } & Omit<ComponentProps<typeof Button>, "value" | "onClick">) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          disabled={!value}
          onClick={async () => {
            if (await copyText(value)) {
              setDone(true);
              onCopied?.();
            } else toast.error("Couldn't copy. Select the text and copy it manually.");
          }}
          {...rest}
        >
          {done ? <Check className="text-success" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{done ? "Copied!" : label}</TooltipContent>
    </Tooltip>
  );
}
