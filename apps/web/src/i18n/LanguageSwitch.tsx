import { Check, Languages } from "lucide-react";
import { LANGUAGES } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@7xen/ui/components/ui/dropdown-menu";
import { cn } from "@7xen/ui/lib/utils";
import { common } from "./common";
import { LANGUAGE_META, useLocale, useT } from "./core";

/** EN / हिं / Hinglish picker for the top bar (icon + short label). Hidden for managers/admins (English only). */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, canSwitch } = useLocale();
  const t = useT(common);
  if (!canSwitch) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" data-tour="language" aria-label={`${t("language")}: ${LANGUAGE_META[lang].label}`} className={cn("h-9 gap-1.5 px-2 text-muted-foreground hover:text-primary", className)}>
          <Languages className="size-4" />
          <span className="text-xs font-bold">{LANGUAGE_META[lang].short}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LANGUAGES.map((l) => (
          <DropdownMenuItem key={l} onSelect={() => setLang(l)} className="cursor-pointer justify-between">
            <span lang={LANGUAGE_META[l].htmlLang}>{LANGUAGE_META[l].label}</span>
            {l === lang && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Three big chips for the login / welcome screens (no menu to open). */
export function LanguageChips({ className }: { className?: string }) {
  const { lang, setLang, canSwitch } = useLocale();
  if (!canSwitch) return null;
  return (
    <div role="radiogroup" aria-label="Language" className={cn("inline-flex rounded-full border bg-card/70 p-0.5 backdrop-blur", className)}>
      {LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === lang}
          lang={LANGUAGE_META[l].htmlLang}
          onClick={() => setLang(l)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            l === lang ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {LANGUAGE_META[l].label}
        </button>
      ))}
    </div>
  );
}
