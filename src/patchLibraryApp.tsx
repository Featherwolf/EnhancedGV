import { routerHook } from "@decky/api";
import { findInReactTree, afterPatch, basicAppDetailsSectionStylerClasses } from "@decky/ui";
import ReactDOM from "react-dom";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { StorePanel } from "./components/StorePanel";
import { captureNavFromElement, isCaptureLive } from "./navBridge";
import type { NavCapture } from "./navBridge";
import {
  setDiag,
  collectContainerClasses,
  markFFire,
  markInjectApply,
  markInjectMiss,
  markRouteRender,
  isPanelAlive,
  getPanelDoc,
  stashPanelDoc,
  setNavBridgeNote,
} from "./diag";

const ROUTE = "/library/app/:appid";
export const PANEL_MARKER = "enhancedgv-store";

// Grace before the Decky-global portal backup may engage — longer than the
// courier's own grace so the tiers cascade instead of racing (time-based; see
// git history for why render-count grace windows are unsound).
const FALLBACK_DELAY_MS = 6000;

type AnyEl = any;

const log = (...a: unknown[]) => console.log("[EnhancedGV]", ...a);
const warn = (...a: unknown[]) => console.warn("[EnhancedGV]", ...a);

let currentAppid: number | null = null;
let lastAppid: number | null = null;

// The appid of the game page the user is actually LOOKING at (from the visible
// courier), for UI like the QAM's "Open store view" launcher. Falls back to the
// last route appid.
export function getCurrentAppid(): number | null {
  for (const c of courierRegistry) {
    if (c.isVisible()) return c.appid;
  }
  return currentAppid;
}

// renderFunc patch bookkeeping: lets THIS load recognize its own install, and
// lets unload restore Steam's original renderFunc so a plugin reload never
// leaves a ghost injector or blocks the next build from installing.
const ourRenderFuncPatches = new Set<AnyEl>();
const patchedRoutePropsList: AnyEl[] = [];

// ---------- helpers ----------
const token = (mod: AnyEl, key: string): string | undefined => {
  const v = mod?.[key];
  return typeof v === "string" && v.length ? v : undefined;
};
const asAppid = (ov: AnyEl): number | null => {
  const n = Number(ov?.appid ?? ov?.appId ?? ov?.m_gameid);
  return Number.isFinite(n) ? n : null;
};
function resolveAppid(tree: AnyEl): number | null {
  const ov = findInReactTree(tree, (x: AnyEl) => x?.props?.overview != null)?.props
    ?.overview;
  return asAppid(ov);
}

// ---------- the panel element (stable per appid+slot) ----------
function makePanel(appid: number, slot: string): ReactElement {
  return (
    <StorePanel
      key={`${PANEL_MARKER}:${slot}:${appid}`}
      __panelMarker={PANEL_MARKER}
      appid={appid}
      slot={slot}
    />
  ) as ReactElement;
}

const panelCache = new Map<string, ReactElement>();
function stablePanel(appid: number, slot: string): ReactElement {
  const key = `${slot}:${appid}`;
  let p = panelCache.get(key);
  if (!p) {
    p = makePanel(appid, slot);
    panelCache.set(key, p);
  }
  return p;
}

// Insert a styled host div immediately before the given AppDetailsContainer —
// below the Play/cloud-sync area, above the tab strip. Removes any stale host
// of ours already parked next to that container (no stacked doubles, ever).
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

// The courier's container lookup MUST be scoped to ITS OWN page subtree: Steam
// keeps left-behind pages mounted-but-hidden, and during A->B navigation a
// document-wide "visible container" heuristic attaches to the OUTGOING page —
// the panel then lives invisibly in the old page while its mount suppresses
// every fallback (verified failure mode). The probe span renders inside this
// courier's route container, so walking up a few ancestors and querying within
// finds only this page's container, visible or not.
function findScopedContainer(fromEl: HTMLElement | null): HTMLElement | null {
  const contCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsContainer");
  if (!fromEl || !contCls) return null;
  let scope: HTMLElement | null = fromEl.parentElement;
  for (let i = 0; scope && i < 6; i++) {
    const hit = scope.querySelector(`.${contCls}`) as HTMLElement | null;
    if (hit) return hit;
    scope = scope.parentElement;
  }
  return null;
}

