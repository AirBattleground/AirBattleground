import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type AuthConfig, type AuthResponse, type SessionUser } from "@7xen/shared";
import { useTour } from "@7xen/ui/tour";
import { api } from "./api";

interface AuthCtx {
  user: SessionUser | null;
  isLoading: boolean;
  /** Google Identity Services ID token → admin session (403 when it isn't the admin account) */
  loginWithGoogle: (credential: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export const ME_KEY = ["admin", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setUserKey } = useTour();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await api.get<AuthResponse>("/api/admin/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000, // short, so refocusing an idle tab re-checks the session and a dead one lands on login
  });
  const loginM = useMutation({
    mutationFn: (credential: string) => api.post<AuthResponse>("/api/admin/auth/google", { credential }),
  });

  const user = me.data ?? null;
  useEffect(() => setUserKey(user?.id ?? null), [user?.id, setUserKey]);

  const value: AuthCtx = {
    user,
    isLoading: me.isLoading,
    loginWithGoogle: async (credential) => {
      const { user } = await loginM.mutateAsync(credential);
      qc.clear();
      qc.setQueryData(ME_KEY, user);
      return user;
    },
    logout: async () => {
      await api.post("/api/admin/auth/logout").catch(() => undefined);
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


/** Google client id + dev flag (same endpoint as the main app; same origin via the proxy). */
export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth", "config"],
    queryFn: () => api.get<AuthConfig>("/api/auth/config"),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}
