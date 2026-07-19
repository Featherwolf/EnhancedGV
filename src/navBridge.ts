// The nav bridge: makes the portaled panel a REAL member of Steam's gamepad
// focus tree, at the right position.
//
// How Valve's nav works (verified against the deobfuscated source):
// - Every Focusable registers a FocusNavNode whose PARENT comes from a React
//   context (TJContext, library/28869.js:17-19) — portals preserve context from
//   the RENDER position, which is why the courier's panel registered at route
//   level and was unreachable.
// - Sibling ORDER is live DOM document order (compareDocumentPosition,
//   4690.js:554-585, re-sorted on every D-pad press) — so once our node's
//   parent is the AppDetailsRoot node, our host div's physical position
//   (before AppDetailsContainer) puts it exactly at header -> banners ->
//   PANEL -> tabs.
// - Direction events bubble through the real DOM (20893.js), and focus
//   scrolling walks the NAV ancestor chain (71255.js:140-207) — both work iff
//   the nav parent's element is a DOM ancestor of our host. It is: the host's
//   parentElement IS the AppDetailsRoot element.
//
// Capture is FIBER-FIRST (per adversarial review): from the AppDetailsRoot
// element's React fiber, find the wrapper fiber carrying the live FocusNavNode
// (memoizedProps.node), then continue up to the provider fiber whose
// memoizedProps.value IS that node — its type yields the context identity
// actually consumed by this page (React 19: the provider element type IS the
// context object; older: a Provider wrapper with ._context).

type AnyObj = any;

export interface NavCapture {
  ctx: AnyObj; // the React context object (TJContext) — render <ctx.Provider>
  node: AnyObj; // the live FocusNavNode of the capture element
}

const looksLikeNavNode = (n: AnyObj): boolean =>
  n != null &&
  typeof n === "object" &&
  "m_rgChildren" in n &&
  "m_Parent" in n &&
  typeof n.AddChild === "function";

const contextFromProviderType = (t: AnyObj): AnyObj | null => {
  if (!t || typeof t !== "object") return null;
  // React <19: element type is Context.Provider, carrying ._context.
  if (t._context && t._context.Provider) return t._context;
  // React 19: element type is the Context itself (has .Provider on it).
  if (t.Provider) return t;
  return null;
};

export function captureNavFromElement(el: HTMLElement | null): NavCapture | null {
  try {
    if (!el || !el.isConnected) return null;
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) return null;
    let fiber: AnyObj = (el as AnyObj)[fiberKey];
    let node: AnyObj = null;
    for (let i = 0; fiber && i < 40; i++) {
      const mp = fiber.memoizedProps;
      if (mp && typeof mp === "object") {
        if (!node && looksLikeNavNode(mp.node)) {
          node = mp.node;
        }
        // Provider fiber directly above the wrapper: value === the node.
        if (node && mp.value === node) {
          const ctx = contextFromProviderType(fiber.type);
          if (ctx) return { ctx, node };
        }
      }
      fiber = fiber.return;
    }
    return null;
  } catch {
    return null;
  }
}

// Read a game page's appid from a DOM element's React fiber (walk up for the
// nearest ancestor carrying `memoizedProps.overview`). Used by the isolated
// portal tier to resolve the VISIBLE app page's appid WITHOUT patching Steam's
// render function (which would collide with co-installed plugins).
export function appidFromElement(el: HTMLElement | null): number | null {
  try {
    if (!el) return null;
    const fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    if (!fiberKey) return null;
    let fiber: AnyObj = (el as AnyObj)[fiberKey];
    for (let i = 0; fiber && i < 40; i++) {
      const mp = fiber.memoizedProps;
      const ov = mp && typeof mp === "object" ? mp.overview : null;
      if (ov) {
        const n = Number(ov.appid ?? ov.appId ?? ov.m_gameid);
        if (Number.isFinite(n)) return n;
      }
      fiber = fiber.return;
    }
    return null;
  } catch {
    return null;
  }
}

// A capture goes stale when its node unmounted or its element left the DOM
// (page rebuild). Stale parents are tolerated by Valve's RemoveChild
// (4690.js:501-509); we recapture opportunistically.
export function isCaptureLive(cap: NavCapture | null): boolean {
  if (!cap) return false;
  const el = cap.node?.m_element as HTMLElement | undefined;
  return !!el && el.isConnected && cap.node?.m_bMounted !== false;
}