// The backup tier has no in-page anchor, so it targets the VISIBLE container
// only — never a hidden left-behind page (zombie panels burning battery there).
function findVisibleContainer(doc: Document): HTMLElement | null {
  const contCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsContainer");
  if (!contCls) return null;
  const candidates = Array.from(doc.querySelectorAll(`.${contCls}`)) as HTMLElement[];
  return candidates.find((c) => c.offsetParent !== null) ?? null;
}

// Registry of live couriers — the VISIBLE one drives the backup watchdog, so a
// hidden page's courier (or a stale global appid) can never point recovery at
// the wrong game.
interface CourierInfo {
  appid: number;
  mountedAt: number;
  isVisible: () => boolean;
  dispose: () => void; // plugin-unload kill switch (detach host, stop timers)
}
const courierRegistry = new Set<CourierInfo>();
// Set true at the top of unpatchLibraryApp so any straggler timer tick becomes
// a no-op even before its own effect cleanup runs.
let unloaded = false;

// NOTE on abandoned tiers: an in-tree splice (correct native focus order) was
// tried and removed — on this device co-patching plugins fork element identity
// per page load, so the inline panel mounted-and-died in cycles (primary 4/4 on
// device) or never mounted at all, and its churn remounted the media hero,
// aborting every trailer load. The courier below is the reliable primary.
const isOurs = (n: AnyEl): boolean =>
  n?.props?.__panelMarker === PANEL_MARKER ||
  n?.props?.["data-enhancedgv"] === PANEL_MARKER;
void isOurs;

