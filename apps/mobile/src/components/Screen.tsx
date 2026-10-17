import { type ReactNode } from "react";
import { KeyboardAvoidingView, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors, fonts } from "@/lib/theme";
import { IconButton } from "./ui";

/** Page header with optional back button and right-side actions. */
export function Header({ title, subtitle, back, right }: { title: ReactNode; subtitle?: string; back?: boolean; right?: ReactNode }) {
  return (
    <View style={st.header}>
      {back ? <IconButton icon="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : null}
      <View style={{ flex: 1, paddingLeft: back ? 2 : 4 }}>
        {typeof title === "string" ? (
          <Text style={st.title} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle ? (
          <Text style={st.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Scrollable page with safe-area padding, optional pull-to-refresh and a sticky footer. */
export function Screen({
  header,
  children,
  refreshing,
  onRefresh,
  footer,
  scroll = true,
}: {
  header?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={undefined}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>{header}</View>
      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: footer ? 24 : insets.bottom + 32, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} progressBackgroundColor={colors.card} tintColor={colors.primary} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer ? <View style={[st.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 60, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.fg, letterSpacing: 0.3 },
  subtitle: { fontFamily: fonts.text, fontSize: 13, color: colors.muted, marginTop: -2 },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bgRaised, gap: 10 },
});
