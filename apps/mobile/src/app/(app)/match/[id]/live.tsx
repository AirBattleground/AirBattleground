import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ApiError, type ListResponse, type Recipe, type RecordingRow, type RoomDetails, type ScreenshotKind } from "@7xen/shared";
import { Header, Screen } from "@/components/Screen";
import { PermissionRow } from "@/components/PermissionRow";
import { Banner, Body, Button, Card, Chip, ConfirmSheet, Field, Loading, Muted, ProgressBar, Section, Segmented, ToggleRow } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { appVersion } from "@/lib/appInfo";
import { AUTO_WARNING } from "@/lib/copy";
import { deviceName, useAuth } from "@/lib/auth";
import { formatBytes, formatElapsed, mapLabel, percent } from "@/lib/format";
import { liveReporter, useLive } from "@/lib/liveReporter";
import { pickRecipe } from "@/lib/recipes";
import { colors, fonts } from "@/lib/theme";
import { useMatch } from "@/lib/useMatch";
import { useNow } from "@/lib/useQuery";
import { GAMEOPS_IS_MOCK, GameOps } from "@/native/gameops";
import type { GameOpsPermissions, ScreenKind, SessionStatus } from "@/native/types";


const ACTIVE = new Set<SessionStatus["state"]>(["STARTING", "LIVE", "PAUSED", "STOPPING"]);
const SCREEN_LABEL: Record<ScreenKind, string> = { TEAM_LIST: "Team list", RESULTS: "Results", LOBBY: "Lobby", OTHER: "In game / other" };

export default function LiveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { card, patch } = useMatch(id);
  const status = useLive((s) => s.status);
  const mine = status && status.matchId === id;
  const showDashboard = !!mine && (ACTIVE.has(status.state) || status.state === "STOPPED" || status.state === "ERROR");

  return (
    <Screen
      header={<Header back title={showDashboard ? "Live" : "Go live"} subtitle={card ? `${card.title} · Match ${card.number} · ${mapLabel(card.map)}` : undefined} />}
      scroll
    >
      {GAMEOPS_IS_MOCK ? <Banner tone="info" title="Demo recorder" text="The screen recorder isn't in this build — this runs a simulation. Nothing is recorded." /> : null}
      {!card ? <Loading /> : showDashboard ? <Dashboard matchId={id} status={status} roomSet={!!card.room} onRoomSaved={(room) => patch({ room })} /> : <Setup matchId={id} />}
    </Screen>
  );
}

