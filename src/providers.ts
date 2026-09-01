// Data-source (provider) helpers shared across the resolver and the data hook.
// The panel is provider-agnostic below `useResolvedGame`: it consumes a tagged
// DataRef ({provider, id}) instead of a bare Steam appid, so the Steam store and
// non-Steam metadata sources (Hasheous, …) flow through the exact same caches
// and components.
import type { DataRef, DataProvider } from "./types";

// Stable string key for a ref — used to key the in-memory app-data caches and as
// the effect dependency (an object identity would re-fire the effect every
// render; a Hasheous numeric id could also collide with a Steam appid, so the
// provider must be part of the key).
export function refKey(ref: DataRef): string {
  return `${ref.provider}:${ref.id}`;
}

export function sameRef(a: DataRef | null, b: DataRef | null): boolean {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.id === b.id;
}

// A ref is fetchable when it has a usable id (Steam needs a positive appid; other
// providers just need a non-empty id).
export function refIsValid(ref: DataRef | null): ref is DataRef {
  if (!ref) return false;
  if (ref.provider === "steam") return Number(ref.id) > 0;
  return ref.id !== "" && ref.id != null;
}

// The Steam appid a ref points at, or null for a non-Steam provider. Used only by
// the Steam-specific bits (e.g. the reviews chip-filter fetch), never for gating.
export function steamAppidOf(ref: DataRef | null): number | null {
  return ref && ref.provider === "steam" ? Number(ref.id) : null;
}

// Short, user-facing label for the source that supplied a game's content.
export function providerLabel(provider: DataProvider): string {
  switch (provider) {
    case "hasheous":
      return "Hasheous";
    case "steam":
    default:
      return "Steam";
  }
}
