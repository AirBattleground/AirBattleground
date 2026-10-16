import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";
import { generatePassword } from "@/lib/format";
import { CopyButton } from "./CopyButton";

type Props = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (v: string) => void;
  /** Show the Generate + Copy helpers (for creating logins). */
  generator?: boolean;
};

/**
 * Password input with show/hide toggle; optional "Generate" (strong random) and copy.
 * Extra props (id, aria-*) land on the <input> so it works inside shadcn <FormControl>.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { value, onValueChange, generator = false, className, ...rest },
  ref,
) {
  const [show, setShow] = useState(generator);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          ref={ref}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={cn("pr-10", show && "font-mono", className)}
          autoComplete={generator ? "new-password" : "current-password"}
          spellCheck={false}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {generator && (
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onValueChange(generatePassword());
              setShow(true);
            }}
          >
            <Wand2 /> Generate
          </Button>
          <CopyButton value={value} label="Copy password" />
        </>
      )}
    </div>
  );
});
