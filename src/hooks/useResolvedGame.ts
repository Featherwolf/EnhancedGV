import { useEffect, useState } from "react";
import { getGameIdentity } from "../identity";
import type { GameIdentity } from "../identity";
import { resolveGame } from "../api";
import type { ResolveResult } from "../api";
import type { DataRef } from "../types";
import { resolveLanguage, resolveCountry } from "../lang";
import { onMatchChanged } from "../matches";
import { withTimeout } from "./useAppData";

export type ResolveStatus = "resolving" | "content" | "unmatched";

export interface ResolvedGame {
  status: ResolveStatus;
  // The tagged data source to fetch (Steam appid, or a non-Steam provider id), or
  // null while resolving / when a non-Steam game has no match.
  ref: DataRef | null;
  identity: GameIdentity;
  name: string;
  year: string;
  source: string;
  reason?: string;
}

// Map a backend resolve result to a tagged DataRef. A Steam appid wins (and is
// also what auto-matched non-Steam-to-Steam games return); otherwise a non-Steam
// provider match (Hasheous, …) is carried by provider + provider_id.
function refFromResult(r: ResolveResult | null | undefined): DataRef | null {
  if (!r || !r.ok) return null;
  if (r.store_appid) return { provider: "steam", id: r.store_appid };
  if (r.provider && r.provider !== "steam" && r.provider_id != null && r.provider_id !== "")
    return { provider: r.provider, id: r.provider_id };
  return null;
}

// Resolve the game on the page (Steam or non-Steam shortcut) to the store appid
// whose content we should show. A saved match wins; a non-Steam game with no
// match is searched by title once and remembered. Re-runs when the QAM edits or
// clears this game's match.
export function useResolvedGame(appid: number): ResolvedGame {
  const [state, setState] = useState<ResolvedGame>(() => ({
    status: "resolving",
    ref: null,
    identity: getGameIdentity(appid),
    name: "",
    year: "",
    source: "auto",
  }));

  useEffect(() => {
    // Per-run supersede token: a newer run() (e.g. a match edit re-run, or an
    // appid change) invalidates any older in-flight run, so an out-of-order
    // resolveGame completion can NEVER overwrite the fresh state. Sharing a
    // single unmount-only flag here caused last-writer-wins races.
    let gen = 0;
    let alive = true;

    const run = async () => {
      const myGen = ++gen;
      const current = () => alive && myGen === gen;
      const identity = getGameIdentity(appid);
      // Optimistic: a Steam game almost always resolves to itself, so show its
      // content immediately (no round-trip on the critical path). A saved
      // override (rare) is applied a beat later when resolve returns. Non-Steam
      // games must wait for the title search.
      if (!identity.isShortcut) {
        if (current())
          setState({
            status: "content",
            ref: { provider: "steam", id: appid },
            identity,
            name: "",
            year: "",
            source: "auto",
          });
      } else if (current()) {
        setState((s) => ({ ...s, status: "resolving", identity }));
      }

      try {
        // Timeout so a hung/dead backend can't leave a non-Steam game stuck on
        // the skeleton forever (the "callable hangs forever" failure mode).
        const r = await withTimeout(
          resolveGame(appid, identity.isShortcut, identity.title, resolveLanguage(), resolveCountry()),
          "resolve_game"
        );
        if (!current()) return;
        const ref = refFromResult(r);
        if (ref) {
          setState({
            status: "content",
            ref,
            identity,
            name: r.name ?? "",
            year: r.year ?? "",
            source: r.source ?? "auto",
          });
        } else {
          setState({
            status: "unmatched",
            ref: null,
            identity,
            name: "",
            year: "",
            source: "auto",
            reason: r?.reason,
          });
        }
      } catch (e) {
        // Backend unreachable/timed out: for a Steam game the optimistic content
        // still stands; only surface "unmatched" for a shortcut we couldn't
        // resolve (so its QAM "set an ID" banner shows instead of an infinite
        // skeleton).
        if (current() && identity.isShortcut) {
          setState({
            status: "unmatched",
            ref: null,
            identity,
            name: "",
            year: "",
            source: "auto",
            reason: String(e),
          });
        }
      }
    };

    run();
    const off = onMatchChanged((changed) => {
      if (changed === appid) run();
    });
    return () => {
      alive = false;
      off();
    };
  }, [appid]);

  return state;
}
