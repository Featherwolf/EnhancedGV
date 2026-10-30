import { useEffect, useMemo, useState } from "react";
import { DialogButton, Focusable, showModal } from "@decky/ui";
import { FaThumbsUp, FaThumbsDown } from "react-icons/fa";
import { getReviewsList } from "../api";
import { registerCacheClearer } from "../hooks/useAppData";
import type { Reviews, ReviewItem, PluginSettings } from "../types";
import { FOCUS_SCROLL_MARGIN, CENTER_ON_FOCUS } from "../focus";
import { ReviewModal } from "./ReviewModal";
import { resolveLanguage } from "../lang";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n";

// Keyed to the plugin's own uiLanguage (via `language` below) rather than
// the runtime's default locale, so the date format follows the same setting
// as the rest of the plugin's interface regardless of the device's own
// locale configuration.
function fmtReviewDate(unixSeconds: number, language: string): string {
  if (!unixSeconds) return "";
  try {
    return new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(unixSeconds * 1000));
  } catch {
    return "";
  }
}

// A single review: a real focus stop (has onActivate) so the D-pad can land on
// it while scrolling, and A opens the full text in a popup — the list keeps the
// 5-line clamp so it stays skimmable.
function ReviewCard({ review }: { review: ReviewItem }) {
  const { t, language } = useTranslation();
  const [focused, setFocused] = useState(false);
  return (
    <Focusable
      {...CENTER_ON_FOCUS}
      onActivate={() => showModal(<ReviewModal review={review} />)}
      onOKActionDescription={t("reviews.readFullAction")}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        ...FOCUS_SCROLL_MARGIN,
        padding: "8px 10px",
        borderRadius: 6,
        background: focused ? "rgba(102,192,244,0.14)" : "rgba(255,255,255,0.04)",
        borderLeft: `3px solid ${review.voted_up ? "#66c0f4" : "#c15b58"}`,
        boxShadow: focused ? "inset 0 0 0 2px #66c0f4" : "inset 0 0 0 2px transparent",
        outline: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          opacity: 0.75,
          marginBottom: 4,
        }}
      >
        {review.voted_up ? (
          <FaThumbsUp size={11} color="#66c0f4" />
        ) : (
          <FaThumbsDown size={11} color="#c15b58" />
        )}
        <span>{review.voted_up ? t("reviews.recommended") : t("reviews.notRecommended")}</span>
        <span>·</span>
        <span>{t("reviews.hoursPlayed", { hours: review.playtime_hours })}</span>
        {review.steam_deck && (
          <>
            <span>·</span>
            <span>{t("reviews.onDeck")}</span>
          </>
        )}
        {review.early_access && (
          <>
            <span>·</span>
            <span>{t("reviews.earlyAccess")}</span>
          </>
        )}
        {!!review.timestamp && (
          <>
            <span>·</span>
            <span>{fmtReviewDate(review.timestamp, language)}</span>
          </>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.45,
          display: "-webkit-box",
          WebkitLineClamp: 5,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {review.text}
      </div>
      {focused && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{t("reviews.readFullHint")}</div>
      )}
    </Focusable>
  );
}

function pct(pos: number, total: number): number {
  if (!total) return 0;
  return Math.round((pos / total) * 100);
}

// recent.desc is a stable bucket KEY from the backend (computed locally from
// the 30-day histogram, never fetched from Steam — see _score_label in
// main.py), unlike summary.desc/lang_summary.desc, which already arrive as
// Steam-localized prose via get_reviews' own l= param. Only translate a
// recognized key; render anything else (an old cached value from before this
// existed, or a future bucket we haven't added) as-is rather than showing a
// raw "reviews.bucket.…" string.
const SCORE_BUCKETS = new Set([
  "overwhelmingly_positive", "very_positive", "mostly_positive",
  "mixed", "mostly_negative", "very_negative",
]);
function scoreDesc(desc: string | undefined, t: (k: TranslationKey) => string): string {
  if (!desc) return "";
  return SCORE_BUCKETS.has(desc) ? t(`reviews.bucket.${desc}` as TranslationKey) : desc;
}

// reviews.lang is a Steam store-API language SLUG ("brazilian", "schinese", …
// — see STORE_LANGS in lang.ts), not fit to show as-is; look up its display
// name, falling back to a capitalized version of the code for anything added
// to STORE_LANGS without a matching lang.* key yet.
function langDisplayName(code: string, t: (k: TranslationKey) => string): string {
  const key = `lang.${code.toLowerCase()}` as TranslationKey;
  const translated = t(key);
  return translated !== key ? translated : code.charAt(0).toUpperCase() + code.slice(1);
}

// No "Recent" chip: the list is only ~30 most-recent reviews anyway, so a
// 30-day sub-filter just shows a near-identical subset (user feedback).
type Chip = "all" | "positive" | "negative";
const CHIP_KEYS: { key: Chip; labelKey: TranslationKey }[] = [
  { key: "all", labelKey: "reviews.chipAll" },
  { key: "positive", labelKey: "reviews.chipPositive" },
  { key: "negative", labelKey: "reviews.chipNegative" },
];

// Module cache: filtered lists per appid so chip flips are instant on revisits.
const filteredCache = new Map<string, ReviewItem[]>();
// Flushed by "Clear cached store data" so filtered lists stay coherent with the
// backend cache.
registerCacheClearer(() => filteredCache.clear());

