// sw-router.js — Endpoint-family classifier for the StakTrakr service worker.
// Loaded via importScripts("sw-router.js") in sw.js; also require()'d by Node unit tests.

const _ALLOWED_API_HOSTS = ["api.staktrakr.com", "api2.staktrakr.com"];

// Family descriptor table. Iterated in order; first match wins.
// floor: minimum TTL in seconds (used when envelope stale_after is absent)
// hasEnvelope: whether the v2 response body carries generated_at / stale_after fields
const FAMILY_TABLE = [
  {
    family: "manifest",
    test: function (p) {
      return p === "/v2/manifest.json";
    },
    floor: 1800,
    hasEnvelope: true,
  },
  {
    family: "spot-latest",
    test: function (p) {
      return p === "/v2/spot/latest.json";
    },
    floor: 1200,
    hasEnvelope: true,
  },
  {
    family: "spot-history-daily",
    test: function (p) {
      return /\/v2\/spot\/[^/]+\/\d{4}\/\d{2}\/\d{2}\.json$/.test(p);
    },
    floor: 3600,
    hasEnvelope: true,
  },
  {
    family: "goldback-latest",
    test: function (p) {
      return p === "/v2/goldback/latest.json";
    },
    floor: 90000,
    hasEnvelope: true,
  },
  {
    family: "retail-latest",
    test: function (p) {
      return /\/v2\/retail\/[^/]+\/latest\.json$/.test(p);
    },
    floor: 1800,
    hasEnvelope: true,
  },
  {
    family: "retail-intraday",
    test: function (p) {
      return /\/v2\/retail\/[^/]+\/intraday\.json$/.test(p);
    },
    floor: 1200,
    hasEnvelope: true,
  },
  {
    family: "retail-history-short",
    test: function (p) {
      return /\/v2\/retail\/[^/]+\/history-7d\.json$/.test(p);
    },
    floor: 3600,
    hasEnvelope: true,
  },
  {
    family: "retail-history-long",
    test: function (p) {
      return /\/v2\/retail\/[^/]+\/history-(?:30d|90d)\.json$/.test(p);
    },
    floor: 86400,
    hasEnvelope: true,
  },
  {
    family: "providers",
    test: function (p) {
      return p === "/v2/providers.json";
    },
    floor: 86400,
    hasEnvelope: true,
  },
  {
    // Matches /data/spot-history-YYYY.json (local origin) and /spot-history-YYYY.json (API root)
    family: "annual-spot-history",
    test: function (p) {
      return /\/(?:data\/)?spot-history-\d{4}\.json$/.test(p);
    },
    floor: 86400,
    hasEnvelope: false,
  },
];

// classifyEndpoint(urlString, selfOrigin) → { family, floor, hasEnvelope } | null
//
// urlString: absolute URL string (Request.url or string literal in tests)
// selfOrigin: the SW's self.location.origin (injected by sw.js; tests supply a mock)
//
// Returns null for:
//   - malformed URLs
//   - hosts other than the two allowed API hosts or selfOrigin
//   - third-party staktrakr.com (GitHub Pages remote fallback — SW cannot intercept)
//   - API paths not covered by any family
function classifyEndpoint(urlString, selfOrigin) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }

  const isApiHost = _ALLOWED_API_HOSTS.indexOf(url.hostname) !== -1;
  const isSelfOrigin = Boolean(selfOrigin) && url.origin === selfOrigin;

  if (!isApiHost && !isSelfOrigin) {
    return null;
  }

  for (let i = 0; i < FAMILY_TABLE.length; i++) {
    const entry = FAMILY_TABLE[i];
    if (entry.family === "annual-spot-history") {
      // Annual spot-history: valid on API hosts (API-root path) and local origin (/data/ path)
      if ((isApiHost || isSelfOrigin) && entry.test(url.pathname)) {
        return { family: entry.family, floor: entry.floor, hasEnvelope: entry.hasEnvelope };
      }
    } else {
      // All other families: API hosts only
      if (isApiHost && entry.test(url.pathname)) {
        return { family: entry.family, floor: entry.floor, hasEnvelope: entry.hasEnvelope };
      }
    }
  }

  return null;
}

// parseGeneratedAtSeconds(body) → number | null
//
// Extracts a v2 envelope's generated_at as unix SECONDS (the x-generated-at
// header contract consumed by matchWithAgeCheck in sw.js). Production envelopes
// carry generated_at as an ISO-8601 string; numeric unix-seconds values are
// accepted for backward compatibility (STRK-189).
function parseGeneratedAtSeconds(body) {
  if (!body) return null;
  if (typeof body.generated_at === "number") {
    return body.generated_at;
  }
  const ms = Date.parse(body.generated_at);
  return isNaN(ms) ? null : ms / 1000;
}

// CJS export guard — allows require() in Node unit tests without breaking importScripts in SW
if (typeof module !== "undefined") {
  module.exports = {
    FAMILY_TABLE: FAMILY_TABLE,
    classifyEndpoint: classifyEndpoint,
    parseGeneratedAtSeconds: parseGeneratedAtSeconds,
  };
}
