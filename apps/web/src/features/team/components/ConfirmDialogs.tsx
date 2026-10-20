import type { ReactNode } from "react";
import { AlertTriangle, CalendarDays, Clock, User } from "lucide-react";
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
import { useT } from "@/i18n/core";
import { scrimUi } from "@/i18n/scrims";
import { formatTime, useDayFormat } from "../format";
import { MapChips } from "./MapChips";

export interface ScrimSummary {
  title: string;
  date: string;
  startTime: string;
  organiser: string;
  maps: GameMap[];
}

function SummaryBox({ s }: { s: ScrimSummary }) {
  const t = useT(scrimUi);
  const { formatDate } = useDayFormat();
  return (
    <div className="space-y-3 rounded-xl border bg-muted/40 p-4 text-left">
      <p className="font-display text-xl leading-tight font-bold">{s.title}</p>
      <div className="grid gap-1.5 text-sm">
        <Row icon={<CalendarDays />}>{formatDate(s.date, "EEEE, d MMMM")}</Row>
        <Row icon={<Clock />}>{formatTime(s.startTime)} IST</Row>
        <Row icon={<User />}>{t("organised_by", { name: s.organiser })}</Row>
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
  const t = useT(scrimUi);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">{again ? t("reg_again_title") : t("reg_title")}</AlertDialogTitle>
          <AlertDialogDescription>{t.rich("reg_approve", { b: (c) => <strong className="text-foreground">{c}</strong> })}</AlertDialogDescription>
        </AlertDialogHeader>
        <SummaryBox s={summary} />
        {full && (
          <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/15 p-3 text-sm text-warning-foreground dark:text-warning">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p>{t("reg_full")}</p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("not_now")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} size="lg">
            {again ? t("send_again") : t("yes_register")}
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
  const t = useT(scrimUi);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-2xl">{approved ? t("cancel_slot_title") : t("cancel_req_title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {approved
              ? t("cancel_slot_text", { slot: slot != null ? ` #${String(slot).padStart(2, "0")}` : "" })
              : t("cancel_req_text")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <SummaryBox s={summary} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t("keep_it")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {approved ? t("yes_release") : t("yes_cancel_req")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
