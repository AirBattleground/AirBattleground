import { Pill } from "@7xen/ui/components/brand/status";

export function ActivePill({ active }: { active: boolean }) {
  return active ? (
    <Pill tone="success" icon={<span className="size-1.5 rounded-full bg-success" aria-hidden />}>
      Active
    </Pill>
  ) : (
    <Pill tone="neutral" icon={<span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden />}>
      Disabled
    </Pill>
  );
}
