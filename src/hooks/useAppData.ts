import { useEffect, useState } from "react";
import { getAll, getAllFromProvider, getSettings } from "../api";
import { DEFAULT_EXPANDED } from "../types";
import type { AppData, DataRef, PluginSettings } from "../types";
import { refKey, refIsValid } from "../providers";
import { resolveLanguage, resolveCountry } from "../lang";

// Module-level caches survive the re-splicing of the panel into the app tree,
// so navigating back to a game (or a re-render of renderFunc) never refetches.
// Keyed by the tagged-ref string ("steam:730" / "hasheous:1234") so Steam and
// non-Steam sources never collide even if their numeric ids overlap.
const dataCache = new Map<string, AppData>();
const inflight = new Map<string, Promise<AppData>>();

// Failures are cached too (with a short TTL): the panel remounts on every tab
// switch (Steam's tab transition is keyed), and without a negative cache a game
// whose store fetch fails would flash loading -> error and refire the request on
// every switch, forever.
const failureCache = new Map<string, { res: AppData; at: number }>();
const FAILURE_TTL_MS = 60_000;

// A Decky callable against a dead/stale Python backend can hang FOREVER (neither
// resolve nor reject) — observed on-device as the panel stuck on "loading" with no
// error. Racing a timeout turns that silence into a visible, actionable message.
// Cold get_all can take ~30s, but the backend itself caps it at 40s (wait_for).
// A dead/unstarted backend never answers, so a shorter frontend cap turns
// "placeholder forever" into a visible error fast. get_settings (trivial, reads
// a local file) uses a much shorter cap — if IT times out the backend is dead.
const CALL_TIMEOUT_MS = 25_000;
const SETTINGS_TIMEOUT_MS = 6_000;
export function withTimeout<T>(p: Promise<T>, what: string, ms = CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`${what} timed out after ${ms / 1000}s — plugin backend not responding (Decky may have failed to start it; try a full Steam restart or reinstall)`)
          ),
        ms
      );
    }),
  ]);
}

let settingsCache: PluginSettings | null = null;
let settingsPromise: Promise<PluginSettings> | null = null;
// Bumped by primeSettings; a slow in-flight get_settings only writes the cache
// if no newer prime happened meanwhile (else a stale disk read reverts a toggle
// the user just changed).
let settingsGen = 0;

// Cap the per-appid caches so a long browsing session can't grow the Steam UI
// heap without bound (LRU by Map insertion order).
const CACHE_CAP = 24;
function lruSet<K, V>(m: Map<K, V>, k: K, v: V): void {
  if (m.has(k)) m.delete(k);
  m.set(k, v);
  while (m.size > CACHE_CAP) {
    const oldest = m.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

// Subscribers (open panels) get notified when settings change so a Quick Access
// toggle is reflected live, not only after a reload.
const settingsListeners = new Set<(s: PluginSettings) => void>();

const DEFAULT_SETTINGS: PluginSettings = {
  sections: {
    media: true,
    about: true,
    features: true,
    reviews: true,
    news: true,
    deck: true,
  },
  // "auto" = follow the Steam client language/region (resolved at fetch time via
  // resolveLanguage/resolveCountry). An explicit language name is an override.
  language: "auto",
  country: "auto",
  nonSteamSources: false,
};

function mergeSettings(s: Partial<PluginSettings> | null | undefined): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(s ?? {}),
    sections: { ...DEFAULT_SETTINGS.sections, ...(s?.sections ?? {}) },
    expanded: { ...DEFAULT_EXPANDED, ...(s?.expanded ?? {}) },
  };
}

/** Seed the shared settings cache and notify open panels. Called after a save. */
export function primeSettings(next: PluginSettings): void {
  settingsGen++;
  settingsCache = mergeSettings(next);
  settingsPromise = null;
  settingsListeners.forEach((l) => l(settingsCache as PluginSettings));
}

// Reviews chip-filter cache lives in ReviewsSection; register a clearer so
// "Clear cached store data" flushes it too (kept coherent with dataCache).
const extraCacheClearers = new Set<() => void>();
export function registerCacheClearer(fn: () => void): () => void {
  extraCacheClearers.add(fn);
  return () => extraCacheClearers.delete(fn);
}

