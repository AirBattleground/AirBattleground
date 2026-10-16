import { createApiClient } from "@7xen/shared";
import { queryClient } from "./query";

/** All requests go to /api (proxied to the API in dev). 401 → clear cached session. */
export const api = createApiClient({
  onUnauthenticated: () => {
    queryClient.setQueryData(["auth", "me"], null);
  },
});