// ---------------------------------------------------------------- setup
function Setup({ matchId }: { matchId: string }) {
  const { api, prefs, session } = useAuth();
  const { card, patch } = useMatch(matchId);
  const [perms, setPerms] = useState<GameOpsPermissions | null>(null);
  const [mode, setMode] = useState<"ASSISTED" | "AUTO">("ASSISTED");
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [quality, setQuality] = useState(prefs.quality);
  const [autoCapture, setAutoCapture] = useState(prefs.autoCapture);
  const [launchBgmi, setLaunchBgmi] = useState(prefs.launchBgmi);
  const [roomPassword, setRoomPassword] = useState(card?.room?.password ?? "");
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPerms = useCallback(() => {
    GameOps.getPermissions()
      .then(setPerms)
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadPerms();
    const sub = AppState.addEventListener("change", (s) => s === "active" && loadPerms());
    return () => sub.remove();
  }, [loadPerms]);

  useEffect(() => {
    api
      .get<ListResponse<Recipe>>("/api/manager/recipes")
      .then((r) => setRecipe(pickRecipe(r.items, "CREATE_ROOM")))
      .catch(() => setRecipe(null));
  }, [api]);

  useEffect(() => {
    if (card?.room?.password && !roomPassword) setRoomPassword(card.room.password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.room?.password]);

  const after = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
    loadPerms();
  };

  const auto = mode === "AUTO";
  const ready = !!perms && perms.overlay && perms.notifications && (!auto || perms.accessibility);

  const start = async () => {
    if (!card || !session) return;
    setError(null);
    setStarting(true);
    let rec: RecordingRow | null = null;
    try {
      // reuse a LIVE recording left over from a crash/restart, otherwise start a new one
      if (card.recording?.status === "LIVE") rec = card.recording;
      else rec = await api.post<RecordingRow>(`/api/manager/matches/${matchId}/recordings`, { deviceName: deviceName(), appVersion });
      patch({ recording: rec });
    } catch (e) {
      setStarting(false);
      return setError(e instanceof ApiError && e.status === 409 ? "Another phone is already live on this match. Stop it there first." : errorMessage(e));
    }
    try {
      const s = await GameOps.startSession({
        apiBaseUrl: prefs.serverUrl,
        token: session.token,
        matchId,
        recordingId: rec.id,
        title: `${card.title} · Match ${card.number}`,
        checklist: recipe?.steps ?? [],
        autoMode: auto,
        recordVideo: true,
        quality,
        autoCapture,
        roomPassword: roomPassword.trim() || undefined,
        launchBgmi,
      });
      liveReporter.setStatus(s);
      liveReporter.log(rec.id, "start", `${auto ? "Auto" : "Assisted"} mode · ${quality}${autoCapture ? " · auto-capture" : ""}${recipe ? ` · recipe v${recipe.version}` : ""}`);
      void liveReporter.flush(rec.id, { status: "LIVE" });
    } catch (e) {
      const msg = errorMessage(e);
      setError(/denied|cancel/i.test(msg) ? "Screen recording wasn't allowed. Tap Start again and choose “Start now” / “Entire screen”." : msg);
      // the recording never started — tell the server
      api.patch(`/api/manager/recordings/${rec.id}`, { status: "FAILED", error: msg.slice(0, 300), events: [] }).catch(() => {});
      patch({ recording: null });
    } finally {
      setStarting(false);
    }
  };

  if (!card) return <Loading />;
  return (
    <>
      <Section title="1 · Permissions">
        <Card style={{ paddingVertical: 4 }}>
          {!perms ? (
            <Loading text="Checking…" />
          ) : (
            <>
              <PermissionRow
                ok={perms.bgmiInstalled}
                required
                title="BGMI installed"
                text={perms.bgmiInstalled ? "Battlegrounds Mobile India found." : "Install BGMI on this phone to run matches."}
              />
              <PermissionRow ok={perms.overlay} required title="Show over other apps" text="For the floating 7XEN bubble and checklist on top of BGMI." onPress={after(() => GameOps.requestOverlayPermission())} />
              <PermissionRow ok={perms.notifications} required title="Notifications" text="Shows the recording notification with Pause / Stop." onPress={after(() => GameOps.requestNotificationPermission())} />
              <PermissionRow
                ok={perms.batteryOptimizationIgnored}
                title="Battery: don't restrict"
                text="Stops the phone from killing the recorder in the middle of a match."
                onPress={after(() => GameOps.requestIgnoreBatteryOptimizations())}
              />
              {auto ? (
                <PermissionRow
                  ok={perms.accessibility}
                  required
                  title="Accessibility: 7XEN Manager"
                  text="Needed for Auto mode taps. Settings → Accessibility → 7XEN Manager → On."
                  actionTitle="Open"
                  onPress={after(() => GameOps.openAccessibilitySettings())}
                />
              ) : null}
            </>
          )}
        </Card>
      </Section>

      <Section title="2 · Room mode">
        <Segmented
          value={mode}
          onChange={(v) => (v === "AUTO" ? setConfirmAuto(true) : setMode("ASSISTED"))}
          options={[
            { value: "ASSISTED", label: "Assisted", icon: "hand-left-outline" },
            { value: "AUTO", label: "Auto", icon: "flash-outline" },
          ]}
        />
        {auto ? (
          <Banner tone="danger" title="Auto mode is on" text={AUTO_WARNING} />
        ) : (
          <Muted>Assisted: the bubble shows each step and ticks it off when it sees the screen. You do the taps.</Muted>
        )}
        <Card style={{ gap: 4 }}>
          <Text style={st.cardTitle}>Room checklist</Text>
          {recipe === undefined ? (
            <Muted>Loading steps…</Muted>
          ) : recipe ? (
            <>
              <Muted>
                {recipe.steps.length} steps · {recipe.scope === "MANAGER" ? "your taught version" : "7XEN default"} (v{recipe.version})
              </Muted>
              {recipe.steps.slice(0, 6).map((s, i) => (
                <Text key={s.id} style={st.step}>
                  {i + 1}. {s.label}
                </Text>
              ))}
              {recipe.steps.length > 6 ? <Muted>+ {recipe.steps.length - 6} more</Muted> : null}
            </>
          ) : (
            <Muted>No room recipe yet — the bubble won't show steps. You can teach one in Settings → Teach a recipe.</Muted>
          )}
        </Card>
        <Field
          label="Room password to type"
          value={roomPassword}
          onChangeText={setRoomPassword}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          placeholder="e.g. 7xen"
          hint="Used when the checklist reaches the password step."
          icon="lock-closed-outline"
        />
      </Section>

      <Section title="3 · Recording">
        <Segmented
          value={quality}
          onChange={setQuality}
          options={[
            { value: "720p", label: "720p · smaller" },
            { value: "1080p", label: "1080p · sharper" },
          ]}
        />
        <Card style={{ paddingVertical: 4 }}>
          <ToggleRow title="Auto-capture screenshots" text="Captures the team list and results when they appear." value={autoCapture} onChange={setAutoCapture} />
          <ToggleRow title="Open BGMI after start" value={launchBgmi} onChange={setLaunchBgmi} />
        </Card>
      </Section>

      {error ? <Banner tone="danger" text={error} /> : null}
      {!ready && perms ? <Muted style={{ textAlign: "center" }}>Allow the required permissions above to start.</Muted> : null}
      <Button title={starting ? "Starting…" : "Start recording"} icon="radio-button-on" disabled={!ready} loading={starting} onPress={start} />
      <Muted style={{ textAlign: "center", fontSize: 12 }}>Android will ask to allow screen recording — choose “Entire screen”.</Muted>

      <ConfirmSheet
        visible={confirmAuto}
        tone="danger"
        title="Turn on Auto mode?"
        text={AUTO_WARNING}
        confirmTitle="I understand — use Auto"
        cancelTitle="Stay on Assisted"
        onConfirm={() => {
          setConfirmAuto(false);
          setMode("AUTO");
        }}
        onCancel={() => setConfirmAuto(false)}
      >
        <Body style={{ color: colors.muted, fontSize: 14 }}>Auto mode taps the BGMI screen for you using Android Accessibility. You can switch back any time.</Body>
      </ConfirmSheet>
    </>
  );
}

