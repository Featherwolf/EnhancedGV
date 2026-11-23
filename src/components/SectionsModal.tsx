import { useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { DEFAULT_EXPANDED } from "../types";
import type { ExpandedToggles, PluginSettings, SectionToggles } from "../types";

export type SectionMode = "hidden" | "collapsed" | "expanded";

export const SECTION_ROWS: { key: keyof SectionToggles; label: string; expandable: boolean }[] = [
  { key: "media", label: "Videos & screenshots", expandable: false },
  { key: "about", label: "About", expandable: true },
  { key: "features", label: "Features & details", expandable: true },
  { key: "deck", label: "Steam Deck compatibility", expandable: true },
  { key: "reviews", label: "Reviews", expandable: true },
  { key: "news", label: "Update history", expandable: true },
];

export function sectionMode(s: PluginSettings, key: keyof SectionToggles): SectionMode {
  if (!s.sections[key]) return "hidden";
  if (key === "media") return "expanded";
  return (s.expanded ?? DEFAULT_EXPANDED)[key as keyof ExpandedToggles] ? "expanded" : "collapsed";
}

export function withSectionMode(
  s: PluginSettings,
  key: keyof SectionToggles,
  mode: SectionMode,
): PluginSettings {
  const next: PluginSettings = { ...s, sections: { ...s.sections, [key]: mode !== "hidden" } };
  // Hiding a section keeps whether it starts expanded, for when it comes back.
  if (key !== "media" && mode !== "hidden") {
    next.expanded = { ...DEFAULT_EXPANDED, ...s.expanded, [key]: mode === "expanded" };
  }
  return next;
}

// One line for the panel: how many sections show, and how many open expanded.
export function sectionSummary(s: PluginSettings): string {
  const shown = SECTION_ROWS.filter((r) => s.sections[r.key]).length;
  const open = SECTION_ROWS.filter((r) => r.expandable && sectionMode(s, r.key) === "expanded").length;
  return `${shown} of ${SECTION_ROWS.length} shown · ${open} start expanded`;
}

const CHOICES: { mode: SectionMode; label: string }[] = [
  { mode: "hidden", label: "Hidden" },
  { mode: "collapsed", label: "Collapsed" },
  { mode: "expanded", label: "Expanded" },
];

export function SectionsModal({
  initial,
  onSave,
  closeModal,
}: {
  initial: PluginSettings;
  onSave: (next: PluginSettings) => void;
  closeModal?: () => void;
}) {
  const [settings, setLocal] = useState<PluginSettings>(initial);

  const choose = (key: keyof SectionToggles, mode: SectionMode) => {
    const next = withSectionMode(settings, key, mode);
    setLocal(next);
    onSave(next);
  };

  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Game page sections</div>
      <div style={{ fontSize: 12.5, opacity: 0.7, margin: "4px 0 14px" }}>
        Choose what shows under a game, and what starts open. Changes apply right away.
      </div>
      <Focusable style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SECTION_ROWS.map((row) => {
          const current = sectionMode(settings, row.key);
          const choices = row.expandable
            ? CHOICES
            : [CHOICES[0], { mode: "expanded" as SectionMode, label: "Shown" }];
          return (
            <Focusable
              key={row.key}
              // @ts-ignore Decky flow hint for gamepad navigation.
              flow-children="horizontal"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{row.label}</div>
              {choices.map((c, i) => (
                <DialogButton
                  key={c.mode}
                  onClick={() => choose(row.key, c.mode)}
                  style={{
                    minWidth: 0,
                    // "Shown" spans the Collapsed and Expanded columns.
                    width: !row.expandable && i === 1 ? 214 : 104,
                    height: 32,
                    padding: "0 8px",
                    fontSize: 12.5,
                    borderRadius: 16,
                    border: current === c.mode ? "2px solid #66c0f4" : "2px solid transparent",
                    opacity: current === c.mode ? 1 : 0.7,
                  }}
                >
                  {c.label}
                </DialogButton>
              ))}
            </Focusable>
          );
        })}
      </Focusable>
    </ModalRoot>
  );
}
