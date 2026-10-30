// UI localization: the plugin's OWN interface text (settings, section titles,
// empty-state messages), independent of the Steam STORE CONTENT language
// (description/reviews/news), which lang.ts/resolveLanguage already handles.
//
// "auto" (the default) follows the same Steam-locale detection lang.ts uses
// for store content (detectStoreLanguage), so a Brazilian Steam client gets a
// Portuguese plugin UI out of the box; an explicit choice in Settings →
// Language overrides it. English is the hardcoded fallback: any key missing
// from a non-English dictionary, or any dictionary entirely, resolves to the
// English string rather than the raw key.
import { call } from "@decky/api";
import { useEffect, useState } from "react";
import { detectStoreLanguage } from "../lang";
import { en, TranslationKey } from "./en";
import { ptBR } from "./pt-BR";

export type { TranslationKey } from "./en";

export type Language = "en" | "pt-BR";
export type LanguagePreference = "auto" | Language;

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = {
  en,
  "pt-BR": ptBR,
};

export const LANGUAGE_UPDATED_EVENT = "enhancedgv:ui-language-updated";

function detectSystemLanguage(): Language {
  return detectStoreLanguage() === "brazilian" ? "pt-BR" : "en";
}

let currentLanguage: Language = detectSystemLanguage();
let initialized = false;
const listeners = new Set<() => void>();

async function resolveUiLanguage(): Promise<Language> {
  try {
    const settings = await call<[], { uiLanguage?: LanguagePreference }>("get_settings");
    const pref = settings?.uiLanguage || "auto";
    return pref === "auto" ? detectSystemLanguage() : pref;
  } catch {
    return detectSystemLanguage();
  }
}

async function refreshLanguage() {
  currentLanguage = await resolveUiLanguage();
  listeners.forEach((listener) => listener());
}

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  refreshLanguage();
  window.addEventListener(LANGUAGE_UPDATED_EVENT, refreshLanguage);
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function translate(key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[currentLanguage][key] ?? en[key] ?? key;
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(String(value)),
    template,
  );
}

/**
 * Subscribe to language changes (fired via LANGUAGE_UPDATED_EVENT, dispatched
 * after the user changes the Language setting).
 */
export function subscribeToLanguage(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * React hook giving components a `t()` function that re-renders when the
 * resolved UI language changes (system detection or manual override).
 */
export function useTranslation() {
  const [, forceRender] = useState(0);

  useEffect(() => subscribeToLanguage(() => forceRender((n) => n + 1)), []);

  return { t: translate, language: currentLanguage };
}
