import { useRef, useState, type ComponentRef } from "react";
import { Dimensions, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, mobileLoginSchema } from "@7xen/shared";
import { Banner, Body, Button, Field, H1, Kicker, Logo, Muted } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/api";
import { DEFAULT_SERVER_URL, normalizeServerUrl } from "@/lib/server";
import { colors, fonts } from "@/lib/theme";

const { width: W } = Dimensions.get("window");
const ART_H = Math.round(Math.min(380, W * 0.95));

export default function SignIn() {
  const { signIn, prefs, updatePrefs, signOutReason } = useAuth();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ username?: string; password?: string }>({});
  const [serverOpen, setServerOpen] = useState(false);
  const [server, setServer] = useState(prefs.serverUrl);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const pwRef = useRef<ComponentRef<typeof TextInput>>(null);

  const saveServer = async () => {
    const url = normalizeServerUrl(server);
    if (!url) return setServerErr("Enter an address like 192.168.0.199 or https://7xen.example.com");
    setServerErr(null);
    setServer(url);
    await updatePrefs({ serverUrl: url });
    setServerOpen(false);
  };

  const submit = async () => {
    setFormError(null);
    const parsed = mobileLoginSchema.safeParse({ username, password });
    if (!parsed.success) {
      const f: { username?: string; password?: string } = {};
      for (const i of parsed.error.issues) f[i.path[0] as "username" | "password"] ??= i.message;
      setFieldErr(f);
      return;
    }
    setFieldErr({});
    setBusy(true);
    try {
      await signIn(parsed.data.username, parsed.data.password);
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErr({ username: e.fields.username, password: e.fields.password });
      setFormError(errorMessage(e));
      pwRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
        {/* artwork: Erangel map + squad, fading into the form like the web login */}
        <View style={{ height: ART_H + insets.top }}>
          <Image source={require("../../assets/erangel.webp")} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={["rgba(7,10,16,0.55)", "rgba(7,10,16,0.15)", "rgba(7,10,16,0.65)"]} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={["rgba(255,95,15,0.22)", "transparent"]} start={{ x: 1, y: 0 }} end={{ x: 0.2, y: 0.7 }} style={StyleSheet.absoluteFill} />
          <Image source={require("../../assets/squad.webp")} style={[st.squad, { height: ART_H * 0.92 }]} contentFit="contain" contentPosition="bottom" />
          <LinearGradient colors={["transparent", "rgba(7,10,16,0.85)", colors.bg]} locations={[0.45, 0.82, 1]} style={StyleSheet.absoluteFill} />
          <View style={[st.logo, { top: insets.top + 14 }]}>
            <Logo subtitle="Manager" />
          </View>
        </View>

        <View style={st.form}>
          <Kicker>Match day</Kicker>
          <H1 style={{ fontSize: 40, lineHeight: 42 }}>Welcome back.</H1>
          <Muted>Sign in with your 7XEN manager account to run today&apos;s matches.</Muted>

          {signOutReason && !formError ? <Banner tone="warning" text={signOutReason} /> : null}
          {formError ? <Banner tone="danger" text={formError} /> : null}

          <Field
            label="Username"
            icon="person-outline"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            placeholder="your-username"
            returnKeyType="next"
            onSubmitEditing={() => pwRef.current?.focus()}
            error={fieldErr.username}
          />
          <Field
            ref={pwRef}
            label="Password"
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!show}
            autoComplete="current-password"
            placeholder="Enter your password"
            returnKeyType="go"
            onSubmitEditing={submit}
            error={fieldErr.password}
            right={
              <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} accessibilityLabel={show ? "Hide password" : "Show password"}>
                <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
              </Pressable>
            }
          />
          <Button title="Sign in" icon="arrow-forward" onPress={submit} loading={busy} style={{ marginTop: 6 }} />

          {/* server address */}
          <View style={st.server}>
            <Pressable style={st.serverRow} onPress={() => setServerOpen((v) => !v)} accessibilityRole="button">
              <Ionicons name="server-outline" size={18} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={st.serverLabel}>Server</Text>
                <Text style={st.serverValue} numberOfLines={1}>
                  {prefs.serverUrl}
                </Text>
              </View>
              <Text style={st.serverEdit}>{serverOpen ? "Close" : "Change"}</Text>
            </Pressable>
            {serverOpen ? (
              <View style={{ gap: 10, paddingTop: 6 }}>
                <Field
                  label="Server address"
                  value={server}
                  onChangeText={setServer}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder={DEFAULT_SERVER_URL}
                  error={serverErr}
                  hint="The 7XEN computer on your Wi-Fi (e.g. 192.168.0.199) or its web address."
                  onSubmitEditing={saveServer}
                />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button title="Save" size="md" onPress={saveServer} style={{ flex: 1 }} />
                  <Button title="Reset" size="md" variant="secondary" onPress={() => setServer(DEFAULT_SERVER_URL)} style={{ flex: 1 }} />
                </View>
              </View>
            ) : null}
          </View>
          <Body style={st.foot}>Manager accounts only · Made for the game.</Body>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  squad: { position: "absolute", left: -W * 0.08, right: -W * 0.08, bottom: 0 },
  logo: { position: "absolute", left: 18 },
  form: { paddingHorizontal: 20, marginTop: -36, gap: 14 },
  server: { marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12 },
  serverRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  serverLabel: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.4, textTransform: "uppercase", color: colors.muted },
  serverValue: { fontFamily: fonts.medium, fontSize: 14, color: colors.fg },
  serverEdit: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  foot: { textAlign: "center", color: colors.faint, fontSize: 12, marginTop: 6 },
});
