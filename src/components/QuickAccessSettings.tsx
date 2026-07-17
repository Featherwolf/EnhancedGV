import { useEffect, useState } from "react";
import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  ButtonItem,
  showModal,
} from "@decky/ui";
import { toaster, useQuickAccessVisible } from "@decky/api";
import { getCurrentAppid } from "../patchLibraryApp";
import { FullStoreModal } from "./FullStoreModal";
import {
  getSettings,
  setSettings,
  clearCache,
  checkUpdate,
  testVideo,
  getBackendInfo,
} from "../api";
import type { VideoProbe, BackendInfo } from "../api";
import type { UpdateInfo } from "../types";
import { primeSettings, clearFrontendCache, getFetchInfo } from "../hooks/useAppData";
import {
  getDiag,
  subscribeDiag,
  getStoreRenders,
  getProbeCounters,
  getVideoNote,
  getNavBridgeNote,
} from "../diag";
import type { DiagState } from "../diag";
import { DEFAULT_EXPANDED } from "../types";
import type { PluginSettings, SectionToggles, ExpandedToggles } from "../types";

const DEFAULTS: PluginSettings = {
  sections: {
    media: true,
    about: true,
    features: true,
    reviews: true,
    news: true,
    deck: true,
  },
  expanded: { ...DEFAULT_EXPANDED },
  language: "english",
  country: "us",
};

const EXPANDED_LABELS: { key: keyof ExpandedToggles; label: string }[] = [
  { key: "about", label: "About / description" },
  { key: "features", label: "Features & details" },
  { key: "deck", label: "Steam Deck compatibility" },
  { key: "reviews", label: "Reviews" },
  { key: "news", label: "Update history" },
];

const SECTION_LABELS: { key: keyof SectionToggles; label: string }[] = [
  { key: "media", label: "Media (videos & screenshots)" },
  { key: "about", label: "About / description" },
  { key: "features", label: "Features & details" },
  { key: "deck", label: "Steam Deck compatibility" },
  { key: "reviews", label: "Reviews" },
  { key: "news", label: "Update history" },
];

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function tri(v: boolean | null): string {
  return v == null ? "—" : v ? "yes" : "NO";
}

// What can THIS client's media engine actually decode? Confirms/refutes the
// "client update dropped H.264" theory in one glance ("no" = unsupported).
// Computed ONCE at module load — decoder support can't change at runtime.
const CODEC_SUPPORT: string = (() => {
  try {
    const v = document.createElement("video");
    const p = (t: string) => v.canPlayType(t) || "no";
    return `h264: ${p('video/mp4; codecs="avc1.42E01E"')} · vp9: ${p('video/webm; codecs="vp9"')} · av1: ${p('video/mp4; codecs="av01.0.05M.08"')}`;
  } catch (e) {
    return `probe failed: ${String(e)}`;
  }
})();

function describeFetch(): string {
  const f = getFetchInfo();
  if (f.startedAt && !f.settledAt) {
    return `${f.note} — ${Math.round((Date.now() - f.startedAt) / 1000)}s`;
  }
  if (f.settledAt) {
    const took = f.startedAt ? ` in ${Math.round((f.settledAt - f.startedAt) / 1000)}s` : "";
    return `${f.note}${took}`;
  }
  return f.note;
}

