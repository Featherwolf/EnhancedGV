import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Focusable, DialogButton, GamepadButton } from "@decky/ui";
import type { GamepadEvent } from "@decky/ui";
import { FaPlay, FaVolumeMute } from "react-icons/fa";
import { setVideoNote } from "../diag";
import { FOCUS_SCROLL_MARGIN, CENTER_ON_FOCUS } from "../focus";
import { playDashInto } from "../dashPlayer";
import type { Movie, Screenshot } from "../types";

interface Props {
  movies: Movie[];
  screenshots: Screenshot[];
}

type Item =
  | { kind: "movie"; id: string; movie: Movie; thumb: string; label: string }
  | { kind: "shot"; id: string; shot: Screenshot; thumb: string; label?: string };

const SHOT_DWELL_MS = 5000; // like the store page: screenshots dwell then advance


// Size relative to the VIEWPORT so the hero scales across resolutions (Deck
// 800p, 1080p handhelds, 4K TV) instead of being a fixed pixel block tuned for
// one screen. clamp keeps it sane at the extremes; contain (not cover) so
// trailers letterbox instead of cropping, and it stays short enough that
// "About this game" is visible below it.
const HERO_MEDIA_STYLE: CSSProperties = {
  width: "100%",
  aspectRatio: "16 / 9",
  maxHeight: "clamp(190px, 34vh, 620px)",
  objectFit: "contain",
  display: "block",
  background: "#000",
};

