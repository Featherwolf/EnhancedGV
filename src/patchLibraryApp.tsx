import { routerHook } from "@decky/api";
import { basicAppDetailsSectionStylerClasses } from "@decky/ui";
import ReactDOM from "react-dom";
import { useEffect, useReducer, useRef } from "react";
import type { ReactElement } from "react";
import { StorePanel } from "./components/StorePanel";
import { captureNavFromElement, isCaptureLive, appidFromElement } from "./navBridge";
import type { NavCapture } from "./navBridge";
import { prefetchAppData, warmSettings } from "./hooks/useAppData";
import { getGameIdentity } from "./identity";
import {
  armEarlyNav,
  stopEarlyNav,
  resetEarlyNavPage,
  consumeSlotCrossing,
} from "./earlyNav";
import { focusFirstStop } from "./focus";
import {
  setDiag,
  markInjectApply,
  markInjectMiss,
  markRouteRender,
  getPanelDoc,
  stashPanelDoc,
  setNavBridgeNote,
} from "./diag";

// PLUGIN-COEXISTENCE NOTE (why this is a single, isolated, out-of-tree tier):
// Earlier builds afterPatched the /library/app renderFunc and mutated its render
// output (turning `ret.props.children` into an array). That CRASHED co-installed
// plugins: SDH-PlayTime co-patches the SAME renderFunc and reads
// `ret.props.children.props.overview`, which threw on the array; TabMaster
// (on /library) died from the extra reconciliation pressure. So EnhancedGV now
// NEVER patches Steam's render function and never touches its render output. It
// mounts one component in DECKY's own tree (`addGlobalComponent`), finds the
// visible app page in the DOM, reads that page's appid from its React fiber, and
// portals the panel into a host <div> it owns — re-providing the page's
// gamepad-focus node so the panel stays controller-navigable.

const ROUTE = "/library/app/:appid";
export const PANEL_MARKER = "enhancedgv-store";
const GLOBAL_COMPONENT = "EnhancedGVPortal";

type AnyEl = any;

const log = (...a: unknown[]) => console.log("[EnhancedGV]", ...a);
const warn = (...a: unknown[]) => console.warn("[EnhancedGV]", ...a);

let unloaded = false;
// The appid of the app page the user is currently LOOKING at — set by the portal
// tier when it resolves the visible container. Consumed by the QAM.
let currentAppid: number | null = null;

export function getCurrentAppid(): number | null {
  return currentAppid;
}

// ---------- helpers ---------------------------------------------------------
const token = (mod: AnyEl, key: string): string | undefined => {
  const v = mod?.[key];
  return typeof v === "string" && v.length ? v : undefined;
};

// The VISIBLE app-details container (Steam keeps left-behind pages mounted but
// display:none'd, so gate on offsetParent). Our host is inserted before this.
function findVisibleContainer(doc: Document): HTMLElement | null {
  const contCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsContainer");
  if (!contCls) return null;
  const candidates = Array.from(doc.querySelectorAll(`.${contCls}`)) as HTMLElement[];
  return candidates.find((c) => c.offsetParent !== null) ?? null;
}

// Insert our own styled host <div> immediately before the given container —
// below the Play/cloud-sync area, above the tab strip. Any stale host of OURS
// next to that container is removed first (never stack doubles). We only ever
// add/remove our own element; Steam's nodes are untouched.
function makeHostBeforeTarget(target: HTMLElement): HTMLElement | null {
  const parent = target.parentElement;
  const doc = target.ownerDocument;
  if (!parent || !doc) return null;
  parent
    .querySelectorAll(`[data-enhancedgv="${PANEL_MARKER}"]`)
    .forEach((n) => n.remove());
  const host = doc.createElement("div");
  host.setAttribute("data-enhancedgv", PANEL_MARKER);
  host.style.width = "100%";
  host.style.boxSizing = "border-box";
  host.style.padding = "0 24px";
  host.style.margin = "10px 0 4px";
  parent.insertBefore(host, target);
  return host;
}

