import { ModalRoot } from "@decky/ui";
import { FaThumbsUp, FaThumbsDown } from "react-icons/fa";
import type { ReviewItem } from "../types";
import { FocusableBlocks } from "./FocusableBlocks";

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
          {review.steam_deck && <span>· 🎮 on Deck</span>}
          {review.early_access && <span>· Early Access</span>}
        </div>
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
