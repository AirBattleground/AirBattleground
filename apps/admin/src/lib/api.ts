import { createApiClient } from "@7xen/shared";
import { queryClient } from "./query";

export const api = createApiClient({
  onUnauthenticated: () => {
    queryClient.setQueryData(["admin", "me"], null);
  },
});
