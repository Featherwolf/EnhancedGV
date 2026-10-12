import { ModalRoot } from "@decky/ui";
import { FaThumbsUp, FaThumbsDown } from "react-icons/fa";
import type { ReviewItem } from "../types";
import { FocusableBlocks } from "./FocusableBlocks";
import { useTranslation } from "../i18n";

type T = (key: import("../i18n").TranslationKey, vars?: Record<string, string | number>) => string;

// Details shared by the review card and this popup.
// Deck hours are as of when the review was written.
export function deckNote(r: ReviewItem, t: T): string | null {
  if (r.deck_hours && r.deck_hours > 0) return t("reviews.onDeckHours", { hours: r.deck_hours });
  return r.steam_deck ? t("reviews.onDeck") : null;
}

export function postedDate(r: ReviewItem): string | null {
  if (!r.timestamp) return null;
  return new Date(r.timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function helpfulText(r: ReviewItem, t: T): string | null {
  const n = r.votes_up || 0;
  if (n <= 0) return null;
  return n === 1 ? t("reviews.helpfulOne") : t("reviews.helpfulMany", { n: n.toLocaleString() });
}

// Escape review text (plain, user-written — treat as untrusted) so it renders as
// literal text, then turn newlines into <br>. FocusableBlocks makes the result
// D-pad scrollable (each chunk is a focus stop) — the same in-place scroll the
// About section uses, so long reviews are fully readable on a controller.
function textToSafeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

export function ReviewModal({
  review,
  closeModal,
}: {
  review: ReviewItem;
  closeModal?: () => void;
}) {
  const { t } = useTranslation();
  const html = textToSafeHtml(review.text);
  const deck = deckNote(review, t);
  const posted = postedDate(review);
  const helpful = helpfulText(review, t);
  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal} bAllowFullSize>
      <div style={{ maxHeight: "80vh", overflowY: "auto", padding: "6px 10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            fontSize: 13,
            opacity: 0.85,
            marginBottom: 12,
          }}
        >
          {review.voted_up ? (
            <FaThumbsUp size={13} color="#66c0f4" />
          ) : (
            <FaThumbsDown size={13} color="#c15b58" />
          )}
          <span style={{ fontWeight: 600 }}>
            {review.voted_up ? t("reviews.recommended") : t("reviews.notRecommended")}
          </span>
          <span>·</span>
          <span>{t("reviews.hoursPlayed", { hours: review.playtime_hours })}</span>
          {deck && <span>· {deck}</span>}
          {review.early_access && <span>· {t("reviews.earlyAccess")}</span>}
          {posted && <span style={{ marginLeft: "auto" }}>{posted}</span>}
        </div>
        {helpful && (
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: -6, marginBottom: 12 }}>
            {helpful}
          </div>
        )}
        {html ? (
          <FocusableBlocks html={html} blockClass="ssp-review" targetPerStop={6} />
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>
            {t("reviews.noText")}
          </div>
        )}
      </div>
    </ModalRoot>
  );
}
