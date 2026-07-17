import { setVideoNote } from "./diag";

// Minimal MSE player for Steam's trailer DASH manifests. Steam's NEWEST trailer
// uploads are manifest-only (zero progressive files on the CDN — verified), so
// a <video src> can never play them. Their manifests are ideal for a tiny
// hand-rolled player instead of a 700KB dash.js:
//   - static, single Period, SegmentTemplate with fixed duration + $Number%05d$
//   - AV1 video representations (royalty-free: decodes even on clients that
//     dropped H.264) + one AAC audio representation
//   - the CDN sends Access-Control-Allow-Origin: * (verified), so frontend
//     fetch() of segments works directly
// Strategy: trailers are small (~10MB) — pick ONE representation, fetch init +
// every segment sequentially, append, endOfStream. No adaptive logic.

export interface DashHandle {
  stop(): void;
}

interface Rep {
  id: string;
  codecs: string;
  mime: string;
  bandwidth: number;
  height: number;
  init: string;
  media: string;
  timescale: number;
  segDuration: number;
  startNumber: number;
}

function parseDurationSec(v: string | null): number {
  // e.g. "PT1M0.4S", "PT58.3S", "PT1H2M3S"
  if (!v) return 0;
  const m = v.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!m) return 0;
  return (
    (parseInt(m[1] ?? "0") || 0) * 3600 +
    (parseInt(m[2] ?? "0") || 0) * 60 +
    (parseFloat(m[3] ?? "0") || 0)
  );
}

function repsFrom(doc: Document): { video: Rep[]; audio: Rep[]; durationSec: number } {
  const durationSec = parseDurationSec(
    doc.documentElement.getAttribute("mediaPresentationDuration")
  );
  const video: Rep[] = [];
  const audio: Rep[] = [];
  for (const set of Array.from(doc.querySelectorAll("AdaptationSet"))) {
    const kind =
      set.getAttribute("contentType") ??
      (set.getAttribute("mimeType") ?? "").split("/")[0];
    if (kind !== "video" && kind !== "audio") continue;
    for (const rep of Array.from(set.querySelectorAll("Representation"))) {
      const tpl =
        rep.querySelector("SegmentTemplate") ?? set.querySelector("SegmentTemplate");
      if (!tpl) continue;
      const r: Rep = {
        id: rep.getAttribute("id") ?? "0",
        codecs: rep.getAttribute("codecs") ?? set.getAttribute("codecs") ?? "",
        mime: rep.getAttribute("mimeType") ?? set.getAttribute("mimeType") ?? "video/mp4",
        bandwidth: parseInt(rep.getAttribute("bandwidth") ?? "0") || 0,
        height: parseInt(rep.getAttribute("height") ?? "0") || 0,
        init: tpl.getAttribute("initialization") ?? "",
        media: tpl.getAttribute("media") ?? "",
        timescale: parseInt(tpl.getAttribute("timescale") ?? "1") || 1,
        segDuration: parseInt(tpl.getAttribute("duration") ?? "0") || 0,
        startNumber: parseInt(tpl.getAttribute("startNumber") ?? "1") || 1,
      };
      if (r.init && r.media && r.segDuration > 0) {
        (kind === "video" ? video : audio).push(r);
      }
    }
  }
  return { video, audio, durationSec };
}

function fillTemplate(tpl: string, repId: string, num?: number): string {
  let out = tpl.replace(/\$RepresentationID\$/g, repId);
  if (num != null) {
    out = out.replace(/\$Number(%0(\d+)d)?\$/g, (_m, _pad, width) =>
      width ? String(num).padStart(parseInt(width), "0") : String(num)
    );
  }
  return out;
}

