#!/usr/bin/env python3
"""Fail the build when the version numbers disagree.

This repo has been bitten twice by version drift that CI happily went green on:

  * 4b1adc2 / 1271d5d shipped `package.json` 0.19.0 next to `plugin.json` 0.18.0.
    Decky reads plugin.json, so the plugin would have DISPLAYED the wrong
    version while its own updater compared the other one.
  * Two feature lines independently claimed 0.19.0, which forced a renumber.

So: one job, no network, runs right after checkout, and says exactly which file
disagrees with which.

Run locally with no arguments; CI additionally passes the pushed ref so a tag can
be checked against the tree it points at.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def read_json(name):
    with open(os.path.join(ROOT, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    errors = []

    pkg = read_json("package.json").get("version", "")
    plug = read_json("plugin.json").get("version", "")

    if pkg != plug:
        errors.append(
            f"package.json says {pkg!r} but plugin.json says {plug!r}.\n"
            f"    plugin.json is what Decky displays; package.json is what the "
            f"in-plugin updater compares. They must match."
        )
    if not SEMVER.match(pkg):
        errors.append(f"package.json version {pkg!r} is not a bare X.Y.Z.")

    # The release job slices release notes out of CHANGELOG.md with an EXACT
    # `^## v<version>\n` match, while main.py's patch-notes modal tolerates
    # trailing whitespace. A heading with a stray space therefore ships empty
    # release notes while looking fine in the plugin — so require the exact form.
    with open(os.path.join(ROOT, "CHANGELOG.md"), "r", encoding="utf-8") as fh:
        changelog = fh.read()
    section = re.search(
        rf"^## v{re.escape(pkg)}$\n(.*?)(?=^## |\Z)", changelog, re.S | re.M
    )
    if not section:
        loose = re.search(rf"^## v{re.escape(pkg)}\s*$", changelog, re.M)
        errors.append(
            f"CHANGELOG.md has no exact '## v{pkg}' heading."
            + (
                "\n    A heading for that version exists but has trailing "
                "whitespace, which silently empties the release notes."
                if loose
                else ""
            )
        )
    elif not section.group(1).strip():
        errors.append(f"CHANGELOG.md section '## v{pkg}' is empty.")

    # On a tag push, the tag must describe the tree it points at. `v0.19.0` and
    # `v0.19.0-beta` both map to 0.19.0 — a beta carries the version it becomes.
    ref_type = os.environ.get("GITHUB_REF_TYPE", "")
    ref_name = os.environ.get("GITHUB_REF_NAME", "")
    if ref_type == "tag" and ref_name:
        tag_version = re.sub(r"-.*$", "", ref_name.lstrip("v"))
        if tag_version != pkg:
            errors.append(
                f"tag {ref_name!r} implies version {tag_version!r}, but the tree "
                f"says {pkg!r}. Tag the commit that carries the version."
            )

    if errors:
        print("Version consistency check FAILED:\n", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"Version consistency OK: {pkg} (package.json == plugin.json, "
          f"CHANGELOG section present"
          + (f", tag {ref_name} matches" if ref_type == "tag" else "") + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
