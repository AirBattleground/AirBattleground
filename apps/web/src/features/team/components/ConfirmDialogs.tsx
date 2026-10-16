import type { ReactNode } from "react";
import { AlertTriangle, CalendarDays, Clock, ShieldCheck, User } from "lucide-react";
import type { GameMap } from "@7xen/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { formatDate, formatTime } from "../format";
import { MapChips } from "./MapChips";

export interface ScrimSummary {
  title: string;
  date: string;
  startTime: string;
  organiser: string;
  maps: GameMap[];
}

function SummaryBox({ s }: { s: ScrimSummary }) {
  return (
    <div className="space-y-3 rounded-xl border bg-muted/40 p-4 text-left">
      <p className="font-display text-xl leading-tight font-bold">{s.title}</p>
      <div className="grid gap-1.5 text-sm">
        <Row icon={<CalendarDays />}>{formatDate(s.date, "EEEE, d MMMM")}</Row>
        <Row icon={<Clock />}>{formatTime(s.startTime)} IST</Row>
        <Row icon={<User />}>Organised by {s.organiser}</Row>
      </div>
      {s.maps.length > 0 && <MapChips maps={s.maps} />}
    </div>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">
      {icon}
      <span className="text-foreground">{children}</span>
    </div>
  );
}

export function RegisterDialog({
  open,
  onOpenChange,
  summary,
  full,
  again,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  summary: ScrimSummary;
  full: boolean;
  again?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">{again ? "Request again?" : "Register your team?"}</AlertDialogTitle>
          <AlertDialogDescription>Check the details below, then confirm.</AlertDialogDescription>
        </AlertDialogHeader>
        <SummaryBox s={summary} />
        {full ? (
          <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/15 p-3 text-sm text-warning-foreground dark:text-warning">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p>All slots are filled — you'll be on the waiting list until a slot frees up.</p>
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-info/30 bg-info/10 p-3 text-sm text-info">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" />
            <p>
              The organiser must <strong>approve</strong> your request. Once approved you'll get your slot number here.
            </p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} size="lg">
            {again ? "Send request again" : "Yes, register"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CancelDialog({
  open,
  onOpenChange,
  summary,
  approved,
  slot,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  summary: ScrimSummary;
  approved: boolean;
  slot?: number | null;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">{approved ? "Give up your slot?" : "Cancel your request?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {approved
              ? `Your slot${slot != null ? ` #${String(slot).padStart(2, "0")}` : ""} will be released and another team can take it. You may not get it back.`
              : "Your request will be withdrawn. You can register again while registration is open."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <SummaryBox s={summary} />
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {approved ? "Yes, release my slot" : "Yes, cancel request"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
