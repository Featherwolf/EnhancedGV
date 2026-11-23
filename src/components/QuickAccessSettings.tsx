import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { openExternal } from "../nav";
import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  ButtonItem,
  TextField,
  DropdownItem,
  showModal,
} from "@decky/ui";
import { toaster, useQuickAccessVisible } from "@decky/api";
import { getCurrentAppid, layoutClassMissing } from "../patchLibraryApp";
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
import { VersionPickerModal } from "./VersionPickerModal";
import { SectionsModal, sectionSummary } from "./SectionsModal";
import { canInstallInPlace, installRelease } from "../updater";
import { onMatchChanged, emitMatchChanged } from "../matches";
import { resolveLanguage, resolveCountry, languageDiag } from "../lang";
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
import type { PluginSettings } from "../types";
import { useTranslation, LANGUAGE_UPDATED_EVENT } from "../i18n";
import type { TranslationKey, LanguagePreference } from "../i18n";

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

// Translated per-render (needs `t`) rather than a module-level constant.
function languageChoices(
  t: (k: TranslationKey) => string,
): { pref: LanguagePreference; label: string }[] {
  return [
    { pref: "auto", label: t("settings.languageAuto") },
    { pref: "en", label: "English" },
    { pref: "pt-BR", label: "Português (Brasil)" },
  ];
}

const ACCENT = "#66c0f4";
const WARN = "#e5b143";
const RELEASES_PAGE = "https://github.com/Featherwolf/EnhancedGV/releases";

// The last successful update check, shared by every mount of the panel.
const UPDATE_REUSE_MS = 30 * 60_000;
let lastUpdateCheck: { at: number; beta: boolean; info: UpdateInfo } | null = null;

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 0" }}>
      {children}
    </div>
  );
}

