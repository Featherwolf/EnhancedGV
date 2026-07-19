// Shapes returned by the Python backend (already normalized/sanitized there).

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

export interface Requirements {
  minimum: string;
  recommended: string;
}

export interface AppDetails {
  ok: boolean;
  error?: string;
  name: string;
  type: string;
  short_description: string;
  about_html: string;
  detailed_html: string;
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
  pc_requirements: Requirements | null;
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
  early_access: boolean;
}

export interface Reviews {
  ok: boolean;
  error?: string;
  summary: {
    desc: string;
    score: number;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  };
  // 30-day window score (store-page "Recent Reviews"); absent on old caches.
  recent?: {
    desc: string;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
    capped?: boolean; // sampled floor (fallback path only) -> display as "N+"
  };
  // Language-filtered summary (store-page "ENGLISH REVIEWS (N)" row).
  lang_summary?: {
    desc: string;
    score?: number;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  } | null;
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
  notes: { display_type: number; text: string }[];
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
  beta?: boolean; // opt in to pre-release update checks
}

export const DEFAULT_EXPANDED: ExpandedToggles = {
  about: true,
  features: false,
  deck: false,
  reviews: false,
  news: false,
};
