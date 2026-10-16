import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, type AuthResponse, type LoginInput, type SessionUser } from "@7xen/shared";
import { useTour } from "@7xen/ui/tour";
import { api } from "./api";

interface AuthCtx {
  user: SessionUser | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<SessionUser>;
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
      try {
        return (await api.get<AuthResponse>("/api/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
  const loginM = useMutation({
    mutationFn: (input: LoginInput) => api.post<AuthResponse>("/api/auth/login", input),
  });

  const user = me.data ?? null;
  useEffect(() => setUserKey(user?.id ?? null), [user?.id, setUserKey]);

  const value: AuthCtx = {
    user,
    isLoading: me.isLoading,
    login: async (input) => {
      const { user } = await loginM.mutateAsync(input);
      qc.clear();
      qc.setQueryData(ME_KEY, user);
      return user;
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

/** Home route for a role. */
export function homeFor(user: SessionUser | null) {
  if (!user) return "/login";
  return user.role === "MANAGER" ? "/manager" : "/team";
}
