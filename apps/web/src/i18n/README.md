# Portal languages — how to translate a screen

Players can use the portal in **English**, **हिंदी** (Hindi, Devanagari) and **Hinglish** (Hindi in Roman letters).
Managers/admins always see English (`useLocale().canSwitch === false`), so shared components can be translated safely.

## Pattern

```ts
// src/i18n/<area>.ts
import { defineMessages } from "./core";
export const scrimsMsg = defineMessages({
  en:       { title: "Find a scrim", count_one: "{count} scrim", count_other: "{count} scrims", hint: "Tap <b>Register</b> to join." },
  hi:       { title: "स्क्रिम खोजें", count_one: "{count} स्क्रिम", count_other: "{count} स्क्रिम", hint: "जुड़ने के लिए <b>रजिस्टर</b> दबाएँ।" },
  hinglish: { title: "Scrim dhundo", count_one: "{count} scrim", count_other: "{count} scrims", hint: "Join karne ke liye <b>Register</b> dabao." },
});
```

```tsx
const t = useT(scrimsMsg);
t("title");                      // string
t("greeting", { name });         // {name} filled
t.plural("count", n);            // count_one / count_other, {count} filled
t.rich("hint", { b: (c) => <b>{c}</b> });   // <b>…</b> rendered by your function
const fmt = useDateFormat(); fmt(iso, "EEE, d MMM");  // Hindi day/month names in Hindi
```

- The type forces `hi` and `hinglish` to have exactly the keys of `en` — a missing key fails `tsc`.
- `common.ts` already has: nav labels, today/tomorrow, retry/cancel/save/close/back/see_all/loading, statuses
  (pending/approved/rejected/cancelled), something_wrong, offline. Import it read-only; don't edit it (add your own keys).
- **Page tours**: `STEPS` are module consts today. Build them in the component with `useMemo(() => [...], [t])`
  and pass to `usePageTour(id, steps)`. Keep every `element: '[data-tour="…"]'` unchanged.
- Toasts, empty states, buttons, labels, aria-labels, placeholders, tooltips: all translated.
- Do **not** translate: data from the server (scrim/team/tournament names, organiser names, map names from
  `MAP_LABELS`, server error messages), IGNs, numbers, route paths, `data-tour` ids, code identifiers.

## Tone

- Simple, friendly, short — the same "plain words" style as the English. Players are BGMI gamers in India.
- Keep common gaming words players already use: scrim, slot, match, room ID, password, team, leader, squad, kills,
  points, live, register (Hindi: रजिस्टर), tournament (टूर्नामेंट), TDM. Don't invent pure-Hindi terms nobody uses.
- **Hindi**: Devanagari, polite "आप" form, natural spoken Hindi (e.g. "रजिस्टर करें", "अपनी टीम बनाएँ").
- **Hinglish**: Roman letters, casual "tum" form as gamers talk ("Register karo", "Apni team banao", "Slot mil gaya!").
- Keep the English capitalisation/emphasis intent; Hindi has no capitals.
