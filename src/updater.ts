// One-press installs through Decky Loader's own installer.
//
// Decky's store installs plugins through the backend route
// "utilities/install_plugin", reachable from any plugin as window.DeckyBackend
// (Decky Loader 3.0 and later). Decky shows its own "Update EnhancedGV to
// version X?" dialog, and nothing changes until the user confirms there. It then
// replaces the plugin and reloads it, so Steam needs no restart.
//
// The backend downloads the release first and checks it against the SHA-256
// GitHub recorded for it (see prepare_update in main.py). Decky gets that local
// file plus the same hash and checks it again. That ordering matters: Decky
// removes the installed copy BEFORE it checks a hash, so a download that only
// Decky checked could fail after the old version was already gone.
import { prepareUpdate } from "./api";
import type { PreparedUpdate } from "./types";

type DeckyBackendLike = {
  call: (route: string, ...args: unknown[]) => Promise<unknown>;
};

function deckyBackend(): DeckyBackendLike | null {
  const b = (window as unknown as { DeckyBackend?: DeckyBackendLike }).DeckyBackend;
  return b && typeof b.call === "function" ? b : null;
}

// Whether this Decky Loader can install from a plugin. Older loaders get the
// manual steps instead.
export function canInstallInPlace(): boolean {
  return deckyBackend() !== null;
}

export async function installRelease(tag: string): Promise<{ ok: boolean; error?: string }> {
  const backend = deckyBackend();
  if (!backend) {
    return { ok: false, error: "This Decky Loader can't install updates for plugins. Update Decky Loader, or install the zip by hand." };
  }
  let prep: PreparedUpdate;
  try {
    prep = await prepareUpdate(tag);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  if (!prep.ok || !prep.artifact || !prep.hash) {
    return { ok: false, error: prep.error ?? "Couldn't prepare the download." };
  }
  try {
    // Positional, matching Decky's install_plugin(artifact, name, version,
    // hash, install_type). This only opens Decky's confirmation dialog.
    await backend.call(
      "utilities/install_plugin",
      prep.artifact,
      prep.name,
      prep.version,
      prep.hash,
      prep.install_type,
    );
  } catch (e) {
    return { ok: false, error: `Decky couldn't start the install: ${String(e)}` };
  }
  return { ok: true };
}
