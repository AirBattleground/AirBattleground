import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ME_KEY } from "@/lib/auth";
import { wasExplicitLogout } from "@/lib/session";

const ME_HASH = JSON.stringify(ME_KEY);

/**
 * While the shell is mounted, watch the session query. If it flips to `null` without the
 * user pressing "Sign out" (a 401 somewhere), tell them why they're back at the login screen.
 * RequireRole does the redirect itself.
 */
export function useSessionExpiryToast() {
  const qc = useQueryClient();
  useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        if (e.type !== "updated" || e.action.type !== "success") return;
        if (JSON.stringify(e.query.queryKey) !== ME_HASH) return;
        if (e.query.state.data !== null || wasExplicitLogout()) return;
        toast.warning("Your session expired, please sign in again", { id: "session-expired" });
      }),
    [qc],
  );
}
