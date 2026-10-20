import { ApiError, createApiClient } from "@7xen/shared";
import { pageLanguage, translatedError } from "@/i18n/errors";
import { queryClient } from "./query";

/** All requests go to /api (proxied to the API in dev). 401 → clear cached session. */
const client = createApiClient({
  onUnauthenticated: () => {
    queryClient.setQueryData(["auth", "me"], null);
  },
});

/** Known error codes come back in the player's language (Hindi / Hinglish); everything else is untouched. */
function localized<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  return async (...a: A): Promise<R> => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof ApiError) {
        const msg = translatedError(pageLanguage(), e.code);
        if (msg) throw new ApiError(e.status, e.code, msg, e.fields);
      }
      throw e;
    }
  };
}

export const api: typeof client = {
  get: localized(client.get) as typeof client.get,
  post: localized(client.post) as typeof client.post,
  patch: localized(client.patch) as typeof client.patch,
  put: localized(client.put) as typeof client.put,
  del: localized(client.del) as typeof client.del,
};