/** Drop the in-memory app-data caches so re-viewing a game forces a refetch. */
export function clearFrontendCache(): void {
  dataCache.clear();
  inflight.clear();
  failureCache.clear();
  extraCacheClearers.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

async function loadSettings(): Promise<PluginSettings> {
  if (settingsCache) return settingsCache;
  if (!settingsPromise) {
    const gen = settingsGen;
    settingsPromise = withTimeout(getSettings(), "get_settings", SETTINGS_TIMEOUT_MS)
      .then((s) => {
        const merged = mergeSettings(s);
        // Only adopt the disk read if the user hasn't changed settings while it
        // was in flight (primeSettings bumps settingsGen).
        if (gen === settingsGen && !settingsCache) settingsCache = merged;
        return settingsCache ?? merged;
      })
      .catch(() => {
        // Don't pin defaults for the whole session: let a later call retry.
        settingsPromise = null;
        // If the user changed settings while this read was in flight, honor the
        // primed value instead of reverting the panel to defaults on error.
        return settingsCache ?? DEFAULT_SETTINGS;
      });
  }
  return settingsPromise;
}

async function loadData(ref: DataRef, settings: PluginSettings): Promise<AppData> {
  const key = refKey(ref);
  const cached = dataCache.get(key);
  if (cached) {
    fetchInfo = { startedAt: 0, settledAt: Date.now(), note: `cache hit (${key})` };
    return cached;
  }

  const failed = failureCache.get(key);
  if (failed) {
    if (Date.now() - failed.at < FAILURE_TTL_MS) return failed.res;
    failureCache.delete(key); // TTL expired -> allow a retry
  }

  let promise = inflight.get(key);
  if (!promise) {
    fetchInfo = { startedAt: Date.now(), settledAt: 0, note: `get_all(${key}) in flight` };
    const lang = resolveLanguage(settings.language);
    const cc = resolveCountry(settings.country);
    // Steam appid -> get_all; any other provider -> get_all_provider (same shape).
    const call =
      ref.provider === "steam"
        ? getAll(Number(ref.id), lang, cc)
        : getAllFromProvider(ref.provider, ref.id, lang, cc);
    promise = withTimeout(call, "get_all")
      .then((res) => {
        fetchInfo = {
          startedAt: fetchInfo.startedAt,
          settledAt: Date.now(),
          note: res && res.ok ? `ok (${key})` : `not ok: ${res?.error ?? "?"}`,
        };
        if (res && res.ok) lruSet(dataCache, key, res);
        else lruSet(failureCache, key, { res, at: Date.now() });
        return res;
      })
      .catch((e) => {
        fetchInfo = {
          startedAt: fetchInfo.startedAt,
          settledAt: Date.now(),
          note: `rejected: ${String(e)}`,
        };
        // Negative-cache the failure (incl. the 45s timeout) so a hung backend
        // serves the error instantly on the next remount instead of re-hanging.
        lruSet(failureCache, key, {
          res: { ok: false, error: String(e) } as AppData,
          at: Date.now(),
        });
        throw e;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return promise;
}

export interface UseAppData {
  data: AppData | null;
  settings: PluginSettings;
  loading: boolean;
  error: string | null;
}

// Live fetch telemetry for the QAM diagnostics: answers "is the data call in
// flight, and for how long / how did it end" without needing console access.
let fetchInfo = { startedAt: 0, settledAt: 0, note: "idle" };
export function getFetchInfo(): { startedAt: number; settledAt: number; note: string } {
  return fetchInfo;
}

const hasFreshResult = (key: string | null): boolean => {
  if (!key) return false;
  if (dataCache.has(key)) return true;
  const f = failureCache.get(key);
  return !!f && Date.now() - f.at < FAILURE_TTL_MS;
};

// ref is null while the game is still being resolved (or a non-Steam game has no
// match) — no fetch happens in that case. The primitive `key` (not the ref
// object) drives the effect and the caches, so a fresh ref object with the same
// provider+id never refires the fetch.
export function useAppData(ref: DataRef | null): UseAppData {
  const key = refIsValid(ref) ? refKey(ref) : null;
  const [data, setData] = useState<AppData | null>(
    key ? dataCache.get(key) ?? null : null
  );
  const [settings, setSettings] = useState<PluginSettings>(
    settingsCache ?? DEFAULT_SETTINGS
  );
  const [loading, setLoading] = useState<boolean>(!hasFreshResult(key));
  const [error, setError] = useState<string | null>(null);

  // Reconcile state DURING render when the ref changes (e.g. a QAM match edit
  // flips the resolved source X->Y): the async reset in the effect below runs
  // only after paint, which would flash the previous ref's cached content for one
  // frame. Adjusting state here re-renders synchronously before paint.
  const [prevKey, setPrevKey] = useState<string | null>(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setData(key ? dataCache.get(key) ?? null : null);
    setError(null);
    setLoading(!hasFreshResult(key));
  }

  // Live settings updates (e.g. section toggled in Quick Access).
  useEffect(() => {
    const listener = (s: PluginSettings) => setSettings(s);
    settingsListeners.add(listener);
    return () => {
      settingsListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Reset from cache on ref change (covers a reused panel instance).
    setData(key ? dataCache.get(key) ?? null : null);
    setError(null);

    // Null (still resolving) / invalid refs won't have data; skip the round-trip.
    // StorePanel gates on the resolver status, so this "no data" state is never
    // shown as an error to the user.
    if (!key || !refIsValid(ref)) {
      setLoading(false);
      setError("no appid");
      return;
    }

    setLoading(!hasFreshResult(key));

    (async () => {
      try {
        const s = await loadSettings();
        if (!cancelled) setSettings(s);
        const res = await loadData(ref, s);
        if (cancelled) return;
        if (res && res.ok) {
          setData(res);
        } else {
          setError(res?.error ?? "unavailable");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Depend on the primitive key; `ref` is captured in the closure and is
    // consistent with `key` for this render (both derive from the same ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, settings, loading, error };
}
