import { useEffect, useState } from "react";
import { DialogButton, Focusable, ModalRoot } from "@decky/ui";
import { listReleases } from "../api";
import type { ReleaseInfo } from "../types";
import { installRelease } from "../updater";

function actionLabel(r: ReleaseInfo): string {
  if (!r.installable) return "Unavailable";
  if (r.installed) return "Reinstall";
  return r.newer ? "Update" : "Downgrade";
}

// Any published release, stable or beta, installed through Decky's own
// installer. Decky asks for confirmation before it changes anything.
export function VersionPickerModal({ closeModal }: { closeModal?: () => void }) {
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
        else setError(r.error ?? "Couldn't load the list of releases.");
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const install = async (r: ReleaseInfo) => {
    setBusy(r.tag);
    setError("");
    const res = await installRelease(r.tag);
    setBusy("");
    // Decky's own confirmation dialog takes over from here.
    if (res.ok) closeModal?.();
    else setError(res.error ?? "The install didn't start.");
  };

  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Install a version</div>
      <div style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.45, margin: "4px 0 14px" }}>
        Installed: v{current || "?"}. Stable releases are finished builds; betas test the next
        one. Decky asks you to confirm first, and your settings are kept.
      </div>
      {error && (
        <div style={{ fontSize: 12.5, color: "#e5b143", lineHeight: 1.45, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {releases === null && !error && <div style={{ fontSize: 13, opacity: 0.6 }}>Loading…</div>}
      {releases?.length === 0 && (
        <div style={{ fontSize: 13, opacity: 0.6 }}>No installable releases were found.</div>
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
                  <span style={{ fontWeight: 400, opacity: 0.6 }}> · installed</span>
                )}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6 }}>
                {r.prerelease ? "Beta" : "Stable"}
                {r.published ? ` · ${r.published}` : ""}
                {r.self_update === false ? " · updates by hand from there" : ""}
              </div>
            </div>
            <DialogButton
              disabled={!!busy || !r.installable}
              onClick={() => void install(r)}
              style={{ minWidth: 0, width: 140, height: 36, padding: "0 12px", fontSize: 13 }}
            >
              {busy === r.tag ? "Downloading…" : actionLabel(r)}
            </DialogButton>
          </Focusable>
        ))}
      </Focusable>
    </ModalRoot>
  );
}
