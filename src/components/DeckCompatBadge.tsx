import type { DeckCompat } from "../types";

const COLORS: Record<number, string> = {
  0: "#8f98a0", // Unknown
  1: "#c15b58", // Unsupported
  2: "#e1b12c", // Playable
  3: "#58a058", // Verified
};

const GLYPH: Record<number, string> = {
  0: "?",
  1: "✕",
  2: "✓",
  3: "✔",
};

export function DeckCompatBadge({ deck }: { deck: DeckCompat }) {
  if (!deck || !deck.ok) return null;
  const cat = deck.category ?? 0;
  const color = COLORS[cat] ?? COLORS[0];

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 12,
        background: color,
        color: "#fff",
        fontSize: 12.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
      title={deck.notes.map((n) => n.text).filter(Boolean).join(" • ")}
    >
      <span>{GLYPH[cat] ?? "?"}</span>
      <span>Deck: {deck.label}</span>
    </div>
  );
}

// How Steam rates each test result (display_type): 4 passed, 3 caution,
// 2 failed, anything else informational. Plain bullets made a failed check
// look the same as a passed one.
const RESULT_MARK: Record<number, { mark: string; color: string }> = {
  4: { mark: "✓", color: "#59bf40" },
  3: { mark: "⚠", color: "#e5b143" },
  2: { mark: "✗", color: "#c15b58" },
};
const INFO_MARK = { mark: "ⓘ", color: "#8f98a0" };

export function DeckCompatDetails({ deck }: { deck: DeckCompat }) {
  if (!deck || !deck.ok) {
    return (
      <div style={{ opacity: 0.6, fontSize: 13 }}>
        No Steam Deck compatibility report.
      </div>
    );
  }
  const notes = deck.notes.filter((n) => n.text);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <DeckCompatBadge deck={deck} />
      {notes.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 13, lineHeight: 1.6 }}>
          {notes.map((n, i) => {
            const m = RESULT_MARK[n.display_type] ?? INFO_MARK;
            return (
              <li key={i} style={{ display: "flex", gap: 6 }}>
                <span style={{ color: m.color, flex: "0 0 auto" }}>{m.mark}</span>
                <span>{n.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
