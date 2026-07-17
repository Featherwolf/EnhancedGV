// Detect the user's Steam client language so store content (description,
// reviews, news) comes back localized instead of always English.
//
// Source of truth: Steam's own LocalizationManager, exposed on window
// (confirmed in the client source: `window.LocalizationManager`, method
// `GetPreferredLocales()` returns the preferred locale codes, itself falling
// back to navigator.languages). We map those BCP-47 locales to the store API's
// `l=` language NAMES using Steam's authoritative table (LanguageICUNames from
// the client's localization module, reversed here). navigator.* is the backstop
// because on the Deck the CEF locale is launched to match the Steam language.

// Valid store-API `l=` values (the keys of Steam's LanguageICUNames, using the
// store-side name "koreana" for Korean).
const STORE_LANGS = new Set<string>([
  "english", "german", "french", "italian", "koreana", "latam", "spanish",
  "schinese", "tchinese", "russian", "thai", "japanese", "brazilian",
  "portuguese", "polish", "danish", "dutch", "finnish", "norwegian", "swedish",
  "hungarian", "czech", "romanian", "turkish", "arabic", "bulgarian", "greek",
  "ukrainian", "vietnamese", "indonesian",
]);

// Primary-subtag → store language for the simple (non-regional) cases.
const BASE_LOCALE: Record<string, string> = {
  en: "english", de: "german", fr: "french", it: "italian", ko: "koreana",
  ru: "russian", th: "thai", ja: "japanese", pl: "polish", da: "danish",
  nl: "dutch", fi: "finnish", sv: "swedish", hu: "hungarian", cs: "czech",
  ro: "romanian", tr: "turkish", ar: "arabic", bg: "bulgarian", el: "greek",
  uk: "ukrainian", vi: "vietnamese", id: "indonesian",
  nb: "norwegian", nn: "norwegian", no: "norwegian",
};

/** Map a BCP-47 locale (e.g. "pt-BR", "zh-Hans-CN") to a store `l=` value. */
export function localeToStoreLang(locale: string): string | null {
  const s = (locale || "").trim().toLowerCase().replace(/_/g, "-");
  if (!s) return null;
  const primary = s.split("-")[0];
  // Chinese: script/region decides simplified vs traditional.
  if (primary === "zh") {
    return /(^|-)(tw|hk|mo|hant)(-|$)/.test(s) ? "tchinese" : "schinese";
  }
  // Portuguese: Brazil vs Portugal.
  if (primary === "pt") return /(^|-)br(-|$)/.test(s) ? "brazilian" : "portuguese";
  // Spanish: Latin America vs Spain.
  if (primary === "es") {
    return /(^|-)(419|mx|ar|cl|co|pe|ve|uy|py|bo|ec|gt|cr|do|hn|ni|pa|sv|us)(-|$)/.test(s)
      ? "latam"
      : "spanish";
  }
  return BASE_LOCALE[primary] ?? null;
}

function regionFromLocale(locale: string): string | null {
  const parts = (locale || "").toLowerCase().split("-");
  for (let i = parts.length - 1; i >= 1; i--) {
    if (/^[a-z]{2}$/.test(parts[i])) return parts[i];
  }
  return null;
}

interface Detection {
  lang: string;
  cc: string;
  locale: string | null;
  source: string;
}

let _cache: Detection | null = null;

function preferredLocales(): Array<[string, string[] | undefined]> {
  const out: Array<[string, string[] | undefined]> = [];
  try {
    const lm = (window as unknown as { LocalizationManager?: {
      GetPreferredLocales?: () => string[];
      m_rgLocalesToUse?: string[];
    } }).LocalizationManager;
    const locs = lm?.GetPreferredLocales?.() ?? lm?.m_rgLocalesToUse;
    out.push(["LocalizationManager", Array.isArray(locs) ? locs : undefined]);
  } catch {
    out.push(["LocalizationManager", undefined]);
  }
  try {
    out.push(["navigator.languages", (navigator as Navigator).languages as string[] | undefined]);
  } catch {
    /* ignore */
  }
  try {
    const l = (navigator as Navigator).language;
    out.push(["navigator.language", l ? [l] : undefined]);
  } catch {
    /* ignore */
  }
  return out;
}

function detect(): Detection {
  if (_cache) return _cache;
  for (const [source, locs] of preferredLocales()) {
    if (!locs || !locs.length) continue;
    for (const loc of locs) {
      const low = String(loc || "").trim().toLowerCase();
      if (!low) continue;
      // A source may already hand us a store language name (e.g. "english").
      const lang = STORE_LANGS.has(low) ? low : localeToStoreLang(low);
      if (lang) {
        _cache = { lang, cc: regionFromLocale(low) || "us", locale: String(loc), source };
        return _cache;
      }
    }
  }
  _cache = { lang: "english", cc: "us", locale: null, source: "fallback" };
  return _cache;
}

/** The detected Steam store language (`l=` value), cached for the session. */
export function detectStoreLanguage(): string {
  return detect().lang;
}

/** The detected store country (`cc=`), derived from the same locale. */
export function detectStoreCountry(): string {
  return detect().cc;
}

/**
 * Resolve a stored setting to an actual value: "auto" (or empty) means detect
 * the Steam language; anything else is an explicit user override.
 */
export function resolveLanguage(setting?: string | null): string {
  return setting && setting !== "auto" ? setting : detectStoreLanguage();
}

export function resolveCountry(setting?: string | null): string {
  return setting && setting !== "auto" ? setting : detectStoreCountry();
}

/** One-line summary for the QAM diagnostics so detection is verifiable on-device. */
export function languageDiag(settingLang?: string | null, settingCc?: string | null): string {
  const d = detect();
  const manual = settingLang && settingLang !== "auto";
  const lang = manual ? settingLang : d.lang;
  const cc = settingCc && settingCc !== "auto" ? settingCc : d.cc;
  const how = manual ? "manual override" : `auto (${d.locale ?? "?"} via ${d.source})`;
  return `${lang} / ${cc} — ${how}`;
}