// A line of small print: a hint, a result, or a warning when given a colour.
function Hint({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.45,
        padding: "2px 0",
        color,
        opacity: color ? 1 : 0.7,
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
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

// The open game: its store view, and which store page or listing it is matched
// to. The match editor stays folded away until asked for. Saving an ID (a
// number or a pasted store URL) sets a sticky manual match; "Detect again"
// re-runs auto-detection; "Leave unmatched" keeps the game blank, which hides
// the panel for it.
function GameSection({ appid, lang, cc }: { appid: number; lang: string; cc: string }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ResolveResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
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
      setLoaded(true);
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
        ? t("settings.matchedTo", { name: look.name ?? "", year: look.year || "—" })
        : t("settings.matchedToVia", {
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
    setMsg(t("settings.leftUnmatchedMsg"));
    await blankMatch(appid).catch(() => {});
    emitMatchChanged(appid);
    setBusy(false);
  };

  // Delete the record so auto-matching runs again on this game.
  const redetect = async () => {
    setBusy(true);
    setMsg(t("settings.detecting"));
    await clearMatch(appid).catch(() => {});
    emitMatchChanged(appid);
    setBusy(false);
  };

  const matched = info?.store_appid
    ? `${info.name || "?"} (${info.year || "—"})${info.source === "manual" ? t("settings.setByYou") : ""}`
    : info?.provider && info.provider !== "steam" && info.provider_id != null
    ? `${info.name || "?"} (${info.year || "—"})${t("settings.viaProvider", { provider: providerLabel(info.provider) })}`
    : loaded
    ? t("settings.notMatched")
    : "…";

  return (
    <PanelSection title={t("settings.thisGame")}>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => showModal(<FullStoreModal appid={appid} />)}>
          {t("settings.openStoreView")}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <Rows>
          {identity.isShortcut && <DiagRow label={t("settings.shortcutLabel")} value={identity.title || String(appid)} />}
          <DiagRow label={t("settings.storePageLabel")} value={matched} />
        </Rows>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => setEditing((e) => !e)}>
          {editing ? t("settings.done") : t("settings.changeMatch")}
        </ButtonItem>
      </PanelSectionRow>
      {editing && (
        <>
          <PanelSectionRow>
            <TextField
              label={t("settings.matchToLabel")}
              description={t("settings.matchToDesc")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy || !input.trim()} onClick={save}>
              {t("settings.saveMatch")}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={redetect}>
              {t("settings.detectAgain")}
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={clear}>
              {t("settings.leaveUnmatched")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
      {msg && (
        <PanelSectionRow>
          <Hint>{msg}</Hint>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

// Artwork for non-Steam games. With EnhancedGV's Hasheous app key in the build,
// covers and screenshots need nothing from the user. Their own IGDB (Twitch
// application) credentials are optional and add IGDB's title search. The pair
// lives in the plugin's local settings file and the secret goes only to
// id.twitch.tv: the test below never echoes it back, and the backend never
// returns it over RPC.
function NonSteamArtwork() {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState<string>("");
  const [clientSecret, setClientSecret] = useState<string>("");
  const [saved, setSaved] = useState<boolean>(false);
  // Whether ANYTHING is stored, which is not the same as being set up. A build
  // before 0.19.1 could blank the client id and leave the secret behind, and a
  // Remove button gated on `saved` was then hidden from exactly the people who
  // had a secret on disk to remove.
  const [stored, setStored] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<IgdbStep[] | null>(null);
  const [note, setNote] = useState<string>("");
  const [appKey, setAppKey] = useState<boolean>(false);

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
        setAppKey(!!st.hasheousAppKey);
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
      // Panels already shown for non-Steam games were built without IGDB
      // artwork; drop the in-memory copies so the next visit asks again. The
      // backend cache stays: it never holds a merged result, and wiping it
      // would refetch every Steam game at once (#10).
      clearFrontendCache();
    } catch (e) {
      setNote(t("settings.couldNotSave", { error: String(e) }));
    }
  };

  const remove = async () => {
    setClientId("");
    setClientSecret("");
    try {
      const res = await clearIgdbCredentials();
      // It reports failure in its result rather than throwing, and this note
      // must never claim an erase that didn't happen.
      if (!res?.ok) {
        setNote(t("settings.couldNotEraseCredentials", { error: res?.error ?? "unknown error" }));
        return;
      }
      const cur = await getSettings();
      primeSettings(cur as PluginSettings);
      setSaved(false);
      setStored(false);
      setNote(t("settings.credentialsErased"));
      // clearIgdbCredentials already dropped the IGDB data cached with them;
      // this just repaints without it.
      clearFrontendCache();
    } catch (e) {
      setNote(t("settings.couldNotClear", { error: String(e) }));
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

  const source = saved
    ? t("settings.sourceYourIgdb")
    : appKey
    ? t("settings.sourceHasheousApp")
    : t("settings.sourceHasheous");

  return (
    <>
      <PanelSectionRow>
        <Rows>
          <DiagRow label={t("settings.artworkFrom")} value={source} />
        </Rows>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={runTest} disabled={busy}>
          {busy ? t("settings.testing") : t("settings.testArtworkLookup")}
        </ButtonItem>
      </PanelSectionRow>
      {steps && steps.length > 0 && (
        <PanelSectionRow>
          <Rows>
            {steps.map((st) => (
              <DiagRow key={st.name} label={st.name} value={`${st.ok ? "✔" : "✖"} ${st.detail}`} />
            ))}
          </Rows>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => setOpen((o) => !o)}>
          {open
            ? t("settings.hideIgdbAccount")
            : saved
            ? t("settings.igdbAccountSaved")
            : t("settings.useOwnIgdbAccount")}
        </ButtonItem>
      </PanelSectionRow>
      {open && (
        <>
          <PanelSectionRow>
            <Hint>
              {saved
                ? t("settings.igdbHintSaved")
                : appKey
                ? t("settings.igdbHintAppKey")
                : t("settings.igdbHintNone")}
            </Hint>
          </PanelSectionRow>
          <PanelSectionRow>
            <TextField
              label={t("settings.igdbClientId")}
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
              <ButtonItem layout="below" onClick={() => void remove()}>
                {t("settings.removeCredentials")}
              </ButtonItem>
            </PanelSectionRow>
          )}
        </>
      )}
      {!!note && (
        <PanelSectionRow>
          <Hint>{note}</Hint>
        </PanelSectionRow>
      )}
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
  const [backend, setBackend] = useState<string>("checking…");
  const [fetch, setFetch] = useState<string>(describeFetch());
  const [probes, setProbes] = useState(getProbeCounters());
  const [videoNote, setVideoNoteState] = useState(getVideoNote());
  const [navBridge, setNavBridge] = useState(getNavBridgeNote());
  const [showDiag, setShowDiag] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [backendInfo, setBackendInfo] = useState<BackendInfo | null>(null);
  const qamVisible = useQuickAccessVisible();
  const [videoTest, setVideoTest] = useState<string>("");

  const runVideoTest = async () => {
    const gameAppid = getCurrentAppid();
    if (gameAppid == null) {
      setVideoTest(t("settings.openGamePageFirst"));
      return;
    }
    setVideoTest(t("settings.testing"));
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
  const runUpdateCheck = async (beta: boolean = !!settings.beta, force = false) => {
    // Opening Quick Access re-runs this, and GitHub allows 60 unauthenticated
    // requests an hour per address, so an automatic check reuses a recent
    // answer for the same channel. The "Check for updates" button always asks.
    const recent = lastUpdateCheck;
    if (!force && recent && recent.beta === beta && Date.now() - recent.at < UPDATE_REUSE_MS) {
      setUpdate(recent.info);
      return;
    }
    // Beta builds are published as GitHub PRE-RELEASES: excluded from
    // /releases/latest (so stable users never see them) but visible to the
    // beta channel, which opts in here.
    const id = ++updateReq.current;
    const info = await checkUpdate(beta).catch(
      (e) => ({ ok: false, error: String(e), current: "?" }) as UpdateInfo
    );
    if (info?.ok) lastUpdateCheck = { at: Date.now(), beta, info };
    if (id === updateReq.current) setUpdate(info);
  };

  // Hands the release to Decky's installer, which asks for confirmation in its
  // own dialog and reloads the plugin when it's done (see updater.ts).
  const install = async (tag?: string) => {
    if (!tag) return;
    setInstalling(true);
    setInstallNote("");
    const res = await installRelease(tag);
    setInstalling(false);
    if (!res.ok) setInstallNote(res.error ?? t("update.installNotStarted"));
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
        setBackend("ok");
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
  }, []);

  // The automatic update check must wait for the SAVED settings: running it
  // from the initial DEFAULTS closure checked the stable channel even when the
  // user had the beta channel on, and nothing re-ran it once settings loaded.
  useEffect(() => {
    if (!qamVisible || !settingsLoaded) return;
    void runUpdateCheck(!!settings.beta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qamVisible, settingsLoaded, settings.beta]);

  // Poll the synchronous probes ONLY while their rows are on screen: a hidden
  // panel that re-rendered twice a second kept doing so forever after the
  // overlay closed (thousands of orphan renders + timer churn on battery).
  useEffect(() => {
    if (!qamVisible || !showDiag) return;
    const iv = setInterval(() => {
      setStoreRenders(getStoreRenders());
      setFetch(describeFetch());
      setProbes(getProbeCounters());
      setVideoNoteState(getVideoNote());
      setNavBridge(getNavBridgeNote());
    }, 500);
    return () => clearInterval(iv);
  }, [qamVisible, showDiag]);

  const persist = async (next: PluginSettings) => {
    setLocal(next);
    primeSettings(next); // update shared cache + live-update any open game page
    // The IGDB pair is owned by the credentials rows and the backend, never by
    // this object — which is loaded once when the panel mounts and is stale the
    // moment credentials are saved or removed. Sending it back is how flipping
    // a switch used to erase a just-saved Client ID, and how a removed one could
    // reappear. Omit both halves: set_settings leaves out what it isn't given.
    const { igdbClientId: _id, igdbClientSecret: _secret, ...withoutCreds } = next;
    await setSettings(withoutCreds).catch(() => {});
    // The i18n module only re-resolves the plugin's own UI language on this
    // event (it doesn't poll settings), so a uiLanguage change needs an
    // explicit nudge — harmless to fire even when it didn't change.
    window.dispatchEvent(new Event(LANGUAGE_UPDATED_EVENT));
  };

  const modalAppid = getCurrentAppid();
  const inPlace = canInstallInPlace();
  const offerInstall = !!(update?.ok && update.has_update);
  const status =
    backend !== "ok"
      ? backend
      : diag.panelError
      ? t("settings.backendOkWithError")
      : t("settings.backendOk");

  return (
    <>
      {layoutClassMissing() && (
        <PanelSection>
          <PanelSectionRow>
            <Hint color={WARN}>
              {t("settings.layoutMissingWarning")}
            </Hint>
          </PanelSectionRow>
        </PanelSection>
      )}

      {offerInstall && update && (
        <PanelSection>
          <PanelSectionRow>
            <div style={{ fontSize: 13, fontWeight: 600, color: ACCENT, padding: "2px 0" }}>
              {t("settings.updateAvailable", { version: update.latest ?? "" })}
              {update.prerelease ? " (beta)" : ""}
            </div>
          </PanelSectionRow>
          {inPlace && update.installable && update.tag ? (
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                disabled={installing}
                onClick={() => void install(update.tag)}
              >
                {installing ? t("settings.downloading") : t("settings.updateToVersion", { version: update.latest ?? "" })}
              </ButtonItem>
            </PanelSectionRow>
          ) : (
            <>
              <PanelSectionRow>
                <Hint>
                  {t("settings.downloadInstructions")}
                </Hint>
              </PanelSectionRow>
              {update.url && (
                <PanelSectionRow>
                  <ButtonItem layout="below" onClick={() => openExternal(update.url)}>
                    {t("settings.openReleasePage")}
                  </ButtonItem>
                </PanelSectionRow>
              )}
            </>
          )}
          {update.notes && (
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={() =>
                  showModal(
                    <PatchNotesModal
                      version={update.latest}
                      // The release page's install footer means nothing here.
                      notes={(update.notes ?? "").split(/\r?\n---\r?\n/)[0]}
                    />,
                  )
                }
              >
                {t("settings.whatsNew")}
              </ButtonItem>
            </PanelSectionRow>
          )}
          {installNote && (
            <PanelSectionRow>
              <Hint color={WARN}>{installNote}</Hint>
            </PanelSectionRow>
          )}
        </PanelSection>
      )}

      {modalAppid != null && (
        // key per game: a game change remounts a fresh section so a stale
        // in-flight load from the previous game can't land on the new one.
        <GameSection
          key={modalAppid}
          appid={modalAppid}
          lang={resolveLanguage(settings.language)}
          cc={resolveCountry(settings.country)}
        />
      )}

      <PanelSection title={t("settings.language")}>
        <PanelSectionRow>
          <DropdownItem
            label={t("settings.language")}
            description={t("settings.languageDesc")}
            rgOptions={languageChoices(t).map((c) => ({ data: c.pref, label: c.label }))}
            selectedOption={settings.uiLanguage ?? "auto"}
            onChange={(data) => void persist({ ...settings, uiLanguage: data.data as LanguagePreference })}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t("settings.gamePage")}>
        <PanelSectionRow>
          <Hint>{sectionSummary(settings, t)}</Hint>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() =>
              showModal(<SectionsModal initial={settings} onSave={(next) => void persist(next)} />)
            }
          >
            {t("settings.chooseSections")}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t("settings.nonSteamGames")}>
        <PanelSectionRow>
          <ToggleField
            label={t("settings.lookupEmulatedGames")}
            description={t("settings.lookupEmulatedGamesDesc")}
            checked={!!settings.nonSteamSources}
            onChange={(value: boolean) => persist({ ...settings, nonSteamSources: value })}
          />
        </PanelSectionRow>
        {!!settings.nonSteamSources && <NonSteamArtwork />}
      </PanelSection>

      <PanelSection title={t("settings.updates")}>
        <PanelSectionRow>
          <Rows>
            <DiagRow label={t("settings.installed")} value={update?.current ? `v${update.current}` : "…"} />
            {update?.ok && (
              <DiagRow
                label={update.channel === "beta" ? t("settings.latestWithBetas") : t("settings.latest")}
                value={`v${update.latest ?? "?"}${update.prerelease ? " (beta)" : ""}${
                  update.has_update ? "" : t("settings.upToDate")
                }`}
              />
            )}
            {update && !update.ok && (
              <DiagRow label={t("settings.updateCheck")} value={update.error ?? t("settings.checkFailed")} />
            )}
          </Rows>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => void runUpdateCheck(!!settings.beta, true)}>
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
        <PanelSectionRow>
          {inPlace ? (
            <ButtonItem layout="below" onClick={() => showModal(<VersionPickerModal />)}>
              {t("settings.installAnotherVersion")}
            </ButtonItem>
          ) : (
            <ButtonItem layout="below" onClick={() => openExternal(RELEASES_PAGE)}>
              {t("settings.openReleasesPage")}
            </ButtonItem>
          )}
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => showModal(<PatchNotesModal version={update?.current} />)}
          >
            {t("settings.patchNotesForVersion")}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={t("settings.troubleshooting")}>
        <PanelSectionRow>
          <Rows>
            <DiagRow label={t("settings.status")} value={status} />
            {diag.panelError && <DiagRow label={t("settings.lastError")} value={diag.panelError} />}
          </Rows>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () => {
              const res = await clearCache().catch(() => null);
              clearFrontendCache();
              toaster.toast({
                title: "EnhancedGV",
                body: res
                  ? t("settings.clearedFiles", { n: res.removed })
                  : t("settings.clearFailed"),
              });
            }}
          >
            {t("settings.clearCacheButton")}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField label={t("settings.showDiagnostics")} checked={showDiag} onChange={setShowDiag} />
        </PanelSectionRow>
        {showDiag && (
          <>
            <PanelSectionRow>
              <Rows>
                <DiagRow label={t("settings.diagBackend")} value={backend} />
                <DiagRow label={t("settings.diagIntegration")} value={diag.path ?? "—"} />
                <DiagRow label={t("settings.diagNavBridge")} value={navBridge.split(" · ")[0]} />
                <DiagRow label={t("settings.diagVideo")} value={videoNote} />
                <DiagRow label={t("settings.diagCodecs")} value={CODEC_SUPPORT} />
                <DiagRow label={t("settings.diagStoreLanguage")} value={languageDiag(settings.language, settings.country)} />
                <DiagRow label={t("settings.diagFetch")} value={fetch} />
                <DiagRow
                  label={t("settings.diagData")}
                  value={
                    diag.dataOk
                      ? `${diag.dataOk.appdetails ? "✓" : "✗"}/${diag.dataOk.reviews ? "✓" : "✗"}/${diag.dataOk.news ? "✓" : "✗"}/${diag.dataOk.deck ? "✓" : "✗"}`
                      : "—"
                  }
                />
                <DiagRow
                  label={t("settings.diagSanitizer")}
                  value={
                    backendInfo
                      ? `${backendInfo.engine} (html.parser: ${backendInfo.html_parser ? "yes" : "NO"}) · self-test b/br/img ${backendInfo.selftest_tags.b}/${backendInfo.selftest_tags.br}/${backendInfo.selftest_tags.img} · py ${backendInfo.python}`
                      : "—"
                  }
                />
                <DiagRow label={t("settings.diagLayoutClass")} value={diag.installClass ?? "MISSING"} />
                <DiagRow label={t("settings.diagRenderFunc")} value={tri(diag.renderFuncFound)} />
                <DiagRow label={t("settings.diagAppid")} value={diag.appid != null ? String(diag.appid) : tri(diag.overviewFound)} />
                <DiagRow label={t("settings.diagNote")} value={diag.note} />
                <DiagRow label={t("settings.diagPanelRenders")} value={String(storeRenders)} />
                <DiagRow label={t("settings.diagPanelState")} value={diag.panelState ?? "—"} />
                <DiagRow
                  label={t("settings.diagRoute")}
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
              </Rows>
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
          </>
        )}
      </PanelSection>
    </>
  );
}
