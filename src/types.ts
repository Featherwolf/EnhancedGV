// Shapes returned by the Python backend (already normalized/sanitized there).

// A resolved data SOURCE for a library game. "steam" pulls from the Steam store
// (the id is a Steam appid); other providers (e.g. "hasheous") serve non-Steam /
// emulated games that have no Steam page. Everything below the resolver is keyed
// on this tagged ref instead of a bare Steam appid, so a new source plugs in
// without touching any section component.
export type DataProvider = "steam" | "hasheous" | "igdb";
export interface DataRef {
  provider: DataProvider;
  id: number | string;
}

export interface Movie {
  // DASH manifest (AV1-first) for trailers with no progressive files — played
  // via the built-in MSE streamer. hls stays informational (h264-only).
  dash?: string | null;
  hls?: string | null;
  id: number;
  name: string;
  thumb: string;
  sources: string[]; // ordered progressive video URLs (vp9 webm first, then mp4)
}

export interface Screenshot {
  id: number;
  thumb: string;
  full: string;
}

export interface Tag {
  id: string | number;
  description: string;
}

export interface AppDetails {
  ok: boolean;
  error?: string;
  // On a failure from get_all: true unless Steam said the app has no store
  // data, i.e. a later retry may succeed.
  transient?: boolean;
  name: string;
  type: string;
  short_description: string;
  about_html: string;
  header_image: string;
  background: string;
  developers: string[];
  publishers: string[];
  release_date: string;
  coming_soon: boolean;
  website: string | null;
  controller_support: string | null;
  platforms: { windows?: boolean; mac?: boolean; linux?: boolean };
  genres: Tag[];
  categories: Tag[];
  screenshots: Screenshot[];
  movies: Movie[];
  metacritic: { score: number; url: string } | null;
  price:
    | { final: string; initial: string; discount: number; is_free: boolean }
    | null;
  recommendations_total: number | null;
  achievements_total: number | null;
  supported_languages_html: string;
  // Set by the backend when the IGDB pass added artwork/details on top of the
  // keyless Hasheous baseline (drives the source note in the panel).
  igdb_enriched?: boolean;
  content_descriptor_notes: string | null;
}

export interface ReviewItem {
  id: string;
  voted_up: boolean;
  text: string;
  playtime_hours: number;
  timestamp: number;
  votes_up: number;
  steam_deck: boolean;
  // Hours on a Steam Deck when the review was written; 0 if none.
  deck_hours?: number;
  early_access: boolean;
}

// One score row as Steam reports it. `score` is Steam's 0-9 rating; 0 means
// too few reviews to rate, and `desc` then reads like "3 user reviews".
export interface ReviewScore {
  desc: string;
  score?: number;
  total_positive: number;
  total_negative: number;
  total_reviews: number;
}

export interface Reviews {
  ok: boolean;
  error?: string;
  summary: ReviewScore;
  // Last 30 days (store-page "Recent Reviews").
  recent?: ReviewScore | null;
  // Only people who played mostly on a Steam Deck.
  deck?: ReviewScore | null;
  // Language-filtered summary (store-page "ENGLISH REVIEWS (N)" row).
  lang_summary?: ReviewScore | null;
  lang?: string;
  list: ReviewItem[];
}

export interface UpdateInfo {
  ok: boolean;
  error?: string;
  current: string;
  latest?: string;
  notes?: string;
  has_update?: boolean;
  prerelease?: boolean;
  channel?: string; // "stable" | "beta"
  url?: string; // release page
  zip_url?: string;
  tag?: string; // e.g. "v0.21.0-beta.2"
  // Whether this panel can install it (a checksummed EnhancedGV.zip, 0.20.0+).
  installable?: boolean;
}

export interface ReleaseInfo {
  tag: string;
  version: string;
  prerelease: boolean;
  published: string; // YYYY-MM-DD
  url: string; // release page
  installable: boolean;
  installed: boolean;
  newer: boolean; // than the installed version
  self_update?: boolean; // has the Update button; older builds update by hand
}

export interface ReleaseList {
  ok: boolean;
  error?: string;
  current: string;
  releases: ReleaseInfo[];
}

// What Decky's installer needs, after the backend has downloaded the release
// and checked it against GitHub's checksum.
export interface PreparedUpdate {
  ok: boolean;
  error?: string;
  artifact?: string; // file:// path of the checked zip
  name?: string;
  version?: string;
  hash?: string; // SHA-256, hex
  install_type?: number; // Decky's PluginInstallType: 1 reinstall, 2 update, 3 downgrade
}

export interface PatchNotes {
  ok: boolean;
  version: string;
  notes?: string;
  error?: string;
}

export interface NewsItem {
  gid: string;
  title: string;
  html: string;
  date: number;
  url: string;
  external: boolean;
  feedlabel: string;
  author: string;
}

export interface News {
  ok: boolean;
  error?: string;
  items: NewsItem[];
}

export interface DeckCompat {
  ok: boolean;
  error?: string;
  category: number; // 0 Unknown / 1 Unsupported / 2 Playable / 3 Verified
  label: string;
  steamos_category: number | null;
  notes: {
    display_type: number;
    text: string; // English fallback; see `token`
    // Normalized loc_token (e.g. "DefaultControllerConfigFullySupported"),
    // for an i18n lookup (deck.note.<token>) — empty if Steam sent none.
    token?: string;
  }[];
  blog_url: string;
}

export interface AppData {
  ok: boolean;
  error?: string;
  appid: number;
  appdetails: AppDetails;
  reviews: Reviews;
  news: News;
  deck: DeckCompat;
  // First-paint result: appdetails is real, the other three sections are still
  // in flight (see useAppData). Sections render a small loading placeholder
  // instead of their "nothing here" state while this is set.
  partial?: boolean;
}

export interface SectionToggles {
  media: boolean;
  about: boolean;
  features: boolean;
  reviews: boolean;
  news: boolean;
  deck: boolean;
}

// Which collapsible sections start expanded on the game page (media is the
// always-visible hero, so it has no entry here).
export interface ExpandedToggles {
  about: boolean;
  features: boolean;
  deck: boolean;
  reviews: boolean;
  news: boolean;
}

export interface PluginSettings {
  sections: SectionToggles;
  expanded?: ExpandedToggles;
  language: string;
  country: string;
  // UI language ("auto" | "en" | "pt-BR"): the plugin's OWN interface text —
  // independent of `language` above, which is the Steam STORE CONTENT
  // language (description/reviews/news). See src/i18n/index.ts.
  uiLanguage?: string;
  beta?: boolean; // opt in to pre-release update checks
  // The user's own IGDB (Twitch application) credentials, optional. They add
  // IGDB's title search for non-Steam games. Stored on this device only.
  igdbClientId?: string;
  igdbClientSecret?: string;
  /** Backend-reported: a secret is stored. The secret itself is never sent. */
  igdbClientSecretSet?: boolean;
  // Whether this build carries EnhancedGV's Hasheous app key (never the key):
  // with it, IGDB artwork needs no credentials of the user's own.
  hasheousAppKey?: boolean;
  // Opt in to pulling metadata for non-Steam / emulated games from external
  // sources (Hasheous). OFF by default — when off, non-Steam games behave exactly
  // as before (Steam title-search only, then "unmatched").
  nonSteamSources?: boolean;
}

export const DEFAULT_EXPANDED: ExpandedToggles = {
  about: true,
  features: false,
  deck: false,
  reviews: false,
  news: false,
};