// ---------- TIER 2: the courier (health-gated fallback) ---------------------
// Always mounted as a sibling of the page tree inside the ROUTE's render output
// (immune to in-tree forks; unmounts only with the route). It monitors tier 1's
// panel health and, only if the inline panel is dead past a grace window,
// portals a fallback panel into a host div above this page's tab area. It
// stands down the moment tier 1 recovers. Tradeoff of this tier: its focus-tree
// position is after the tabs, so nav order is imperfect — visible > perfect.
function PortalCourier({ appid }: { appid: number }) {
  const probeRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  // Gamepad nav bridge: the live in-page FocusNavNode + context to re-provide
  // around the portaled panel. `gaveUp` renders unbridged after the deadline
  // (today's behavior) rather than hiding the panel forever.
  const [navCap, setNavCap] = useState<NavCapture | null>(null);
  const navCapRef = useRef<NavCapture | null>(null);
  const [bridgeGaveUp, setBridgeGaveUp] = useState(false);

  useLayoutEffect(() => {
    let disposed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const tryCapture = () => {
      if (disposed) return;
      const parent = hostRef.current?.parentElement ?? null;
      const cap = captureNavFromElement(parent);
      if (cap) {
        navCapRef.current = cap;
        setNavCap(cap);
        setBridgeGaveUp(false);
        const isAncestor = !!cap.node?.m_element?.contains?.(hostRef.current);
        setNavBridgeNote(
          `bridged (fiber) · parent el ${isAncestor ? "IS" : "NOT"} host ancestor`
        );
      }
    };

    const detach = () => {
      try {
        hostRef.current?.remove();
      } catch {
        /* ignore */
      }
      hostRef.current = null;
      setHost(null);
    };

    const attach = (): boolean => {
      if (disposed || unloaded) return true;
      if (hostRef.current?.isConnected) return true;
      const target = findScopedContainer(probeRef.current);
      if (!target) return false;
      const made = makeHostBeforeTarget(target);
      if (!made) return false;
      hostRef.current = made;
      setHost(made);
      markInjectApply();
      // Only THIS page's courier should retire the shared backup, and only when
      // it is the visible page — a hidden left-behind page re-attaching must not
      // tear down the backup that's showing on the page the user is looking at.
      if (probeRef.current?.parentElement?.offsetParent != null) removeDomInject();
      tryCapture();
      setDiag({
        overviewFound: true,
        appid,
        path: "courier",
        injected: true,
        note: "courier host attached above this page's AppDetailsContainer",
      });
      log("courier host attached for appid", appid);
      return true;
    };

    const doc0 = probeRef.current?.ownerDocument;
    if (doc0) stashPanelDoc(doc0);

    // Attach immediately (this is the primary tier); retry through the page's
    // enter transition, then keep the host healthy.
    if (!attach()) {
      for (const ms of [100, 400, 1200, 3000]) timers.push(setTimeout(attach, ms));
      timers.push(
        setTimeout(() => {
          if (!disposed && !hostRef.current) {
            markInjectMiss("courier: no in-page AppDetailsContainer after 3s");
          }
        }, 3200)
      );
    }
    // Bridge capture retries (the page's fiber may settle a beat after the DOM
    // does), then the give-up deadline: render unbridged rather than never.
    for (const ms of [250, 800, 2000]) {
      timers.push(
        setTimeout(() => {
          if (!disposed && !navCapRef.current) tryCapture();
        }, ms)
      );
    }
    timers.push(
      setTimeout(() => {
        if (!disposed && !navCapRef.current) {
          setBridgeGaveUp(true);
          setNavBridgeNote("gave up: no nav fiber found (panel renders unbridged)");
        }
      }, 3500)
    );
    const iv = setInterval(() => {
      if (disposed || unloaded) return;
      if (hostRef.current && !hostRef.current.isConnected) detach();
      if (!hostRef.current) attach();
      // Recapture when the captured nav parent goes stale (page DOM rebuilt).
      // NEVER null it out — a stale parent keeps the Provider element type
      // stable (no panel remount) and Valve tolerates detached parents.
      if (navCapRef.current && !isCaptureLive(navCapRef.current)) tryCapture();
    }, 2000);

    const teardown = () => {
      disposed = true;
      timers.forEach(clearTimeout);
      clearInterval(iv);
      courierRegistry.delete(info);
      detach();
    };

    // Register with the backup watchdog. The page is "visible" when the probe's
    // parent chain has layout (hidden left-behind pages are display:none'd).
    // dispose() is the plugin-unload kill switch so panels/timers don't outlive
    // the plugin when it's disabled or reloaded with a game page open.
    const info: CourierInfo = {
      appid,
      mountedAt: Date.now(),
      isVisible: () => probeRef.current?.parentElement?.offsetParent != null,
      dispose: teardown,
    };
    courierRegistry.add(info);

    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appid]);

  const createPortal = (ReactDOM as AnyEl)?.createPortal;
  // Mount-once discipline: hold the portal until the bridge resolves (or gives
  // up) so the panel mounts exactly once, already under the right nav parent.
  // Once bridged, ALWAYS render the Provider (even with a stale node) so the
  // element type at this position never changes -> no panel remounts.
  let content: AnyEl = null;
  if (host && host.isConnected && typeof createPortal === "function") {
    const panel = stablePanel(appid, "courier");
    if (navCap) {
      const Provider = navCap.ctx.Provider ?? navCap.ctx;
      content = createPortal(<Provider value={navCap.node}>{panel}</Provider>, host);
    } else if (bridgeGaveUp) {
      content = createPortal(panel, host);
    }
  }
  return (
    <>
      <span ref={probeRef as AnyEl} style={{ display: "none" }} />
      {content}
    </>
  );
}

const courierCache = new Map<number, ReactElement>();
function stableCourier(appid: number): ReactElement {
  let el = courierCache.get(appid);
  if (!el) {
    el = <PortalCourier key={`${PANEL_MARKER}:courier:${appid}`} appid={appid} />;
    courierCache.set(appid, el);
  }
  return el;
}

// ---------- BACKUP: portal from a Decky-owned global component --------------
// Engages only if the courier's panel is not actually mounted after the grace
// window (e.g. the route never rendered our courier, or its host can't attach).
// Lives in DECKY's React tree — Steam cannot unmount it. Tradeoff: no gamepad
// focus, which is why it's the backup.
const GLOBAL_COMPONENT = "EnhancedGVPortal";
const portalListeners = new Set<() => void>();
let portalHostEl: HTMLElement | null = null;
let portalAppid: number | null = null;
let domMissNotedFor: number | null = null;

function notifyPortal(): void {
  portalListeners.forEach((l) => {
    try {
      l();
    } catch {
      /* ignore */
    }
  });
}

