import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { Rajdhani_600SemiBold, Rajdhani_700Bold } from "@expo-google-fonts/rajdhani";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { Ionicons } from "@expo/vector-icons";
import { AuthProvider, useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync().catch(() => {});
void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

function RootStack() {
  const { status } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
  });
  const ready = (fontsLoaded || !!fontError) && status !== "loading";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const signedIn = status === "signedIn";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "slide_from_right" }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ animation: "fade" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <AuthProvider>
        <RootStack />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
