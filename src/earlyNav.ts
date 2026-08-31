// Early-navigation replay.
//
// The panel is injected into a page Steam already owns, so there is always a
// window — however short — between the app page becoming interactive and our
// host <div> existing. A D-pad Down (or a stick flick) inside that window moves
// the cursor from the header/Play area straight past our slot to the tab strip,
// and when the panel then lands the user has "skipped" a section they never saw.
//
// So we remember focus moves made on the app page while the panel is still
// missing. When the host attaches, the injector asks whether the user crossed
// our slot during that window; if so it replays the press by putting focus on
// the panel's first stop — exactly where the press would have landed had the
// panel been there.
//
// Only DOM focus is read (Valve's nav sets real focus on its active element, so
// `focusin` mirrors gamepad navigation); nothing is intercepted or swallowed.

interface Move {
  from: HTMLElement | null;
  to: HTMLElement | null;
  at: number;
}

// How long after a page enter a crossing still counts as "the user pressed down
// before the panel appeared". Long enough for a slow cold page, short enough
// that a deliberate move to the tabs a beat later is never hijacked.
const GRACE_MS = 2500;

let armedAt = 0;
let armedKey = "";
let listening = false;
let listeningDoc: Document | null = null;
let lastFocused: HTMLElement | null = null;
let moves: Move[] = [];

function onFocusIn(e: Event): void {
  const to = (e.target as HTMLElement) ?? null;
  if (armedAt) {
    moves.push({ from: lastFocused, to, at: Date.now() });
    if (moves.length > 8) moves.shift();
  }
  lastFocused = to;
}

/**
 * Start watching focus moves for a fresh app-page enter. `pageKey` identifies
 * the page: Steam re-renders the route several times while a page settles, and
 * re-arming on each of those would throw away the very press we are trying to
 * remember, so a repeat of the same key is a no-op.
 */
export function armEarlyNav(doc: Document | null | undefined, pageKey: string): void {
  try {
    if (!doc) return;
    if (pageKey === armedKey) return;
    armedKey = pageKey;
    if (!listening || listeningDoc !== doc) {
      if (listeningDoc) listeningDoc.removeEventListener("focusin", onFocusIn, true);
      doc.addEventListener("focusin", onFocusIn, true);
      listening = true;
      listeningDoc = doc;
    }
    armedAt = Date.now();
    moves = [];
    lastFocused = (doc.activeElement as HTMLElement) ?? null;
  } catch {
    /* focus history is an optimization — never let it break injection */
  }
}

/** Stop recording (the panel is in place, or we left the app page). */
export function disarmEarlyNav(): void {
  armedAt = 0;
  moves = [];
}

/**
 * Forget which page we armed for, so returning to the SAME game later arms
 * again. Called when the injector sees that no app page is on screen.
 */
export function resetEarlyNavPage(): void {
  armedKey = "";
  disarmEarlyNav();
}

/** Full teardown on plugin unload: drop the focus listener too. */
export function stopEarlyNav(): void {
  disarmEarlyNav();
  try {
    if (listeningDoc) listeningDoc.removeEventListener("focusin", onFocusIn, true);
  } catch {
    /* ignore */
  }
  listening = false;
  listeningDoc = null;
  lastFocused = null;
  armedKey = "";
}

const isBefore = (el: HTMLElement, ref: HTMLElement): boolean => {
  if (!el.isConnected || !ref.isConnected) return false;
  const rel = ref.compareDocumentPosition(el);
  // PRECEDING (2) and not contained by ref: strictly above our slot.
  return !!(rel & Node.DOCUMENT_POSITION_PRECEDING) && !(rel & Node.DOCUMENT_POSITION_CONTAINS);
};

const isAfter = (el: HTMLElement, ref: HTMLElement): boolean => {
  if (!el.isConnected || !ref.isConnected) return false;
  const rel = ref.compareDocumentPosition(el);
  // FOLLOWING (4) covers both a later sibling (the tab strip) and its contents.
  return !!(rel & Node.DOCUMENT_POSITION_FOLLOWING);
};

/**
 * Did the user navigate across our (not yet existing) slot during the grace
 * window? Consumes the answer: it can only fire once per page enter.
 */
export function consumeSlotCrossing(host: HTMLElement | null): boolean {
  try {
    if (!host || !host.isConnected || !armedAt) return false;
    if (Date.now() - armedAt > GRACE_MS) {
      disarmEarlyNav();
      return false;
    }
    const recent = moves.filter((m) => m.at >= armedAt && !!m.from && !!m.to);
    const crossed = recent.some(
      (m) =>
        m.from !== m.to &&
        !host.contains(m.from as HTMLElement) &&
        !host.contains(m.to as HTMLElement) &&
        isBefore(m.from as HTMLElement, host) &&
        isAfter(m.to as HTMLElement, host)
    );
    // ...and the user is still down there. If they crossed the empty slot and
    // then came back up, they are already where they wanted to be — pulling
    // them into the panel would be the hijack this is meant to avoid.
    const last = recent[recent.length - 1]?.to as HTMLElement | undefined;
    const landedBelow = !!last && !host.contains(last) && isAfter(last, host);
    disarmEarlyNav();
    return crossed && landedBelow;
  } catch {
    disarmEarlyNav();
    return false;
  }
}
