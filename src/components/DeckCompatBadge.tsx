import type { DeckCompat } from "../types";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n";

// Steam's own compat-report endpoint never localizes (verified live:
// l=brazilian and l=english return byte-identical loc_tokens — Valve
// resolves them client-side, inside the real Steam UI), so `category` and
// each note's `token` are translated here instead of trusting the backend's
// English `label`/`text` fallback fields.
function categoryLabel(cat: number, t: (k: TranslationKey) => string): string {
  const key = `deck.cat.${cat}` as TranslationKey;
  const translated = t(key);
  return translated !== key ? translated : "Unknown";
}

function noteText(
  note: { text: string; token?: string },
  t: (k: TranslationKey) => string,
): string {
  if (!note.token) return note.text;
  const key = `deck.note.${note.token}` as TranslationKey;
  const translated = t(key);
  return translated !== key ? translated : note.text;
}

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
  const { t } = useTranslation();
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
      title={deck.notes.map((n) => noteText(n, t)).filter(Boolean).join(" • ")}
    >
      <span>{GLYPH[cat] ?? "?"}</span>
      <span>{t("deck.label", { label: categoryLabel(cat, t) })}</span>
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
  const { t } = useTranslation();
  if (!deck || !deck.ok) {
    return (
      <div style={{ opacity: 0.6, fontSize: 13 }}>
        {t("deck.none")}
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
                <span>{noteText(n, t)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
