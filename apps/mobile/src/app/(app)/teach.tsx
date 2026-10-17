import { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { RECIPE_KEYS, saveRecipeSchema, type Recipe, type RecipeKey, type RecipeStep } from "@7xen/shared";
import { Header, Screen } from "@/components/Screen";
import { PermissionRow } from "@/components/PermissionRow";
import { Banner, Body, Button, Card, Field, Muted, Section } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { RECIPE_INFO } from "@/lib/recipes";
import { colors, fonts } from "@/lib/theme";
import { GameOps } from "@/native/gameops";

type Phase = "pick" | "teaching" | "review";

function describe(step: RecipeStep): string {
  const a = step.action;
  switch (a.type) {
    case "tap":
      return `Tap at ${Math.round(a.x * 100)}% × ${Math.round(a.y * 100)}%`;
    case "swipe":
      return "Swipe";
    case "wait":
      return `Wait ${(a.ms / 1000).toFixed(1)}s`;
    case "input_text":
      return "Type the room password";
    case "read_text":
      return `Read ${a.field === "roomId" ? "room ID" : "password"}`;
    default:
      return "Do it yourself";
  }
}

export default function Teach() {
  const { api } = useAuth();
  const [key, setKey] = useState<RecipeKey>("CREATE_ROOM");
  const [name, setName] = useState(RECIPE_INFO.CREATE_ROOM.title);
  const [phase, setPhase] = useState<Phase>("pick");
  const [accessibility, setAccessibility] = useState<boolean | null>(null);
  const [steps, setSteps] = useState<RecipeStep[]>([]);
  const [profile, setProfile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Recipe | null>(null);

  const check = useCallback(() => {
    GameOps.getPermissions()
      .then((p) => setAccessibility(p.accessibility))
      .catch(() => setAccessibility(false));
  }, []);
  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (s) => s === "active" && check());
    return () => sub.remove();
  }, [check]);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const start = run(async () => {
    setSaved(null);
    await GameOps.startTeachMode(key);
    setPhase("teaching");
    await GameOps.launchBgmi().catch(() => false);
  });
  const finish = run(async () => {
    const r = await GameOps.stopTeachMode();
    setSteps(r.steps.map((s, i) => ({ ...s, label: s.label || `Step ${i + 1}` })));
    setProfile(r.deviceProfile);
    setPhase("review");
  });
  const cancel = run(async () => {
    await GameOps.stopTeachMode().catch(() => null);
    setPhase("pick");
  });
  const save = run(async () => {
    const parsed = saveRecipeSchema.safeParse({ name, deviceProfile: profile, steps });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.path.includes("steps") ? "Record at least one step (and at most 60)." : (parsed.error.issues[0]?.message ?? "Check the recipe"));
    const r = await api.put<Recipe>(`/api/manager/recipes/${key}`, parsed.data);
    setSaved(r);
    setPhase("pick");
  });

  return (
    <Screen header={<Header back title="Teach a recipe" subtitle="Show the app your taps once" />}>
      {error ? <Banner tone="danger" text={error} /> : null}
      {saved ? <Banner tone="success" title="Recipe saved" text={`${saved.name} · ${saved.steps.length} steps (v${saved.version}). It's used the next time you Go live.`} /> : null}

      {phase === "pick" ? (
        <>
          <Section title="Which steps?">
            {RECIPE_KEYS.map((k) => (
              <Card
                key={k}
                highlight={k === key}
                onPress={() => {
                  setKey(k);
                  setName(RECIPE_INFO[k].title);
                }}
                style={{ gap: 4 }}
              >
                <Text style={st.title}>{RECIPE_INFO[k].title}</Text>
                <Muted>{RECIPE_INFO[k].text}</Muted>
              </Card>
            ))}
          </Section>
          <Section title="Before you start">
            <Card style={{ paddingVertical: 4 }}>
              <PermissionRow
                ok={!!accessibility}
                required
                title="Accessibility: 7XEN Manager"
                text="Lets the app see where you tap while teaching."
                actionTitle="Open"
                onPress={run(async () => GameOps.openAccessibilitySettings())}
              />
            </Card>
            <Card style={{ gap: 8 }}>
              <Body>How it works</Body>
              {[
                "Open BGMI on the lobby screen (the app does this for you).",
                "Do the steps slowly, one tap at a time — wait for each screen to load.",
                "Skip typing passwords; the app types the match password itself.",
                "Come back to 7XEN Manager and tap “Finish”.",
                "Check the steps and save. Re-teach any time BGMI changes its menus.",
              ].map((t, i) => (
                <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                  <Text style={st.num}>{i + 1}</Text>
                  <Muted style={{ flex: 1 }}>{t}</Muted>
                </View>
              ))}
            </Card>
          </Section>
          <Button title="Start teaching" icon="school-outline" disabled={!accessibility} loading={busy} onPress={start} />
        </>
      ) : phase === "teaching" ? (
        <>
          <Card highlight style={{ gap: 10, alignItems: "center", paddingVertical: 28 }}>
            <View style={st.rec} />
            <Text style={st.big}>Teaching “{RECIPE_INFO[key].title}”</Text>
            <Muted style={{ textAlign: "center" }}>Go to BGMI and do the steps. Your taps are being recorded. Come back here when you're done.</Muted>
          </Card>
          <Button title="Open BGMI" icon="game-controller-outline" variant="secondary" onPress={run(async () => void (await GameOps.launchBgmi()))} />
          <Button title="Finish" icon="checkmark" loading={busy} onPress={finish} />
          <Button title="Cancel" variant="ghost" onPress={cancel} />
        </>
      ) : (
        <>
          <Field label="Recipe name" value={name} onChangeText={setName} maxLength={60} />
          <Section title={`${steps.length} steps${profile ? ` · ${profile}` : ""}`}>
            {steps.length === 0 ? <Banner tone="warning" text="No taps were recorded. Cancel and try again." /> : null}
            {steps.map((s, i) => (
              <Card key={s.id} style={{ gap: 6 }}>
                <Text style={st.stepMeta}>
                  Step {i + 1} · {describe(s)}
                </Text>
                <TextInput
                  value={s.label}
                  onChangeText={(t) => setSteps((all) => all.map((x) => (x.id === s.id ? { ...x, label: t.slice(0, 80) } : x)))}
                  style={st.stepInput}
                  placeholder="What this step does (shown in the bubble)"
                  placeholderTextColor={colors.faint}
                />
                <Button title="Remove step" size="sm" variant="ghost" icon="trash-outline" onPress={() => setSteps((all) => all.filter((x) => x.id !== s.id))} style={{ alignSelf: "flex-start" }} />
              </Card>
            ))}
          </Section>
          <Button title="Save recipe" icon="save-outline" loading={busy} disabled={!steps.length} onPress={save} />
          <Button title="Discard" variant="secondary" onPress={() => setPhase("pick")} />
        </>
      )}
      {phase === "pick" ? <Button title="Back to settings" variant="ghost" onPress={() => router.back()} /> : null}
    </Screen>
  );
}

const st = StyleSheet.create({
  title: { fontFamily: fonts.semibold, fontSize: 16, color: colors.fg },
  num: { fontFamily: fonts.display, fontSize: 18, color: colors.primary, width: 16 },
  rec: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.danger },
  big: { fontFamily: fonts.display, fontSize: 24, color: colors.fg, textAlign: "center" },
  stepMeta: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.8, color: colors.muted, textTransform: "uppercase" },
  stepInput: { fontFamily: fonts.text, fontSize: 15, color: colors.fg, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12, backgroundColor: colors.input },
});