// Stable panel element per appid so React keeps it mounted across re-syncs.
const panelCache = new Map<number, ReactElement>();
function stablePanel(appid: number): ReactElement {
  let p = panelCache.get(appid);
  if (!p) {
    p = (
      <StorePanel
        key={`${PANEL_MARKER}:${appid}`}
        __panelMarker={PANEL_MARKER}
        appid={appid}
        slot="portal"
      />
    ) as ReactElement;
    panelCache.set(appid, p);
  }
  return p;
}

// A "resync now" signal (route render) fans out to the mounted host. A listener
// reports whether it is SETTLED (panel attached to the visible page, or there is
// no app page to attach to) so the retry burst below can stop early.
const listeners = new Set<() => boolean>();
function notify(): boolean {
  let settled = true;
  listeners.forEach((l) => {
    try {
      if (!l()) settled = false;
    } catch {
      settled = false;
    }
  });
  return settled;
}

// PLUGIN-COEXISTENCE (v0.18): NEVER run the resync fan-out synchronously from a
// render. Decky invokes route-patch callbacks INSIDE its router wrapper's render
// body (processList), so a notify() called there runs sync() -> makeHostBeforeTarget
// (DOM remove()+insertBefore) and force() (setState) while React is mid-reconcile
// of the SHARED AppDetailsRoot subtree. That throws NotFoundError
// (removeChild/insertBefore) + "cannot update a component while rendering", and
// because co-plugins (SDH-PlayTime) render on that same subtree the throw carries
// THEIR frame and Decky's ErrorBoundary blames them. Deferring to a fresh
// macrotask guarantees sync() only ever mutates the DOM AFTER commit. Coalesced so
// a burst of route renders collapses to a single resync.
//
// LOAD TIME: a single deferred resync used to be the only prompt, so whenever the
// app-details container was not yet laid out (offsetParent === null during the
// page-enter transition — the common case) the panel had to wait for the 2s
// heartbeat before it appeared. That is the whole "the panel shows up late, and a
// D-pad press before it lands skips the section" problem. The route render now
// starts a short RETRY BURST instead: densely at first, then tapering, stopping
// the moment a listener reports it is settled. Every attempt still runs off the
// render stack, so the coexistence guarantee above is unchanged.
const RETRY_MS = [0, 16, 40, 80, 140, 220, 340, 500, 750, 1100, 1600];
let burstTimers: ReturnType<typeof setTimeout>[] = [];
let burstStartedAt = 0;

function clearBurst(): void {
  burstTimers.forEach(clearTimeout);
  burstTimers = [];
}

function scheduleNotify(): void {
  // Coalesce the burst of route renders Steam emits while a page settles.
  if (burstTimers.length && Date.now() - burstStartedAt < 120) return;
  clearBurst();
  burstStartedAt = Date.now();
  for (const ms of RETRY_MS) {
    burstTimers.push(
      setTimeout(() => {
        if (notify()) clearBurst();
      }, ms)
    );
  }
}

