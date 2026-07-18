// Read a library game's identity from Steam's app store. `window.appStore` is a
// global (confirmed in the client source: `window.appStore = tw`), and
// GetAppOverviewByAppID returns an overview that exposes BIsShortcut() and
// display_name — for non-Steam shortcuts too. This lets us detect non-Steam
// games and get their title WITHOUT threading anything through the fragile
// library-page injection layer (we already have the appid there).

const K_EAppTypeShortcut = 1073741824; // app_type for a non-Steam shortcut

export interface GameIdentity {
  appid: number;
  isShortcut: boolean;
  title: string;
}

interface Overview {
  BIsShortcut?: () => boolean;
  app_type?: number;
  display_name?: string;
}

export function getGameIdentity(appid: number): GameIdentity {
  let isShortcut = false;
  let title = "";
  try {
    const ov = (
      window as unknown as {
        appStore?: { GetAppOverviewByAppID?: (id: number) => Overview | null };
      }
    ).appStore?.GetAppOverviewByAppID?.(appid);
    if (ov) {
      isShortcut =
        typeof ov.BIsShortcut === "function"
          ? !!ov.BIsShortcut()
          : ov.app_type === K_EAppTypeShortcut;
      title = String(ov.display_name ?? "");
    }
  } catch {
    /* appStore not reachable in this realm -> treat as a normal Steam game */
  }
  return { appid, isShortcut, title };
}
