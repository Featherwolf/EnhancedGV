import { useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { listReleases } from "../api";
import type { ReleaseInfo } from "../types";
import { installRelease } from "../updater";
import { useTranslation } from "../i18n";
import type { TranslationKey } from "../i18n";

function actionLabel(r: ReleaseInfo, t: (k: TranslationKey) => string): string {
  if (!r.installable) return t("versionPicker.unavailable");
  if (r.installed) return t("versionPicker.reinstall");
  return r.newer ? t("versionPicker.update") : t("versionPicker.downgrade");
}

// Any published release, stable or beta, installed through Decky's own
// installer. Decky asks for confirmation before it changes anything.
export function VersionPickerModal({ closeModal }: { closeModal?: () => void }) {
  const { t } = useTranslation();
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let alive = true;
    listReleases()
      .then((r) => {
        if (!alive) return;
        setCurrent(r.current ?? "");
        if (r.ok) setReleases(r.releases ?? []);
        else setError(r.error ?? t("versionPicker.couldntLoad"));
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async (r: ReleaseInfo) => {
    setBusy(r.tag);
    setError("");
    const res = await installRelease(r.tag);
    setBusy("");
    // Decky's own confirmation dialog takes over from here.
    if (res.ok) closeModal?.();
    else setError(res.error ?? t("update.installNotStarted"));
  };

  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{t("versionPicker.title")}</div>
      <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.45, margin: "4px 0 14px" }}>
        {t("versionPicker.subtitle", { current: current || "?" })}
      </div>
      {error && (
        <div style={{ fontSize: 12.5, color: "#e5b143", lineHeight: 1.45, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {releases === null && !error && <div style={{ fontSize: 13, opacity: 0.6 }}>{t("common.loading")}</div>}
      {releases?.length === 0 && (
        <div style={{ fontSize: 13, opacity: 0.6 }}>{t("versionPicker.noReleases")}</div>
      )}
      <Focusable style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {releases?.map((r) => (
          <Focusable
            key={r.tag}
            // @ts-ignore Decky flow hint for gamepad navigation.
            flow-children="horizontal"
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                v{r.version}
                {r.installed && (
                  <span style={{ fontWeight: 400, opacity: 0.6 }}>{t("versionPicker.installedSuffix")}</span>
                )}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                {r.prerelease ? t("versionPicker.beta") : t("versionPicker.stable")}
                {r.published ? ` · ${r.published}` : ""}
                {r.self_update === false ? t("versionPicker.updatesByHand") : ""}
              </div>
            </div>
            <DialogButton
              disabled={!!busy || !r.installable}
              onClick={() => void install(r)}
              style={{ minWidth: 0, width: 140, height: 36, padding: "0 12px", fontSize: 13 }}
            >
              {busy === r.tag ? t("settings.downloading") : actionLabel(r, t)}
            </DialogButton>
          </Focusable>
        ))}
      </Focusable>
    </ModalRoot>
  );
}
