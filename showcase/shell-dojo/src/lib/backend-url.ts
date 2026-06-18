const NO_LOCAL_BACKENDS: Record<string, string> = Object.freeze({});

let lastRaw: string | undefined;
let lastParsed: Record<string, string> = NO_LOCAL_BACKENDS;

function parseLocalBackends(raw: string | undefined): Record<string, string> {
  if (!raw) return NO_LOCAL_BACKENDS;
  if (raw === lastRaw) return lastParsed;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const map: Record<string, string> = Object.create(null);
      for (const [slug, value] of Object.entries(parsed)) {
        if (typeof value === "string" && isCleanHttpUrl(value)) {
          map[slug] = value.replace(/\/+$/, "");
        }
      }
      lastRaw = raw;
      lastParsed = Object.freeze(map);
      return lastParsed;
    }
  } catch {
    // Treat malformed local overrides as unset. The generated registry remains
    // the production-safe fallback.
  }

  lastRaw = raw;
  lastParsed = NO_LOCAL_BACKENDS;
  return lastParsed;
}

function isCleanHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function resolveBackendUrl(slug: string, registryBackendUrl: string) {
  const local = parseLocalBackends(process.env.NEXT_PUBLIC_LOCAL_BACKENDS);
  return local[slug] ?? registryBackendUrl.replace(/\/+$/, "");
}
