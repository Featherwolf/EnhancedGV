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

// A non-Steam shortcut's launch command, as Steam stores it. The backend reads
// the game's system from it (the ROM's extension and folder, the emulator), so
// a Switch game isn't matched to a Game Boy dump. It stays on the device.
export interface ShortcutLaunch {
  exe: string;
  args: string;
  dir: string;
}

interface ShortcutDetails {
  strShortcutExe?: string;
  strShortcutLaunchOptions?: string;
  strShortcutStartDir?: string;
}

function launchFrom(d: ShortcutDetails | null | undefined): ShortcutLaunch | null {
  if (!d || !(d.strShortcutExe || d.strShortcutLaunchOptions)) return null;
  return {
    exe: String(d.strShortcutExe ?? ""),
    args: String(d.strShortcutLaunchOptions ?? ""),
    dir: String(d.strShortcutStartDir ?? ""),
  };
}

// Steam's details for the app: from appDetailsStore when the library page has
// loaded them (it has, by the time the game page shows), otherwise by asking
// SteamClient for them, for at most `waitMs`. null when neither answers.
export function getShortcutLaunch(appid: number, waitMs = 1500): Promise<ShortcutLaunch | null> {
  const w = window as unknown as {
    appDetailsStore?: { GetAppDetails?: (id: number) => ShortcutDetails | null };
    SteamClient?: {
      Apps?: {
        RegisterForAppDetails?: (
          id: number,
          cb: (d: ShortcutDetails) => void
        ) => { unregister?: () => void } | undefined;
      };
    };
  };
  try {
    const known = launchFrom(w.appDetailsStore?.GetAppDetails?.(appid));
    if (known) return Promise.resolve(known);
  } catch {
    /* store not reachable in this realm: ask SteamClient below */
  }
  const register = w.SteamClient?.Apps?.RegisterForAppDetails;
  if (typeof register !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let handle: { unregister?: () => void } | undefined;
    const finish = (v: ShortcutLaunch | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        handle?.unregister?.();
      } catch {
        /* already gone */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), waitMs);
    try {
      handle = register(appid, (d) => {
        const v = launchFrom(d);
        if (v) finish(v);
      });
    } catch {
      finish(null);
    }
    // The callback can fire inside register(), before `handle` was set.
    if (done) {
      try {
        handle?.unregister?.();
      } catch {
        /* already gone */
      }
    }
  });
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
