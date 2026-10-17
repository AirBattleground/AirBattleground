import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "@/lib/theme";

export function PermissionRow({
  ok,
  title,
  text,
  required,
  actionTitle = "Allow",
  onPress,
}: {
  ok: boolean;
  title: string;
  text: string;
  required?: boolean;
  actionTitle?: string;
  onPress?: () => void;
}) {
  return (
    <View style={st.row}>
      <Ionicons name={ok ? "checkmark-circle" : required ? "ellipse-outline" : "remove-circle-outline"} size={26} color={ok ? colors.success : required ? colors.warning : colors.muted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={st.title}>
          {title}
          {!required ? <Text style={st.optional}>  · recommended</Text> : null}
        </Text>
        <Text style={st.text}>{text}</Text>
      </View>
      {!ok && onPress ? (
        <Pressable onPress={onPress} style={({ pressed }) => [st.btn, pressed && { opacity: 0.8 }]} accessibilityRole="button">
          <Text style={st.btnText}>{actionTitle}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.fg },
  optional: { fontFamily: fonts.text, fontSize: 12, color: colors.muted },
  text: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: colors.muted },
  btn: { minHeight: 42, minWidth: 72, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(255,95,15,0.16)", borderWidth: 1, borderColor: "rgba(255,95,15,0.4)", alignItems: "center", justifyContent: "center" },
  btnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primaryHi },
});
