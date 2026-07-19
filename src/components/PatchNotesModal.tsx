import { useEffect, useState } from "react";
import { ModalRoot } from "@decky/ui";
import { getPatchNotes } from "../api";
import { FocusableBlocks } from "./FocusableBlocks";

// Render the CHANGELOG markdown for a version as safe, D-pad-scrollable content.
// The notes are our own changelog, but we still escape first and only add the
// small set of tags we generate (<b>, <code>, <br>).
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function notesToSafeHtml(notes: string): string {
  return (notes || "")
    .split(/\r?\n/)
    .map((raw) => {
      let line = esc(raw)
        .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>") // **bold**
        .replace(/`([^`]+)`/g, "<code>$1</code>"); // `code`
      const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (bullet) line = `${bullet[1]}• ${bullet[2]}`;
      return line;
    })
    .join("<br>");
}

export function PatchNotesModal({
  version,
  closeModal,
}: {
  version?: string;
  closeModal?: () => void;
}) {
  const [notes, setNotes] = useState<string | null>(null);
  const [ver, setVer] = useState<string>(version ?? "");
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    getPatchNotes(version ?? "")
      .then((r) => {
        if (cancelled) return;
        setVer(r?.version ?? version ?? "");
        if (r?.ok) setNotes(r.notes ?? "");
        else setErr(r?.error ?? "Couldn't load patch notes.");
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal} bAllowFullSize>
      <div style={{ maxHeight: "80vh", overflowY: "auto", padding: "6px 10px" }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>
          EnhancedGV {ver ? `v${ver}` : ""} — patch notes
        </div>
        {notes === null && !err && (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Loading…</div>
        )}
        {err && <div style={{ opacity: 0.7, fontSize: 13 }}>{err}</div>}
        {notes !== null && !err && (
          notes.trim() ? (
            <FocusableBlocks html={notesToSafeHtml(notes)} blockClass="ssp-notes" targetPerStop={6} />
          ) : (
            <div style={{ opacity: 0.6, fontSize: 13 }}>
              No patch notes recorded for this version.
            </div>
          )
        )}
      </div>
    </ModalRoot>
  );
}
