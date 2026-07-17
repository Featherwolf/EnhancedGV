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

