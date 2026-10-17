import { router } from "expo-router";
import { View } from "react-native";
import type { ListResponse, LiveMatchCard } from "@7xen/shared";
import { Header, Screen } from "@/components/Screen";
import { MatchCardView } from "@/components/MatchCard";
import { Banner, Button, Empty, IconButton, Loading, Logo, Muted } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { matchCache } from "@/lib/matchCache";
import { useNow, useQuery } from "@/lib/useQuery";
import { GAMEOPS_IS_MOCK } from "@/native/gameops";
import { colors } from "@/lib/theme";

export default function Today() {
  const { api, user, offline } = useAuth();
  const now = useNow(1000);
  const q = useQuery(async () => {
    const res = await api.get<ListResponse<LiveMatchCard>>("/api/manager/live/today", { days: 2 });
    matchCache.setAll(res.items);
    return res.items;
  });

  return (
    <Screen
      header={
        <Header
          title={<Logo subtitle="Manager" size={30} />}
          right={
            <View style={{ flexDirection: "row" }}>
              <IconButton icon="settings-outline" label="Settings" onPress={() => router.push("/settings")} />
            </View>
          }
        />
      }
      refreshing={q.refreshing}
      onRefresh={q.refresh}
    >
      <View style={{ gap: 2 }}>
        <Muted>Hi {user?.displayName ?? "manager"} — your matches for today and tomorrow.</Muted>
      </View>
      {offline ? <Banner tone="warning" text="Can't reach the 7XEN server right now. Showing what we have — pull down to try again." /> : null}
      {GAMEOPS_IS_MOCK ? <Banner tone="info" title="Demo recorder" text="This build doesn't include the screen recorder yet — Go live runs a simulation." /> : null}

      {q.loading && !q.data ? (
        <Loading text="Loading today's matches…" />
      ) : q.error && !q.data ? (
        <Empty icon="cloud-offline-outline" title="Couldn't load matches" text={q.error} action={<Button title="Try again" size="md" onPress={q.refresh} />} />
      ) : q.data && q.data.length === 0 ? (
        <Empty
          title="No matches today"
          text="Scrim and tournament matches you manage for today and tomorrow show up here. Plan them on the 7XEN website."
          action={<Button title="Refresh" size="md" variant="secondary" icon="refresh" onPress={q.refresh} />}
        />
      ) : (
        q.data?.map((c) => <MatchCardView key={c.matchId} card={c} now={now} onPress={() => router.push({ pathname: "/match/[id]", params: { id: c.matchId } })} />)
      )}
      {q.error && q.data ? <Banner tone="danger" text={q.error} /> : null}
      <View style={{ height: 8, backgroundColor: colors.bg }} />
    </Screen>
  );
}
