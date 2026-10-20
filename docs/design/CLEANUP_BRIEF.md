# Page clean-up brief (owner request, 2026-10-21)

Goal: every page except the **team Home** (which the owner likes) should show **less, cleaner, more useful**
information. Same features and data — better hierarchy.

## Principles
1. **One job per screen.** The top of the page answers "what is this and what do I do?" in one glance: title, a short
   (≤ 1 line) description *only if it adds something*, and the one primary action.
2. **Cut the words.** Remove helper paragraphs that repeat the title, long hints under every field, duplicate stats,
   and "tip" text that a tour already explains. Keep only what prevents a mistake. Prefer a tooltip/`title` over a
   permanent sentence for secondary help.
3. **Show the important number big, the rest small.** Key facts (slot number, start time, status, points, prize,
   teams registered) get size/weight; metadata (organiser, dates, ids) is small and muted.
4. **Group, don't stack.** Related info goes in one card with clear sections; avoid many tiny cards each with an icon
   header. Use simple key-value rows / compact tables where data is tabular.
5. **Fewer badges & colours.** One status pill per item; avoid stacking 3–4 pills/chips. Colour = meaning
   (success/warning/destructive/primary), not decoration.
6. **Consistent spacing**: page sections `space-y-6`, card padding `p-4 sm:p-5`, grid gaps `gap-3/gap-4`.
7. **Empty states**: one line + one action.
8. **Mobile first**: everything must read well at 390px wide; no horizontal scroll; tap targets ≥ 40px.

## Update from the owner (applies to every page)
9. **Organise pages like the Arena lobby** (`apps/web/src/skins/arena/ArenaLobby.tsx` is the reference): a clear page
   "stage" made of a few labelled panels/zones (e.g. left: context/status, centre: the main content, right: the
   next action / key facts), each panel with a small uppercase label and generous spacing — not a long stack of
   unrelated cards. Use normal theme tokens so it works in every site look (don't copy the arena-* CSS classes).
10. **Less UI complication**: fewer controls visible at once; advanced options behind an "Advanced" / "More"
    disclosure; no nested cards inside cards.
11. **Creation is step by step**: creating a scrim, tournament or TDM battle is a short wizard — one topic per step
    (e.g. Basics → Schedule → Matches/Format → Slots/Teams → Review & create), a step indicator, Back/Next, sensible
    defaults pre-filled, and a final Review step that summarises everything before the one Create/Publish button.

## Hard rules (don't break things)
- Keep all behaviour, routes, API calls, mutations, permissions and `data-tour="…"` ids that still exist on screen
  (if you remove an element a tour step points at, remove/adjust that tour step too).
- Keep translations working: player pages use `useT(...)` from `@/i18n/core` with dictionaries in `src/i18n/*.ts`.
  If you remove or change a string, update **all three** languages (en, hi, hinglish) in the dictionary you own —
  the typecheck enforces key parity. New strings need all three too. Manager pages are English only.
- Theme tokens only (bg-card, text-muted-foreground, border, …) — must look right in light + dark and in all three
  site looks (Teal, Lux, Arena). Don't touch `packages/ui`, `packages/shared`, `apps/api`, or skin CSS.
- Only edit the files you were given. Other agents are editing other pages at the same time.
- Verify with `pnpm --filter ./apps/web typecheck` (fix errors in your files; ignore others' in-progress files).
- No git, builds, deploys or `pnpm add`.