export async function playDashInto(
  video: HTMLVideoElement,
  mpdUrl: string
): Promise<DashHandle> {
  // Use the UI document's realm for MSE (plugin globals live in a hidden 1px
  // window — cross-realm MediaSource/objectURL would not attach to the video).
  const win = (video.ownerDocument?.defaultView ?? window) as Window &
    typeof globalThis;
  const MS: typeof MediaSource | undefined = (
    win as unknown as { MediaSource?: typeof MediaSource }
  ).MediaSource;
  if (!MS || typeof MS.isTypeSupported !== "function") {
    throw new Error("MediaSource unavailable");
  }

  const abort = new AbortController();
  const res = await fetch(mpdUrl, { signal: abort.signal });
  if (!res.ok) throw new Error(`mpd HTTP ${res.status}`);
  const xml = new win.DOMParser().parseFromString(await res.text(), "text/xml");
  const { video: vreps, audio: areps, durationSec } = repsFrom(xml);

  // isTypeSupported can reject the manifest's LONG-form codec string
  // (av01.0.05M.08.0.110.01.01.01.0) even when the same decoder accepts the
  // short form (av01.0.05M.08). Try the full string, then a truncated fallback,
  // and remember which actually passed so addSourceBuffer uses the same one.
  const shortCodec = (c: string) => c.split(".").slice(0, 4).join(".");
  const acceptedType = (r: Rep): string | null => {
    const full = `${r.mime}; codecs="${r.codecs}"`;
    if (MS.isTypeSupported(full)) return full;
    const shortT = `${r.mime}; codecs="${shortCodec(r.codecs)}"`;
    if (shortCodec(r.codecs) !== r.codecs && MS.isTypeSupported(shortT)) return shortT;
    return null;
  };
  const playableV = vreps
    .map((r) => ({ r, type: acceptedType(r) }))
    .filter((x): x is { r: Rep; type: string } => x.type != null);
  if (!playableV.length) {
    throw new Error(
      `no decodable video rep (tried: ${vreps.map((r) => r.codecs).join(", ") || "none"})`
    );
  }
  // Hero is ~330px tall: ~480p is ideal (quality vs bandwidth).
  playableV.sort(
    (a, b) =>
      Math.abs((a.r.height || 480) - 480) - Math.abs((b.r.height || 480) - 480)
  );
  const chosenV = playableV[0].r;
  const chosenVType = playableV[0].type;
  // Audio is optional: clients that dropped H.264 usually dropped AAC too —
  // the hero autoplays muted anyway; video-only playback is fine.
  const chosenAPair = areps
    .map((r) => ({ r, type: acceptedType(r) }))
    .find((x) => x.type != null) as { r: Rep; type: string } | undefined;
  const chosenA = chosenAPair?.r;
  const typeOf = (r: Rep): string =>
    r === chosenV
      ? chosenVType
      : r === chosenA
        ? (chosenAPair as { type: string }).type
        : `${r.mime}; codecs="${r.codecs}"`;

  const base = mpdUrl.split("?")[0].replace(/[^/]*$/, "");
  const query = mpdUrl.includes("?") ? "?" + mpdUrl.split("?")[1] : "";
  const segCount = (r: Rep) =>
    Math.max(1, Math.ceil((durationSec * r.timescale) / r.segDuration));

  const ms = new MS();
  const objectUrl = win.URL.createObjectURL(ms);
  video.src = objectUrl;

  let stopped = false;
  const cleanup = () => {
    stopped = true;
    try {
      abort.abort();
    } catch {
      /* ignore */
    }
    try {
      win.URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
  };

  const appendTrack = async (r: Rep): Promise<void> => {
    const sb = ms.addSourceBuffer(typeOf(r));
    const appendWait = (buf: ArrayBuffer) =>
      new Promise<void>((resolve, reject) => {
        const done = () => {
          sb.removeEventListener("updateend", done);
          sb.removeEventListener("error", fail);
          resolve();
        };
        const fail = () => {
          sb.removeEventListener("updateend", done);
          sb.removeEventListener("error", fail);
          reject(new Error("sourceBuffer append error"));
        };
        sb.addEventListener("updateend", done);
        sb.addEventListener("error", fail);
        sb.appendBuffer(buf);
      });
    const fetchBuf = async (url: string): Promise<ArrayBuffer | null> => {
      const resp = await fetch(url, { signal: abort.signal });
      if (!resp.ok) return null;
      return resp.arrayBuffer();
    };

    const initBuf = await fetchBuf(base + fillTemplate(r.init, r.id) + query);
    if (!initBuf) throw new Error(`init segment HTTP failure (rep ${r.id})`);
    await appendWait(initBuf);
    const n = segCount(r);
    for (let i = 0; i < n && !stopped; i++) {
      const num = r.startNumber + i;
      const buf = await fetchBuf(base + fillTemplate(r.media, r.id, num) + query);
      if (!buf) {
        // Segment-count ceil can overshoot by one at the tail — tolerate.
        if (i >= n - 2) break;
        throw new Error(`segment ${num} HTTP failure (rep ${r.id})`);
      }
      await appendWait(buf);
      if (i === 0) {
        // First media data is in: start playback (muted autoplay).
        video.play().catch(() => {
          /* kick effect retries */
        });
      }
    }
  };

  await new Promise<void>((resolve) => {
    if (ms.readyState === "open") return resolve();
    ms.addEventListener("sourceopen", () => resolve(), { once: true });
  });

  setVideoNote(
    `streaming ${chosenV.height || "?"}p ${chosenV.codecs.split(".")[0]}${
      chosenA ? "+audio" : " (video-only)"
    } · ${segCount(chosenV)} segs`
  );

  // Audio is best-effort: a failed audio segment must NOT sink a fully-buffered
  // video (the client may lack the audio codec anyway; the hero plays muted).
  if (chosenA) {
    appendTrack(chosenA).catch((e) => {
      if (!stopped) setVideoNote(`audio dropped (video continues): ${String(e)}`);
    });
  }
  appendTrack(chosenV)
    .then(() => {
      if (!stopped && ms.readyState === "open") {
        try {
          ms.endOfStream();
        } catch {
          /* ignore */
        }
        setVideoNote("streaming: fully buffered");
      }
    })
    .catch((e) => {
      if (!stopped) setVideoNote(`streaming failed: ${String(e)}`);
    });

  return { stop: cleanup };
}
