import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Focusable } from "@decky/ui";
import { useAppData } from "../hooks/useAppData";
import { useResolvedGame } from "../hooks/useResolvedGame";
import {
  setDiag,
  markStoreRender,
  reportPanelRect,
  markPanelMount,
  markPanelUnmount,
} from "../diag";
import { CollapsibleSection } from "./CollapsibleSection";
import { MediaHero } from "./MediaGallery";
import { SkeletonPanel } from "./SkeletonPanel";
import { DEFAULT_EXPANDED } from "../types";
import { DescriptionSection } from "./DescriptionSection";
import { FeaturesSection } from "./FeaturesSection";
import { ReviewsSection } from "./ReviewsSection";
import { NewsSection } from "./NewsSection";
import { DeckCompatBadge, DeckCompatDetails } from "./DeckCompatBadge";

interface Props {
  appid: number;
  __panelMarker?: string;
  // Which injection slot this instance lives in ("primary" scroll-flow panel vs
  // "fallback" below-tabs panel) — drives the per-slot mount health counters.
  slot?: string;
  // When injected as a replacement for native content (e.g. the Game Info tab),
  // this is rendered while loading or if store data is unavailable, so the slot
  // is never blank.
  fallback?: ReactNode;
}

interface Section {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  node: ReactNode;
}

// Solid, clearly-bounded card. The panel sits at the top of the tab content, and
// an on-device round proved a translucent box with a faint banner reads as empty
// space from a couch — the card must be unmistakably "a thing" in EVERY state.
const CONTAINER_STYLE: CSSProperties = {
  margin: "10px 0 24px",
  padding: "12px 16px",
  borderRadius: 8,
  background: "#10161d",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 8,
};

function StatusBanner({ tone, text }: { tone: "info" | "warn"; text: string }) {
  return (
    <div
      style={{
        margin: "8px 12px",
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 13,
        background: tone === "warn" ? "rgba(193,91,88,0.35)" : "rgba(102,192,244,0.25)",
        borderLeft: `3px solid ${tone === "warn" ? "#c15b58" : "#66c0f4"}`,
      }}
    >
      {text}
    </div>
  );
}