// Big store-style hero: shows the current item large, autoplays trailers muted,
// and carousels through everything (video: on ended; screenshot: after a dwell).
// Thumbnails select directly; inline controls handle mute and fullscreen — no
// popup players.
export function MediaHero({ movies, screenshots }: Props) {
  const items = useMemo<Item[]>(
    () => [
      ...(movies ?? []).map<Item>((m) => ({
        kind: "movie",
        id: `mov-${m.id}`,
        movie: m,
        thumb: m.thumb,
        label: m.name,
      })),
      ...(screenshots ?? []).map<Item>((s) => ({
        kind: "shot",
        id: `ss-${s.id}`,
        shot: s,
        thumb: s.thumb,
      })),
    ],
    [movies, screenshots]
  );

  const [idx, setIdx] = useState(0);
  // Movies whose progressive sources failed (Steam derives them; some 404) fall
  // back to their poster image + dwell timer, keeping the carousel moving.
  const [videoFailed, setVideoFailed] = useState<Record<string, boolean>>({});
  // Manual source ladder: a single `src` set directly is deterministic in CEF —
  // <source>-children resource selection raced our play() kicks (AbortError,
  // ready stuck at 1 on-device even though the CDN serves 206 ranges fine).
  const [srcIdx, setSrcIdx] = useState(0);
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [heroFocused, setHeroFocused] = useState(false);
  // Steam keeps left-behind pages mounted but hidden, and the user scrolls the
  // hero off-screen; either way the video must stop downloading/decoding.
  const [visible, setVisible] = useState(true);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const rootDivRef = useRef<HTMLDivElement | null>(null);
  const heroBoxRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const count = items.length;
  const advance = useCallback(() => {
    if (count > 0) setIdx((i) => (i + 1) % count);
  }, [count]);
  const [playing, setPlaying] = useState(true);

  // Carousel recovery for "trailer ended while fullscreen": we intentionally
  // don't auto-advance in fullscreen, but the deferred advance must fire on
  // exit or the whole carousel freezes on the final frame.
  const endedWhileFsRef = useRef(false);
  const onVideoEnded = useCallback(() => {
    if (count <= 1) return; // single item loops via the loop attribute
    if (fullscreen) endedWhileFsRef.current = true;
    else advance();
  }, [count, fullscreen, advance]);
  useEffect(() => {
    if (!fullscreen && endedWhileFsRef.current) {
      endedWhileFsRef.current = false;
      if (count > 1) advance();
    }
  }, [fullscreen, count, advance]);

  // EXPLICIT user selection gives a previously-failed trailer a fresh chance
  // (transient network hiccups shouldn't condemn an item for the whole visit);
  // auto-advance paths do NOT retry, so a dead trailer can't churn the network
  // on every carousel lap.
  const selectManually = useCallback(
    (i: number) => {
      const target = items[i];
      if (target && target.kind === "movie") {
        setVideoFailed((f) => {
          if (!f[target.id]) return f;
          const n = { ...f };
          delete n[target.id];
          return n;
        });
      }
      setIdx(i);
    },
    [items]
  );

  const cur = items[Math.min(idx, Math.max(count - 1, 0))];
  const curIsPlayableVideo = cur?.kind === "movie" && !videoFailed[cur.id];

  // Streaming mode (per item): Steam's newest trailers are manifest-only —
  // when the progressive ladder exhausts (or never existed), play the DASH
  // manifest via the built-in MSE streamer instead of failing to poster.
  const [streamFor, setStreamFor] = useState<Record<string, boolean>>({});
  const streamHandleRef = useRef<{ stop(): void } | null>(null);
  const curDash = cur?.kind === "movie" ? cur.movie.dash : null;
  const curStreaming = !!(cur && streamFor[cur.id] && curDash && !videoFailed[cur.id]);

  const markCurFailed = useCallback(() => {
    const id = cur?.id;
    if (!id) return;
    setVideoFailed((f) => (f[id] ? f : { ...f, [id]: true }));
  }, [cur?.id]);

  const escalate = useCallback(() => {
    // Ladder exhausted: stream if we have a manifest, otherwise poster.
    const id = cur?.id;
    if (!id) return;
    if (curDash) {
      setStreamFor((s) => (s[id] ? s : { ...s, [id]: true }));
    } else {
      markCurFailed();
    }
  }, [cur?.id, curDash, markCurFailed]);

  // Restart the source ladder whenever the carousel moves to another item; a
  // trailer with no progressive sources at all goes straight to streaming.
  useEffect(() => {
    setSrcIdx(0);
    if (
      cur?.kind === "movie" &&
      cur.movie.sources.length === 0 &&
      cur.movie.dash &&
      !videoFailed[cur.id]
    ) {
      setStreamFor((s) => (s[cur.id] ? s : { ...s, [cur.id]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id]);

  const curSources = cur?.kind === "movie" ? cur.movie.sources : [];
  const curSrc = curSources[srcIdx];
  const onVideoError = useCallback(() => {
    if (curStreaming) {
      setVideoNote(`stream element error (${cur?.id})`);
      markCurFailed();
      return;
    }
    const v = videoRef.current;
    const next = srcIdx + 1;
    if (next < curSources.length) {
      setVideoNote(
        `source ${srcIdx} failed (err=${v?.error?.code ?? "-"}), trying ${next}/${curSources.length}`
      );
      setSrcIdx(next);
    } else {
      setVideoNote(`all ${curSources.length} sources failed (${cur?.id}); escalating`);
      escalate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcIdx, curSources.length, cur?.id, curStreaming, escalate, markCurFailed]);

  // Drive the MSE streamer for the current item while visible.
  useEffect(() => {
    if (!curStreaming || !visible || !curDash) return;
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    playDashInto(v, curDash)
      .then((h) => {
        if (cancelled) h.stop();
        else streamHandleRef.current = h;
      })
      .catch((e) => {
        if (!cancelled) {
          setVideoNote(`stream setup failed: ${String(e)}`);
          markCurFailed();
        }
      });
    return () => {
      cancelled = true;
      streamHandleRef.current?.stop();
      streamHandleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curStreaming, curDash, visible, cur?.id]);

  // Visibility poll: page hidden (offsetParent null) or hero scrolled well out
  // of the viewport. Fullscreen overrides (element leaves normal flow).
  useEffect(() => {
    const check = () => {
      const el = rootDivRef.current;
      if (!el) return;
      if (fullscreen) {
        setVisible(true);
        return;
      }
      if (el.offsetParent == null) {
        setVisible(false);
        return;
      }
      const win = el.ownerDocument?.defaultView;
      const vh = win?.innerHeight ?? 800;
      const r = el.getBoundingClientRect();
      setVisible(r.bottom > -200 && r.top < vh + 200);
    };
    check();
    const iv = setInterval(check, 2000);
    return () => clearInterval(iv);
  }, [fullscreen]);

  // Autoplay hardening: CEF/React ordering can leave a muted autoplay video
  // paused; kick it explicitly whenever the current video (re)mounts, and
  // report exactly why playback fails (policy vs source) to the QAM.
  // AbortError is BENIGN (a newer load interrupted the play() — observed
  // on-device as net=2/ready=0, i.e. still downloading): retry, don't fail.
  useEffect(() => {
    if (!curIsPlayableVideo || !visible) return;
    const v = videoRef.current;
    if (!v) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const kick = (attempt: number) => {
      // Never touch a detached/replaced element (unmount or carousel move mid-
      // retry would otherwise resurrect a background-decoding <video>).
      if (disposed || videoRef.current !== v || !v.isConnected) return;
      v.muted = muted;
      (v as HTMLVideoElement & { defaultMuted?: boolean }).defaultMuted = muted;
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          if (!disposed) setVideoNote(`playing (${cur?.id})`);
        }).catch((e: unknown) => {
          if (disposed) return;
          const name = (e as { name?: string })?.name ?? String(e);
          setVideoNote(
            `play() rejected: ${name} (net=${v.networkState} ready=${v.readyState}, try ${attempt})`
          );
          if (attempt < 4) retry = setTimeout(() => kick(attempt + 1), 1500);
        });
      }
    };
    kick(1);
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
    };
  }, [cur?.id, srcIdx, curIsPlayableVideo, visible, muted]);

  // Dwell/advance is for STILLS only (screenshots + failed videos). A playing
  // video is NEVER advanced past by a timer — it moves on solely via 'ended'
  // (user requirement); dead sources are handled by the stall backstop.
  useEffect(() => {
    if (!cur || count < 2 || !visible || fullscreen) return;
    if (curIsPlayableVideo) return;
    const t = setTimeout(advance, SHOT_DWELL_MS);
    return () => clearTimeout(t);
  }, [cur, count, curIsPlayableVideo, advance, visible, fullscreen]);

  // Stall backstop: demote genuinely dead sources to poster + dwell — but be
  // PATIENT with slow ones. On-device the max-quality trailers buffered so
  // slowly over WiFi that a 10s readyState check condemned every video
  // (net=2 means the browser is still actively downloading — never fail that
  // before the long deadline).
  useEffect(() => {
    if (!curIsPlayableVideo || !visible) return;
    const fail = (v: HTMLVideoElement | null, at: string) => {
      setVideoNote(
        v
          ? `stalled@${at}: net=${v.networkState} ready=${v.readyState} err=${v.error?.code ?? "-"} (${cur?.id})`
          : `stalled@${at}: no element (${cur?.id})`
      );
      markCurFailed();
    };
    const t1 = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return fail(v, "12s");
      if (v.readyState >= 2) return; // has data — fine
      if (v.networkState !== 2) fail(v, "12s"); // idle/no-source and no data = dead
    }, 12_000);
    const t2 = setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) fail(v ?? null, "40s"); // even loading has limits
    }, 40_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [cur?.id, srcIdx, curIsPlayableVideo, visible, markCurFailed]);

  // Track fullscreen state from the UI document (works for B/Esc exits too).
  useEffect(() => {
    const doc = heroBoxRef.current?.ownerDocument;
    if (!doc) return;
    const onFs = () => setFullscreen(doc.fullscreenElement != null);
    doc.addEventListener("fullscreenchange", onFs);
    return () => doc.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Keep the selected thumbnail centered — scrolling ONLY the strip
  // horizontally (scrollIntoView would yank the page's vertical scroll).
  useEffect(() => {
    if (!visible) return;
    const strip = stripRef.current;
    const el = strip?.children?.[idx] as HTMLElement | undefined;
    if (strip && el && typeof strip.scrollTo === "function") {
      strip.scrollTo({
        left: el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2,
        behavior: "smooth",
      });
    }
  }, [idx, visible]);

  if (count === 0) {
    return <div style={{ opacity: 0.6, fontSize: 13 }}>No media available.</div>;
  }

  const toggleFullscreen = () => {
    const box = heroBoxRef.current;
    const doc = box?.ownerDocument;
    if (!box || !doc) return;
    if (doc.fullscreenElement) {
      doc.exitFullscreen?.().catch?.(() => {});
    } else {
      box.requestFullscreen?.().catch?.(() => {});
    }
  };

  // Store-page interaction model: A = play/pause on a video, fullscreen on an
  // image; X = mute; Y = fullscreen; D-pad left/right browses media in place.
  const onHeroActivate = () => {
    if (curIsPlayableVideo) {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) {
        const p = v.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } else {
        v.pause();
      }
    } else {
      toggleFullscreen();
    }
  };

  // Valve's handler wrapper (library/20893.js C()) consumes the event unless
  // the callback returns EXACTLY false — returning undefined for UP/DOWN here
  // swallowed them and focus-trapped the hero (observed on-device). Handled
  // directions return true; everything else MUST return false to propagate.
  const onHeroDirection = (evt: GamepadEvent): boolean => {
    const b = evt?.detail?.button;
    if (b === GamepadButton.DIR_LEFT) {
      selectManually((idx - 1 + count) % count);
      return true;
    }
    if (b === GamepadButton.DIR_RIGHT) {
      selectManually((idx + 1) % count);
      return true;
    }
    return false;
  };

  return (
    <div ref={rootDivRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Focusable
        {...CENTER_ON_FOCUS}
        onActivate={onHeroActivate}
        onOKButton={onHeroActivate}
        onOKActionDescription={
          curIsPlayableVideo ? (playing ? "Pause" : "Play") : "Fullscreen"
        }
        onSecondaryButton={curIsPlayableVideo ? () => setMuted((m) => !m) : undefined}
        onSecondaryActionDescription={
          curIsPlayableVideo ? (muted ? "Unmute" : "Mute") : undefined
        }
        onOptionsButton={toggleFullscreen}
        onOptionsActionDescription={fullscreen ? "Exit Fullscreen" : "Fullscreen"}
        onCancelButton={fullscreen ? toggleFullscreen : undefined}
        onCancelActionDescription={fullscreen ? "Exit Fullscreen" : undefined}
        onGamepadDirection={onHeroDirection}
        onGamepadFocus={() => setHeroFocused(true)}
        onGamepadBlur={() => setHeroFocused(false)}
        onFocus={() => setHeroFocused(true)}
        onBlur={() => setHeroFocused(false)}
        style={{
          ...FOCUS_SCROLL_MARGIN,
          position: "relative",
          borderRadius: 8,
          overflow: "hidden",
          // No transition: animated outlines repaint during focus-driven page
          // scrolling and read as judder from the couch.
          outline: heroFocused ? "2px solid #1a9fff" : "2px solid transparent",
          outlineOffset: -2,
        }}
      >
        <div ref={heroBoxRef} style={{ background: "#000" }}>
          {visible && curIsPlayableVideo && cur.kind === "movie" && (curSrc || curStreaming) ? (
            <video
              key={`${cur.id}:${curStreaming ? "stream" : srcIdx}`}
              ref={videoRef}
              src={curStreaming ? undefined : curSrc}
              preload="auto"
              autoPlay
              muted={muted}
              playsInline
              loop={count === 1}
              poster={cur.thumb}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={onVideoEnded}
              onError={onVideoError}
              style={fullscreen ? { ...HERO_MEDIA_STYLE, maxHeight: "100vh", height: "100%" } : HERO_MEDIA_STYLE}
            />
          ) : (
            <img
              key={cur?.id}
              src={cur?.kind === "shot" ? cur.shot.full : cur?.thumb}
              style={fullscreen ? { ...HERO_MEDIA_STYLE, maxHeight: "100vh", height: "100%" } : HERO_MEDIA_STYLE}
            />
          )}
          {/* Store-style overlay: title, position, mute state. Button hints
              live in Steam's own bottom legend (A/X/Y descriptions). */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              fontSize: 12,
              background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                flex: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cur?.label ?? ""}
              {cur?.kind === "movie" && videoFailed[cur.id] && (
                <span style={{ opacity: 0.7 }}> · preview unavailable</span>
              )}
            </span>
            {curIsPlayableVideo && muted && <FaVolumeMute size={12} style={{ opacity: 0.8 }} />}
            {curIsPlayableVideo && !playing && <FaPlay size={11} style={{ opacity: 0.8 }} />}
            <span style={{ opacity: 0.85, flexShrink: 0 }}>
              {idx + 1} / {count}
            </span>
          </div>
        </div>
      </Focusable>

      <Focusable
        // @ts-ignore Decky flow hint for horizontal gamepad navigation.
        flow-children="horizontal"
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          padding: "2px 2px 6px",
        }}
        ref={stripRef as AnyRef}
      >
        {items.map((it, i) => (
          <Thumb
            key={it.id}
            src={it.thumb}
            label={it.kind === "movie" ? it.label : undefined}
            isVideo={it.kind === "movie"}
            selected={i === idx}
            onActivate={() => selectManually(i)}
          />
        ))}
      </Focusable>
    </div>
  );
}

type AnyRef = any;

function Thumb({
  src,
  label,
  isVideo,
  selected,
  onActivate,
}: {
  src: string;
  label?: string;
  isVideo?: boolean;
  selected?: boolean;
  onActivate: () => void;
}) {
  return (
    <DialogButton
      {...CENTER_ON_FOCUS}
      onClick={onActivate}
      onOKButton={onActivate}
      style={{
        ...FOCUS_SCROLL_MARGIN,
        // Viewport-relative so thumbnails scale with the display like the hero.
        height: "clamp(58px, 8vh, 108px)",
        aspectRatio: "16 / 9",
        padding: 0,
        borderRadius: 6,
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
        border: selected ? "2px solid #66c0f4" : "2px solid transparent",
        opacity: selected ? 1 : 0.75,
      }}
    >
      <img
        src={src}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {isVideo && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <FaPlay size={16} style={{ filter: "drop-shadow(0 1px 2px #000)" }} />
        </div>
      )}
      {label && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "2px 6px",
            fontSize: 10,
            background: "rgba(0,0,0,0.6)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
      )}
    </DialogButton>
  );
}
