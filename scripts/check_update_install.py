"""The in-plugin updater must install only EnhancedGV's own, checksummed releases.

Quick Access can now install any published release (the newest for the user's
channel, or an older or beta one they pick) through Decky Loader's installer.
Decky runs as root and unzips the package into its plugins folder, so this is
the most dangerous thing the plugin does. This gate checks, offline:

  * only release tags of this repository are accepted, from 0.20.0 up;
  * nothing is fetched unless TLS verification works on the device;
  * the zip URL must be exactly this repository's asset for that tag, and a
    redirect may lead only into GitHub's asset storage, over https;
  * the download must match the SHA-256 GitHub recorded, must be an EnhancedGV
    package of that version, and must keep every path inside one EnhancedGV/
    folder;
  * a refused download leaves nothing staged; an accepted one is staged once,
    with the same hash handed on for Decky to check again;
  * the install type tells Decky whether it is an update, a reinstall or a
    downgrade, and the frontend passes Decky's arguments in Decky's order.

With --live, it also stages the newest stable release from GitHub through the
real code path, in a temporary folder that is deleted afterwards.
"""
import asyncio, hashlib, importlib.util, io, json, logging, os, re, shutil, sys, tempfile, types
import urllib.request, zipfile

LIVE = "--live" in sys.argv
ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-update-")
PLUGIN_DIR = os.path.join(TMP, "plugin")
stub = types.ModuleType("decky")
for name, sub in (("DECKY_PLUGIN_SETTINGS_DIR", "settings"), ("DECKY_PLUGIN_RUNTIME_DIR", "data"),
                  ("DECKY_PLUGIN_LOG_DIR", "logs")):
    path = os.path.join(TMP, sub); os.makedirs(path, exist_ok=True); setattr(stub, name, path)
os.makedirs(PLUGIN_DIR, exist_ok=True)
INSTALLED = "0.21.0-beta.1"
with open(os.path.join(PLUGIN_DIR, "package.json"), "w", encoding="utf-8") as fh:
    json.dump({"version": INSTALLED}, fh)
stub.DECKY_PLUGIN_DIR = PLUGIN_DIR
stub.logger = logging.getLogger("decky-update-gate")
stub.logger.addHandler(logging.NullHandler())
async def _emit(event, *args):
    return None
stub.emit = _emit
sys.modules["decky"] = stub

spec = importlib.util.spec_from_file_location("egv_main", os.path.join(ROOT, "main.py"))
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1; print(f"  OK   {name}")
    else:
        fail += 1; print(f"  FAIL {name} {extra}")

def run(coro):
    return asyncio.run(coro)

