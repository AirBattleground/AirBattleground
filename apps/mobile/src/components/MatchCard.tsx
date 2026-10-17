import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MATCH_STATUS_LABELS, type LiveMatchCard } from "@7xen/shared";
import { formatCountdown, formatDay, formatTime, mapLabel, slotRangeLabel } from "@/lib/format";
import { colors, fonts } from "@/lib/theme";
import { Card, Chip } from "./ui";

export function recordingChip(card: LiveMatchCard) {
  const r = card.recording;
  if (!r) return null;
  switch (r.status) {
    case "LIVE":
      return <Chip label="Recording" tone="danger" icon="radio-button-on" />;
    case "UPLOADING":
    case "STOPPED":
      return <Chip label="Video uploading" tone="info" icon="cloud-upload-outline" />;
    case "PROCESSING":
      return <Chip label="Processing video" tone="info" icon="hourglass-outline" />;
    case "READY":
      return <Chip label="Video ready" tone="success" icon="videocam-outline" />;
    case "FAILED":
      return <Chip label="Video failed" tone="danger" icon="alert-circle-outline" />;
    default:
      return null;
  }
}

export function MatchCardView({ card, now, onPress }: { card: LiveMatchCard; now: number; onPress: () => void }) {
  const countdown = formatCountdown(card.startsAt, now);
  const soon = card.startsAt ? Date.parse(card.startsAt) - now < 30 * 60_000 && Date.parse(card.startsAt) - now > -90 * 60_000 : false;
  const live = card.recording?.status === "LIVE";
  return (
    <Card onPress={onPress} highlight={soon || live} style={{ gap: 12 }}>
      <View style={st.top}>
        <Chip label={card.kind === "SCRIM" ? "Scrim" : "Tournament"} tone={card.kind === "SCRIM" ? "primary" : "info"} />
        <Chip label={mapLabel(card.map)} icon="map-outline" />
        <View style={{ flex: 1 }} />
        <Text style={st.status}>{MATCH_STATUS_LABELS[card.status]}</Text>
      </View>

      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
        <View style={st.num}>
          <Text style={st.numSmall}>MATCH</Text>
          <Text style={st.numBig}>{card.number}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.title} numberOfLines={2}>
            {card.title}
          </Text>
          <Text style={st.sub} numberOfLines={1}>
            {card.subtitle}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.faint} />
      </View>

      <View style={st.timeRow}>
        <Ionicons name="time-outline" size={16} color={soon ? colors.primary : colors.muted} />
        <Text style={st.time}>
          {formatDay(card.startsAt)} {formatTime(card.startsAt)}
        </Text>
        {countdown ? <Text style={[st.countdown, soon && { color: colors.primary }]}>· {countdown}</Text> : null}
      </View>

      <View style={st.facts}>
        <Fact icon="people-outline" text={`${card.teamsCount} teams`} />
        <Fact icon="grid-outline" text={slotRangeLabel(card.slotRange)} />
        <Fact icon="key-outline" text={card.room ? "Room set" : "No room yet"} tone={card.room ? "ok" : "warn"} />
        <Fact icon="images-outline" text={`${card.screenshotCounts.slotList} list · ${card.screenshotCounts.results} results`} />
      </View>
      {recordingChip(card)}
    </Card>
  );
}

function Fact({ icon, text, tone }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: "ok" | "warn" }) {
  const c = tone === "ok" ? colors.success : tone === "warn" ? colors.warning : colors.muted;
  return (
    <View style={st.fact}>
      <Ionicons name={icon} size={14} color={c} />
      <Text style={[st.factText, tone && { color: c }]}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  num: { width: 58, height: 58, borderRadius: 14, backgroundColor: colors.accent, borderWidth: 1, borderColor: "rgba(255,95,15,0.35)", alignItems: "center", justifyContent: "center" },
  numSmall: { fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 1.5, color: colors.accentFg },
  numBig: { fontFamily: fonts.display, fontSize: 28, lineHeight: 30, color: colors.fg },
  title: { fontFamily: fonts.display, fontSize: 21, lineHeight: 23, color: colors.fg },
  sub: { fontFamily: fonts.text, fontSize: 13, color: colors.muted },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontFamily: fonts.semibold, fontSize: 15, color: colors.fg },
  countdown: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fact: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.04)" },
  factText: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.muted },
});
