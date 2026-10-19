import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type AuthResponse, type DevLoginInput, type SessionUser } from "@7xen/shared";
import { useTour } from "@7xen/ui/tour";
import { api } from "./api";

interface AuthCtx {
  user: SessionUser | null;
  isLoading: boolean;
  /** everyone (player / manager / admin — role comes from the email): Google Identity Services ID token */
  loginWithGoogle: (credential: string) => Promise<SessionUser>;
  /** dev only (PLAYER_DEV_LOGIN=1); same email → role rules as Google */
  devLogin: (input: DevLoginInput) => Promise<SessionUser>;
  /** re-read the session (after onboarding / team changes) */
  refresh: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export const ME_KEY = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setUserKey } = useTour();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      // index.html starts GET /api/auth/me while the app code downloads; use that answer once (saves a round trip on slow links)
      const early = (window as { __sxMe?: Promise<SessionUser | null | undefined> }).__sxMe;
      if (early) {
        delete (window as { __sxMe?: unknown }).__sxMe;
        const u = await early;
        if (u !== undefined) return u;
      }
      try {
        return (await api.get<AuthResponse>("/api/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
  // Google / dev sign-in. Going through a mutation re-renders this provider, so the `me` observer
  // re-attaches to the fresh cache entry after qc.clear().
  const playerM = useMutation({
    mutationFn: (v: { path: string; body: unknown }) => api.post<AuthResponse>(v.path, v.body),
  });
  const start = async (path: string, body: unknown) => {
    const { user } = await playerM.mutateAsync({ path, body });
    qc.clear();
    qc.setQueryData(ME_KEY, user);
    return user;
  };

  const user = me.data ?? null;
  useEffect(() => setUserKey(user?.id ?? null), [user?.id, setUserKey]);

  const value: AuthCtx = {
    user,
    isLoading: me.isLoading,
    loginWithGoogle: (credential) => start("/api/auth/google", { credential }),
    devLogin: (input) => start("/api/auth/dev-login", input),
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ME_KEY });
      return qc.getQueryData<SessionUser | null>(ME_KEY) ?? null;
    },
    logout: async () => {
      await api.post("/api/auth/logout").catch(() => undefined);
      qc.clear();
      qc.setQueryData(ME_KEY, null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Home route for a role. Players who haven't picked an IGN yet go to onboarding first.
 *  Admins live in the separate admin console — /login sends them there (full page load). */
export function homeFor(user: SessionUser | null) {
  if (!user || user.role === "ADMIN") return "/login";
  if (user.role === "MANAGER") return "/manager";
  return user.player?.needsOnboarding ? "/welcome" : "/team";
}

/** Player helpers: team summary + whether the caller leads it. */
export function usePlayerSession() {
  const { user } = useAuth();
  const player = user?.role === "PLAYER" ? user.player : null;
  const team = player?.team ?? null;
  return { user, player, team, isLeader: team?.role === "LEADER", hasTeam: !!team };
}
