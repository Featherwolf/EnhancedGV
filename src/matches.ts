// Pub/sub so a QAM match edit/clear re-resolves any open game page live (mirrors
// the settings listener pattern). Keyed by the game's own appid.
type MatchListener = (gameAppid: number) => void;

const listeners = new Set<MatchListener>();

export function onMatchChanged(fn: MatchListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitMatchChanged(gameAppid: number): void {
  listeners.forEach((l) => {
    try {
      l(gameAppid);
    } catch {
      /* ignore a bad listener */
    }
  });
}
