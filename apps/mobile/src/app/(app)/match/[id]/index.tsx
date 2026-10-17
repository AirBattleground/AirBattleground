import { useEffect, useState } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { saveRoomSchema, type RoomDetails } from "@7xen/shared";
import { Header, Screen } from "@/components/Screen";
import { recordingChip } from "@/components/MatchCard";
import { Banner, Body, Button, Card, Chip, ConfirmSheet, Field, Loading, Muted, Section } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCountdown, formatDay, formatTime, mapLabel, revealLabel, revealMinutesBefore, roomShareText, slotRangeLabel } from "@/lib/format";
import { colors, fonts } from "@/lib/theme";
import { useMatch } from "@/lib/useMatch";
import { useNow } from "@/lib/useQuery";

const REVEAL_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Now" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const { card, error, refreshing, refresh, patch } = useMatch(id);
  const now = useNow(1000);

  const [editing, setEditing] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState<number | null>(15);
  const [errs, setErrs] = useState<{ roomId?: string; password?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // fresh room from the API (the card may be cached)
  useEffect(() => {
    api
      .get<RoomDetails | null>(`/api/manager/matches/${id}/room`)
      .then((room) => patch({ room: room ?? null }))
      .catch(() => {});
  }, [api, id, patch]);

  if (!card) {
    return <Screen header={<Header back title="Match" />}>{error ? <Banner tone="danger" text={error} /> : <Loading />}</Screen>;
  }

  const room = card.room;
  const startEdit = () => {
    setRoomId(room?.roomId ?? "");
    setPassword(room?.password ?? "");
    setReveal(revealMinutesBefore(room, card.startsAt));
    setErrs({});
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    const parsed = saveRoomSchema.safeParse({ roomId, password, revealMinutesBefore: reveal });
    if (!parsed.success) {
      const f: { roomId?: string; password?: string } = {};
      for (const i of parsed.error.issues) f[i.path[0] as "roomId" | "password"] ??= i.message;
      return setErrs(f);
    }
    setErrs({});
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.put<RoomDetails>(`/api/manager/matches/${id}/room`, parsed.data);
      patch({ room: saved });
      setEditing(false);
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await api.del(`/api/manager/matches/${id}/room`);
      patch({ room: null });
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  const share = () => {
    if (!room) return;
    void Share.share({ message: roomShareText(card, room) }, { dialogTitle: "Share room details" });
  };

  const live = card.recording?.status === "LIVE";

  return (
    <Screen
      header={<Header back title={`Match ${card.number} · ${mapLabel(card.map)}`} subtitle={card.title} />}
      refreshing={refreshing}
      onRefresh={refresh}
      footer={
        <Button
          title={live ? "Open live dashboard" : "Go live"}
          icon={live ? "pulse" : "radio-button-on"}
          onPress={() => router.push({ pathname: "/match/[id]/live", params: { id } })}
        />
      }
    >
      {error ? <Banner tone="warning" text={error} /> : null}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <Chip label={card.kind === "SCRIM" ? "Scrim" : "Tournament"} tone={card.kind === "SCRIM" ? "primary" : "info"} />
          <Chip label={mapLabel(card.map)} icon="map-outline" />
          {recordingChip(card)}
        </View>
        <Text style={st.bigTitle}>{card.title}</Text>
        <Muted>{card.subtitle}</Muted>
        <View style={st.stats}>
          <Stat label="Starts" value={formatTime(card.startsAt)} sub={[formatDay(card.startsAt), formatCountdown(card.startsAt, now)].filter(Boolean).join(" · ")} />
          <Stat label="Teams" value={String(card.teamsCount)} sub={slotRangeLabel(card.slotRange)} />
          <Stat label="Screens" value={`${card.screenshotCounts.slotList + card.screenshotCounts.results}`} sub={`${card.screenshotCounts.slotList} list · ${card.screenshotCounts.results} results`} />
        </View>
      </Card>

      <Section title="Room details">
        {editing ? (
          <Card style={{ gap: 14 }}>
            {saveError ? <Banner tone="danger" text={saveError} /> : null}
            <Field label="Room ID" value={roomId} onChangeText={(t) => setRoomId(t.replace(/\D/g, ""))} keyboardType="number-pad" placeholder="e.g. 4417302" maxLength={12} error={errs.roomId} icon="key-outline" />
            <Field label="Password" value={password} onChangeText={setPassword} autoCapitalize="none" autoCorrect={false} placeholder="Room password" maxLength={20} error={errs.password} icon="lock-closed-outline" />
            <View style={{ gap: 8 }}>
              <Text style={st.label}>Teams can see it</Text>
              <View style={st.chips}>
                {REVEAL_OPTIONS.map((o) => {
                  const on = o.value === reveal;
                  return (
                    <Button
                      key={String(o.value)}
                      title={o.value === null ? o.label : `${o.label} before`}
                      size="sm"
                      variant={on ? "primary" : "secondary"}
                      onPress={() => setReveal(o.value)}
                      style={{ flexGrow: 1 }}
                    />
                  );
                })}
              </View>
              <Muted style={{ fontSize: 13 }}>Approved teams see the room ID and password in their 7XEN dashboard from this time.</Muted>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Cancel" variant="secondary" size="md" onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <Button title="Save room" size="md" icon="checkmark" loading={saving} onPress={save} style={{ flex: 1.4 }} />
            </View>
          </Card>
        ) : room ? (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={st.roomBox}>
                <Text style={st.roomLabel}>ROOM ID</Text>
                <Text style={st.roomValue} selectable>
                  {room.roomId}
                </Text>
              </View>
              <View style={st.roomBox}>
                <Text style={st.roomLabel}>PASSWORD</Text>
                <Text style={st.roomValue} selectable>
                  {room.password}
                </Text>
              </View>
            </View>
            <Body style={{ color: colors.muted, fontSize: 14 }}>{revealLabel(room, now)}</Body>
            <Button title="Share on WhatsApp…" icon="share-social" onPress={share} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Edit" icon="create-outline" variant="secondary" size="md" onPress={startEdit} style={{ flex: 1 }} />
              <Button title="Remove" icon="trash-outline" variant="danger" size="md" onPress={() => setConfirmDelete(true)} style={{ flex: 1 }} />
            </View>
            {saveError ? <Banner tone="danger" text={saveError} /> : null}
          </Card>
        ) : (
          <Card style={{ gap: 12 }}>
            <Body>No room yet. Create the custom room in BGMI, then enter its ID and password here — or Go live and the app reads them from the screen.</Body>
            <Button title="Enter room details" icon="key-outline" variant="secondary" onPress={startEdit} />
          </Card>
        )}
      </Section>

      <Section title="Recordings">
        <Card onPress={() => router.push({ pathname: "/match/[id]/recordings", params: { id } })} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.rowTitle}>Match videos</Text>
            <Muted>{card.recording ? "See status and upload progress" : "Nothing recorded yet"}</Muted>
          </View>
          <Chip label="Open" tone="primary" icon="chevron-forward" />
        </Card>
      </Section>

      <ConfirmSheet
        visible={confirmDelete}
        tone="danger"
        title="Remove room details?"
        text="Teams will no longer see the room ID and password for this match."
        confirmTitle="Remove"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={st.stat}>
      <Text style={st.statLabel}>{label}</Text>
      <Text style={st.statValue} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={st.statSub} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  bigTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 28, color: colors.fg },
  stats: { flexDirection: "row", gap: 8, marginTop: 4 },
  stat: { flex: 1, backgroundColor: colors.bgRaised, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.border, gap: 2 },
  statLabel: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: colors.muted },
  statValue: { fontFamily: fonts.display, fontSize: 22, color: colors.fg },
  statSub: { fontFamily: fonts.text, fontSize: 11.5, color: colors.muted },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.fg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  roomBox: { flex: 1, backgroundColor: colors.accent, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,95,15,0.35)", padding: 12, gap: 2 },
  roomLabel: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.8, color: colors.accentFg },
  roomValue: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30, color: colors.fg, letterSpacing: 1 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.fg },
});