export function StorePanel({ appid, slot = "primary", fallback }: Props) {
  markStoreRender(); // synchronous render probe (see diag.ts)
  // Resolve the (possibly non-Steam) game to the store appid to fetch. For a
  // Steam game this is the appid itself; for a non-Steam shortcut it's the
  // matched store appid (or null while resolving / if unidentified).
  const resolved = useResolvedGame(appid);
  const fetchAppid = resolved.storeAppid;
  const { data, settings, loading, error } = useAppData(fetchAppid);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Mount health: lets the patcher detect "injection succeeded once but the
  // committed tree lost the panel" and re-arm the fallback ladder. Keyed by
  // slot+appid (each StorePanel instance element is keyed `slot:appid`, so
  // these are fixed for the instance's lifetime).
  useEffect(() => {
    markPanelMount(slot, appid);
    return () => markPanelUnmount(slot, appid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout probe: measure where our node actually landed (0-height vs off-screen
  // vs covered vs hidden). Several delayed re-measures because the page-enter /
  // tab transition can keep the subtree display:none well past the first frame —
  // and if data never arrives there is no later re-render to try again from.
  useLayoutEffect(() => {
    const measure = () => reportPanelRect(rootRef.current);
    measure();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const raf = requestAnimationFrame(() => {
      measure();
      for (const ms of [400, 1200, 3000]) timers.push(setTimeout(measure, ms));
    });
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  });

  // Report the data/render outcome to the Quick Access diagnostics readout so a
  // backend/network failure is visible on-device without reading logs.
  useEffect(() => {
    if (resolved.status === "resolving") {
      setDiag({ panelState: "loading", panelError: null });
      return;
    }
    if (resolved.status === "unmatched") {
      setDiag({ panelState: "hidden", panelError: resolved.reason ?? "not identified" });
      return;
    }
    const hidden = !!(error || !data || !data.appdetails?.ok);
    setDiag({
      panelState: loading ? "loading" : hidden ? "hidden" : "rendered",
      panelError:
        error ??
        (data && !data.appdetails?.ok
          ? (data.appdetails as { error?: string })?.error ?? "appdetails not ok"
          : null),
      dataOk: data
        ? {
            appdetails: !!data.appdetails?.ok,
            reviews: !!data.reviews?.ok,
            news: !!data.news?.ok,
            deck: !!data.deck?.ok,
          }
        : null,
    });
  }, [appid, resolved.status, resolved.reason, loading, error, data]);

  // Same visible card chrome for the loading / unavailable states as for the
  // loaded panel, so the panel is unmistakably present the moment it mounts.
  const chromeHeader = (
    <div style={HEADER_STYLE}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Store</div>
      <div style={{ fontSize: 12, opacity: 0.5 }}>EnhancedGV</div>
    </div>
  );

  if (resolved.status === "resolving" || loading) {
    // Animated store-shaped skeleton (user preference: fill the space with a
    // placeholder rather than popping in). It approximates the loaded layout so
    // content replaces it in place. Also covers the brief "matching a non-Steam
    // game by title" window.
    return (
      <div ref={rootRef} style={CONTAINER_STYLE}>
        {chromeHeader}
        <SkeletonPanel sections={settings.sections} />
        {fallback}
      </div>
    );
  }

  if (resolved.status === "unmatched") {
    // A non-Steam game with no Steam store match (auto-search missed, or it's not
    // on Steam). Managed entirely from the QAM — no in-page matcher.
    return (
      <div ref={rootRef} style={CONTAINER_STYLE}>
        {chromeHeader}
        <StatusBanner
          tone="info"
          text="This game isn’t matched to a Steam store page yet. Set its Steam App ID from Quick Access → EnhancedGV → Store data source to pull content."
        />
        {fallback}
      </div>
    );
  }

  if (error || !data || !data.appdetails?.ok) {
    // Store data unavailable (non-Steam shortcut / region-locked / fetch error).
    // Show the native content as a fallback, but make it clear EnhancedGV IS
    // active and why there's no store content, rather than looking unchanged.
    const why =
      (data && !data.appdetails?.ok
        ? (data.appdetails as { error?: string })?.error
        : error) || "no store data";
    return (
      <div ref={rootRef} style={CONTAINER_STYLE}>
        {chromeHeader}
        <StatusBanner tone="warn" text={`Store content unavailable (${why})`} />
        {fallback}
      </div>
    );
  }

  const d = data.appdetails;
  const sec = settings.sections;
  const expanded = { ...DEFAULT_EXPANDED, ...settings.expanded };
  const reviewSummary = data.reviews?.ok ? data.reviews.summary.desc : "";

  // Build the enabled sections. Media is NOT a collapsible section — it renders
  // big and front-and-center as the store-style hero right under the header.
  // Which sections start expanded is a user setting.
  const sections: Section[] = [];
  if (sec.about)
    sections.push({
      id: "about",
      title: "About this game",
      defaultOpen: expanded.about,
      node: (
        <DescriptionSection aboutHtml={d.about_html} short={d.short_description} />
      ),
    });
  if (sec.features)
    sections.push({
      id: "features",
      title: "Features & details",
      defaultOpen: expanded.features,
      node: <FeaturesSection d={d} />,
    });
  if (sec.deck)
    sections.push({
      id: "deck",
      title: "Steam Deck",
      subtitle: data.deck?.ok ? data.deck.label : undefined,
      defaultOpen: expanded.deck,
      node: <DeckCompatDetails deck={data.deck} />,
    });
  if (sec.reviews)
    sections.push({
      id: "reviews",
      title: "Reviews",
      subtitle: data.reviews?.ok
        ? data.reviews.summary.total_reviews.toLocaleString()
        : undefined,
      defaultOpen: expanded.reviews,
      node: (
        <ReviewsSection
          reviews={data.reviews}
          appid={fetchAppid ?? appid}
          settings={settings}
        />
      ),
    });
  if (sec.news)
    sections.push({
      id: "news",
      title: "Update history",
      subtitle: data.news?.ok ? `${data.news.items.length}` : undefined,
      defaultOpen: expanded.news,
      node: <NewsSection news={data.news} />,
    });

  const header = (
    <div style={HEADER_STYLE}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Store</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {reviewSummary && (
          <span style={{ fontSize: 12.5, opacity: 0.85 }}>{reviewSummary}</span>
        )}
        {data.deck?.ok && <DeckCompatBadge deck={data.deck} />}
      </div>
    </div>
  );

  // Store-blue accent card so the game summary reads as a deliberate feature,
  // not stray text (user request: stylish, "what's this game about" header).
  const shortDesc = d.short_description ? (
    <div
      style={{
        margin: "2px 0 12px",
        padding: "10px 14px",
        borderLeft: "3px solid #66c0f4",
        borderRadius: "0 6px 6px 0",
        background:
          "linear-gradient(90deg, rgba(102,192,244,0.12), rgba(102,192,244,0.02))",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: "#66c0f4",
          marginBottom: 4,
        }}
      >
        What's this game about?
      </div>
      <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{d.short_description}</div>
    </div>
  ) : null;

  const hasMedia = d.movies.length > 0 || d.screenshots.length > 0;

  return (
    <Focusable ref={rootRef} style={CONTAINER_STYLE}>
      {header}
      {shortDesc}
      {sec.media && hasMedia && (
        <div style={{ margin: "2px 0 10px" }}>
          <MediaHero movies={d.movies} screenshots={d.screenshots} />
        </div>
      )}
      {sections.map((s) => (
        <CollapsibleSection
          key={s.id}
          title={s.title}
          subtitle={s.subtitle}
          defaultOpen={s.defaultOpen}
        >
          {s.node}
        </CollapsibleSection>
      ))}
    </Focusable>
  );
}
