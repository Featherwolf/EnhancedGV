import { useEffect, useRef, useState } from "react";
import { openExternal } from "../nav";
import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  ButtonItem,
  TextField,
  Dropdown,
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
  resolveGame,
  testIgdb,
  clearIgdbCredentials,
  lookupStoreApp,
  setMatch,
  clearMatch,
  blankMatch,
} from "../api";
import type { VideoProbe, BackendInfo, ResolveResult, IgdbStep } from "../api";
import type { UpdateInfo } from "../types";
import { getGameIdentity } from "../identity";
import { providerLabel } from "../providers";
import { PatchNotesModal } from "./PatchNotesModal";
import { onMatchChanged, emitMatchChanged } from "../matches";
import { resolveLanguage, resolveCountry, languageDiag } from "../lang";
import { useTranslation, LANGUAGE_UPDATED_EVENT } from "../i18n";
import type { LanguagePreference } from "../i18n";
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
  language: "auto",
  country: "auto",
  uiLanguage: "auto",
  nonSteamSources: false,
};

// Translated per-render (needs `t`) rather than module-level constants.
function expandedLabels(t: (k: any) => string): { key: keyof ExpandedToggles; label: string }[] {
  return [
    { key: "about", label: t("settings.sectionAbout") },
    { key: "features", label: t("settings.sectionFeaturesDetails") },
    { key: "deck", label: t("settings.sectionDeckCompat") },
    { key: "reviews", label: t("settings.sectionReviews") },
    { key: "news", label: t("settings.sectionUpdateHistory") },
  ];
}

