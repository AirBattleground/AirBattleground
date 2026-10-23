import { CopyButton } from "./CopyButton";

/** "ID 5829104 ⧉" — one room value with its copy button (Home's next-match strip, the scrim page). */
export function RoomValue({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-semibold tracking-[0.2em] text-primary uppercase">{label}</span>
      <span className="font-display text-lg leading-none font-bold tracking-wider text-foreground select-all">{value}</span>
      <CopyButton value={value} label={copyLabel} className="size-7 [&_svg]:size-3.5" />
    </span>
  );
}
