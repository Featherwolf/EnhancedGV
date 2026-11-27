// Keeps EnhancedGV's panel host directly above Steam's details container.
//
// Other plugins put their own bars into Steam's page right before that same
// container: Quick User Switcher's "Switch User & Play", HowLongToBeat's times.
// Quick User Switcher's bar renders nothing until its owner lookup finishes, so
// it appears after our host is already in place, and React then inserts it
// directly before the container: under our whole store panel, where it reads as
// gone (reported by a Quick User Switcher user). Keeping our host the
// container's immediate previous sibling leaves those bars next to the Play
// button, above the panel. Only our own node is ever moved; Steam's and other
// plugins' nodes are never touched.

type MovableParent = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };

/**
 * Move `host` back to directly before `target` when something has been put
 * between them. Returns true when it moved.
 */
export function keepHostAdjacent(host: HTMLElement | null, target: HTMLElement | null): boolean {
  if (!host || !target || !host.isConnected || !target.isConnected) return false;
  const parent = target.parentElement as MovableParent | null;
  if (!parent || host.parentElement !== parent || host.nextElementSibling === target) return false;
  // moveBefore (Chromium 133+) moves a node without taking it out of the page:
  // focus, a playing trailer and scroll positions inside the panel survive.
  if (typeof parent.moveBefore === "function") {
    try {
      parent.moveBefore(host, target);
      return true;
    } catch {
      /* fall back to a plain move below */
    }
  }
  // A plain move drops focus from inside the panel, so wait while the user is
  // in it; the next check moves it once they've left.
  const active = host.ownerDocument?.activeElement;
  if (active && host.contains(active)) return false;
  parent.insertBefore(host, target);
  return true;
}

/**
 * Keep `host` directly before `target` as siblings come and go. The observer
 * fires after React's commit and before the next paint, so a late bar never
 * shows below the panel first. Returns a function that stops watching.
 */
export function watchHostOrder(host: HTMLElement, target: HTMLElement): () => void {
  const parent = target.parentElement;
  const win = host.ownerDocument?.defaultView as (Window & typeof globalThis) | null;
  const Observer =
    win?.MutationObserver ?? (typeof MutationObserver !== "undefined" ? MutationObserver : undefined);
  if (!parent || !Observer) return () => {};
  keepHostAdjacent(host, target);
  const observer = new Observer(() => {
    keepHostAdjacent(host, target);
  });
  observer.observe(parent, { childList: true });
  return () => observer.disconnect();
}
