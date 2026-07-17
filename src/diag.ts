// Lightweight diagnostics shared between the library-page patch and the Quick
// Access panel. The patch records what it found at each hop; the QAM reads it so
// the user can see exactly what happened on their device (which is otherwise
// only visible in the Decky console log).

export interface DiagState {
  ts: number;
  installClass: string | null; // resolved appDetailsClasses.InnerContainer
  appid: number | null;
  renderFuncFound: boolean | null; // HOP1
  overviewFound: boolean | null; // HOP2
  injected: boolean | null;
  containerClasses: string[]; // classNames of array-children nodes on failure
  note: string;
  // --- tab layer ---
  tabs: { id: string; title: string }[] | null; // tabs found on the app page
  path: string | null; // which integration path was taken
  sawTabs: boolean | null; // a tab strip existed at all
  matchedTab: { id: string; title: string } | null; // the tab we replaced
  // --- data / render layer (set by StorePanel) ---
  panelState: "loading" | "rendered" | "hidden" | null;
  panelError: string | null;
  dataOk: {
    appdetails: boolean;
    reviews: boolean;
    news: boolean;
    deck: boolean;
  } | null;
  // --- layout probe (set by StorePanel measuring its own DOM node) ---
  // Distinguishes the three "renders but not seen" failure modes:
  //   h === 0            -> clipped / collapsed by parent layout
  //   onScreen === false -> laid out off the viewport (scrolled away / positioned away)
  //   covered === true   -> painted but another element sits on top (z-index/float)
  panelRect: {
    w: number;
    h: number;
    top: number;
    left: number;
    vw: number;
    vh: number;
    onScreen: boolean;
    covered: boolean;
    hidden?: boolean; // display:none ancestor at every measure attempt
  } | null;
}

const EMPTY: DiagState = {
  ts: 0,
  installClass: null,
  appid: null,
  renderFuncFound: null,
  overviewFound: null,
  injected: null,
  containerClasses: [],
  note: "patch not run yet",
  tabs: null,
  path: null,
  sawTabs: null,
  matchedTab: null,
  panelState: null,
  panelError: null,
  dataOk: null,
  panelRect: null,
};

let state: DiagState = { ...EMPTY };
const listeners = new Set<(d: DiagState) => void>();

// Synchronous render probe: incremented in StorePanel's render BODY (not an
// effect), so it counts even if the component mounts+unmounts before effects
// run. Polled by the QAM. Tells us definitively whether our content is being
// rendered by Steam's tab content area at all.
let storeRenders = 0;
export function markStoreRender(): void {
  storeRenders++;
}
export function getStoreRenders(): number {
  return storeRenders;
}

// Injection lifecycle counters (polled by the QAM like storeRenders). These
// pinpoint WHERE the pipeline drops the panel: F renders but injection misses ->
// structural predicate broke; injections apply but the panel unmounts and mounts
// stop -> the committed tree lost our element anyway; mounts < unmounts -> panel
// currently dead (drives the fallback's health check too).
let fFires = 0;
let injectApplies = 0;
let injectMisses = 0;
let lastMissReason = "";
// Timestamps: distinguish "panel died while the page was open" (route renders
// continue after the unmount with no re-apply) from "the user left the page"
// (everything freezes together). Ages are computed by the QAM poll.
let lastRouteRenderAt = 0;
let lastApplyAt = 0;
let lastMountAt = 0;
let lastUnmountAt = 0;
export function markRouteRender(): void {
  lastRouteRenderAt = Date.now();
}
// Mount/unmount tallies keyed by `${slot}:${appid}`. BOTH dimensions matter:
// a live fallback must not mask a dead primary, and — because Steam keeps
// left-behind pages mounted but hidden — game A's still-mounted panel must not
// mask a dead panel on game B (the page the user is actually looking at).
const panelMounts: Record<string, number> = {};
const panelUnmounts: Record<string, number> = {};
export function markFFire(): void {
  fFires++;
}
// Lifecycle flight recorder. MUST be console.warn: on-device cef_log.txt captures
// only WARNING+ console messages — a 3.3MB log spanning months contained zero of
// our console.log lines while other plugins' warns/errors all appeared.
const clog = (...a: unknown[]) =>
  console.warn("[EnhancedGV]", new Date().toISOString(), ...a);

