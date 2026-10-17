import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { ListResponse, RecordingRow, RecordingStatus } from "@7xen/shared";
import { Header, Screen } from "@/components/Screen";
import { Banner, Button, Card, Chip, Empty, Loading, Muted, ProgressBar } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { formatBytes, formatDay, formatElapsed, formatTime, percent } from "@/lib/format";
import { useLive } from "@/lib/liveReporter";
import { colors, fonts } from "@/lib/theme";
import { useQuery } from "@/lib/useQuery";
import { GameOps } from "@/native/gameops";
import type { UploadProgressEvent } from "@/native/types";

const STATUS: Record<RecordingStatus, { label: string; tone: "danger" | "info" | "success" | "warning" | "neutral" }> = {
  LIVE: { label: "Recording", tone: "danger" },
  STOPPED: { label: "Waiting to upload", tone: "warning" },
  UPLOADING: { label: "Uploading", tone: "info" },
  PROCESSING: { label: "Processing", tone: "info" },
  READY: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  DELETED: { label: "Deleted", tone: "neutral" },
};

export default function Recordings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useAuth();
  const uploads = useLive((s) => s.uploads);
  const q = useQuery(() => api.get<ListResponse<RecordingRow>>(`/api/manager/matches/${id}/recordings`).then((r) => r.items), [id]);

  // a finished upload changes the server status → refresh
  const doneCount = Object.values(uploads).filter((u) => u.state === "DONE").length;
  useEffect(() => {
    if (doneCount) void q.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount]);

  return (
    <Screen header={<Header back title="Recordings" subtitle="Match videos from this phone and others" />} refreshing={q.refreshing} onRefresh={q.refresh}>
      {q.loading && !q.data ? (
        <Loading />
      ) : q.error && !q.data ? (
        <Empty icon="cloud-offline-outline" title="Couldn't load recordings" text={q.error} action={<Button title="Try again" size="md" onPress={q.refresh} />} />
      ) : !q.data?.length ? (
        <Empty icon="videocam-outline" title="No recordings yet" text="Go live on this match to record it. Videos upload in the background after you stop." />
      ) : (
        q.data.map((r) => <RecordingCard key={r.id} r={r} local={uploads[r.id]} onRetry={async () => GameOps.retryUploads().then(q.reload)} />)
      )}
      {q.error && q.data ? <Banner tone="danger" text={q.error} /> : null}
    </Screen>
  );
}

function RecordingCard({ r, local, onRetry }: { r: RecordingRow; local?: UploadProgressEvent; onRetry: () => Promise<unknown> }) {
  const s = STATUS[r.status];
  const total = local?.totalBytes ?? r.sizeBytes ?? 0;
  const sent = local?.uploadedBytes ?? r.uploadedBytes;
  const uploading = r.status === "UPLOADING" || r.status === "STOPPED" || (local && local.state !== "DONE");
  const failed = r.status === "FAILED" || local?.state === "FAILED";
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Chip label={local?.state === "WAITING_FOR_WIFI" ? "Waiting for Wi-Fi" : s.label} tone={s.tone} />
        <View style={{ flex: 1 }} />
        <Text style={st.meta}>
          {formatDay(r.startedAt)} {formatTime(r.startedAt)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Fact label="Length" value={r.durationSec != null ? formatElapsed(r.durationSec * 1000) : "—"} />
        <Fact label="Size" value={formatBytes(r.sizeBytes ?? local?.totalBytes ?? null)} />
        <Fact label="Shots" value={`${r.captures.slotList} + ${r.captures.results}`} />
      </View>
      {r.deviceName ? <Muted style={{ fontSize: 13 }}>From {r.deviceName}</Muted> : null}
      {uploading && total > 0 ? (
        <View style={{ gap: 6 }}>
          <ProgressBar value={percent(sent, total)} tone={failed ? "danger" : "primary"} />
          <Muted style={{ fontSize: 13 }}>
            {formatBytes(sent)} of {formatBytes(total)} · {percent(sent, total)}%
          </Muted>
        </View>
      ) : null}
      {r.error || local?.error ? <Banner tone="danger" text={(local?.error ?? r.error)!} /> : null}
      {failed || r.status === "STOPPED" ? <Button title="Retry upload" icon="refresh" size="md" variant="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={st.factLabel}>{label}</Text>
      <Text style={st.factValue}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  meta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
  factLabel: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: colors.muted },
  factValue: { fontFamily: fonts.display, fontSize: 20, color: colors.fg },
});
