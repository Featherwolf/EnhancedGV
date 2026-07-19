import { callable } from "@decky/api";
import type { AppData, PluginSettings, Reviews, UpdateInfo } from "./types";

// Each string MUST match an `async def` name on the Python `class Plugin`.
export const getAll = callable<[appid: number, lang: string, cc: string], AppData>(
  "get_all"
);

export const getSettings = callable<[], PluginSettings>("get_settings");

export const setSettings = callable<[settings: PluginSettings], { ok: boolean }>(
  "set_settings"
);

export const clearCache = callable<[], { ok: boolean; removed: number }>(
  "clear_cache"
);

export const getReviewsList = callable<
  [appid: number, review_type: string, lang: string],
  Reviews
>("get_reviews_list");

export const checkUpdate = callable<[], UpdateInfo>("check_update");

// --- non-Steam matching ---------------------------------------------------
export interface ResolveResult {
  ok: boolean;
  store_appid: number | null;
  name: string;
  year: string;
  source?: string; // "auto" | "manual"
  matched: boolean;
  from_cache?: boolean;
  reason?: string;
}
// Resolve a library game (Steam or non-Steam shortcut) to the store appid to
// fetch. Persists the match so it's never re-identified.
export const resolveGame = callable<
  [game_appid: number, is_shortcut: boolean, title: string, lang: string, cc: string],
  ResolveResult
>("resolve_game");

export interface LookupResult {
  ok: boolean;
  appid?: number;
  name?: string;
  year?: string;
  error?: string;
}
// Validate a typed Steam app ID or pasted store URL -> name + year.
export const lookupStoreApp = callable<
  [id_or_url: string, lang: string, cc: string],
  LookupResult
>("lookup_store_app");

export const setMatch = callable<
  [game_appid: number, store_appid: number, name: string, year: string, source: string],
  { ok: boolean }
>("set_match");

export const clearMatch = callable<
  [game_appid: number],
  { ok: boolean; existed?: boolean }
>("clear_match");

// Clear to BLANK (sticky): the game stays unmatched and won't auto-match again.
export const blankMatch = callable<[game_appid: number], { ok: boolean }>("blank_match");

export interface BackendInfo {
  ok: boolean;
  html_parser: boolean;
  engine: string;
  selftest_tags: { b: number; br: number; img: number };
  python: string;
}
export const getBackendInfo = callable<[], BackendInfo>("get_backend_info");

export interface VideoProbe {
  url: string;
  status: number;
  bytes?: number;
  ms: number;
  error?: string;
}
export const testVideo = callable<
  [appid: number],
  { ok: boolean; error?: string; results?: VideoProbe[] }
>("test_video");