export function markInjectApply(): void {
  injectApplies++;
  lastApplyAt = Date.now();
  clog("inject apply", `#${injectApplies}`);
}
export function markInjectMiss(reason: string): void {
  injectMisses++;
  lastMissReason = reason;
  clog("inject MISS", reason);
}
export function markPanelMount(slot: string, appid: number): void {
  const k = `${slot}:${appid}`;
  panelMounts[k] = (panelMounts[k] ?? 0) + 1;
  lastMountAt = Date.now();
  clog("panel MOUNT", k, `(${panelMounts[k]})`);
}
export function markPanelUnmount(slot: string, appid: number): void {
  const k = `${slot}:${appid}`;
  panelUnmounts[k] = (panelUnmounts[k] ?? 0) + 1;
  lastUnmountAt = Date.now();
  clog("panel UNMOUNT", k, `(${panelUnmounts[k]})`);
}
// appid omitted = "any game's panel in this slot is alive" (QAM display only —
// gates that decide recovery MUST pass the appid).
export function isPanelAlive(slot: string, appid?: number): boolean {
  if (appid != null) {
    const k = `${slot}:${appid}`;
    return (panelMounts[k] ?? 0) > (panelUnmounts[k] ?? 0);
  }
  const keys = new Set([...Object.keys(panelMounts), ...Object.keys(panelUnmounts)]);
  return [...keys].some(
    (k) => k.startsWith(`${slot}:`) && (panelMounts[k] ?? 0) > (panelUnmounts[k] ?? 0)
  );
}
export function getProbeCounters(): {
  fFires: number;
  injectApplies: number;
  injectMisses: number;
  lastMissReason: string;
  mounts: string;
  ages: string;
} {
  const slots = new Set([...Object.keys(panelMounts), ...Object.keys(panelUnmounts)]);
  const mounts =
    [...slots]
      .map((s) => `${s} ${panelMounts[s] ?? 0}/${panelUnmounts[s] ?? 0}`)
      .join(" · ") || "none";
  const ago = (t: number) => (t ? `${Math.round((Date.now() - t) / 1000)}s` : "—");
  const ages = `route ${ago(lastRouteRenderAt)} · apply ${ago(lastApplyAt)} · mnt ${ago(lastMountAt)} · unmnt ${ago(lastUnmountAt)}`;
  return { fFires, injectApplies, injectMisses, lastMissReason, mounts, ages };
}

// Gamepad nav-bridge state (fiber capture of Steam's FocusNavNode) — polled by
// the QAM; the decisive readout for whether the panel joined the focus tree.
let navBridgeNote = "—";
export function setNavBridgeNote(note: string): void {
  navBridgeNote = note;
  clog("navBridge:", note);
}
export function getNavBridgeNote(): string {
  return navBridgeNote;
}

// Video pipeline probe: the hero reports WHY playback isn't happening (autoplay
// policy rejection vs dead progressive URLs vs codec) — polled by the QAM.
let videoNote = "—";
export function setVideoNote(note: string): void {
  videoNote = note;
  clog("video:", note);
}
export function getVideoNote(): string {
  return videoNote;
}

// The Steam UI document the panel actually mounted into (stashed by the layout
// probe). The plugin's own `document` global is a hidden ~1px context — DOM-level
// injection must target this one.
let lastPanelDoc: Document | null = null;
export function stashPanelDoc(doc: Document | null | undefined): void {
  if (doc) lastPanelDoc = doc;
}
export function getPanelDoc(): Document | null {
  return lastPanelDoc;
}

