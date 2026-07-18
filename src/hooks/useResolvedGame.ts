import { useEffect, useState } from "react";
import { getGameIdentity } from "../identity";
import type { GameIdentity } from "../identity";
import { resolveGame } from "../api";
import { resolveLanguage, resolveCountry } from "../lang";
import { onMatchChanged } from "../matches";
import { withTimeout } from "./useAppData";

export type ResolveStatus = "resolving" | "content" | "unmatched";

export interface ResolvedGame {
  status: ResolveStatus;
  storeAppid: number | null;
  identity: GameIdentity;
  name: string;
  year: string;
  source: string;
  reason?: string;
}

// Resolve the game on the page (Steam or non-Steam shortcut) to the store appid
// whose content we should show. A saved match wins; a non-Steam game with no
// match is searched by title once and remembered. Re-runs when the QAM edits or
// clears this game's match.
export function useResolvedGame(appid: number): ResolvedGame {
  const [state, setState] = useState<ResolvedGame>(() => ({
    status: "resolving",
    storeAppid: null,
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
          setState({ status: "content", storeAppid: appid, identity, name: "", year: "", source: "auto" });
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
        if (r?.ok && r.store_appid) {
          setState({
            status: "content",
            storeAppid: r.store_appid,
            identity,
            name: r.name ?? "",
            year: r.year ?? "",
            source: r.source ?? "auto",
          });
        } else {
          setState({
            status: "unmatched",
            storeAppid: null,
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
            storeAppid: null,
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
