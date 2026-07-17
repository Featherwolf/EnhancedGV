import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Focusable } from "@decky/ui";
import { CENTER_ON_FOCUS } from "../focus";

// Renders long content as a few FOCUSABLE blocks so it scrolls the way the rest
// of the game page does: D-pad down steps focus block-to-block and the page's
// own scroll container follows (scrollIntoViewWhenChildFocused, 18914.js:16548)
// — the mechanism the nav bridge already makes work. A fixed-height overflow box
// can't scroll here: Valve's nav consumes the D-pad press to move focus OUT
// before any inner scroll runs, and right-stick scrolling isn't available in
// this region of this SteamOS build.

function Block({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <Focusable
      {...CENTER_ON_FOCUS}
      // A Focusable WITHOUT an activation handler is not registered as a focus
      // stop by Steam's nav (learned in v0.12.1) — so the D-pad would skip these
      // text blocks and the details would be unreachable/unscrollable. A no-op
      // onActivate makes each block a real stop; no footer hint is set so "A"
      // shows nothing to press.
      onActivate={() => {}}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        scrollMarginTop: 90,
        scrollMarginBottom: 120,
        borderRadius: 5,
        padding: "6px 8px",
        // Subtle so a wall of text with one block highlighted isn't garish, but
        // enough to see which block the D-pad is on.
        background: focused ? "rgba(26,159,255,0.14)" : "transparent",
        boxShadow: focused ? "inset 2px 0 0 #1a9fff" : "inset 2px 0 0 transparent",
        outline: "none",
      }}
    >
      {children}
    </Focusable>
  );
}

// A text node's textContent is entity-DECODED, so it MUST be re-escaped before
// it goes back through dangerouslySetInnerHTML — otherwise a caller's escaping
// (e.g. review text) is undone, which is an injection sink, and a literal "<" in
// a description silently swallows following text. Element nodes use outerHTML
// (already re-serialized with entities), so only text nodes need this.
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Split already-sanitized HTML into ~half-screen focus stops. DOMParser only
// re-groups the safe DOM (no new markup, no execution).
function chunkHtml(html: string, targetPerStop: number): string[] {
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="r">${html}</div>`,
      "text/html"
    );
    const root = doc.getElementById("r");
    const nodes = root ? Array.from(root.childNodes) : [];
    const out: string[] = [];
    let buf = "";
    let weight = 0;
    const flush = () => {
      if (buf.trim()) out.push(buf);
      buf = "";
      weight = 0;
    };
    // Longest text run allowed in a single focus stop. A stop taller than the
    // viewport can't be D-pad scrolled (there's nothing to step focus to), so a
    // long single-paragraph review/description MUST be sliced into several stops.
    const maxTextChars = Math.max(220, targetPerStop * 220);
    for (const n of nodes) {
      if (n.nodeType === 3) {
        const text = n.textContent ?? "";
        if (!text.trim()) continue;
        let i = 0;
        while (i < text.length) {
          let end = Math.min(i + maxTextChars, text.length);
          if (end < text.length) {
            const sp = text.lastIndexOf(" ", end);
            if (sp > i) end = sp; // break at whitespace, never mid-word
          }
          const piece = text.slice(i, end);
          buf += escapeText(piece); // re-encode — textContent was decoded
          weight += Math.max(1, Math.ceil(piece.length / 220));
          if (weight >= targetPerStop) flush();
          i = end;
        }
        continue;
      }
      if (n.nodeType !== 1) continue;
      const el = n as HTMLElement;
      const frag = el.outerHTML;
      if (!frag.trim()) continue;
      buf += frag;
      // Weight by rough visual height: media/headers count big, text by length.
      const tall = /^(img|h1|h2|h3|figure|table|ul|ol|picture|video)$/i.test(
        el.tagName
      );
      weight += tall ? Math.ceil(targetPerStop / 2) : Math.max(1, Math.ceil(frag.length / 220));
      if (weight >= targetPerStop) flush();
    }
    flush();
    return out.length ? out : [html];
  } catch {
    return [html];
  }
}

export function FocusableBlocks({
  html,
  blockClass,
  targetPerStop = 5,
}: {
  html: string;
  blockClass?: string;
  targetPerStop?: number;
}) {
  const chunks = useMemo(() => chunkHtml(html, targetPerStop), [html, targetPerStop]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Steam descriptions can embed autoplaying muted <video> clips ("animated
  // graphics"). Injected via innerHTML, CEF often leaves muted-autoplay PAUSED
  // (same quirk the media gallery hits), so kick play() explicitly. Also
  // viewport-gate them: a looping clip that keeps decoding while scrolled off
  // is pure battery drain. Use the UI document's realm, not the plugin's hidden
  // 1px context.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const win = (root.ownerDocument && root.ownerDocument.defaultView) || window;
    const vids = Array.from(
      root.querySelectorAll("video")
    ) as HTMLVideoElement[];
    if (!vids.length) return;
    const kick = (v: HTMLVideoElement) => {
      try {
        v.muted = true;
        const p = v.play();
        if (p && typeof (p as Promise<void>).catch === "function") {
          (p as Promise<void>).catch(() => {});
        }
      } catch {
        /* autoplay policy / detached — poster still shows */
      }
    };
    vids.forEach(kick);
    let io: IntersectionObserver | undefined;
    const IO = (win as unknown as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    if (IO) {
      io = new IO(
        (entries) => {
          entries.forEach((e) => {
            const v = e.target as HTMLVideoElement;
            if (e.isIntersecting) kick(v);
            else {
              try {
                v.pause();
              } catch {
                /* noop */
              }
            }
          });
        },
        { threshold: 0.01 }
      );
      vids.forEach((v) => io!.observe(v));
    }
    return () => {
      try {
        io && io.disconnect();
      } catch {
        /* noop */
      }
      vids.forEach((v) => {
        try {
          v.pause();
        } catch {
          /* noop */
        }
      });
    };
  }, [chunks]);

  return (
    <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {chunks.map((c, i) => (
        <Block key={i}>
          <div
            className={blockClass}
            style={{ fontSize: 13.5, lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: c }}
          />
        </Block>
      ))}
    </div>
  );
}
