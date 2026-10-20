/**
 * Server errors players hit most, by error code, in Hindi / Hinglish. The API answers in English; lib/api.ts swaps
 * the message for these codes when the page is in Hindi or Hinglish. Codes whose wording depends on the situation
 * (VALIDATION_ERROR, CONFLICT, NOT_FOUND, FORBIDDEN) keep the server's English text.
 */
import type { Language } from "@7xen/shared";

type Translated = Partial<Record<string, string>>;

const HI: Translated = {
  NO_TEAM: "पहले एक टीम बनाएँ या किसी टीम में जुड़ें।",
  LEADER_ONLY: "यह सिर्फ़ आपका टीम लीडर कर सकता है — “लीडर से कहें” दबाएँ।",
  ALREADY_IN_TEAM: "आप पहले से एक टीम में हैं। दूसरी टीम में जुड़ने से पहले उसे छोड़ें।",
  TEAM_FULL: "यह टीम भर चुकी है।",
  BGMI_ID_REQUIRED: "पहले अपनी BGMI ID जोड़ें। यह आपके इन-गेम प्रोफ़ाइल पर मिलेगी।",
  BGMI_ID_TAKEN: "यह BGMI ID पहले से किसी दूसरे अकाउंट से जुड़ी है।",
  INVITE_INVALID: "यह इनवाइट लिंक अब काम नहीं करता। टीम लीडर से नया लिंक माँगें।",
  JOIN_REQUEST_PENDING: "आपने पहले ही एक टीम में जुड़ने की रिक्वेस्ट भेजी है। पहले उसे रद्द करें।",
  REGISTRATION_CLOSED: "इसका रजिस्ट्रेशन बंद हो चुका है।",
  SLOTS_FULL: "सारे स्लॉट भर चुके हैं।",
  UNAUTHENTICATED: "जारी रखने के लिए कृपया साइन इन करें।",
  RATE_LIMITED: "बहुत ज़्यादा कोशिशें हुईं। थोड़ी देर बाद फिर कोशिश करें।",
  INTERNAL: "सर्वर से कनेक्ट नहीं हो पा रहा। इंटरनेट चेक करके फिर कोशिश करें।",
};

const HINGLISH: Translated = {
  NO_TEAM: "Pehle ek team banao ya kisi team mein join karo.",
  LEADER_ONLY: "Ye sirf tumhara team leader kar sakta hai — “Leader se bolo” dabao.",
  ALREADY_IN_TEAM: "Tum pehle se ek team mein ho. Dusri team join karne se pehle use chhodo.",
  TEAM_FULL: "Ye team full ho chuki hai.",
  BGMI_ID_REQUIRED: "Pehle apni BGMI ID add karo. Ye tumhari in-game profile pe milegi.",
  BGMI_ID_TAKEN: "Ye BGMI ID pehle se kisi aur account se judi hai.",
  INVITE_INVALID: "Ye invite link ab kaam nahi karta. Team leader se naya link maango.",
  JOIN_REQUEST_PENDING: "Tumne pehle hi ek team join request bheji hai. Pehle use cancel karo.",
  REGISTRATION_CLOSED: "Iska registration band ho chuka hai.",
  SLOTS_FULL: "Saare slots bhar chuke hain.",
  UNAUTHENTICATED: "Aage badhne ke liye sign in karo.",
  RATE_LIMITED: "Bahut zyada try ho gaya. Thodi der baad phir try karo.",
  INTERNAL: "Server se connect nahi ho pa raha. Internet check karke phir try karo.",
};

/** Hindi/Hinglish text for a known error code, or null to keep the server's message. */
export function translatedError(lang: Language, code: string): string | null {
  if (lang === "hi") return HI[code] ?? null;
  if (lang === "hinglish") return HINGLISH[code] ?? null;
  return null;
}

/** Current page language from <html lang> (set by LocaleProvider), usable outside React. */
export function pageLanguage(): Language {
  const l = typeof document !== "undefined" ? document.documentElement.lang : "en";
  return l === "hi" ? "hi" : l === "hi-Latn" ? "hinglish" : "en";
}
