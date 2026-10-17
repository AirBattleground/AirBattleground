/** Small UI kit for the 7XEN Manager app — dark ember look, big tap targets. */
import { type ComponentProps, type ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { colors, fonts, radius } from "@/lib/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// ---------- text ----------
export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h2, style]}>{children}</Text>;
}
export function Body({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text style={[s.body, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}
export function Muted({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text style={[s.muted, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}
/** "— PLAYER ACCESS" style kicker */
export function Kicker({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: 10 }, style]}>
      <View style={{ height: 1, width: 22, backgroundColor: colors.primary }} />
      <Text style={s.kicker}>{children}</Text>
    </View>
  );
}

// ---------- brand ----------
export function Logo({ subtitle, size = 34 }: { subtitle?: string; size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Image source={require("../../assets/logo-mark.png")} style={{ width: size, height: size }} contentFit="contain" />
      <View>
        <Text style={[s.wordmark, { fontSize: size * 0.72 }]}>
          7<Text style={{ color: colors.primary }}>XEN</Text>
        </Text>
        {subtitle ? <Text style={s.wordSub}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

// ---------- buttons ----------
type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";
export function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  style,
  size = "lg",
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: "lg" | "md" | "sm";
}) {
  const v = VARIANTS[variant];
  const h = size === "lg" ? 54 : size === "md" ? 46 : 38;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      android_ripple={{ color: "rgba(255,255,255,0.12)" }}
      style={({ pressed }) => [
        s.btn,
        { height: h, backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.45 : pressed ? 0.85 : 1, paddingHorizontal: size === "sm" ? 12 : 18 },
        variant === "primary" && !disabled ? s.glow : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === "sm" ? 16 : 20} color={v.fg} /> : null}
          <Text style={[s.btnText, { color: v.fg, fontSize: size === "sm" ? 14 : 16 }]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
const VARIANTS: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.primaryFg, border: colors.primary },
  secondary: { bg: colors.cardHi, fg: colors.fg, border: colors.borderStrong },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: "rgba(245,71,72,0.35)" },
  success: { bg: colors.successBg, fg: colors.success, border: "rgba(50,195,100,0.35)" },
  ghost: { bg: "transparent", fg: colors.muted, border: "transparent" },
};

export function IconButton({ icon, onPress, label, color = colors.fg }: { icon: IconName; onPress: () => void; label: string; color?: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => [s.iconBtn, pressed && { backgroundColor: colors.cardHi }]}>
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

// ---------- containers ----------
export function Card({ children, style, onPress, highlight }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; highlight?: boolean }) {
  const st = [s.card, highlight && { borderColor: "rgba(255,95,15,0.45)" }, style];
  if (!onPress) return <View style={st}>{children}</View>;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: "rgba(255,255,255,0.06)" }} style={({ pressed }) => [...st, pressed && { backgroundColor: colors.cardHi }]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, children, right, style }: { title: string; children: ReactNode; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 10 }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={s.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

// ---------- chips / badges ----------
type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: "rgba(255,255,255,0.06)", fg: colors.muted, border: colors.border },
  primary: { bg: "rgba(255,95,15,0.14)", fg: colors.primaryHi, border: "rgba(255,95,15,0.35)" },
  success: { bg: colors.successBg, fg: colors.success, border: "rgba(50,195,100,0.3)" },
  warning: { bg: colors.warningBg, fg: colors.warning, border: "rgba(243,186,37,0.3)" },
  danger: { bg: colors.dangerBg, fg: colors.danger, border: "rgba(245,71,72,0.3)" },
  info: { bg: colors.infoBg, fg: colors.info, border: "rgba(46,177,239,0.3)" },
};
export function Chip({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONES[tone];
  return (
    <View style={[s.chip, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[s.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Banner({ tone = "info", title, text, icon, action }: { tone?: Tone; title?: string; text: string; icon?: IconName; action?: ReactNode }) {
  const t = TONES[tone];
  const ic: IconName = icon ?? (tone === "danger" ? "alert-circle" : tone === "warning" ? "warning" : tone === "success" ? "checkmark-circle" : "information-circle");
  return (
    <View style={[s.banner, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Ionicons name={ic} size={20} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[s.bannerTitle, { color: t.fg }]}>{title}</Text> : null}
        <Text style={[s.bannerText, { color: tone === "neutral" ? colors.muted : colors.fg }]}>{text}</Text>
        {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
      </View>
    </View>
  );
}

export function ProgressBar({ value, tone = "primary" }: { value: number; tone?: Tone }) {
  const c = tone === "primary" ? colors.primary : TONES[tone].fg;
  return (
    <View style={s.track}>
      <View style={[s.fill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: c }]} />
    </View>
  );
}

// ---------- inputs ----------
export function Field({
  label,
  error,
  hint,
  icon,
  right,
  ...props
}: ComponentProps<typeof TextInput> & { label: string; error?: string | null; hint?: string; icon?: IconName; right?: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, error ? { borderColor: "rgba(245,71,72,0.6)" } : null]}>
        {icon ? <Ionicons name={icon} size={18} color={colors.muted} /> : null}
        <TextInput placeholderTextColor={colors.faint} selectionColor={colors.primary} cursorColor={colors.primary} style={s.input} {...props} />
        {right}
      </View>
      {error ? <Text style={s.error}>{error}</Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function ToggleRow({ title, text, value, onChange, disabled }: { title: string; text?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable onPress={() => !disabled && onChange(!value)} style={s.toggleRow} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {text ? <Text style={s.rowText}>{text}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: "#2a303b", true: "rgba(255,95,15,0.55)" }}
        thumbColor={value ? colors.primary : "#c9ced6"}
      />
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.segItem, on && s.segOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            {o.icon ? <Ionicons name={o.icon} size={16} color={on ? colors.primaryFg : colors.muted} /> : null}
            <Text style={[s.segText, on && { color: colors.primaryFg }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- states ----------
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Muted>{text}</Muted>
    </View>
  );
}
export function Empty({ icon = "calendar-outline", title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={[s.center, { paddingVertical: 48 }]}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <H2 style={{ textAlign: "center" }}>{title}</H2>
      {text ? <Muted style={{ textAlign: "center", maxWidth: 300 }}>{text}</Muted> : null}
      {action}
    </View>
  );
}

/** Full-screen confirm sheet (the viewer has no Alert-free confirm for custom content). */
export function ConfirmSheet({
  visible,
  title,
  text,
  tone = "warning",
  confirmTitle,
  cancelTitle = "Cancel",
  onConfirm,
  onCancel,
  children,
}: {
  visible: boolean;
  title: string;
  text: string;
  tone?: Tone;
  confirmTitle: string;
  cancelTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={[s.sheetIcon, { backgroundColor: TONES[tone].bg, borderColor: TONES[tone].border }]}>
            <Ionicons name={tone === "danger" ? "alert-circle" : "warning"} size={28} color={TONES[tone].fg} />
          </View>
          <H2>{title}</H2>
          <Body style={{ color: colors.muted }}>{text}</Body>
          {children}
          <View style={{ gap: 10, marginTop: 8 }}>
            <Button title={confirmTitle} variant={tone === "danger" ? "danger" : "primary"} onPress={onConfirm} />
            <Button title={cancelTitle} variant="secondary" onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export const s = StyleSheet.create({
  h1: { fontFamily: fonts.display, fontSize: 34, lineHeight: 36, color: colors.fg, letterSpacing: 0.2 },
  h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: colors.fg, letterSpacing: 0.2 },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: colors.fg },
  muted: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: colors.muted },
  kicker: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 2.6, color: colors.primary, textTransform: "uppercase" },
  wordmark: { fontFamily: fonts.display, color: colors.fg, letterSpacing: 1.5, lineHeight: undefined },
  wordSub: { fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 2.4, color: colors.muted, textTransform: "uppercase", marginTop: -2 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: radius.md, borderWidth: 1, overflow: "hidden" },
  btnText: { fontFamily: fonts.semibold, letterSpacing: 0.2 },
  glow: { shadowColor: colors.primary, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, overflow: "hidden" },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 1.8, color: colors.muted, textTransform: "uppercase" },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, borderWidth: 1, alignSelf: "flex-start" },
  chipText: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  banner: { flexDirection: "row", gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 1 },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 14 },
  bannerText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20 },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  label: { fontFamily: fonts.medium, fontSize: 14, color: colors.fg },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 54, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.input },
  input: { flex: 1, fontFamily: fonts.text, fontSize: 16, color: colors.fg, paddingVertical: 12 },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  hint: { fontFamily: fonts.text, fontSize: 13, color: colors.muted },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingVertical: 8 },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.fg },
  rowText: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: colors.muted },
  seg: { flexDirection: "row", backgroundColor: colors.bgRaised, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 },
  segItem: { flex: 1, minHeight: 46, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segOn: { backgroundColor: colors.primary },
  segText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,95,15,0.12)", borderWidth: 1, borderColor: "rgba(255,95,15,0.3)" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.borderStrong, padding: 22, paddingBottom: 34, gap: 12 },
  sheetIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1 },
});