function sectionLabels(t: (k: any) => string): { key: keyof SectionToggles; label: string }[] {
  return [
    { key: "media", label: t("settings.sectionMedia") },
    { key: "about", label: t("settings.sectionAbout") },
    { key: "features", label: t("settings.sectionFeaturesDetails") },
    { key: "deck", label: t("settings.sectionDeckCompat") },
    { key: "reviews", label: t("settings.sectionReviews") },
    { key: "news", label: t("settings.sectionUpdateHistory") },
  ];
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function tri(v: boolean | null, t: (k: any) => string): string {
  return v == null ? "—" : v ? t("common.yes") : t("common.no");
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

// Per-game store matching. Shows the Steam App ID the panel is pulling content
// for (always editable), plus the matched "Title (Year)" so the user can eyeball
// that the right store page loaded. Editing the ID (a number or a pasted store
// URL) sets a sticky manual match; Clear re-runs auto-detection. Works for Steam
// games too — most people only need it for non-Steam apps, but it's there.
function StoreSourceSection({ appid, lang, cc }: { appid: number; lang: string; cc: string }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ResolveResult | null>(null);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const identity = getGameIdentity(appid);

  useEffect(() => {
    // Generation guard: a late-settling resolve for a previous appid (or an
    // earlier load) must not overwrite the current game's info/input — otherwise
    // the QAM could show, and Save could persist, the wrong game's store appid.
    let alive = true;
    let gen = 0;
    const load = async () => {
      const myGen = ++gen;
      const id = getGameIdentity(appid);
      const r = await resolveGame(appid, id.isShortcut, id.title, lang, cc).catch(() => null);
      if (!alive || myGen !== gen) return;
      setInfo(r);
      setInput(r?.store_appid ? String(r.store_appid) : "");
    };
    setMsg("");
    load();
    const off = onMatchChanged((c) => {
      if (c === appid) load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [appid, lang, cc]);

  const save = async () => {
    setBusy(true);
    setMsg(t("settings.lookingUp"));
    const look = await lookupStoreApp(input, lang, cc).catch(() => null);
    if (!look?.ok || !look.appid) {
      setMsg(look?.error ?? t("settings.lookupFailed"));
      setBusy(false);
      return;
    }
    const provider = look.provider ?? "steam";
    await setMatch(appid, look.appid, look.name ?? "", look.year ?? "", "manual", provider).catch(
      () => {},
    );
    emitMatchChanged(appid); // re-resolve the open game page + reload this section
    setMsg(
      provider === "steam"
        ? t("settings.setTo", { name: look.name ?? "", year: look.year || "—" })
        : t("settings.setToVia", {
            name: look.name ?? "",
            year: look.year || "—",
            provider: providerLabel(provider),
          }),
    );
    setBusy(false);
  };

  // Erase the match and LEAVE IT BLANK — the game stays unmatched and is not
  // auto-matched again (sticky). Use this to hide the store panel for a game.
  const clear = async () => {
    setBusy(true);
    setMsg(t("settings.clearedBlank"));
    await blankMatch(appid).catch(() => {});
    emitMatchChanged(appid);
    setBusy(false);
  };

  // Delete the record so auto-matching runs again on this game.
  const redetect = async () => {
    setBusy(true);
    setMsg(t("settings.redetecting"));
    await clearMatch(appid).catch(() => {});
    emitMatchChanged(appid);
    setBusy(false);
  };

  const matched = info?.store_appid
    ? `${info.name || "?"} (${info.year || "—"})${info.source === "manual" ? " · manual" : ""}`
    : info?.provider && info.provider !== "steam" && info.provider_id != null
    ? `${info.name || "?"} (${info.year || "—"}) · via ${providerLabel(info.provider)}`
    : t("settings.notIdentified");

  return (
    <PanelSection title={t("settings.storeDataSource")}>
      <PanelSectionRow>
        <DiagRow label={t("settings.game")} value={identity.title || String(appid)} />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label={t("settings.sourceIdLabel")}
          description={t("settings.sourceIdDesc")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <DiagRow label={t("settings.matched")} value={matched} />
      </PanelSectionRow>
      {msg && (
        <PanelSectionRow>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || !input.trim()} onClick={save}>
          {t("settings.saveId")}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={clear}>
          {t("settings.clearBlank")}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={redetect}>
          {t("settings.redetect")}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

// Artwork upgrade for non-Steam games: paste a Twitch application's Client ID
// and Secret and the backend layers IGDB covers/screenshots/genres/developers
// over the keyless baseline. The pair lives in the plugin's local settings file
// and the secret goes only to id.twitch.tv — the test below never echoes it
// back, and the backend never returns it over RPC.
function IgdbCredentialsRow() {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [saved, setSaved] = useState<boolean>(false);
  // Whether ANYTHING is stored, which is not the same as being set up. A build
  // before 0.19.1 could blank the client id and leave the secret behind, and a
  // Remove button gated on `saved` was then hidden from exactly the people who
  // had a secret on disk to remove.
  const [stored, setStored] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<IgdbStep[] | null>(null);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (!alive) return;
        const st = s as PluginSettings;
        // The backend redacts the secret and reports only whether one exists.
        setSaved(!!(st.igdbClientId && st.igdbClientSecretSet));
        setStored(!!(st.igdbClientId || st.igdbClientSecretSet));
        setClientId(st.igdbClientId ?? "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const save = async (id: string, secret: string) => {
    try {
      const cur = await getSettings();
      const next = { ...(cur as PluginSettings), igdbClientId: id, igdbClientSecret: secret };
      await setSettings(next);
      // Never keep the secret in the object handed around the frontend.
      primeSettings({ ...next, igdbClientSecret: "", igdbClientSecretSet: !!secret });
      setClientSecret("");
      setSaved(!!(id && secret));
      setStored(!!(id || secret));
      setNote(t("settings.credentialsSaved"));
      // Cached non-Steam payloads were built without artwork; drop them so the
      // next visit refetches with IGDB in play.
      await clearCache().catch(() => undefined);
      clearFrontendCache();
    } catch (e) {
      setNote(t("settings.couldNotSave", { error: String(e) }));
    }
  };

  const runTest = async () => {
    setBusy(true);
    setSteps(null);
    setNote("");
    try {
      const res = await testIgdb(getCurrentAppid() ?? 0);
      setSteps(res.steps ?? []);
      if (!res.ok && res.error) setNote(res.error);
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelSectionRow>
        <TextField
          label={t("settings.igdbClientId")}
          description={
            saved
              ? t("settings.igdbClientIdDescSaved")
              : t("settings.igdbClientIdDescUnsaved")
          }
          value={clientId}
          onChange={(e: { target: { value: string } }) => setClientId(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label={t("settings.igdbClientSecret")}
          description={t("settings.igdbClientSecretDesc")}
          value={clientSecret}
          bIsPassword
          onChange={(e: { target: { value: string } }) => setClientSecret(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => save(clientId.trim(), clientSecret.trim())}
          disabled={!clientId.trim() || !clientSecret.trim()}
        >
          {t("settings.saveCredentials")}
        </ButtonItem>
      </PanelSectionRow>
      {stored && (
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => {
              void (async () => {
                setClientId("");
                setClientSecret("");
                try {
                  await clearIgdbCredentials();
                  const cur = await getSettings();
                  primeSettings(cur as PluginSettings);
                  setSaved(false);
                  setStored(false);
                  setNote(t("settings.credentialsErased"));
                  await clearCache().catch(() => undefined);
                  clearFrontendCache();
                } catch (e) {
                  setNote(t("settings.couldNotClear", { error: String(e) }));
                }
              })();
            }}
          >
            {t("settings.removeCredentials")}
          </ButtonItem>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={runTest} disabled={busy}>
          {busy ? t("settings.testing") : t("settings.testArtwork")}
        </ButtonItem>
      </PanelSectionRow>
      {steps?.map((st) => (
        <DiagRow key={st.name} label={st.name} value={`${st.ok ? "✔" : "✖"} ${st.detail}`} />
      ))}
      {!!note && <DiagRow label={t("settings.result")} value={note} />}
    </>
  );
}


export function QuickAccessSettings() {
  const { t } = useTranslation();
  const [settings, setLocal] = useState<PluginSettings>(DEFAULTS);
  const [diag, setDiag] = useState<DiagState>(getDiag());
  const [storeRenders, setStoreRenders] = useState<number>(getStoreRenders());
  // Live backend health probe: a dead/stale Python backend makes callables hang
  // forever (panel stuck on "loading" with no error), so surface it directly.
  const [backend, setBackend] = useState<string>(t("settings.backendChecking"));
  const [fetch, setFetch] = useState<string>(describeFetch());
  const [probes, setProbes] = useState(getProbeCounters());
  const [videoNote, setVideoNoteState] = useState(getVideoNote());
  const [navBridge, setNavBridge] = useState(getNavBridgeNote());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const qamVisible = useQuickAccessVisible();
  const [videoTest, setVideoTest] = useState<string>("");

  const runVideoTest = async () => {
    const gameAppid = getCurrentAppid();
    if (gameAppid == null) {
      setVideoTest(t("settings.videoTestNoGame"));
      return;
    }
    setVideoTest(t("settings.videoTestTesting"));
    try {
      // For a non-Steam game the page appid is the shortcut id, which has no
      // store data — probe the MATCHED store appid instead (idempotent resolve).
      const id = getGameIdentity(gameAppid);
      const r = await resolveGame(
        gameAppid,
        id.isShortcut,
        id.title,
        resolveLanguage(settings.language),
        resolveCountry(settings.country)
      ).catch(() => null);
      const appid = r?.store_appid ?? gameAppid;
      const res = await testVideo(appid);
      if (!res.ok || !res.results) {
        setVideoTest(t("settings.videoTestFailed", { error: res.error ?? "?" }));
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
      setVideoTest(t("settings.videoTestFailed", { error: String(e) }));
    }
  };

  // Monotonic request id: the channel can flip while a check is in flight,
  // and the OLDER response must not land on top of the newer one.
  const updateReq = useRef(0);
  const runUpdateCheck = async (beta: boolean = !!settings.beta) => {
    // Beta builds are published as GitHub PRE-RELEASES: excluded from
    // /releases/latest (so stable users never see them) but visible to the
    // beta channel, which opts in here.
    const id = ++updateReq.current;
    const info = await checkUpdate(beta).catch(
      (e) => ({ ok: false, error: String(e), current: "?" }) as UpdateInfo
    );
    if (id === updateReq.current) setUpdate(info);
  };


  useEffect(() => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) setBackend(t("settings.backendNotResponding"));
    }, 5000);
    getSettings()
      .then((s) => {
        settled = true;
        clearTimeout(timer);
        setBackend(t("settings.backendOk"));
        setLocal({
          ...DEFAULTS,
          ...s,
          sections: { ...DEFAULTS.sections, ...s?.sections },
          expanded: { ...DEFAULT_EXPANDED, ...s?.expanded },
        });
        setSettingsLoaded(true);
      })
      .catch((e) => {
        settled = true;
        clearTimeout(timer);
        setBackend(t("settings.backendError", { error: String(e) }));
      });
    getBackendInfo()
      .then(setBackendInfo)
      .catch(() => setBackendInfo(null));
    const unsub = subscribeDiag(setDiag);
    return () => {
      unsub();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the synchronous probes ONLY while the QAM is actually visible —
  // otherwise a hidden panel re-renders twice a second forever after the
  // overlay closes (thousands of orphan renders + timer churn on battery).
  // The automatic update check must wait for the SAVED settings: running it
  // from the initial DEFAULTS closure checked the stable channel even when the
  // user had the beta channel on, and nothing re-ran it once settings loaded.
  useEffect(() => {
    if (!qamVisible || !settingsLoaded) return;
    void runUpdateCheck(!!settings.beta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qamVisible, settingsLoaded, settings.beta]);

  useEffect(() => {
    if (!qamVisible) return;
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
    // The IGDB pair is owned by the credentials row and the backend, never by
    // this object — which is loaded once when the panel mounts and is stale the
    // moment credentials are saved or removed. Sending it back is how flipping
    // a switch used to erase a just-saved Client ID, and how a removed one could
    // reappear. Omit both halves: set_settings leaves out what it isn't given.
    const { igdbClientId: _id, igdbClientSecret: _secret, ...withoutCreds } = next;
    await setSettings(withoutCreds).catch(() => {});
  };

  const toggleSection = (key: keyof SectionToggles, value: boolean) =>
    persist({ ...settings, sections: { ...settings.sections, [key]: value } });

  const toggleExpanded = (key: keyof ExpandedToggles, value: boolean) =>
    persist({
      ...settings,
      expanded: { ...DEFAULT_EXPANDED, ...settings.expanded, [key]: value },
    });

  const toggleNonSteam = (value: boolean) =>
    persist({ ...settings, nonSteamSources: value });

  const updateUiLanguage = async (value: LanguagePreference) => {
    await persist({ ...settings, uiLanguage: value });
    // Tell every mounted i18n consumer (this panel, the game-page StorePanel,
    // any open modal) to re-resolve the language, same as a Steam restart would.
    window.dispatchEvent(new CustomEvent(LANGUAGE_UPDATED_EVENT));
  };

  const LANGUAGE_OPTIONS: Array<{ data: LanguagePreference; label: string }> = [
    { data: "auto", label: t("settings.languageAuto") },
    { data: "en", label: t("settings.languageEnglish") },
    { data: "pt-BR", label: t("settings.languagePortuguese") },
  ];

  const modalAppid = getCurrentAppid();
  const EXPANDED_LABELS = expandedLabels(t);
  const SECTION_LABELS = sectionLabels(t);

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
            {t("settings.openStoreView")}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      {modalAppid != null && (
        // key per game: a game change remounts a fresh section so a stale
        // in-flight load from the previous game can't land on the new one.
        <StoreSourceSection
          key={modalAppid}
          appid={modalAppid}
          lang={resolveLanguage(settings.language)}
          cc={resolveCountry(settings.country)}
        />
      )}

      <PanelSection title={t("settings.nonSteamTitle")}>
        <PanelSectionRow>
          <ToggleField
            label={t("settings.nonSteamToggle")}
            description={t("settings.nonSteamDesc")}
            checked={!!settings.nonSteamSources}
            onChange={toggleNonSteam}
          />
        </PanelSectionRow>
        {!!settings.nonSteamSources && <IgdbCredentialsRow />}
      </PanelSection>

      <PanelSection title={t("settings.sectionsShown")}>
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

      <PanelSection title={t("settings.expandedByDefault")}>
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

      <PanelSection title={t("settings.language")}>
        <PanelSectionRow>
          <div style={{ width: "100%" }}>
            <Dropdown
              rgOptions={LANGUAGE_OPTIONS}
              selectedOption={settings.uiLanguage ?? "auto"}
              onChange={(option) => updateUiLanguage(option.data)}
            />
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t("settings.cache")}>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              const res = await clearCache().catch(() => null);
              clearFrontendCache();
              toaster.toast({
                title: "EnhancedGV",
                body: res
                  ? t("settings.cacheClearedToast", { count: res.removed })
                  : t("settings.cacheClearFailedToast"),
              });
            }}
          >
            {t("settings.clearCache")}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t("settings.updates")}>
        <PanelSectionRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
            <DiagRow label={t("settings.installedVersion")} value={update?.current ?? "…"} />
            {update?.ok && (
              <DiagRow
                label={update.channel === "beta" ? t("settings.latestBeta") : t("settings.latestRelease")}
                value={`${update.latest ?? "?"}${update.prerelease ? " (beta)" : ""}${
                  update.has_update ? t("settings.updateAvailableSuffix") : t("settings.upToDateSuffix")
                }`}
              />
            )}
            {update && !update.ok && (
              <DiagRow label={t("settings.updateCheckLabel")} value={update.error ?? t("settings.updateCheckFailed")} />
            )}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => showModal(<PatchNotesModal version={update?.current} />)}
          >
            {t("settings.viewPatchNotes")}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => void runUpdateCheck()}>
            {t("settings.checkForUpdates")}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label={t("settings.betaChannel")}
            description={t("settings.betaChannelDesc")}
            checked={!!settings.beta}
            // Persisting flips settings.beta, which re-runs the update check
            // for the newly chosen channel via the effect above.
            onChange={(v: boolean) => persist({ ...settings, beta: v })}
          />
        </PanelSectionRow>
        {update?.ok && update.has_update && (
          <>
            <PanelSectionRow>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#66c0f4", padding: "2px 0" }}>
                {t("settings.updateAvailable", { version: update.latest ?? "" })}
                {update.prerelease ? " (beta)" : ""}
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <div
                style={{ fontSize: 11.5, opacity: 0.85 }}
                dangerouslySetInnerHTML={{ __html: t("settings.downloadInstructions") }}
              />
            </PanelSectionRow>
            {update.url && (
              <PanelSectionRow>
                <ButtonItem
                  layout="below"
                  onClick={() => openExternal(update.url)}
                >
                  {t("settings.openReleasePage")}
                </ButtonItem>
              </PanelSectionRow>
            )}
            {update.notes && (
              <PanelSectionRow>
                <div
                  style={{
                    fontSize: 11.5,
                    opacity: 0.75,
                    whiteSpace: "pre-wrap",
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {update.notes}
                </div>
              </PanelSectionRow>
            )}
          </>
        )}
      </PanelSection>

      <PanelSection title={t("settings.statusTitle")}>
        <PanelSectionRow>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
            <DiagRow label={t("settings.statusBackend")} value={backend} />
            <DiagRow label={t("settings.statusIntegration")} value={diag.path ?? "—"} />
            <DiagRow label={t("settings.statusNavBridge")} value={navBridge.split(" · ")[0]} />
            <DiagRow label={t("settings.statusVideo")} value={videoNote} />
            <DiagRow label={t("settings.statusCodecs")} value={CODEC_SUPPORT} />
            <DiagRow label={t("settings.statusStoreLanguage")} value={languageDiag(settings.language, settings.country)} />
            <DiagRow label={t("settings.statusFetch")} value={fetch} />
            <DiagRow
              label={t("settings.statusDataOk")}
              value={
                diag.dataOk
                  ? `${diag.dataOk.appdetails ? "✓" : "✗"}/${diag.dataOk.reviews ? "✓" : "✗"}/${diag.dataOk.news ? "✓" : "✗"}/${diag.dataOk.deck ? "✓" : "✗"}`
                  : "—"
              }
            />
            {diag.panelError && <DiagRow label={t("settings.statusDataError")} value={diag.panelError} />}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={runVideoTest}>
            {t("settings.testTrailerConnectivity")}
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
            label={t("settings.advancedDiagnostics")}
            checked={showAdvanced}
            onChange={setShowAdvanced}
          />
        </PanelSectionRow>
        {showAdvanced && (
          <PanelSectionRow>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
              <DiagRow
                label={t("settings.diagSanitizer")}
                value={
                  backendInfo
                    ? `${backendInfo.engine} (html.parser: ${backendInfo.html_parser ? t("common.yes") : t("common.no")}) · self-test b/br/img ${backendInfo.selftest_tags.b}/${backendInfo.selftest_tags.br}/${backendInfo.selftest_tags.img} · py ${backendInfo.python}`
                    : "—"
                }
              />
              <DiagRow label={t("settings.diagLayoutClass")} value={diag.installClass ?? t("settings.diagMissing")} />
              <DiagRow label={t("settings.diagRenderFunc")} value={tri(diag.renderFuncFound, t)} />
              <DiagRow label={t("settings.diagAppid")} value={diag.appid != null ? String(diag.appid) : tri(diag.overviewFound, t)} />
              <DiagRow label={t("settings.diagNote")} value={diag.note} />
              <DiagRow label={t("settings.diagPanelRenders")} value={String(storeRenders)} />
              <DiagRow label={t("settings.diagPanelState")} value={diag.panelState ?? "—"} />
              <DiagRow
                label={t("settings.diagRouteAttachMiss")}
                value={`${probes.fFires} / ${probes.injectApplies} / ${probes.injectMisses}`}
              />
              <DiagRow label={t("settings.diagMounts")} value={probes.mounts} />
              <DiagRow label={t("settings.diagAges")} value={probes.ages} />
              <DiagRow label={t("settings.diagNavBridgeFull")} value={navBridge} />
              {probes.lastMissReason && (
                <DiagRow label={t("settings.diagLastMiss")} value={probes.lastMissReason} />
              )}
              <DiagRow
                label={t("settings.diagPanelBox")}
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
