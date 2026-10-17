import { useEffect } from "react";
import { Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { liveReporter } from "@/lib/liveReporter";
import { colors } from "@/lib/theme";

export default function AppLayout() {
  const { api } = useAuth();
  useEffect(() => {
    liveReporter.attach(api);
    return () => liveReporter.detach();
  }, [api]);
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "slide_from_right" }} />;
}