// Match the callable hang-timeout hardening used for the main data fetch so a
// stalled backend can't leave the chip stuck on "Loading…" forever.
function withChipTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("get_reviews_list timed out")), 20_000)
    ),
  ]);
}

export function ReviewsSection({
  reviews,
  appid,
  settings,
}: {
  reviews: Reviews;
  appid: number;
  settings?: PluginSettings;
}) {
  const { t } = useTranslation();
  const [chip, setChip] = useState<Chip>("all");
  const [filtered, setFiltered] = useState<ReviewItem[] | null>(null);
  const [loadingChip, setLoadingChip] = useState(false);

  const lang = resolveLanguage(settings?.language);

  useEffect(() => {
    let cancelled = false;
    // Reset unconditionally so switching back to a non-loading chip (or a
    // cache hit) never leaves a stale spinner up.
    setLoadingChip(false);
    if (chip === "all") {
      setFiltered(null);
      return;
    }
    const key = `${appid}:${chip}:${lang}`;
    const cached = filteredCache.get(key);
    if (cached) {
      setFiltered(cached);
      return;
    }
    setLoadingChip(true);
    withChipTimeout(getReviewsList(appid, chip, lang))
      .then((res) => {
        const list = res?.ok ? res.list : [];
        filteredCache.set(key, list); // populate cache even if this view is stale
        if (!cancelled) setFiltered(list);
      })
      .catch(() => {
        if (!cancelled) setFiltered([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChip(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chip, appid, lang]);

  const visibleList = useMemo(() => {
    if (!reviews?.ok) return [];
    if (chip === "all") return reviews.list;
    return filtered ?? [];
  }, [reviews, chip, filtered]);

  if (!reviews || !reviews.ok) {
    return <div style={{ opacity: 0.6, fontSize: 13 }}>{t("reviews.none")}</div>;
  }

  const s = reviews.summary;
  const r = reviews.recent;
  const positivePct = pct(s.total_positive, s.total_reviews);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Store-page style score rows: all-time + recent */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 8, fontSize: 14 }}>
          <span style={{ opacity: 0.6, minWidth: 110 }}>{t("reviews.all")}</span>
          <span style={{ fontWeight: 600 }}>{s.desc || t("reviews.noScore")}</span>
          <span style={{ opacity: 0.6 }}>
            ({s.total_reviews.toLocaleString()})
          </span>
        </div>
        {r && r.total_reviews > 0 && (
          <div style={{ display: "flex", gap: 8, fontSize: 14 }}>
            <span style={{ opacity: 0.6, minWidth: 110 }}>{t("reviews.recent")}</span>
            <span style={{ fontWeight: 600 }}>{scoreDesc(r.desc, t) || "—"}</span>
            <span style={{ opacity: 0.6 }}>
              ({r.total_reviews.toLocaleString()}
              {r.capped ? "+" : ""})
            </span>
          </div>
        )}
        {reviews.lang_summary &&
          reviews.lang_summary.total_reviews > 0 &&
          reviews.lang_summary.total_reviews !== s.total_reviews && (
            <div style={{ display: "flex", gap: 8, fontSize: 14 }}>
              <span style={{ opacity: 0.6, minWidth: 110 }}>
                {t("reviews.langReviews", {
                  lang: langDisplayName(reviews.lang ?? "english", t),
                })}
              </span>
              <span style={{ fontWeight: 600 }}>
                {reviews.lang_summary.desc || "—"}
              </span>
              <span style={{ opacity: 0.6 }}>
                ({reviews.lang_summary.total_reviews.toLocaleString()})
              </span>
            </div>
          )}
        {s.total_reviews > 0 && (
          <div
            style={{
              height: 8,
              borderRadius: 4,
              overflow: "hidden",
              background: "#c15b58",
              display: "flex",
            }}
          >
            <div style={{ width: `${positivePct}%`, background: "#66c0f4" }} />
          </div>
        )}
        {s.total_reviews > 0 && (
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {t("reviews.summaryLine", {
              pct: positivePct,
              pos: s.total_positive.toLocaleString(),
              neg: s.total_negative.toLocaleString(),
            })}
          </div>
        )}
      </div>

      {/* Filter chips: which reviews to show, always most recent first */}
      <Focusable
        // @ts-ignore Decky flow hint for horizontal gamepad navigation.
        flow-children="horizontal"
        style={{ display: "flex", gap: 6 }}
      >
        {CHIP_KEYS.map((c) => (
          <DialogButton
            key={c.key}
            {...CENTER_ON_FOCUS}
            onClick={() => setChip(c.key)}
            onOKButton={() => setChip(c.key)}
            style={{
              ...FOCUS_SCROLL_MARGIN,
              minWidth: 0,
              padding: "4px 14px",
              height: 30,
              fontSize: 12.5,
              borderRadius: 15,
              border:
                chip === c.key ? "2px solid #66c0f4" : "2px solid transparent",
              opacity: chip === c.key ? 1 : 0.7,
            }}
          >
            {t(c.labelKey)}
          </DialogButton>
        ))}
      </Focusable>

      {/* Review cards, most recent first */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loadingChip && (
          <div style={{ opacity: 0.6, fontSize: 13 }}>{t("reviews.loading")}</div>
        )}
        {!loadingChip && visibleList.length === 0 && (
          <div style={{ opacity: 0.6, fontSize: 13 }}>
            {t("reviews.emptyFilter")}
          </div>
        )}
        {!loadingChip &&
          visibleList.slice(0, 10).map((r) => <ReviewCard key={r.id} review={r} />)}
      </div>
    </div>
  );
}
