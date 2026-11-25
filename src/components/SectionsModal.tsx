import { useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { DEFAULT_EXPANDED } from "../types";
import type { ExpandedToggles, PluginSettings, SectionToggles } from "../types";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n";

export type SectionMode = "hidden" | "collapsed" | "expanded";

// Translated per-render (needs `t`) rather than a module-level constant.
function sectionRows(
  t: (k: TranslationKey) => string,
): { key: keyof SectionToggles; label: string; expandable: boolean }[] {
  return [
    { key: "media", label: t("sections.media"), expandable: false },
    { key: "about", label: t("sections.about"), expandable: true },
    { key: "features", label: t("sections.features"), expandable: true },
    { key: "deck", label: t("sections.deck"), expandable: true },
    { key: "reviews", label: t("sections.reviews"), expandable: true },
    { key: "news", label: t("sections.news"), expandable: true },
  ];
}

// Keys only, for logic that doesn't need the label (sectionMode/withSectionMode).
const SECTION_KEYS: (keyof SectionToggles)[] = [
  "media", "about", "features", "deck", "reviews", "news",
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
export function sectionSummary(s: PluginSettings, t: (k: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const shown = SECTION_KEYS.filter((k) => s.sections[k]).length;
  const expandableKeys = SECTION_KEYS.filter((k) => k !== "media");
  const open = expandableKeys.filter((k) => sectionMode(s, k) === "expanded").length;
  return t("sections.summary", { shown, total: SECTION_KEYS.length, open });
}

function choices(t: (k: TranslationKey) => string): { mode: SectionMode; label: string }[] {
  return [
    { mode: "hidden", label: t("sections.hidden") },
    { mode: "collapsed", label: t("sections.collapsed") },
    { mode: "expanded", label: t("sections.expanded") },
  ];
}

export function SectionsModal({
  initial,
  onSave,
  closeModal,
}: {
  initial: PluginSettings;
  onSave: (next: PluginSettings) => void;
  closeModal?: () => void;
}) {
  const { t } = useTranslation();
  const [settings, setLocal] = useState<PluginSettings>(initial);
  const rows = sectionRows(t);
  const allChoices = choices(t);

  const choose = (key: keyof SectionToggles, mode: SectionMode) => {
    const next = withSectionMode(settings, key, mode);
    setLocal(next);
    onSave(next);
  };

  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{t("sections.title")}</div>
      <div style={{ fontSize: 12.5, opacity: 0.7, margin: "4px 0 14px" }}>
        {t("sections.subtitle")}
      </div>
      <Focusable style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((row) => {
          const current = sectionMode(settings, row.key);
          const rowChoices = row.expandable
            ? allChoices
            : [allChoices[0], { mode: "expanded" as SectionMode, label: t("sections.shown") }];
          return (
            <Focusable
              key={row.key}
              // @ts-ignore Decky flow hint for gamepad navigation.
              flow-children="horizontal"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <div style={{ flex: 1, minWidth: 0, fontSize: 14 }}>{row.label}</div>
              {rowChoices.map((c, i) => (
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
