/**
 * Session + preferences for the whole app. Signs in with POST /api/auth/token, keeps the bearer token in
 * SecureStore, re-checks it with GET /api/auth/me on launch / when the app comes back / every 10 minutes,
 * and signs out on 401.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as Device from "expo-device";
import { ApiError, type AuthResponse, type MobileTokenResponse, type SessionUser } from "@7xen/shared";
import { createBearerClient, type BearerClient } from "./api";
import { DEFAULT_PREFS, type Prefs } from "./prefs";
import { storage } from "./storage";
import { isExpired, type StoredSession } from "./token";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthCtx {
  status: Status;
  user: SessionUser | null;
  session: StoredSession | null;
  prefs: Prefs;
  api: BearerClient;
  /** set when the last /me check couldn't reach the server (we keep you signed in, offline) */
  offline: boolean;
  signIn(username: string, password: string): Promise<SessionUser>;
  signOut(reason?: string): Promise<void>;
  /** message to show on the sign-in screen after an automatic sign-out */
  signOutReason: string | null;
  updatePrefs(patch: Partial<Prefs>): Promise<void>;
  refreshMe(): Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function deviceName(): string {
  const parts = [Device.manufacturer, Device.modelName].filter(Boolean);
  return (parts.join(" ") || "Android phone").slice(0, 80);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [offline, setOffline] = useState(false);
  const [signOutReason, setSignOutReason] = useState<string | null>(null);

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const signOut = useCallback(async (reason?: string) => {
    await storage.clearSession();
    sessionRef.current = null;
    setSession(null);
    setUser(null);
    setSignOutReason(reason ?? null);
    setStatus("signedOut");
  }, []);

  const api = useMemo(
    () =>
      createBearerClient({
        getBaseUrl: () => prefsRef.current.serverUrl,
        getToken: () => sessionRef.current?.token ?? null,
        onUnauthenticated: () => void signOut("Your sign-in has expired. Please sign in again."),
      }),
    [signOut],
  );

  const refreshMe = useCallback(async () => {
    if (!sessionRef.current) return;
    if (isExpired(sessionRef.current)) return signOut("Your sign-in has expired. Please sign in again.");
    try {
      const { user: u } = await api.get<AuthResponse>("/api/auth/me");
      if (u.role !== "MANAGER") return signOut("The 7XEN Manager app is for manager accounts only.");
      setUser(u);
      setOffline(false);
      await storage.saveUser(u);
    } catch (e) {
      // 401 already signed us out (onUnauthenticated); anything else = server unreachable → stay signed in
      if (!(e instanceof ApiError && e.status === 401)) setOffline(true);
    }
  }, [api, signOut]);

  // boot: prefs + stored session
  useEffect(() => {
    (async () => {
      const [p, s, u] = await Promise.all([storage.loadPrefs(), storage.loadSession(), storage.loadUser()]);
      prefsRef.current = p;
      setPrefs(p);
      if (s && u && !isExpired(s)) {
        sessionRef.current = s;
        setSession(s);
        setUser(u);
        setStatus("signedIn");
        void refreshMe();
      } else {
        if (s) await storage.clearSession();
        setStatus("signedOut");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-check when the app returns to the foreground, and every 10 minutes
  useEffect(() => {
    if (status !== "signedIn") return;
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refreshMe());
    const t = setInterval(() => void refreshMe(), 10 * 60_000);
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [status, refreshMe]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const res = await api.post<MobileTokenResponse>("/api/auth/token", { username, password, deviceName: deviceName() }, { auth: false });
      if (res.user.role !== "MANAGER") throw new ApiError(403, "FORBIDDEN", "The 7XEN Manager app is for manager accounts only.");
      const s = { token: res.token, expiresAt: res.expiresAt };
      await storage.saveSession(s, res.user);
      sessionRef.current = s;
      setSession(s);
      setUser(res.user);
      setOffline(false);
      setSignOutReason(null);
      setStatus("signedIn");
      return res.user;
    },
    [api],
  );

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    await storage.savePrefs(next);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ status, user, session, prefs, api, offline, signIn, signOut, signOutReason, updatePrefs, refreshMe }),
    [status, user, session, prefs, api, offline, signIn, signOut, signOutReason, updatePrefs, refreshMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
