import { ModalRoot } from "@decky/ui";
import { FaThumbsUp, FaThumbsDown } from "react-icons/fa";
import type { ReviewItem } from "../types";
import { FocusableBlocks } from "./FocusableBlocks";

// Details shared by the review card and this popup.
// Deck hours are as of when the review was written.
export function deckNote(r: ReviewItem): string | null {
  if (r.deck_hours && r.deck_hours > 0) return `🎮 ${r.deck_hours}h on Deck`;
  return r.steam_deck ? "🎮 on Deck" : null;
}

export function postedDate(r: ReviewItem): string | null {
  if (!r.timestamp) return null;
  return new Date(r.timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function helpfulText(r: ReviewItem): string | null {
  const n = r.votes_up || 0;
  if (n <= 0) return null;
  return n === 1
    ? "1 person found this helpful"
    : `${n.toLocaleString()} people found this helpful`;
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
  const html = textToSafeHtml(review.text);
  const deck = deckNote(review);
  const posted = postedDate(review);
  const helpful = helpfulText(review);
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
            {review.voted_up ? "Recommended" : "Not recommended"}
          </span>
          <span>·</span>
          <span>{review.playtime_hours}h played</span>
          {deck && <span>· {deck}</span>}
          {review.early_access && <span>· Early Access</span>}
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
            This review has no written text.
          </div>
        )}
      </div>
    </ModalRoot>
  );
}
