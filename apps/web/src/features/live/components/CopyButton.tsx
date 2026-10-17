import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@7xen/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { copyText } from "../format";

/** Copies `value` and briefly shows a tick. Icon-only unless `children` are given. */
export function CopyButton({
  value,
  label = "Copy",
  toastText,
  children,
  ...rest
}: { value: string; label?: string; toastText?: string; children?: ReactNode } & Omit<ComponentProps<typeof Button>, "value" | "onClick" | "children">) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  const icon = done ? <Check className="text-success" /> : <Copy />;
  const btn = (
    <Button
      type="button"
      variant="outline"
      size={children ? "sm" : "icon"}
      aria-label={children ? undefined : label}
      disabled={!value}
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          if (toastText) toast.success(toastText);
        } else toast.error("Couldn't copy", { description: "Select the text and copy it manually." });
      }}
      {...rest}
    >
      {children ? (done ? <><Check className="text-success" /> Copied!</> : children) : icon}
    </Button>
  );
  if (children) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>{done ? "Copied!" : label}</TooltipContent>
    </Tooltip>
  );
}
