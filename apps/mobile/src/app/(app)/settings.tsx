import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { AppRelease } from "@7xen/shared";
import { Header, Screen } from "@/components/Screen";
import { Banner, Button, Card, ConfirmSheet, Field, Muted, Section, Segmented, ToggleRow } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { appBuild, appVersion } from "@/lib/appInfo";
import { useAuth } from "@/lib/auth";
import { AUTO_WARNING } from "@/lib/copy";
import { formatBytes, formatDay } from "@/lib/format";
import { DEFAULT_SERVER_URL, normalizeServerUrl, resolveUrl } from "@/lib/server";
import { colors, fonts } from "@/lib/theme";
import { daysLeft } from "@/lib/token";
import { isUpdateAvailable } from "@/lib/update";
import { GAMEOPS_IS_MOCK } from "@/native/gameops";

export default function Settings() {
  const { prefs, updatePrefs, user, session, signOut, api } = useAuth();
  const [server, setServer] = useState(prefs.serverUrl);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [serverSaved, setServerSaved] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [checking, setChecking] = useState(false);
  const [release, setRelease] = useState<AppRelease | null | undefined>(undefined);
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  const saveServer = async () => {
    const url = normalizeServerUrl(server);
    if (!url) return setServerErr("Enter an address like 192.168.0.199 or https://7xen.example.com");
    setServerErr(null);
    setServer(url);
    await updatePrefs({ serverUrl: url });
    setServerSaved(true);
    setTimeout(() => setServerSaved(false), 2000);
  };

  const checkUpdate = async () => {
    setChecking(true);
    setUpdateErr(null);
    try {
      setRelease(await api.get<AppRelease | null>("/api/app/manager/latest"));
    } catch (e) {
      setUpdateErr(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const left = daysLeft(session);
  return (
    <Screen header={<Header back title="Settings" />}>
      <Section title="Account">
        <Card style={{ gap: 10 }}>
          <Text style={st.name}>{user?.displayName}</Text>
          <Muted>
            @{user?.username} · Manager{left != null ? ` · signed in for ${left} more day${left === 1 ? "" : "s"}` : ""}
          </Muted>
          <Button title="Sign out" icon="log-out-outline" variant="danger" size="md" onPress={() => setConfirmSignOut(true)} />
        </Card>
      </Section>

      <Section title="Server">
        <Card style={{ gap: 10 }}>
          <Field
            label="Server address"
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder={DEFAULT_SERVER_URL}
            error={serverErr}
            hint="The 7XEN computer on your Wi-Fi, or its public web address."
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title={serverSaved ? "Saved ✓" : "Save"} size="md" onPress={saveServer} style={{ flex: 1 }} />
            <Button title="Reset" size="md" variant="secondary" onPress={() => setServer(DEFAULT_SERVER_URL)} style={{ flex: 1 }} />
          </View>
        </Card>
      </Section>

      <Section title="Going live">
        <Card style={{ gap: 12 }}>
          <Text style={st.label}>Default room mode</Text>
          <Segmented
            value={prefs.defaultMode}
            onChange={(v) => (v === "AUTO" ? setConfirmAuto(true) : void updatePrefs({ defaultMode: "ASSISTED" }))}
            options={[
              { value: "ASSISTED", label: "Assisted" },
              { value: "AUTO", label: "Auto" },
            ]}
          />
          {prefs.defaultMode === "AUTO" ? <Banner tone="danger" text={AUTO_WARNING} /> : null}
          <Muted style={{ fontSize: 13 }}>Go live always starts on Assisted; Auto has to be confirmed for each match.</Muted>
          <Text style={st.label}>Video quality</Text>
          <Segmented
            value={prefs.quality}
            onChange={(v) => void updatePrefs({ quality: v })}
            options={[
              { value: "720p", label: "720p · smaller" },
              { value: "1080p", label: "1080p · sharper" },
            ]}
          />
          <View>
            <ToggleRow title="Upload videos on Wi-Fi only" text="Match videos are 300–600 MB. Screenshots always upload right away." value={prefs.wifiOnly} onChange={(v) => void updatePrefs({ wifiOnly: v })} />
            <ToggleRow title="Auto-capture screenshots" text="Team list and results are captured when the app sees them." value={prefs.autoCapture} onChange={(v) => void updatePrefs({ autoCapture: v })} />
            <ToggleRow title="Open BGMI after Go live" value={prefs.launchBgmi} onChange={(v) => void updatePrefs({ launchBgmi: v })} />
          </View>
        </Card>
      </Section>

      <Section title="Recipes">
        <Card onPress={() => router.push("/teach")} style={{ gap: 4 }}>
          <Text style={st.label}>Teach a recipe</Text>
          <Muted>Record your own taps for creating the room, so the checklist matches your phone.</Muted>
        </Card>
      </Section>

      <Section title="About">
        <Card style={{ gap: 10 }}>
          <Text style={st.name}>
            7XEN Manager <Text style={{ color: colors.muted, fontSize: 16 }}>v{appVersion} ({appBuild})</Text>
          </Text>
          <Muted>Match-day companion: room details, screen recording and automatic screenshots.</Muted>
          {GAMEOPS_IS_MOCK ? <Banner tone="info" text="This build uses the demo recorder (no native screen recording)." /> : null}
          {updateErr ? <Banner tone="danger" text={updateErr} /> : null}
          {release === null ? <Banner tone="success" text="No update published yet." /> : null}
          {release ? (
            isUpdateAvailable(release, appBuild) ? (
              <Banner
                tone="info"
                title={`Update available: v${release.version}`}
                text={`${formatBytes(release.sizeBytes)} · ${formatDay(release.publishedAt)}${release.notes ? `\n${release.notes}` : ""}\nAfter downloading, open the file and tap Install (allow “Install unknown apps” for your browser if asked).`}
                action={<Button title="Download update" icon="download-outline" size="md" onPress={() => void Linking.openURL(resolveUrl(prefs.serverUrl, release.url))} />}
              />
            ) : (
              <Banner tone="success" text={`You're up to date (latest v${release.version}).`} />
            )
          ) : null}
          <Button title="Check for updates" icon="refresh" variant="secondary" size="md" loading={checking} onPress={checkUpdate} />
        </Card>
      </Section>

      <ConfirmSheet
        visible={confirmAuto}
        tone="danger"
        title="Make Auto the default?"
        text={AUTO_WARNING}
        confirmTitle="I understand"
        onConfirm={() => {
          setConfirmAuto(false);
          void updatePrefs({ defaultMode: "AUTO" });
        }}
        onCancel={() => setConfirmAuto(false)}
      />
      <ConfirmSheet
        visible={confirmSignOut}
        tone="danger"
        title="Sign out?"
        text="You'll need your username and password to sign in again. Recordings already queued keep uploading."
        confirmTitle="Sign out"
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  name: { fontFamily: fonts.display, fontSize: 22, color: colors.fg },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.fg },
});
