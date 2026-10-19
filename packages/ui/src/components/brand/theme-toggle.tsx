import { Check, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@7xen/ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@7xen/ui/components/ui/popover";
import { BRANDS, THEME_CONTROLS_ENABLED, useTheme } from "@7xen/ui/theme";

/** Round icon button that flips light/dark with a spin animation. */
export function ThemeToggle(props: { className?: string }) {
  return THEME_CONTROLS_ENABLED ? <ThemeToggleButton {...props} /> : null;
}

function ThemeToggleButton({ className }: { className?: string }) {
  const { resolvedTheme, toggle } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className={cn("relative inline-flex size-9 items-center justify-center overflow-hidden rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground hover:border-primary/50", className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? "moon" : "sun"}
          initial={{ rotate: -90, scale: 0, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          exit={{ rotate: 90, scale: 0, opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/**
 * Brand colour picker: an icon button (paint palette, tinted with the current brand) that opens the Teal preset and a
 * custom colour (native colour picker + hex field). Used at the bottom of the sidebars.
 */
export function BrandPicker(props: { className?: string; side?: "top" | "right" | "bottom" | "left" }) {
  return THEME_CONTROLS_ENABLED ? <BrandPickerPopover {...props} /> : null;
}

function BrandPickerPopover({ className, side = "right" }: { className?: string; side?: "top" | "right" | "bottom" | "left" }) {
  const { brand, setBrand, customColor, setCustomColor } = useTheme();
  const [hex, setHex] = useState(customColor);
  useEffect(() => setHex(customColor), [customColor]);
  const current = brand === "custom" ? "Custom" : (BRANDS.find((b) => b.id === brand)?.label ?? "Teal");
  const commitHex = (v: string) => {
    const h = v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`;
    if (/^#[0-9a-f]{6}$/i.test(h)) setCustomColor(h.toLowerCase());
    else setHex(customColor);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Brand colour: ${current}. Change`}
          title="Brand colour"
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground outline-none transition-colors hover:border-primary/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
        >
          <Palette className="size-4 text-primary" />
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align="end" sideOffset={10} className="w-64 p-3">
        <p className="mb-2 font-display text-sm font-bold tracking-wide">Brand colour</p>
        <div className="grid gap-2" role="radiogroup" aria-label="Brand colour">
          {BRANDS.map((b) => {
            const active = b.id === brand;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setBrand(b.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-2 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active ? "border-primary bg-muted text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                <span className="flex size-7 items-center justify-center rounded-full ring-1 ring-border" style={{ background: b.swatch }}>
                  {active && <Check className="size-4 text-white drop-shadow" />}
                </span>
                <span className="font-medium">{b.label}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{b.swatch}</span>
              </button>
            );
          })}
          <div
            role="radio"
            aria-checked={brand === "custom"}
            className={cn("flex items-center gap-3 rounded-lg border p-2 text-sm", brand === "custom" ? "border-primary bg-muted" : "border-transparent")}
          >
            <label className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-border" style={{ background: customColor }} title="Pick any colour">
              {brand === "custom" && <Check className="pointer-events-none size-4 text-white drop-shadow" />}
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                aria-label="Pick a custom brand colour"
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
            <span className="font-medium">Custom</span>
            <input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitHex((e.target as HTMLInputElement).value)}
              spellCheck={false}
              maxLength={7}
              aria-label="Custom colour hex"
              className="ml-auto w-[5.5rem] rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Applies to this browser, in light and dark mode.</p>
      </PopoverContent>
    </Popover>
  );
}