export function RestorePortalHost() {
  const probeRef = useRef<HTMLElement | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    // Decky's global components live in the Steam UI document — stash it here so
    // the backup tier works even if the route patch never produced a panel.
    stashPanelDoc(probeRef.current?.ownerDocument);
    const l = () => force();
    portalListeners.add(l);
    return () => {
      portalListeners.delete(l);
    };
  }, []);
  const createPortal = (ReactDOM as AnyEl)?.createPortal;
  const active =
    typeof createPortal === "function" &&
    portalHostEl &&
    portalHostEl.isConnected &&
    portalAppid != null;
  return (
    <>
      <span ref={probeRef as AnyEl} style={{ display: "none" }} />
      {active ? createPortal(stablePanel(portalAppid as number, "dom"), portalHostEl as HTMLElement) : null}
    </>
  );
}

function removeDomInject(): void {
  try {
    portalHostEl?.remove();
  } catch {
    /* best effort */
  }
  portalHostEl = null;
  portalAppid = null;
  notifyPortal();
}

function domInject(appid: number): boolean {
  if (portalHostEl && portalHostEl.isConnected && portalAppid === appid) return true;
  removeDomInject();

  const noteMiss = (why: string): false => {
    if (domMissNotedFor !== appid) {
      domMissNotedFor = appid;
      markInjectMiss(`dom-inject: ${why}`);
    }
    return false;
  };

  const doc = getPanelDoc();
  if (!doc) return noteMiss("no stashed UI document");
  if (typeof (ReactDOM as AnyEl)?.createPortal !== "function")
    return noteMiss("SP_REACTDOM.createPortal unavailable");
  const target = findVisibleContainer(doc);
  if (!target) return noteMiss("no VISIBLE AppDetailsContainer (user off app page?)");
  const host = makeHostBeforeTarget(target);
  if (!host) return noteMiss("could not insert host before container");

  portalHostEl = host;
  portalAppid = appid;
  notifyPortal();
  setDiag({
    overviewFound: true,
    appid,
    path: "dom-inject",
    injected: true,
    note: "backup portal tier engaged (courier panel not mounted)",
  });
  log("backup portal engaged for appid", appid);
  return true;
}

let domTimer: ReturnType<typeof setInterval> | null = null;

