/** Persistent storage: token + user + prefs in expo-secure-store (Android Keystore-backed). */
import * as SecureStore from "expo-secure-store";
import type { SessionUser } from "@7xen/shared";
import { parsePrefs, type Prefs } from "./prefs";
import { parseStoredSession, type StoredSession } from "./token";

const K = { session: "7xen.session", user: "7xen.user", prefs: "7xen.prefs" } as const;

async function get(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export const storage = {
  async loadSession(): Promise<StoredSession | null> {
    return parseStoredSession(await get(K.session));
  },
  async saveSession(s: StoredSession, user: SessionUser) {
    await SecureStore.setItemAsync(K.session, JSON.stringify(s));
    await SecureStore.setItemAsync(K.user, JSON.stringify(user));
  },
  async saveUser(user: SessionUser) {
    await SecureStore.setItemAsync(K.user, JSON.stringify(user));
  },
  async loadUser(): Promise<SessionUser | null> {
    const raw = await get(K.user);
    try {
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  },
  async clearSession() {
    await SecureStore.deleteItemAsync(K.session).catch(() => {});
    await SecureStore.deleteItemAsync(K.user).catch(() => {});
  },
  async loadPrefs(): Promise<Prefs> {
    return parsePrefs(await get(K.prefs));
  },
  async savePrefs(p: Prefs) {
    await SecureStore.setItemAsync(K.prefs, JSON.stringify(p));
  },
};
