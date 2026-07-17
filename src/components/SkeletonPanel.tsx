import type { CSSProperties } from "react";
import type { SectionToggles } from "../types";

// Store-shaped animated placeholder shown while data loads: hero block,
// thumbnail strip, description lines, and one bar per enabled section — sized
// to approximate the loaded layout so content replaces it in place instead of
// popping in and shoving the page around.

const SHIMMER_CSS = `
@keyframes ssp-shimmer {
  0% { background-position: -640px 0; }
  100% { background-position: 640px 0; }
}
.ssp-skel {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.055) 25%,
    rgba(255,255,255,0.13) 37%,
    rgba(255,255,255,0.055) 63%
  );
  background-size: 1280px 100%;
  animation: ssp-shimmer 1.4s linear infinite;
  border-radius: 6px;
}
`;

function Skel({ style }: { style: CSSProperties }) {
  return <div className="ssp-skel" style={style} />;
}

export function SkeletonPanel({ sections }: { sections: SectionToggles }) {
  const sectionBars =
    [sections.about, sections.features, sections.deck, sections.reviews, sections.news].filter(
      Boolean
    ).length || 3;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <style>{SHIMMER_CSS}</style>

      {/* short-description line */}
      <Skel style={{ width: "72%", height: 14 }} />

      {sections.media && (
        <>
          {/* hero */}
          <Skel
            style={{
              width: "100%",
              aspectRatio: "16 / 9",
              maxHeight: 330,
              borderRadius: 8,
            }}
          />
          {/* label / counter row */}
          <Skel style={{ width: "40%", height: 12 }} />
          {/* thumbnail strip */}
          <div style={{ display: "flex", gap: 8, overflow: "hidden" }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skel
                key={i}
                style={{ minWidth: 128, width: 128, height: 72, flexShrink: 0 }}
              />
            ))}
          </div>
        </>
      )}

      {/* description lines (About defaults to expanded, so reserve real space) */}
      {sections.about && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          <Skel style={{ width: "100%", height: 13 }} />
          <Skel style={{ width: "96%", height: 13 }} />
          <Skel style={{ width: "88%", height: 13 }} />
          <Skel style={{ width: "60%", height: 13 }} />
        </div>
      )}

      {/* one header bar per enabled collapsible section */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        {Array.from({ length: sectionBars }, (_, i) => (
          <Skel key={i} style={{ width: "100%", height: 36, borderRadius: 4 }} />
        ))}
      </div>
    </div>
  );
}
