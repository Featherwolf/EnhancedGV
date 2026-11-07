import { useEffect, useMemo, useState } from "react";
import { DialogButton, Focusable, showModal } from "@decky/ui";
import { FaThumbsUp, FaThumbsDown } from "react-icons/fa";
import { getReviewsList } from "../api";
import { registerCacheClearer } from "../hooks/useAppData";
import type { Reviews, ReviewItem, ReviewScore, PluginSettings } from "../types";
import { FOCUS_SCROLL_MARGIN, CENTER_ON_FOCUS } from "../focus";
import { ReviewModal, deckNote, postedDate, helpfulText } from "./ReviewModal";
import { resolveLanguage } from "../lang";

// A single review: a real focus stop (has onActivate) so the D-pad can land on
// it while scrolling, and A opens the full text in a popup — the list keeps the
// 5-line clamp so it stays skimmable.
function ReviewCard({ review }: { review: ReviewItem }) {
  const [focused, setFocused] = useState(false);
  const deck = deckNote(review);
  const posted = postedDate(review);
  const helpful = helpfulText(review);
  return (
    <Focusable
      {...CENTER_ON_FOCUS}
      onActivate={() => showModal(<ReviewModal review={review} />)}
      onOKActionDescription="Read full review"
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
          flexWrap: "wrap",
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
        <span>{review.voted_up ? "Recommended" : "Not recommended"}</span>
        <span>·</span>
        <span>{review.playtime_hours}h played</span>
        {deck && <span>· {deck}</span>}
        {review.early_access && <span>· Early Access</span>}
        {posted && <span style={{ marginLeft: "auto" }}>{posted}</span>}
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
      {helpful && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{helpful}</div>
      )}
      {focused && (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>▸ Press A to read the full review</div>
      )}
    </Focusable>
  );
}

function pct(pos: number, total: number): number {
  if (!total) return 0;
  return Math.round((pos / total) * 100);
}

// One store-page-style score row. When Steam rates the reviews (score 1-9) the
// row adds the positive share and count; with too few to rate, Steam's own
// text ("3 user reviews") already carries the count.
function ScoreRow({ label, s }: { label: string; s: ReviewScore }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 14 }}>
      <span style={{ opacity: 0.6, minWidth: 150 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{s.desc || "No score"}</span>
      {(s.score ?? 0) > 0 && (
        <span style={{ opacity: 0.6 }}>
          ({pct(s.total_positive, s.total_reviews)}% of{" "}
          {s.total_reviews.toLocaleString()})
        </span>
      )}
    </div>
  );
}

// Steam's language codes that don't read as names once capitalized.
const LANG_NAMES: Record<string, string> = {
  schinese: "Simplified Chinese",
  tchinese: "Traditional Chinese",
  koreana: "Korean",
  latam: "Latin American Spanish",
  brazilian: "Brazilian Portuguese",
};

function langName(code: string): string {
  return LANG_NAMES[code] ?? code.charAt(0).toUpperCase() + code.slice(1);
}

// No "Recent" chip: every list is the newest reviews already, so a 30-day
// sub-filter would show a near-identical subset (user feedback).
type Chip = "all" | "positive" | "negative" | "deck";
const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "positive", label: "Positive" },
  { key: "negative", label: "Negative" },
  { key: "deck", label: "Steam Deck" },
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
    return <div style={{ opacity: 0.6, fontSize: 13 }}>No reviews available.</div>;
  }

  const s = reviews.summary;
  const r = reviews.recent;
  const d = reviews.deck;
  const ls = reviews.lang_summary;
  const positivePct = pct(s.total_positive, s.total_reviews);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Store-page style score rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <ScoreRow label="All Reviews:" s={s} />
        {r && r.total_reviews > 0 && <ScoreRow label="Recent Reviews:" s={r} />}
        {d && d.total_reviews > 0 && <ScoreRow label="Steam Deck Players:" s={d} />}
        {ls && ls.total_reviews > 0 && ls.total_reviews !== s.total_reviews && (
          <ScoreRow label={`${langName(reviews.lang ?? "english")} Reviews:`} s={ls} />
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
            {s.total_positive.toLocaleString()} up / {s.total_negative.toLocaleString()}{" "}
            down
          </div>
        )}
      </div>

      {/* Filter chips: which reviews to show, always newest first */}
      <Focusable
        // @ts-ignore Decky flow hint for horizontal gamepad navigation.
        flow-children="horizontal"
        style={{ display: "flex", gap: 6 }}
      >
        {CHIPS.map((c) => (
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
            {c.label}
          </DialogButton>
        ))}
      </Focusable>

      {/* Review cards, newest first */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loadingChip && (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Loading reviews…</div>
        )}
        {!loadingChip && visibleList.length === 0 && (
          <div style={{ opacity: 0.6, fontSize: 13 }}>
            No reviews for this filter.
          </div>
        )}
        {!loadingChip &&
          visibleList.slice(0, 10).map((r) => <ReviewCard key={r.id} review={r} />)}
      </div>
    </div>
  );
}
