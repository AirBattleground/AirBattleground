import { Download, Link2, Radio } from "lucide-react";
import { PageHeader } from "@7xen/ui/components/brand/page";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { WorkersSection } from "@/features/studio/components/WorkersSection";

const STEPS: TourStep[] = [
  { title: "Studio", description: "Shows are produced and recorded with the 7XEN Studio app on a PC at your venue. This page links that app to your account." },
  { element: '[data-tour="studio-setup"]', title: "How to set up", description: "Three steps: install the app, connect it here, then pick a match in the app and go live.", side: "bottom" },
  { element: '[data-tour="studio-connected"]', title: "Connected studios", description: "Every 7XEN Studio linked to your account. A green dot means it's online right now.", side: "top" },
  { element: '[data-tour="studio-connect"]', title: "Connect a studio", description: "Press this, then scan the QR in the app's Settings on your venue PC.", side: "bottom" },
];

const SETUP = [
  { icon: Download, title: "Install 7XEN Studio", text: "Install the 7XEN Studio app on the PC at your venue." },
  { icon: Link2, title: "Connect it here", text: "Press “Connect a studio” below and scan the QR in the app's Settings." },
  { icon: Radio, title: "Go live", text: "Pick a match in the app and go live. It streams to AirBattleground and YouTube." },
];

export default function StudioPage() {
  usePageTour("manager.studio", STEPS);

  return (
    <>
      <PageHeader
        eyebrow="Broadcast"
        title="Studio"
        description="Produce and record shows with the 7XEN Studio app on a PC at the venue. Connect it here to stream your matches to AirBattleground and YouTube."
      />

      <section data-tour="studio-setup" className="mb-6 rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 font-display text-xl font-bold">How to set up</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {SETUP.map((s, i) => (
            <li key={s.title} className="flex gap-3 rounded-lg border bg-background/50 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-lg font-bold text-primary">{i + 1}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-semibold">
                  <s.icon className="size-4 text-primary" /> {s.title}
                </span>
                <span className="block text-sm text-muted-foreground">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <WorkersSection />
    </>
  );
}