// True when a hit-test landed inside Steam's menu chrome (Quick Access / main
// menu overlays). Measuring "covered" through an open menu would misreport a
// healthy panel as occluded — the QAM is the very surface used to READ this
// diagnostic, so it is frequently open during re-measures.
function isMenuChrome(node: Node | null): boolean {
  let n: HTMLElement | null = node instanceof HTMLElement ? node : null;
  for (let i = 0; n && i < 12; i++) {
    const cls = typeof n.className === "string" ? n.className.toLowerCase() : "";
    if (
      cls.includes("quickaccess") ||
      cls.includes("mainmenu") ||
      cls.includes("backgroundglass") ||
      cls.includes("steamdeckoverlay")
    ) {
      return true;
    }
    n = n.parentElement;
  }
  return false;
}

// Measure a mounted panel node and record where it actually landed on screen.
// Called from StorePanel via a layout effect + a rAF (after Steam's transitions
// settle). Non-fatal on any DOM/API gap.
export function reportPanelRect(el: HTMLElement | null): void {
  try {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      setDiag({ panelRect: null });
      return;
    }
    // CRITICAL: measure against the window the panel actually LIVES in. Decky
    // plugin code runs in a hidden shared JS context whose own `window` is ~1px
    // (observed on-device as "vh 1" + a bogus OFF-SCREEN verdict) — the panel is
    // mounted into Steam's UI document, so viewport size and hit-testing must
    // come from el.ownerDocument/defaultView, not our globals.
    const doc = el.ownerDocument ?? document;
    const win = doc.defaultView ?? window;
    stashPanelDoc(el.ownerDocument);
    // display:none ancestor (page transition / overlay) -> geometry is meaningless.
    // Record an explicit "hidden" reading ONLY if we have nothing yet (a first-and-
    // only hidden reading is diagnostic); never overwrite a real reading with it.
    if (!el.isConnected || el.offsetParent === null) {
      if (!state.panelRect) {
        setDiag({
          panelRect: {
            w: 0,
            h: 0,
            top: 0,
            left: 0,
            vw: win.innerWidth || 0,
            vh: win.innerHeight || 0,
            onScreen: false,
            covered: false,
            hidden: true,
          },
        });
      }
      return;
    }
    const r = el.getBoundingClientRect();
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    const onScreen =
      r.height > 0 &&
      r.width > 0 &&
      r.bottom > 0 &&
      r.top < vh &&
      r.right > 0 &&
      r.left < vw;
    // Covered check: sample the panel's on-screen centre and see whether the
    // top-most painted element is us (or a descendant of us).
    let covered = false;
    if (onScreen) {
      const cx = Math.min(Math.max((r.left + r.right) / 2, 1), vw - 1);
      const cy = Math.min(Math.max((r.top + r.bottom) / 2, 1), vh - 1);
      const hit = doc.elementFromPoint(cx, cy) as Node | null;
      if (hit && isMenuChrome(hit)) return; // menu overlay open: keep previous reading
      covered = !(hit && (hit === el || el.contains(hit)));
    }
    setDiag({
      panelRect: {
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        left: Math.round(r.left),
        vw,
        vh,
        onScreen,
        covered,
      },
    });
  } catch {
    /* defensive: never break render over a probe */
  }
}

export function setDiag(patch: Partial<DiagState>): void {
  state = { ...state, ...patch, ts: Date.now() };
  listeners.forEach((l) => {
    try {
      l(state);
    } catch {
      /* ignore listener errors */
    }
  });
}

export function getDiag(): DiagState {
  return state;
}

export function subscribeDiag(fn: (d: DiagState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Enumerate every element in a render output that has both a className and an
// array of children — i.e. every candidate injection container — so a broken
// class-module lookup can be diagnosed from a single log/QAM paste.
export function collectContainerClasses(node: unknown): string[] {
  const seen: string[] = [];
  const visit = (n: any, depth: number) => {
    if (!n || depth > 40) return;
    if (
      typeof n?.props?.className === "string" &&
      Array.isArray(n?.props?.children)
    ) {
      seen.push(n.props.className);
    }
    const kids = n?.props?.children;
    if (Array.isArray(kids)) kids.forEach((k) => visit(k, depth + 1));
    else if (kids) visit(kids, depth + 1);
  };
  try {
    visit(node, 0);
  } catch {
    /* defensive */
  }
  return seen;
}