export function patchLibraryApp() {
  unloaded = false; // fresh install (also covers re-patch on the same module)
  const adcCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsContainer") ?? null;
  const rootCls = token(basicAppDetailsSectionStylerClasses, "AppDetailsRoot") ?? null;
  log("patch install; AppDetailsRoot =", rootCls ?? "MISSING", "; AppDetailsContainer =", adcCls ?? "MISSING");
  setDiag({
    installClass: rootCls ?? adcCls,
    note: "courier primary (route-level portal); Decky-global portal backup",
  });

  try {
    routerHook.addGlobalComponent(GLOBAL_COMPONENT, RestorePortalHost);
  } catch (e) {
    warn("addGlobalComponent failed:", e);
  }

  // Backup watchdog: time-driven, never gated on Steam rendering anything, and
  // driven ONLY by the courier whose page is actually visible — so a hidden
  // left-behind page can neither trigger, retire, nor mistarget the backup.
  if (domTimer == null) {
    domTimer = setInterval(() => {
      try {
        let vis: CourierInfo | null = null;
        for (const c of courierRegistry) {
          if (c.isVisible()) {
            vis = c;
            break;
          }
        }
        if (!vis) {
          // No visible app page: never keep (or create) a backup panel.
          if (portalHostEl) removeDomInject();
          return;
        }
        if (isPanelAlive("primary", vis.appid) || isPanelAlive("courier", vis.appid)) {
          if (portalHostEl) removeDomInject();
          return;
        }
        if (Date.now() - vis.mountedAt > FALLBACK_DELAY_MS) {
          domInject(vis.appid);
        }
      } catch (e) {
        warn("backup watchdog:", e);
      }
    }, 2000);
  }

  return routerHook.addPatch(ROUTE, (tree: AnyEl) => {
    const routeProps = findInReactTree(tree, (x: AnyEl) => x?.renderFunc);
    if (!routeProps) {
      warn("HOP1 FAIL: no node with renderFunc on", ROUTE);
      setDiag({ renderFuncFound: false, injected: false, note: "no renderFunc on route" });
      return tree;
    }
    setDiag({ renderFuncFound: true });

    // Steam keeps this route-props object alive across Decky plugin reloads —
    // store the actual afterPatch handle on it so a stale wrapper from a dead
    // bundle can always be detached and can never block a fresh install.
    const existing = routeProps.__enhancedGVPatch;
    if (existing) {
      if (ourRenderFuncPatches.has(existing)) return tree;
      try {
        existing.unpatch();
        log("detached stale renderFunc wrapper from a previous plugin load");
      } catch (e) {
        warn("failed to unpatch stale renderFunc wrapper:", e);
      }
      delete routeProps.__enhancedGVPatch;
    }

    const patchHandle = afterPatch(routeProps, "renderFunc", (args: AnyEl[], ret: AnyEl) => {
      try {
        markRouteRender();
        markFFire(); // route-render counter (QAM "Route" row)
        const appid = asAppid(args?.[0]) ?? resolveAppid(ret);
        // NOTE: hidden left-behind pages also re-render through here, so these
        // globals are for DIAGNOSTICS only — recovery decisions come from the
        // courier registry's visible entry, never from these.
        if (appid !== lastAppid) {
          lastAppid = appid;
        }
        currentAppid = appid;
        setDiag({
          renderFuncFound: true,
          overviewFound: currentAppid != null,
          appid: currentAppid ?? null,
          sawTabs: null,
          tabs: null,
          containerClasses: [],
        });
        if (currentAppid == null) {
          setDiag({
            path: "no-appid",
            injected: false,
            containerClasses: collectContainerClasses(ret),
            note: "route rendered but appid unresolved",
          });
          return ret;
        }
        // Append the courier INSIDE the route output's root element (usually a
        // context Provider), preserving the output's shape for Steam and for
        // co-patching plugins that also process this renderFunc's return.
        // Stable keyed element -> React keeps it mounted across route
        // re-renders; co-patchers wrap components DEEPER in the tree and cannot
        // unmount our top-level sibling.
        const courier = stableCourier(currentAppid);
        if (ret && typeof ret === "object" && ret.props) {
          const kids = ret.props.children;
          ret.props.children = Array.isArray(kids)
            ? [...kids, courier]
            : kids != null
              ? [kids, courier]
              : [courier];
          return ret;
        }
        return [ret, courier];
      } catch (e) {
        warn("route handler threw:", e);
        setDiag({ injected: false, path: "error", note: "route handler threw: " + String(e) });
        return ret;
      }
    });

    routeProps.__enhancedGVPatch = patchHandle;
    ourRenderFuncPatches.add(patchHandle);
    patchedRoutePropsList.push(routeProps);
    return tree;
  });
}

export function unpatchLibraryApp(patch: ReturnType<typeof patchLibraryApp>): void {
  unloaded = true;
  currentAppid = null;
  lastAppid = null;
  // Tear down every mounted courier (detach its host div + stop its timers), so
  // no panel, portal, or interval outlives the plugin when it's disabled or
  // reloaded with a game page open.
  for (const info of [...courierRegistry]) {
    try {
      info.dispose();
    } catch {
      /* ignore */
    }
  }
  courierRegistry.clear();
  removeDomInject();
  if (domTimer != null) {
    clearInterval(domTimer);
    domTimer = null;
  }
  try {
    routerHook.removeGlobalComponent(GLOBAL_COMPONENT);
  } catch {
    /* best effort */
  }
  for (const rp of patchedRoutePropsList.splice(0)) {
    try {
      const h = rp?.__enhancedGVPatch;
      if (h && ourRenderFuncPatches.has(h)) {
        h.unpatch();
        delete rp.__enhancedGVPatch;
      }
    } catch (e) {
      warn("renderFunc unpatch failed:", e);
    }
  }
  ourRenderFuncPatches.clear();
  try {
    panelCache.clear();
    courierCache.clear();
  } catch {
    /* best effort */
  }
  try {
    routerHook.removePatch(ROUTE, patch);
  } catch (e) {
    console.error("[EnhancedGV] removePatch failed:", e);
  }
}
