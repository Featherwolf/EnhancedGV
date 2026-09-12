import { Navigation } from "@decky/ui";

/**
 * Open an external URL, but only if it is plainly http(s).
 *
 * Every URL reaching these call sites comes from a third-party response. The
 * backend already filters them, but this is the last gate before the Steam
 * client acts on the string — and `steam://` is a live command channel to the
 * client, so a cache written by an older build must not be able to reach it.
 */
export function openExternal(url: unknown): void {
  const u = String(url ?? "");
  if (!/^https?:\/\/[^/\s]/i.test(u)) return;
  Navigation.NavigateToExternalWeb(u);
}
