import type { ReleaseInfo } from "./types";

/**
 * The releases "Install another version" shows before "Show more versions":
 * the installed one, the one before it, the newest stable, and the newest beta
 * while it is ahead of that stable. `releases` comes newest first.
 *
 * "The one before" is the next older stable for a stable install, so stepping
 * back from 0.22.0 lands on 0.21.0 rather than on a beta of a version that
 * never shipped; a beta install steps back to whatever came just before it.
 * When the installed build isn't in the list (a local build, or one too old to
 * be offered), the newest release older than it stands in.
 */
export function releaseShortList(releases: ReleaseInfo[]): Set<string> {
  const keep = new Set<string>();
  const stable = releases.findIndex((r) => !r.prerelease);
  if (stable >= 0) keep.add(releases[stable].tag);
  const beta = releases.findIndex((r) => r.prerelease);
  if (beta >= 0 && (stable < 0 || beta < stable)) keep.add(releases[beta].tag);
  const at = releases.findIndex((r) => r.installed);
  if (at >= 0) {
    const installed = releases[at];
    keep.add(installed.tag);
    const before = releases.slice(at + 1).find((r) => installed.prerelease || !r.prerelease);
    if (before) keep.add(before.tag);
  } else {
    const before = releases.find((r) => !r.newer);
    if (before) keep.add(before.tag);
  }
  return keep;
}