// ---------------------------------------------------------------- dashboard
function Dashboard({ matchId, status, roomSet, onRoomSaved }: { matchId: string; status: SessionStatus; roomSet: boolean; onRoomSaved: (r: RoomDetails) => void }) {
  const { api, prefs } = useAuth();
  const now = useNow(500);
  const statusAt = useLive((s) => s.statusAt);
  const roomInfo = useLive((s) => s.roomInfo);
  const lastError = useLive((s) => s.lastError);
  const uploads = useLive((s) => s.uploads);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [steps, setSteps] = useState<Record<string, string>>({});

  const rid = status.recordingId;
  const upload = rid ? uploads[rid] : undefined;
  const elapsed = status.state === "LIVE" ? status.elapsedMs + (now - statusAt) : status.elapsedMs;

  useEffect(() => {
    api
      .get<ListResponse<Recipe>>("/api/manager/recipes")
      .then((r) => {
        const m: Record<string, string> = {};
        for (const rec of r.items) for (const s of rec.steps) m[s.id] = s.label;
        setSteps(m);
      })
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const act = (key: string, fn: () => Promise<unknown>) => async () => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const capture = (kind: ScreenshotKind) =>
    act(kind, async () => {
      const ev = await GameOps.captureNow(kind);
      setToast(ev.error ? `Capture failed: ${ev.error}` : kind === "SLOT_LIST" ? "Team list captured" : "Results captured");
    });

  const stop = act("stop", async () => {
    setConfirmStop(false);
    const s = await GameOps.stopSession({ wifiOnly: prefs.wifiOnly });
    liveReporter.setStatus(s);
    if (rid) {
      liveReporter.log(rid, "stop", `${formatElapsed(s.elapsedMs)} · ${s.captures.slotList} list / ${s.captures.results} results`);
      await liveReporter.flush(rid, { status: "STOPPED", durationSec: Math.round(s.elapsedMs / 1000) });
    }
  });

  const saveRoom = act("room", async () => {
    if (!roomInfo?.roomId || !roomInfo.password) return;
    const saved = await api.put<RoomDetails>(`/api/manager/matches/${matchId}/room`, { roomId: roomInfo.roomId, password: roomInfo.password, revealMinutesBefore: 15 });
    onRoomSaved(saved);
    if (rid) liveReporter.log(rid, "room_created", `Room ${roomInfo.roomId}`);
    liveReporter.clearRoomInfo();
    setToast("Room saved — teams will see it 15 min before the start");
  });

  const done = status.checklist.filter((c) => c.done).length;
  const stopped = status.state === "STOPPED";
  const stateTone = status.state === "LIVE" ? colors.danger : status.state === "PAUSED" ? colors.warning : status.state === "ERROR" ? colors.danger : colors.muted;
  const stateLabel = useMemo(
    () => ({ IDLE: "Idle", STARTING: "Starting…", LIVE: "Recording", PAUSED: "Paused", STOPPING: "Stopping…", STOPPED: "Stopped", ERROR: "Error" })[status.state],
    [status.state],
  );

  return (
    <>
      <Card highlight={status.state === "LIVE"} style={{ alignItems: "center", gap: 6, paddingVertical: 22 }}>
        <View style={st.statePill}>
          <View style={[st.dot, { backgroundColor: stateTone }]} />
          <Text style={[st.stateText, { color: stateTone }]}>{stateLabel}</Text>
        </View>
        <Text style={st.elapsed}>{formatElapsed(elapsed)}</Text>
        <Muted>Screen: {status.screen ? SCREEN_LABEL[status.screen] : "—"}</Muted>
      </Card>

      {status.error || lastError?.fatal ? <Banner tone="danger" text={status.error ?? lastError?.message ?? "Recorder error"} /> : null}
      {error ? <Banner tone="danger" text={error} /> : null}
      {toast ? <Banner tone="success" text={toast} /> : null}

      {roomInfo?.roomId && roomInfo.password && !stopped ? (
        <Banner
          tone="info"
          title="Room found on screen"
          text={`Room ID ${roomInfo.roomId} · Password ${roomInfo.password}${roomSet ? " (a room is already saved — this replaces it)" : ""}`}
          action={
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button title="Save to 7XEN" size="sm" onPress={saveRoom} loading={busy === "room"} />
              <Button title="Ignore" size="sm" variant="secondary" onPress={() => liveReporter.clearRoomInfo()} />
            </View>
          }
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Counter label="Team list" value={status.captures.slotList} icon="list" />
        <Counter label="Results" value={status.captures.results} icon="trophy-outline" />
        <Counter label="Uploading" value={status.captures.pendingUploads} icon="cloud-upload-outline" />
      </View>

      {!stopped ? (
        <>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Capture team list" icon="camera-outline" variant="secondary" size="md" style={{ flex: 1 }} loading={busy === "SLOT_LIST"} onPress={capture("SLOT_LIST")} />
            <Button title="Capture results" icon="camera-outline" variant="secondary" size="md" style={{ flex: 1 }} loading={busy === "RESULTS"} onPress={capture("RESULTS")} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {status.state === "PAUSED" ? (
              <Button title="Resume" icon="play" variant="success" style={{ flex: 1 }} loading={busy === "pause"} onPress={act("pause", async () => liveReporter.setStatus(await GameOps.resumeSession()))} />
            ) : (
              <Button title="Pause" icon="pause" variant="secondary" style={{ flex: 1 }} loading={busy === "pause"} disabled={status.state !== "LIVE"} onPress={act("pause", async () => liveReporter.setStatus(await GameOps.pauseSession()))} />
            )}
            <Button title="Open BGMI" icon="game-controller-outline" variant="secondary" style={{ flex: 1 }} onPress={act("bgmi", () => GameOps.launchBgmi())} />
          </View>
          <Button title="Stop recording" icon="stop" variant="danger" loading={busy === "stop"} onPress={() => setConfirmStop(true)} />
        </>
      ) : (
        <Card style={{ gap: 10 }}>
          <Text style={st.cardTitle}>Match video</Text>
          {upload ? (
            <>
              <ProgressBar value={percent(upload.uploadedBytes, upload.totalBytes)} tone={upload.state === "FAILED" ? "danger" : upload.state === "DONE" ? "success" : "primary"} />
              <Muted>
                {upload.state === "DONE"
                  ? "Uploaded ✓"
                  : upload.state === "WAITING_FOR_WIFI"
                    ? "Waiting for Wi-Fi to upload"
                    : upload.state === "FAILED"
                      ? `Upload failed${upload.error ? `: ${upload.error}` : ""}`
                      : `${formatBytes(upload.uploadedBytes)} of ${formatBytes(upload.totalBytes)} (${percent(upload.uploadedBytes, upload.totalBytes)}%)`}
              </Muted>
              {upload.state === "FAILED" ? <Button title="Retry upload" size="md" icon="refresh" onPress={act("retry", () => GameOps.retryUploads())} /> : null}
            </>
          ) : (
            <Muted>{prefs.wifiOnly ? "The video uploads in the background on Wi-Fi." : "The video uploads in the background."}</Muted>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Recordings" size="md" variant="secondary" style={{ flex: 1 }} onPress={() => router.replace({ pathname: "/match/[id]/recordings", params: { id: matchId } })} />
            <Button title="Done" size="md" style={{ flex: 1 }} onPress={() => router.back()} />
          </View>
        </Card>
      )}

      {status.checklist.length ? (
        <Section title={`Room checklist · ${done}/${status.checklist.length}`}>
          <Card style={{ gap: 8 }}>
            {status.checklist.map((c, i) => (
              <View key={c.stepId} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name={c.done ? "checkmark-circle" : "ellipse-outline"} size={20} color={c.done ? colors.success : colors.faint} />
                <Text style={[st.step, c.done && { color: colors.muted, textDecorationLine: "line-through" }]}>{steps[c.stepId] ?? `Step ${i + 1}`}</Text>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <ConfirmSheet
        visible={confirmStop}
        tone="danger"
        title="Stop recording?"
        text={`The match video is saved and uploads ${prefs.wifiOnly ? "when the phone is on Wi-Fi" : "right away"}. Screenshots already captured are kept.`}
        confirmTitle="Stop"
        onConfirm={stop}
        onCancel={() => setConfirmStop(false)}
      />
    </>
  );
}

function Counter({ label, value, icon }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <Card style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 14 }}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={st.counter}>{value}</Text>
      <Text style={st.counterLabel}>{label}</Text>
    </Card>
  );
}

const st = StyleSheet.create({
  cardTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.fg },
  step: { fontFamily: fonts.text, fontSize: 14, color: colors.fg, flex: 1 },
  statePill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  stateText: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 1.6, textTransform: "uppercase" },
  elapsed: { fontFamily: fonts.display, fontSize: 64, lineHeight: 68, color: colors.fg, letterSpacing: 2 },
  counter: { fontFamily: fonts.display, fontSize: 30, lineHeight: 32, color: colors.fg },
  counterLabel: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
});
