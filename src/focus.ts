import type { CSSProperties } from "react";

// Focus-scroll landing buffer, applied to EVERY focusable in the panel.
// Valve's nav scroller honors CSS scroll-margin on the focused element in both
// its scroll paths (custom Pl reads scrollMargin* at 71255.js:299-302; the
// other path is native scrollIntoView, which respects scroll-margin natively).
// Generous values so a focused item always lands comfortably clear of the
// screen edges and the bottom button legend (on-device: 72/120 still left
// items partially clipped).
export const FOCUS_SCROLL_MARGIN: CSSProperties = {
  scrollMarginTop: 140,
  scrollMarginBottom: 180,
};

// Direct control over where a focused element lands: Valve's nav scroller
// consults the focused node's OWN `fnScrollIntoViewHandler` property FIRST
// (ZQ, 71255.js:160-163) — a non-false return means "handled". Focusable props
// flow into the node's properties (qp SetProperties, 28869.js:31-35), so
// spreading these props onto a Focusable/DialogButton takes over its landing:
// CENTER the element in the viewport, which can never leave it clipped at an
// edge (on-device: margins alone still left the hero/thumbnails/read-more
// partially off-screen). Falls back to native handling if anything's off.
export const CENTER_ON_FOCUS = {
  fnScrollIntoViewHandler: (focusedNode: unknown, animate: unknown) => {
    try {
      const el = (focusedNode as { m_element?: HTMLElement; Element?: HTMLElement })
        ?.m_element ??
        (focusedNode as { Element?: HTMLElement })?.Element;
      if (el?.scrollIntoView) {
        el.scrollIntoView({
          block: "center",
          behavior: animate ? "smooth" : "auto",
        });
        return true; // handled — skip Valve's default landing
      }
    } catch {
      /* fall through */
    }
    return false; // let the native scroller take it
  },
} as Record<string, unknown>;