if LIVE:
    print("== live: stage the newest stable release from GitHub ==")
    plugin = main.Plugin()
    latest = run(plugin.check_update(False))
    tag = latest.get("tag", "")
    check("GitHub reports a latest release", latest.get("ok") and bool(tag), latest.get("error"))
    check("and it is installable", bool(latest.get("installable")))
    res = run(plugin.prepare_update(tag))
    check(f"{tag} downloads, matches GitHub's checksum and passes the package checks",
          res.get("ok"), res.get("error"))
    if res.get("ok"):
        staged = res["artifact"][len("file://"):]
        check("the staged file is what the hash says",
              hashlib.sha256(open(staged, "rb").read()).hexdigest() == res["hash"])
    shutil.rmtree(TMP, ignore_errors=True)
    print(f"\n{ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

# --------------------------------------------------------------------------- #
# Synthetic releases
# --------------------------------------------------------------------------- #
def make_zip(version="0.21.0-beta.2", name="EnhancedGV", files=None, folder="EnhancedGV"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        entries = files if files is not None else {
            f"{folder}/plugin.json": json.dumps({"name": name, "version": version}),
            f"{folder}/main.py": "# backend\n",
            f"{folder}/dist/index.js": "// frontend\n",
            f"{folder}/package.json": json.dumps({"version": version}),
        }
        for path, body in entries.items():
            zf.writestr(path, body)
    return buf.getvalue()

def release(tag, data, *, prerelease=None, url=None, digest=None, draft=False, assets=True):
    asset = {
        "name": "EnhancedGV.zip", "state": "uploaded", "size": len(data),
        "browser_download_url": url if url is not None else
            f"https://github.com/Featherwolf/EnhancedGV/releases/download/{tag}/EnhancedGV.zip",
        "digest": digest if digest is not None else "sha256:" + hashlib.sha256(data).hexdigest(),
    }
    return {"tag_name": tag, "draft": draft,
            "prerelease": ("-" in tag) if prerelease is None else prerelease,
            "html_url": f"https://github.com/Featherwolf/EnhancedGV/releases/tag/{tag}",
            "published_at": "2026-11-23T02:01:09Z", "body": "notes",
            "assets": [asset] if assets else []}

GOOD = make_zip()
RELEASES = {}          # tag -> release JSON
DOWNLOADS = {}         # url -> (bytes, final url)
asked = []             # every URL requested, API and download alike

def fake_get_json(url, headers=None):
    asked.append(("api", url))
    if url.startswith(f"{main.RELEASES_API}?per_page="):
        return list(RELEASES.values())
    prefix = f"{main.RELEASES_API}/tags/"
    if url.startswith(prefix) and url[len(prefix):] in RELEASES:
        return RELEASES[url[len(prefix):]]
    if url == f"{main.RELEASES_API}/latest":
        stable = [r for r in RELEASES.values() if not r["prerelease"]]
        return max(stable, key=lambda r: main.Plugin._ver_tuple(r["tag_name"]))
    raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

class FakeResp:
    def __init__(self, data, final):
        self.data, self.final = data, final
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def geturl(self):
        return self.final
    def read(self, n=-1):
        return self.data if n < 0 else self.data[:n]

class FakeOpener:
    def open(self, req, timeout=None):
        url = req.full_url
        asked.append(("download", url, dict(req.header_items())))
        data, final = DOWNLOADS[url]
        return FakeResp(data, final)

import urllib.error
main._http_get_json = fake_get_json
main._RELEASE_OPENER = FakeOpener()

def publish(tag, data, final=None, **kw):
    rel = release(tag, data, **kw)
    RELEASES[tag] = rel
    url = rel["assets"][0]["browser_download_url"] if rel["assets"] else ""
    DOWNLOADS[url] = (data, final or "https://objects.githubusercontent.com/github-production-release-asset/1/" + tag)
    return rel

def staged():
    try:
        return sorted(os.listdir(main.UPDATE_DIR))
    except FileNotFoundError:
        return []

BASE = {"v0.21.0-beta.1": make_zip("0.21.0-beta.1"), "v0.20.0": make_zip("0.20.0")}

def reset():
    """Republish the good releases; a case may have overwritten one."""
    publish("v0.21.0-beta.2", GOOD)
    for tag, data in BASE.items():
        publish(tag, data)

reset()
publish("v0.19.2", make_zip("0.19.2"))
publish("v0.22.0-nightly.1", make_zip("0.22.0-nightly.1"))   # not a tag shape this repo uses
publish("nightly", make_zip("nightly"))
RELEASES["v0.23.0"] = release("v0.23.0", make_zip("0.23.0"), draft=True)
RELEASES["v0.20.1"] = release("v0.20.1", make_zip("0.20.1"), digest="")  # no checksum recorded

plugin = main.Plugin()

print("== which releases are offered ==")
lst = run(plugin.list_releases())
tags = [r["tag"] for r in lst["releases"]]
check("listed newest first, stable and beta alike",
      tags == ["v0.21.0-beta.2", "v0.21.0-beta.1", "v0.20.1", "v0.20.0"], tags)
check("builds before 0.20.0 are not offered", "v0.19.2" not in tags)
check("drafts and odd tags are not offered", not {"v0.23.0", "nightly", "v0.22.0-nightly.1"} & set(tags))
by = {r["tag"]: r for r in lst["releases"]}
check("the installed build is marked", by["v0.21.0-beta.1"]["installed"] and not by["v0.20.0"]["installed"])
check("newer and older are told apart", by["v0.21.0-beta.2"]["newer"] and not by["v0.20.0"]["newer"])
check("builds without the installer are flagged as manual from there",
      by["v0.21.0-beta.2"]["self_update"] and not by["v0.20.0"]["self_update"])
check("a release without a recorded checksum is listed but not installable",
      by["v0.20.1"]["installable"] is False and by["v0.20.0"]["installable"] is True)
upd = run(plugin.check_update(True))
check("the beta channel offers the newest tag it can install, not an odd one",
      upd.get("tag") == "v0.21.0-beta.2" and upd.get("installable"), upd)

print("== tags that are refused before anything is fetched ==")
for bad in ("", "main", "0.21.0", "v1.2", "v0.21.0-beta.2/../x", "v0.21.0-nightly.1",
            "v0.21.0-beta.2 x", "v0.21.0-beta.2?x", "v0.21.0-beta.2#x", "../v0.21.0"):
    asked.clear()
    res = run(plugin.prepare_update(bad))
    check(f"refuses {bad!r}", not res.get("ok") and not asked, (res, asked))
asked.clear()
res = run(plugin.prepare_update("v0.19.2"))
check("refuses a build older than 0.20.0", not res.get("ok") and not asked, res)

print("== nothing is fetched without TLS verification ==")
real_verifies = main._ssl_verifies
main._ssl_verifies = lambda *a, **k: False
asked.clear()
res = run(plugin.prepare_update("v0.21.0-beta.2"))
check("refused", not res.get("ok"), res)
check("and no request was made", not asked, asked)
main._ssl_verifies = real_verifies

print("== the asset must be this repository's, for this tag, with a checksum ==")
for label, kw in (
    ("another repository", {"url": "https://github.com/someone/EnhancedGV/releases/download/v0.21.0-beta.2/EnhancedGV.zip"}),
    ("another tag", {"url": "https://github.com/Featherwolf/EnhancedGV/releases/download/v0.20.0/EnhancedGV.zip"}),
    ("plain http", {"url": "http://github.com/Featherwolf/EnhancedGV/releases/download/v0.21.0-beta.2/EnhancedGV.zip"}),
    ("another host", {"url": "https://evil.example/Featherwolf/EnhancedGV/releases/download/v0.21.0-beta.2/EnhancedGV.zip"}),
    ("no checksum", {"digest": ""}),
    ("a malformed checksum", {"digest": "sha256:XYZ"}),
    ("a non-SHA-256 checksum", {"digest": "md5:" + "0" * 32}),
    ("no asset at all", {"assets": False}),
):
    publish("v0.21.0-beta.2", GOOD, **kw)
    asked.clear()
    res = run(plugin.prepare_update("v0.21.0-beta.2"))
    downloads = [a for a in asked if a[0] == "download"]
    check(f"refuses {label}, downloading nothing", not res.get("ok") and not downloads, (res, downloads))
reset()

print("== the download must be the file GitHub recorded ==")
run(plugin.prepare_update("v0.20.0"))   # something staged, which a refusal must drop
check("(a good release was staged first)", staged() == ["EnhancedGV-0.20.0.zip"], staged())
DOWNLOADS[f"{main.RELEASE_DOWNLOAD_PREFIX}v0.21.0-beta.2/EnhancedGV.zip"] = (make_zip(files={"EnhancedGV/plugin.json": "{}"}), "https://objects.githubusercontent.com/x")
res = run(plugin.prepare_update("v0.21.0-beta.2"))
check("a checksum mismatch is refused", not res.get("ok") and "checksum" in res.get("error", ""), res)
check("and nothing is staged", staged() == [], staged())
publish("v0.21.0-beta.2", GOOD, final="https://evil.example/EnhancedGV.zip")
res = run(plugin.prepare_update("v0.21.0-beta.2"))
check("a download that ended off GitHub is refused", not res.get("ok"), res)
big = b"PK" + b"\0" * (main.RELEASE_ZIP_MAX_BYTES + 10)
publish("v0.21.0-beta.2", GOOD)
DOWNLOADS[f"{main.RELEASE_DOWNLOAD_PREFIX}v0.21.0-beta.2/EnhancedGV.zip"] = (big, "https://objects.githubusercontent.com/x")
RELEASES["v0.21.0-beta.2"]["assets"][0]["size"] = 1000
res = run(plugin.prepare_update("v0.21.0-beta.2"))
check("an oversized download is refused", not res.get("ok"), res)
check("and nothing is staged", staged() == [], staged())

print("== the package must be EnhancedGV, of that version, inside one folder ==")
cases = {
    "not a zip": b"this is not a zip file",
    "a file outside the folder": make_zip(files={"EnhancedGV/plugin.json": json.dumps({"name": "EnhancedGV", "version": "0.21.0-beta.2"}),
                                                  "EnhancedGV/main.py": "", "EnhancedGV/dist/index.js": "", "other/evil.py": ""}),
    "a path climbing out": make_zip(files={"EnhancedGV/plugin.json": json.dumps({"name": "EnhancedGV", "version": "0.21.0-beta.2"}),
                                            "EnhancedGV/main.py": "", "EnhancedGV/dist/index.js": "", "EnhancedGV/../../evil.py": ""}),
    "a backslash path": make_zip(files={"EnhancedGV/plugin.json": json.dumps({"name": "EnhancedGV", "version": "0.21.0-beta.2"}),
                                         "EnhancedGV/main.py": "", "EnhancedGV/dist/index.js": "", "EnhancedGV\\..\\evil.py": ""}),
    "another plugin's folder": make_zip(folder="SomethingElse"),
    "another plugin's name": make_zip(name="SomethingElse"),
    "a different version inside": make_zip(version="0.20.0"),
    "no backend": make_zip(files={"EnhancedGV/plugin.json": json.dumps({"name": "EnhancedGV", "version": "0.21.0-beta.2"}),
                                   "EnhancedGV/dist/index.js": ""}),
    "an unreadable plugin.json": make_zip(files={"EnhancedGV/plugin.json": "{not json", "EnhancedGV/main.py": "",
                                                  "EnhancedGV/dist/index.js": ""}),
}
for label, data in cases.items():
    publish("v0.21.0-beta.2", data)   # its own checksum, so only the package check can refuse it
    res = run(plugin.prepare_update("v0.21.0-beta.2"))
    check(f"refuses {label}", not res.get("ok") and staged() == [], (res, staged()))

print("== a good release is staged once, for Decky to check again ==")
reset()
asked.clear()
res = run(plugin.prepare_update("v0.21.0-beta.2"))
check("accepted", res.get("ok"), res)
check("asked the API for exactly that tag",
      ("api", f"{main.RELEASES_API}/tags/v0.21.0-beta.2") in asked, asked)
dl = [a for a in asked if a[0] == "download"]
check("downloaded exactly the pinned URL",
      [a[1] for a in dl] == [f"{main.RELEASE_DOWNLOAD_PREFIX}v0.21.0-beta.2/EnhancedGV.zip"], dl)
check("sent no credentials with it", dl and not any(k.lower() in ("authorization", "x-client-api-key") for k in dl[0][2]), dl)
path = res.get("artifact", "")[len("file://"):]
check("the artifact is a file:// path in the update folder",
      res.get("artifact", "").startswith("file://") and os.path.dirname(path) == main.UPDATE_DIR, res.get("artifact"))
check("the staged bytes are the download", open(path, "rb").read() == GOOD)
check("the hash handed to Decky is GitHub's", res.get("hash") == hashlib.sha256(GOOD).hexdigest())
check("named EnhancedGV, version from the tag",
      res.get("name") == "EnhancedGV" and res.get("version") == "0.21.0-beta.2", res)
check("a newer build is an update for Decky", res.get("install_type") == 2, res.get("install_type"))
res2 = run(plugin.prepare_update("v0.20.0"))
check("an older build is a downgrade", res2.get("install_type") == 3, res2.get("install_type"))
check("only the newest preparation stays staged", staged() == ["EnhancedGV-0.20.0.zip"], staged())
res3 = run(plugin.prepare_update("v0.21.0-beta.1"))
check("the installed build is a reinstall", res3.get("install_type") == 1, res3.get("install_type"))
run(plugin._main())
check("starting the plugin clears anything staged", staged() == [], staged())

print("== a release download may be redirected only into GitHub's storage ==")
handler = main._ReleaseRedirect()
req = urllib.request.Request(f"{main.RELEASE_DOWNLOAD_PREFIX}v0.21.0-beta.2/EnhancedGV.zip")
def follows(url):
    try:
        return handler.redirect_request(req, None, 302, "Found", {}, url) is not None
    except ValueError:
        return False
check("to objects.githubusercontent.com", follows("https://objects.githubusercontent.com/github-production-release-asset/1/a"))
check("to release-assets.githubusercontent.com", follows("https://release-assets.githubusercontent.com/github-production-release-asset/1/a"))
for bad in ("https://evil.example/EnhancedGV.zip", "http://objects.githubusercontent.com/a",
            "https://objects.githubusercontent.com:8443/a", "https://user@objects.githubusercontent.com/a",
            "https://evil.example\\@objects.githubusercontent.com/a", "file:///etc/passwd",
            "https://objects.githubusercontent.com.evil.example/a"):
    check(f"not to {bad!r}", not follows(bad))

print("== the frontend hands Decky only what the backend prepared ==")
upd_src = open(os.path.join(ROOT, "src", "updater.ts"), encoding="utf-8").read()
m = re.search(r'call\(\s*"utilities/install_plugin",\s*([^)]*)\)', upd_src, re.S)
args = [a.strip() for a in m.group(1).split(",") if a.strip()] if m else []
check("Decky's arguments in Decky's order (artifact, name, version, hash, install_type)",
      args == ["prep.artifact", "prep.name", "prep.version", "prep.hash", "prep.install_type"], args)
check("the frontend builds no download URL of its own", "https://" not in upd_src)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL - the updater could install something that isn't a checked EnhancedGV release.")
    sys.exit(1)
print("PASS - only EnhancedGV's own checksummed releases can be installed.")
