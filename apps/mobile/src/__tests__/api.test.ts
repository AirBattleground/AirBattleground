import { ApiError } from "@7xen/shared";
import { buildUrl, createBearerClient, errorMessage } from "@/lib/api";

function res(status: number, body?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

function setup(token: string | null = "tok123") {
  const fetchImpl = jest.fn();
  const onUnauthenticated = jest.fn();
  const api = createBearerClient({ getBaseUrl: () => "http://192.168.0.199/", getToken: () => token, onUnauthenticated, fetchImpl: fetchImpl as unknown as typeof fetch });
  return { api, fetchImpl, onUnauthenticated };
}

describe("buildUrl", () => {
  it("joins base and path, drops empty query values", () => {
    expect(buildUrl("http://h/", "/api/x", { days: 2, q: "", z: undefined, s: "a b" })).toBe("http://h/api/x?days=2&s=a%20b");
    expect(buildUrl("http://h", "/api/x")).toBe("http://h/api/x");
  });
});

describe("createBearerClient", () => {
  it("sends the bearer token and JSON body", async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(res(200, { ok: 1 }));
    await expect(api.put("/api/manager/matches/m1/room", { roomId: "1234" })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://192.168.0.199/api/manager/matches/m1/room");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer tok123");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ roomId: "1234" });
    expect(init.credentials).toBeUndefined();
  });

  it("omits the token for auth:false (sign-in) and with no token", async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(res(200, { token: "t" }));
    await api.post("/api/auth/token", { username: "a", password: "b" }, { auth: false });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();

    const s2 = setup(null);
    s2.fetchImpl.mockResolvedValue(res(200, {}));
    await s2.api.get("/api/app/manager/latest");
    expect(s2.fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("returns undefined for 204", async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(res(204));
    await expect(api.del("/api/manager/matches/m1/room")).resolves.toBeUndefined();
  });

  it("throws ApiError with the server's message and fields", async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(res(400, { error: { code: "VALIDATION_ERROR", message: "Room ID is 4–12 digits", fields: { roomId: "Room ID is 4–12 digits" } } }));
    const err = (await api.put("/x", {}).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.fields).toEqual({ roomId: "Room ID is 4–12 digits" });
    expect(errorMessage(err)).toBe("Room ID is 4–12 digits");
  });

  it("signs out on 401 only for authenticated requests", async () => {
    const { api, fetchImpl, onUnauthenticated } = setup();
    fetchImpl.mockResolvedValue(res(401, { error: { code: "UNAUTHENTICATED", message: "Please sign in" } }));
    await expect(api.get("/api/auth/me")).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    // wrong password on sign-in must not trigger a sign-out
    await expect(api.post("/api/auth/token", {}, { auth: false })).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("explains proxy errors without a JSON body", async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(res(502));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/restarting or busy/) });
  });

  it("maps network failures to status 0 with a plain message", async () => {
    const { api, fetchImpl } = setup();
    fetchImpl.mockRejectedValue(new TypeError("Network request failed"));
    await expect(api.get("/x")).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Can't reach the server/) });
  });
});
