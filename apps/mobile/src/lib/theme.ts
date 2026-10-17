/** 7XEN dark "ember" palette — mirrors packages/ui/src/styles/globals.css (.dark), converted from oklch. */
export const colors = {
  bg: "#070a10",
  bgRaised: "#0b0e16",
  card: "#10141c",
  cardHi: "#161b25",
  border: "rgba(255,255,255,0.09)",
  borderStrong: "rgba(255,255,255,0.16)",
  input: "rgba(255,255,255,0.06)",
  fg: "#f0f2f5",
  muted: "#9299a5",
  faint: "#5f6672",
  primary: "#ff5f0f",
  primaryHi: "#ff7a36",
  primaryLo: "#b02e00",
  primaryFg: "#ffffff",
  accent: "#3a221a",
  accentFg: "#ffd3bb",
  danger: "#f54748",
  dangerBg: "rgba(245,71,72,0.12)",
  success: "#32c364",
  successBg: "rgba(50,195,100,0.12)",
  warning: "#f3ba25",
  warningBg: "rgba(243,186,37,0.12)",
  info: "#2eb1ef",
  infoBg: "rgba(46,177,239,0.12)",
  glow: "rgba(255,95,15,0.45)",
} as const;

export const fonts = {
  display: "Rajdhani_700Bold",
  displaySemi: "Rajdhani_600SemiBold",
  text: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22 } as const;
export const space = (n: number) => n * 4;
