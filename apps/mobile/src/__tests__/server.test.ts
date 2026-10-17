import { normalizeServerUrl, resolveUrl } from "@/lib/server";
import { DEFAULT_PREFS, parsePrefs } from "@/lib/prefs";

describe("normalizeServerUrl", () => {
  it.each([
    ["192.168.0.199", "http://192.168.0.199"],
    [" http://192.168.0.199/ ", "http://192.168.0.199"],
    ["192.168.0.199:8080/", "http://192.168.0.199:8080"],
    ["https://7xen.example.com/api", "https://7xen.example.com"],
    ["HTTPS://7XEN.Example.com//", "https://7xen.example.com"],
    ["localhost:4000", "http://localhost:4000"],
  ])("%s → %s", (input, out) => expect(normalizeServerUrl(input)).toBe(out));
  it.each(["", "   ", "http://", "not a url", "ftp://x"])("rejects %p", (input) => expect(normalizeServerUrl(input)).toBeNull());
});

describe("resolveUrl", () => {
  it("keeps absolute URLs and joins relative ones", () => {
    expect(resolveUrl("http://h", "https://cdn/x.apk")).toBe("https://cdn/x.apk");
    expect(resolveUrl("http://h/", "/api/app/manager/download")).toBe("http://h/api/app/manager/download");
    expect(resolveUrl("http://h", "api/x")).toBe("http://h/api/x");
  });
});

describe("parsePrefs", () => {
  it("falls back to defaults", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("nope")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs(JSON.stringify({ serverUrl: "bad url", quality: "4k", defaultMode: "X" }))).toEqual(DEFAULT_PREFS);
  });
  it("keeps valid values", () => {
    expect(parsePrefs(JSON.stringify({ serverUrl: "10.0.0.5", quality: "1080p", defaultMode: "AUTO", wifiOnly: false, autoCapture: false, launchBgmi: false }))).toEqual({
      serverUrl: "http://10.0.0.5",
      quality: "1080p",
      defaultMode: "AUTO",
      wifiOnly: false,
      autoCapture: false,
      launchBgmi: false,
    });
  });
});
