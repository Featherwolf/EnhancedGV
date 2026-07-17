import { useEffect, useState } from "react";
import { getAll, getSettings } from "../api";
import { DEFAULT_EXPANDED } from "../types";
import type { AppData, PluginSettings } from "../types";
import { resolveLanguage, resolveCountry } from "../lang";

// Module-level caches survive the re-splicing of the panel into the app tree,
// so navigating back to a game (or a re-render of renderFunc) never refetches.
const dataCache = new Map<number, AppData>();
const inflight = new Map<number, Promise<AppData>>();

// Failures are cached too (with a short TTL): the panel remounts on every tab
// switch (Steam's tab transition is keyed), and without a negative cache a game
// whose store fetch fails would flash loading -> error and refire the request on
// every switch, forever.
const failureCache = new Map<number, { res: AppData; at: number }>();
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
function withTimeout<T>(p: Promise<T>, what: string, ms = CALL_TIMEOUT_MS): Promise<T> {
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

async function loadData(appid: number, settings: PluginSettings): Promise<AppData> {
  const cached = dataCache.get(appid);
  if (cached) {
    fetchInfo = { startedAt: 0, settledAt: Date.now(), note: `cache hit (${appid})` };
    return cached;
  }

  const failed = failureCache.get(appid);
  if (failed) {
    if (Date.now() - failed.at < FAILURE_TTL_MS) return failed.res;
    failureCache.delete(appid); // TTL expired -> allow a retry
  }

  let promise = inflight.get(appid);
  if (!promise) {
    fetchInfo = { startedAt: Date.now(), settledAt: 0, note: `get_all(${appid}) in flight` };
    promise = withTimeout(
      getAll(appid, resolveLanguage(settings.language), resolveCountry(settings.country)),
      "get_all"
    )
      .then((res) => {
        fetchInfo = {
          startedAt: fetchInfo.startedAt,
          settledAt: Date.now(),
          note: res && res.ok ? `ok (${appid})` : `not ok: ${res?.error ?? "?"}`,
        };
        if (res && res.ok) lruSet(dataCache, appid, res);
        else lruSet(failureCache, appid, { res, at: Date.now() });
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
        lruSet(failureCache, appid, {
          res: { ok: false, error: String(e) } as AppData,
          at: Date.now(),
        });
        throw e;
      })
      .finally(() => inflight.delete(appid));
    inflight.set(appid, promise);
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

const hasFreshResult = (appid: number): boolean => {
  if (dataCache.has(appid)) return true;
  const f = failureCache.get(appid);
  return !!f && Date.now() - f.at < FAILURE_TTL_MS;
};

export function useAppData(appid: number): UseAppData {
  const [data, setData] = useState<AppData | null>(dataCache.get(appid) ?? null);
  const [settings, setSettings] = useState<PluginSettings>(
    settingsCache ?? DEFAULT_SETTINGS
  );
  const [loading, setLoading] = useState<boolean>(!hasFreshResult(appid));
  const [error, setError] = useState<string | null>(null);

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

    // Reset from cache on appid change (covers a reused panel instance).
    setData(dataCache.get(appid) ?? null);
    setError(null);

    // Non-positive / clearly non-Steam ids won't have store data; skip round-trip.
    if (!appid || appid <= 0) {
      setLoading(false);
      setError("no appid");
      return;
    }

    setLoading(!hasFreshResult(appid));

    (async () => {
      try {
        const s = await loadSettings();
        if (!cancelled) setSettings(s);
        const res = await loadData(appid, s);
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
  }, [appid]);

  return { data, settings, loading, error };
}