export function QuickAccessSettings() {
  const [settings, setLocal] = useState<PluginSettings>(DEFAULTS);
  const [diag, setDiag] = useState<DiagState>(getDiag());
  const [storeRenders, setStoreRenders] = useState<number>(getStoreRenders());
  // Live backend health probe: a dead/stale Python backend makes callables hang
  // forever (panel stuck on "loading" with no error), so surface it directly.
  const [backend, setBackend] = useState<string>("checking…");
  const [fetch, setFetch] = useState<string>(describeFetch());
  const [probes, setProbes] = useState(getProbeCounters());
  const [videoNote, setVideoNoteState] = useState(getVideoNote());
  const [navBridge, setNavBridge] = useState(getNavBridgeNote());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const qamVisible = useQuickAccessVisible();
  const [videoTest, setVideoTest] = useState<string>("");

  const runVideoTest = async () => {
    const appid = getCurrentAppid();
    if (appid == null) {
      setVideoTest("open a game page first");
      return;
    }
    setVideoTest("testing…");
    try {
      const res = await testVideo(appid);
      if (!res.ok || !res.results) {
        setVideoTest(`failed: ${res.error ?? "?"}`);
        return;
      }
      setVideoTest(
        res.results
          .map((r: VideoProbe) =>
            r.status
              ? `${r.status} · ${((r.bytes ?? 0) / 1024).toFixed(0)}KB in ${r.ms}ms · ${r.url}`
              : `ERR ${r.error} · ${r.url}`
          )
          .join("\n")
      );
    } catch (e) {
      setVideoTest(`failed: ${String(e)}`);
    }
  };

  const runUpdateCheck = async () => {
    const info = await checkUpdate().catch(
      (e) => ({ ok: false, error: String(e), current: "?" }) as UpdateInfo
    );
    setUpdate(info);
  };


  useEffect(() => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) setBackend("NOT RESPONDING — restart Steam");
    }, 5000);
    getSettings()
      .then((s) => {
        settled = true;
        clearTimeout(timer);
        setBackend("ok");
        setLocal({
          ...DEFAULTS,
          ...s,
          sections: { ...DEFAULTS.sections, ...s?.sections },
          expanded: { ...DEFAULT_EXPANDED, ...s?.expanded },
        });
      })
      .catch((e) => {
        settled = true;
        clearTimeout(timer);
        setBackend("error: " + String(e));
      });
    getBackendInfo()
      .then(setBackendInfo)
      .catch(() => setBackendInfo(null));
    const unsub = subscribeDiag(setDiag);
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);

  // Poll the synchronous probes ONLY while the QAM is actually visible —
  // otherwise a hidden panel re-renders twice a second forever after the
  // overlay closes (thousands of orphan renders + timer churn on battery).
  useEffect(() => {
    if (!qamVisible) return;
    runUpdateCheck();
    const iv = setInterval(() => {
      setStoreRenders(getStoreRenders());
      setFetch(describeFetch());
      setProbes(getProbeCounters());
      setVideoNoteState(getVideoNote());
      setNavBridge(getNavBridgeNote());
    }, 500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qamVisible]);

  const persist = async (next: PluginSettings) => {
    setLocal(next);
    primeSettings(next); // update shared cache + live-update any open game page
    await setSettings(next).catch(() => {});
  };

  const toggleSection = (key: keyof SectionToggles, value: boolean) =>
    persist({ ...settings, sections: { ...settings.sections, [key]: value } });

  const toggleExpanded = (key: keyof ExpandedToggles, value: boolean) =>
    persist({
      ...settings,
      expanded: { ...DEFAULT_EXPANDED, ...settings.expanded, [key]: value },
    });

  const modalAppid = getCurrentAppid();

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={modalAppid == null}
            onClick={() => {
              if (modalAppid != null) showModal(<FullStoreModal appid={modalAppid} />);
            }}
          >
            Open store view (fully controller-navigable)
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Sections shown on the game page">
        {SECTION_LABELS.map(({ key, label }) => (
          <PanelSectionRow key={key}>
            <ToggleField
              label={label}
              checked={settings.sections[key]}
              onChange={(v: boolean) => toggleSection(key, v)}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>

      <PanelSection title="Expanded by default">
        {EXPANDED_LABELS.map(({ key, label }) => (
          <PanelSectionRow key={key}>
            <ToggleField
              label={label}
              checked={(settings.expanded ?? DEFAULT_EXPANDED)[key]}
              onChange={(v: boolean) => toggleExpanded(key, v)}
            />
          </PanelSectionRow>
        ))}
      </PanelSection>

      <PanelSection title="Cache">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              const res = await clearCache().catch(() => null);
              clearFrontendCache();
              toaster.toast({
                title: "EnhancedGV",
                body: res
                  ? `Cleared ${res.removed} cached file(s)`
                  : "Failed to clear cache",
              });
            }}
          >
            Clear cached store data
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Updates">
        <PanelSectionRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
            <DiagRow label="Installed version" value={update?.current ?? "…"} />
            {update?.ok && (
              <DiagRow
                label="Latest release"
                value={`${update.latest}${update.has_update ? " (update available!)" : " (up to date)"}`}
              />
            )}
            {update && !update.ok && (
              <DiagRow label="Update check" value={update.error ?? "failed"} />
            )}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={runUpdateCheck}>
            Check for updates
          </ButtonItem>
        </PanelSectionRow>
        {update?.ok && update.has_update && (
          <PanelSectionRow>
            <div style={{ fontSize: 11.5, opacity: 0.8 }}>
              Update available — download EnhancedGV.zip from the GitHub release
              and install via Decky → Developer → Install Plugin from ZIP.
            </div>
          </PanelSectionRow>
        )}
        {update?.ok && update.notes && (
          <PanelSectionRow>
            <div
              style={{
                fontSize: 11.5,
                opacity: 0.75,
                whiteSpace: "pre-wrap",
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {update.notes}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Status">
        <PanelSectionRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
            <DiagRow label="Backend" value={backend} />
            <DiagRow label="Integration" value={diag.path ?? "—"} />
            <DiagRow label="Nav bridge" value={navBridge.split(" · ")[0]} />
            <DiagRow label="Video" value={videoNote} />
            <DiagRow label="Codecs" value={CODEC_SUPPORT} />
            <DiagRow label="Fetch" value={fetch} />
            <DiagRow
              label="Data (details/reviews/news/deck)"
              value={
                diag.dataOk
                  ? `${diag.dataOk.appdetails ? "✓" : "✗"}/${diag.dataOk.reviews ? "✓" : "✗"}/${diag.dataOk.news ? "✓" : "✗"}/${diag.dataOk.deck ? "✓" : "✗"}`
                  : "—"
              }
            />
            {diag.panelError && <DiagRow label="Data error" value={diag.panelError} />}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={runVideoTest}>
            Test trailer connectivity (current game)
          </ButtonItem>
        </PanelSectionRow>
        {videoTest && (
          <PanelSectionRow>
            <div style={{ fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.85 }}>
              {videoTest}
            </div>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ToggleField
            label="Advanced diagnostics"
            checked={showAdvanced}
            onChange={setShowAdvanced}
          />
        </PanelSectionRow>
        {showAdvanced && (
          <PanelSectionRow>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
              <DiagRow
                label="Sanitizer"
                value={
                  backendInfo
                    ? `${backendInfo.engine} (html.parser: ${backendInfo.html_parser ? "yes" : "NO"}) · self-test b/br/img ${backendInfo.selftest_tags.b}/${backendInfo.selftest_tags.br}/${backendInfo.selftest_tags.img} · py ${backendInfo.python}`
                    : "—"
                }
              />
              <DiagRow label="Layout class" value={diag.installClass ?? "MISSING"} />
              <DiagRow label="renderFunc" value={tri(diag.renderFuncFound)} />
              <DiagRow label="appid" value={diag.appid != null ? String(diag.appid) : tri(diag.overviewFound)} />
              <DiagRow label="Note" value={diag.note} />
              <DiagRow label="Panel renders" value={String(storeRenders)} />
              <DiagRow label="Panel state" value={diag.panelState ?? "—"} />
              <DiagRow
                label="Route / attach / miss"
                value={`${probes.fFires} / ${probes.injectApplies} / ${probes.injectMisses}`}
              />
              <DiagRow label="Mounts (in/out)" value={probes.mounts} />
              <DiagRow label="Ages" value={probes.ages} />
              <DiagRow label="Nav bridge (full)" value={navBridge} />
              {probes.lastMissReason && (
                <DiagRow label="Last miss" value={probes.lastMissReason} />
              )}
              <DiagRow
                label="Panel box (w×h @top)"
                value={
                  diag.panelRect
                    ? `${diag.panelRect.w}×${diag.panelRect.h} @${diag.panelRect.top} (vh ${diag.panelRect.vh})`
                    : "—"
                }
              />
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
}
