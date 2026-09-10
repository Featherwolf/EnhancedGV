import { callable } from "@decky/api";
import type {
  AppData,
  AppDetails,
  DataProvider,
  PatchNotes,
  PluginSettings,
  Reviews,
  UpdateInfo,
} from "./types";

// Each string MUST match an `async def` name on the Python `class Plugin`.
export const getAll = callable<[appid: number, lang: string, cc: string], AppData>(
  "get_all"
);

// The store-details half of get_all on its own. Requested in parallel with
// get_all so the hero/description/features can paint as soon as the single
// appdetails request lands, instead of waiting on reviews + news + deck. The
// backend de-duplicates in-flight requests per resource, so get_all reuses this
// very fetch rather than issuing a second one.
export const getAppDetails = callable<[appid: number, lang: string, cc: string], AppDetails>(
  "get_appdetails"
);

// Non-Steam metadata provider (Hasheous, …) — returns the SAME AppData shape as
// get_all, with reviews/news/deck = {ok:false} (they hide cleanly in the panel).
export const getAllFromProvider = callable<
  [provider: string, id: number | string, lang: string, cc: string],
  AppData
>("get_all_provider");

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

export const checkUpdate = callable<[beta: boolean], UpdateInfo>("check_update");

export const getPatchNotes = callable<[version: string], PatchNotes>("get_patch_notes");

// --- non-Steam matching ---------------------------------------------------
export interface ResolveResult {
  ok: boolean;
  store_appid: number | null;
  // Tagged source. Steam matches also set provider:"steam"/provider_id:store_appid;
  // a non-Steam provider match (e.g. Hasheous) sets store_appid:null and carries
  // the provider + its id here. Older backends omit these (treated as Steam).
  provider?: DataProvider;
  provider_id?: number | string | null;
  platform?: string; // inferred emulator platform, when known (non-Steam)
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

export interface IgdbStep {
  name: string;
  ok: boolean;
  detail: string;
}
export interface IgdbTest {
  ok: boolean;
  error?: string;
  steps: IgdbStep[];
  igdb_id?: number;
  name?: string;
  sample_image?: string;
}
// Per-step probe of the IGDB enrichment path. Never returns the key itself.
export const testIgdb = callable<[game_appid: number], IgdbTest>("test_igdb");

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

