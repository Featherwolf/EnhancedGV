// Keeps EnhancedGV's panel on screen when Steam rebuilds the game page under it.
//
// Some plugins make Steam throw away and rebuild the whole game page every time
// it refreshes. Quick User Switcher 1.0.0 (the Decky store's version as of
// November 2026) does: it gives the page a new React component type on every
// render, so React remounts all of it. Steam refreshes the page constantly while
// a game installs or launches. Our host <div> sits inside that page, so every
// rebuild took the store panel with it: the panel stayed gone until the next
// check (up to 2 s) and was then rebuilt from scratch, which read as heavy
// flicker.
//
// A rebuild removes the old page's root from a container above it, so watching
// the child lists of the host's ancestors (not their subtrees, which change all
// the time) tells us the moment the host leaves the page. The same host, with
// the panel still mounted inside it, then goes straight back into the rebuilt
// page. MutationObserver callbacks run after React's commit and before the next
// paint, so no frame is drawn without the panel. Only our own node is ever
// moved; Steam's and other plugins' nodes are never touched.

/**
 * Call `onDetach` once, as soon as `host` is no longer in the page. Returns a
 * function that stops watching.
 */
export function watchHostDetach(host: HTMLElement, onDetach: () => void): () => void {
  const win = host.ownerDocument?.defaultView as (Window & typeof globalThis) | null;
  const Observer =
    win?.MutationObserver ?? (typeof MutationObserver !== "undefined" ? MutationObserver : undefined);
  if (!Observer || !host.isConnected) return () => {};
  let stopped = false;
  let watched: Node[] = [];
  const chain = (): Node[] => {
    const out: Node[] = [];
    for (let n: Node | null = host.parentNode; n; n = n.parentNode) out.push(n);
    return out;
  };
  const observer = new Observer(() => {
    if (stopped) return;
    if (!host.isConnected) {
      stopped = true;
      observer.disconnect();
      onDetach();
      return;
    }
    // Still in the page, but maybe under different ancestors now: follow it.
    const now = chain();
    if (now.length !== watched.length || now.some((n, i) => n !== watched[i])) observeChain();
  });
  const observeChain = () => {
    observer.disconnect();
    watched = chain();
    for (const n of watched) observer.observe(n, { childList: true });
  };
  observeChain();
  return () => {
    stopped = true;
    observer.disconnect();
  };
}

/**
 * Put `host` back directly before `target`, its spot in a rebuilt page, after
 * removing any other host of ours left in that parent. Returns true when `host`
 * is in place.
 */
export function reattachHost(host: HTMLElement, target: HTMLElement, marker: string): boolean {
  const parent = target.parentElement;
  if (!parent || !target.isConnected) return false;
  parent.querySelectorAll(`[data-enhancedgv="${marker}"]`).forEach((n) => {
    if (n !== host) n.remove();
  });
  if (host.parentElement === parent && host.nextElementSibling === target) return true;
  try {
    parent.insertBefore(host, target);
  } catch {
    return false;
  }
  return host.parentElement === parent;
}
