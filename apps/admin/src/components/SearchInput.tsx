import { Search, X } from "lucide-react";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder,
  loading,
  className,
  ...rest
}: { value: string; onChange: (v: string) => void; placeholder: string; loading?: boolean; className?: string; "data-tour"?: string }) {
  return (
    <div className={cn("relative w-full sm:max-w-xs", className)} {...rest}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="bg-card pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {loading ? (
        <span className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-primary/20 border-t-primary" aria-hidden />
      ) : (
        value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )
      )}
    </div>
  );
}
