"""A saved IGDB credential must survive the plugin's whole lifecycle.

Decky implements an UPDATE as uninstall-then-install, so the plugin's
`_uninstall` hook fires on every upgrade, and the loader re-creates the settings
directory on every load. What keeps a user's Twitch client id and secret across
an update, a reinstall and an uninstall is therefore simply where they are
stored and the fact that nothing in this plugin deletes them unasked.

Both halves of that have already broken once:

  * The secret was erased by any ordinary settings save, because get_settings
    redacts it and the frontend writes back what it was handed (fixed in
    4001719 by treating an absent secret as "leave it alone").
  * The client id was erased the same way, by a different route: the Quick
    Access panel loads its settings object once at mount and every toggle
    spreads that copy, so the first toggle after a first-time save wrote the
    empty id the panel started with. The secret survived and the id did not,
    which silently de-configured IGDB and hid the Remove button.

So this gate asserts the contract end to end: storage location, the keep-rules
on both halves, the lifecycle hooks, and that erasing still works when asked.
Stdlib only, no network, no build — it runs in seconds, before npm install.
"""
import asyncio, importlib.util, json, logging, os, shutil, sys, tempfile, types

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-creds-")

# Stand in for decky-loader's injected module. The real one hands the plugin the
# directories the loader created; DECKY_PLUGIN_DIR is the repo so the plugin can
# read its own package.json and CHANGELOG.md.
stub = types.ModuleType("decky")
stub.DECKY_PLUGIN_SETTINGS_DIR = os.path.join(TMP, "settings")
stub.DECKY_PLUGIN_RUNTIME_DIR = os.path.join(TMP, "data")
stub.DECKY_PLUGIN_LOG_DIR = os.path.join(TMP, "logs")
stub.DECKY_PLUGIN_DIR = ROOT
stub.logger = logging.getLogger("decky")
async def _emit(event, *args):  # noqa: D401 - the loader's signature
    return None
stub.emit = _emit
sys.modules["decky"] = stub
for d in (stub.DECKY_PLUGIN_SETTINGS_DIR, stub.DECKY_PLUGIN_RUNTIME_DIR, stub.DECKY_PLUGIN_LOG_DIR):
    os.makedirs(d, exist_ok=True)

spec = importlib.util.spec_from_file_location("egv_main", os.path.join(ROOT, "main.py"))
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  OK   {name}")
    else:
        fail += 1
        print(f"  FAIL {name} {extra}")

run = asyncio.run
P = main.Plugin()
CID, SECRET = "cid-12345", "twitch-secret-abcdef0123456789"

print("== the credential files live where Decky does not delete them ==")
# ~/homebrew/settings/<folder> survives uninstall; ~/homebrew/data/<folder> is
# emptied by this plugin's own cache purge on a CACHE_VERSION bump.
for label, path in (("settings.json", main.SETTINGS_FILE),
                    ("igdb_token.json", main.IGDB_TOKEN_FILE),
                    ("matches.json", main.MATCHES_FILE)):
    check(f"{label} is under SETTINGS_DIR",
          os.path.abspath(path).startswith(os.path.abspath(main.SETTINGS_DIR) + os.sep), path)
    check(f"{label} is NOT under CACHE_DIR",
          not os.path.abspath(path).startswith(os.path.abspath(main.CACHE_DIR) + os.sep), path)

print("== a saved pair is stored, and the secret never leaves over RPC ==")
run(P.set_settings({"igdbClientId": CID, "igdbClientSecret": SECRET, "nonSteamSources": True}))
check("both halves stored", main._igdb_creds() == (CID, SECRET), main._igdb_creds())
check("IGDB reports configured", main._igdb_configured() is True)
got = run(P.get_settings())
check("get_settings omits the secret", "igdbClientSecret" not in got)
check("get_settings reports it is set", got.get("igdbClientSecretSet") is True)
check("get_settings still returns the id", got.get("igdbClientId") == CID)

print("== an ordinary settings save never erases either half ==")
# Three shapes the frontend really sends. Each one must be a no-op for the pair.
CASES = {
    "redacted get_settings round-trip": dict(got, nonSteamSources=False),
    "stale panel state with an empty id": {"igdbClientId": "", "nonSteamSources": True},
    "a DEFAULTS-shaped payload with no credential keys at all": {"beta": True, "nonSteamSources": True},
}
for label, payload in CASES.items():
    with open(main.IGDB_TOKEN_FILE, "w", encoding="utf-8") as fh:
        json.dump({"client_id": CID, "access_token": "tok", "expires_at": 9e9}, fh)
    run(P.set_settings(payload))
    check(f"pair survives: {label}", main._igdb_creds() == (CID, SECRET), main._igdb_creds())
    check(f"cached token survives: {label}", os.path.exists(main.IGDB_TOKEN_FILE))

print("== the lifecycle Decky runs on every update leaves the file alone ==")
before = open(main.SETTINGS_FILE, "rb").read()
run(P._unload())
run(P._uninstall())          # Decky calls this on UPDATES too, not just removal
main.CACHE_VERSION = main.CACHE_VERSION + "-bumped"
run(P._main())               # the new version starts and purges its cache
check("settings.json is byte-identical after unload/uninstall/restart",
      open(main.SETTINGS_FILE, "rb").read() == before)
check("the pair is still readable", main._igdb_creds() == (CID, SECRET))

print("== but an explicit change, or Remove credentials, still works ==")
run(P.set_settings({"igdbClientId": "other-id", "igdbClientSecret": "other-secret"}))
check("a non-empty pair replaces the old one",
      main._igdb_creds() == ("other-id", "other-secret"), main._igdb_creds())
run(P.set_settings({"igdbClientId": CID, "igdbClientSecret": SECRET}))
res = run(P.clear_igdb_credentials())
check("clear_igdb_credentials reports ok", res.get("ok") is True, res)
check("clear_igdb_credentials blanks BOTH halves", main._igdb_creds() == ("", ""), main._igdb_creds())
check("clear_igdb_credentials drops the token", not os.path.exists(main.IGDB_TOKEN_FILE))

if os.name == "posix":
    print("== and the file the secret sits in stays owner-only ==")
    run(P.set_settings({"igdbClientId": CID, "igdbClientSecret": SECRET}))
    check("settings.json is 0600", oct(os.stat(main.SETTINGS_FILE).st_mode & 0o777) == "0o600",
          oct(os.stat(main.SETTINGS_FILE).st_mode & 0o777))
    check("the settings directory is 0700",
          oct(os.stat(main.SETTINGS_DIR).st_mode & 0o777) == "0o700",
          oct(os.stat(main.SETTINGS_DIR).st_mode & 0o777))

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL — a stored IGDB credential would not survive the plugin lifecycle.")
    sys.exit(1)
print("PASS — stored credentials survive update, reinstall and uninstall.")