// The appid of the page Steam is rendering, read from the router path. Used ONLY
// to start the store fetch early (it overlaps the page transition and our own
// injection work); the panel itself always uses the appid read from the visible
// page's React fiber.
function appidFromLocation(): number | null {
  try {
    const loc = window.location;
    const m = /\/library\/app\/(\d+)/.exec(`${loc.pathname}${loc.search}${loc.hash}`);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

let lastPrefetched = 0;
let lastPrefetchedAt = 0;
function prefetchForRoute(): void {
  try {
    const id = appidFromLocation();
    if (!id) return;
    // Steam re-renders the route several times while a page settles; only the
    // first of those should start a fetch. The window also lets a later visit
    // re-prime the caches (e.g. after "clear cached store data").
    if (id === lastPrefetched && Date.now() - lastPrefetchedAt < 10_000) return;
    lastPrefetched = id;
    lastPrefetchedAt = Date.now();
    // A non-Steam shortcut has to be matched to a store appid first (that
    // happens in the panel), so there is nothing to prefetch for it here.
    if (getGameIdentity(id).isShortcut) return;
    prefetchAppData(id);
  } catch {
    /* prefetch is best-effort */
  }
}

// ---------- the single injector: a Decky-owned global component -------------
function RestorePortalHost() {
  const probeRef = useRef<HTMLElement | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const host = useRef<HTMLElement | null>(null);
  const appid = useRef<number | null>(null);
  const cap = useRef<NavCapture | null>(null);

  useEffect(() => {
    stashPanelDoc(probeRef.current?.ownerDocument);
    let disposed = false;

    const detach = () => {
      if (host.current) {
        try {
          host.current.remove();
        } catch {
          /* ignore */
        }
      }
      host.current = null;
      appid.current = null;
      cap.current = null;
    };

    // Returns TRUE when there is nothing left to wait for (panel attached to the
    // visible page and bridged into its nav tree, or we are not on an app page).
    const sync = (): boolean => {
      if (disposed || unloaded) return true;
      const doc = probeRef.current?.ownerDocument ?? getPanelDoc();
      if (!doc) return false;
      const target = findVisibleContainer(doc);
      if (!target) {
        // Not on an app-details page -> tear our panel down and clear state.
        if (host.current) {
          detach();
          force();
        }
        if (currentAppid != null) currentAppid = null;
        // Left the app page: the next visit (even to the same game) arms afresh.
        if (appidFromLocation() == null) resetEarlyNavPage();
        // On an app page the container appears a beat after the route renders,
        // so "not found yet" is only settled once we are off the route.
        return appidFromLocation() == null;
      }
      const id = appidFromElement(target);
      if (id == null) {
        markInjectMiss("portal: appid not resolvable from visible container");
        return false;
      }
      currentAppid = id;
      // Re-render ONLY when something actually changed. The old unconditional
      // force() re-rendered the portal every 2s, and each stale-capture swap
      // re-provided a NEW nav value — making every Focusable in the panel
      // re-register on Steam's SHARED focus node (RemoveChild/AddChild churn)
      // while the user was focused on native UI. On-device symptom: after
      // visiting the panel, the Play button's selection highlight stopped
      // rendering until the page was re-entered.
      let changed = false;
      const connected =
        !!host.current?.isConnected && host.current.parentElement === target.parentElement;
      if (!connected || appid.current !== id) {
        detach();
        const made = makeHostBeforeTarget(target);
        if (!made) {
          markInjectMiss("portal: could not insert host before container");
          return false;
        }
        host.current = made;
        appid.current = id;
        cap.current = null;
        changed = true;
        markInjectApply();
        setDiag({
          path: "portal",
          injected: true,
          appid: id,
          overviewFound: true,
          note: "panel portaled into the visible app page (isolated global tier)",
        });
        log("portal host attached for appid", id);
      }
      // Capture / recapture the page's gamepad-focus node from the host's parent
      // (the AppDetailsRoot element). Read-only fiber walk; we re-provide the
      // node's context around our panel so its Focusables join the page's nav.
      // A stale capture is kept (and tolerated by Valve's RemoveChild) until a
      // LIVE replacement is actually found — swapping the Provider value is the
      // expensive/disruptive event, so it only happens when the new node is real.
      if (host.current && (!cap.current || !isCaptureLive(cap.current))) {
        const c = captureNavFromElement(host.current.parentElement);
        if (c && (c.node !== cap.current?.node || c.ctx !== cap.current?.ctx)) {
          cap.current = c;
          changed = true;
          setNavBridgeNote("bridged (fiber, portal tier)");
        } else if (!c && !cap.current) {
          setNavBridgeNote("no nav fiber yet (panel renders unbridged)");
        }
      }
      if (changed) force();
      // Settled once the host is in the page AND its focus context is bridged —
      // an unbridged panel is still worth retrying for (its Focusables would
      // register at route level and be unreachable by the D-pad).
      const settled = !!host.current?.isConnected && !!cap.current;
      // The user may already have pressed Down (or flicked the stick) past the
      // still-empty slot while we were attaching. Now that the panel is in the
      // page AND reachable, replay that move into it — its loading placeholder
      // is a focus stop — so the press scrolls into the section instead of
      // skipping it. One-shot and grace-windowed (see earlyNav).
      if (settled && consumeSlotCrossing(host.current)) {
        const target = host.current;
        setTimeout(() => {
          if (!disposed && !unloaded && target?.isConnected) focusFirstStop(target);
        }, 0);
      }
      return settled;
    };

    const l = () => sync();
    listeners.add(l);
    sync();
    // Heartbeat for everything the route render can't tell us about (tab
    // switches, page rebuilds). The fast path is the retry burst above.
    const iv = setInterval(sync, 2000);
    return () => {
      disposed = true;
      listeners.delete(l);
      clearInterval(iv);
      detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPortal = (ReactDOM as AnyEl)?.createPortal;
  let content: AnyEl = null;
  if (host.current?.isConnected && appid.current != null && typeof createPortal === "function") {
    const panel = stablePanel(appid.current);
    if (cap.current) {
      const Provider = cap.current.ctx.Provider ?? cap.current.ctx;
      content = createPortal(<Provider value={cap.current.node}>{panel}</Provider>, host.current);
    } else {
      content = createPortal(panel, host.current); // unbridged fallback
    }
  }
  return (
    <>
      <span ref={probeRef as AnyEl} style={{ display: "none" }} />
      {content}
    </>
  );
}

export function patchLibraryApp() {
  unloaded = false;
  // Read the settings file once, now, so the first game page never waits on it
  // before it can start fetching store data.
  warmSettings();
  const rootCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsRoot") ?? null;
  const adcCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsContainer") ?? null;
  log(
    "patch install; AppDetailsRoot =",
    rootCls ?? "MISSING",
    "; AppDetailsContainer =",
    adcCls ?? "MISSING"
  );
  setDiag({
    installClass: rootCls ?? adcCls,
    note: "isolated portal tier — no render-function patching (plugin-safe)",
  });

  try {
    routerHook.addGlobalComponent(GLOBAL_COMPONENT, RestorePortalHost);
  } catch (e) {
    warn("addGlobalComponent failed:", e);
  }

  // READ-ONLY route patch: we do NOT afterPatch renderFunc, wrap the tree, or
  // write to the route-props object — that render output belongs to Steam and to
  // any co-patching plugin. We only use the route render as a prompt to re-sync
  // the portal, and return the tree UNCHANGED. The resync is DEFERRED off this
  // render stack (scheduleNotify) — see the note above: doing DOM/setState work
  // here, mid-render, is what crashed co-plugins (PlayTime) that share the route.
  return routerHook.addPatch(ROUTE, (tree: AnyEl) => {
    try {
      markRouteRender();
      // Both are cheap and side-effect-free on Steam's tree: start the store
      // fetch, and begin remembering focus moves so a D-pad press made before
      // the panel lands can be replayed into it.
      prefetchForRoute();
      const routeId = appidFromLocation();
      if (routeId != null) {
        armEarlyNav(
          getPanelDoc() ?? (typeof document !== "undefined" ? document : null),
          String(routeId)
        );
      }
      scheduleNotify();
    } catch {
      /* ignore */
    }
    return tree;
  });
}

export function unpatchLibraryApp(patch: ReturnType<typeof patchLibraryApp>): void {
  unloaded = true;
  currentAppid = null;
  clearBurst();
  stopEarlyNav();
  notify(); // let the host detach + unmount its portal (Focusable RemoveChild runs cleanly)
  try {
    routerHook.removeGlobalComponent(GLOBAL_COMPONENT);
  } catch {
    /* best effort */
  }
  try {
    panelCache.clear();
  } catch {
    /* best effort */
  }
  try {
    routerHook.removePatch(ROUTE, patch);
  } catch (e) {
    console.error("[EnhancedGV] removePatch failed:", e);
  }
}
