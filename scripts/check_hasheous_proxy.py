"""EnhancedGV's Hasheous app key must unlock IGDB artwork, and go nowhere else.

Release builds carry an application key for Hasheous (written into the package
by CI from a repository secret, never committed). It unlocks Hasheous' IGDB
proxy, so non-Steam games get IGDB covers, screenshots and genres without the
user setting up IGDB credentials. This gate checks, offline:

  * the key is read from the package, and anything that doesn't look like one
    is ignored;
  * it is sent only to hasheous.org, only in the X-Client-API-Key header, over
    verified TLS, through the opener that refuses redirects;
  * it never reaches a log line, the settings the panel receives, or the cache;
  * the proxy's reply shape ({"<id>": {...}} lists, ISO dates, companies as bare
    ids) parses into the same artwork and details IGDB's own API gives;
  * the user's own IGDB credentials win when saved, and with neither, nothing
    is requested at all.

With --live and HASHEOUS_CLIENT_API_KEY set (CI passes the secret to a separate,
non-blocking step), it also asks the real proxy for a known game and prints the
reply's shape, never the key. Without the variable, --live skips.
"""
import asyncio, importlib.util, io, json, logging, os, sys, tempfile, types, urllib.error, urllib.parse

LIVE = "--live" in sys.argv
LIVE_KEY = os.environ.get("HASHEOUS_CLIENT_API_KEY", "").strip()
if LIVE and not LIVE_KEY:
    print("SKIP - no HASHEOUS_CLIENT_API_KEY in this run (fork PR or secret not set).")
    sys.exit(0)

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-hasheous-")
PLUGIN_DIR = os.path.join(TMP, "plugin")   # never the repo: the key file goes here
stub = types.ModuleType("decky")
for name, sub in (("DECKY_PLUGIN_SETTINGS_DIR", "settings"), ("DECKY_PLUGIN_RUNTIME_DIR", "data"),
                  ("DECKY_PLUGIN_LOG_DIR", "logs")):
    path = os.path.join(TMP, sub); os.makedirs(path, exist_ok=True); setattr(stub, name, path)
os.makedirs(PLUGIN_DIR, exist_ok=True)
stub.DECKY_PLUGIN_DIR = PLUGIN_DIR
LOG = io.StringIO()
stub.logger = logging.getLogger("decky-hasheous-gate")
stub.logger.addHandler(logging.StreamHandler(LOG))
stub.logger.setLevel(logging.DEBUG)
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

def put_key(value):
    if value is None:
        if os.path.exists(main.HASHEOUS_KEY_FILE):
            os.remove(main.HASHEOUS_KEY_FILE)
        return
    with open(main.HASHEOUS_KEY_FILE, "w", encoding="utf-8") as fh:
        fh.write(value)

def run(coro):
    return asyncio.run(coro)

if LIVE:
    print("== live: Hasheous' IGDB proxy with the real app key ==")
    put_key(LIVE_KEY)
    check("the key in this run is accepted as a key", main._hasheous_app_key() == LIVE_KEY)
    try:
        raw = main._hasheous_proxy_get_sync(
            "Game", {"Id": 1103, "expandColumns": main.HASHEOUS_IGDB_EXPAND}, LIVE_KEY)
    except urllib.error.HTTPError as exc:
        raw = None
        check("the proxy answers", False, f"HTTP {exc.code}")
    if isinstance(raw, dict):
        check("the proxy answers with a game", True)
        print("     reply keys and types (values not shown):")
        for k in sorted(raw):
            v = raw[k]
            inner = ""
            if isinstance(v, dict) and v:
                first = next(iter(v.values()))
                inner = (f" keyed by {list(v)[:2]}..., items {sorted(first)[:6]}"
                         if isinstance(first, dict) else f" keys {sorted(v)[:6]}")
            print(f"       {k}: {type(v).__name__}{inner}")
    async def _no_creds(self):
        return (None, None)
    main.Plugin._igdb_ready = _no_creds   # the app-key path, not a user's own credentials
    delta = run(main.Plugin()._igdb_delta(1103))
    check("Super Metroid gets a name", bool(delta.get("name")), delta.get("name"))
    check("and a cover", str(delta.get("header_image", "")).startswith("https://images.igdb.com/"),
          delta.get("header_image"))
    check("and screenshots", len(delta.get("screenshots") or []) > 0, len(delta.get("screenshots") or []))
    check("and genres", len(delta.get("genres") or []) > 0, delta.get("genres"))
    check("and a developer or publisher", bool(delta.get("developers") or delta.get("publishers")),
          (delta.get("developers"), delta.get("publishers")))
    check("and a release date", bool(delta.get("release_date")), delta.get("release_date"))
    check("the key is in no log line", LIVE_KEY not in LOG.getvalue())
    print(f"\n{ok} passed, {fail} failed")
    sys.exit(1 if fail else 0)

KEY = "egv-test-key-0123456789abcdef"

print("== the key is read from the package, and only if it looks like one ==")
put_key(None)
check("no file: no key", main._hasheous_app_key() == "")
put_key(KEY + "\n")
check("a key file is read (trailing newline ignored)", main._hasheous_app_key() == KEY)
for bad in ("short", "has a space in it", "line1\nline2-0123456789", "x" * 600):
    put_key(bad)
    check(f"rejected: {bad[:20]!r}", main._hasheous_app_key() == "")
put_key(KEY)

# A fake network: what each proxy endpoint answers, plus a record of every
# request as it would leave the device.
GAME = {
    "id": 1103, "name": "Super Metroid", "summary": "Samus returns to Zebes.",
    "url": "https://www.igdb.com/games/super-metroid",
    "first_release_date": "1994-03-19T00:00:00+00:00",
    "cover": {"id": 77, "image_id": "co1abc"},
    "screenshots": {"11": {"id": 11, "image_id": "sc1"}, "12": {"id": 12, "image_id": "sc2"}},
    "artworks": {"21": {"id": 21, "image_id": "ar1"}},
    "genres": {"8": {"id": 8, "name": "Platform"}, "31": {"id": 31, "name": "Adventure"}},
    "platforms": {"19": {"id": 19, "name": "Super Nintendo Entertainment System"}},
    "involved_companies": {"501": {"id": 501, "company": 70, "developer": True, "publisher": False},
                           "502": {"id": 502, "company": 71, "developer": False, "publisher": True},
                           "503": {"id": 503, "company": 72, "developer": False, "publisher": False}},
}
COMPANIES = {70: {"id": 70, "name": "Nintendo R&D1"}, 71: {"id": 71, "name": "Nintendo"}}
sent = []
class Reply(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
def fake_open(req, timeout=None):
    sent.append(req)
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(req.full_url).query))
    if req.full_url.startswith(main.HASHEOUS_PROXY_IGDB + "/Game?"):
        return Reply(json.dumps(GAME).encode())
    if req.full_url.startswith(main.HASHEOUS_PROXY_IGDB + "/Company?"):
        return Reply(json.dumps(COMPANIES.get(int(q.get("Id", 0)), {})).encode())
    raise AssertionError(f"unexpected request {req.full_url}")
main._IGDB_OPENER.open = fake_open
main._read_cache_entry = lambda kind, key: (None, False)
writes = []
main._write_cache = lambda kind, key, data, negative=False: writes.append((kind, key, data))
async def no_creds(self):
    return (None, None)
main.Plugin._igdb_ready = no_creds
P = main.Plugin()

print("== without IGDB credentials, the app key brings IGDB's artwork ==")
delta = run(P._igdb_delta(1103))
check("cover from the expanded cover object",
      delta.get("header_image") == main._igdb_img("co1abc", main.IGDB_SIZE_COVER), delta.get("header_image"))
check("screenshots from the {id: {...}} map, artworks after",
      [s["thumb"].rsplit("/", 1)[-1] for s in delta.get("screenshots", [])] == ["sc1.jpg", "sc2.jpg", "ar1.jpg"],
      delta.get("screenshots"))
check("genres by name", [g["description"] for g in delta.get("genres", [])] == ["Platform", "Adventure"],
      delta.get("genres"))
check("developer and publisher named by follow-up lookups",
      (delta.get("developers"), delta.get("publishers")) == (["Nintendo R&D1"], ["Nintendo"]),
      (delta.get("developers"), delta.get("publishers")))
check("an uncredited company costs no lookup",
      not any("Id=72" in r.full_url for r in sent), [r.full_url for r in sent])
check("name carried for IGDB-matched panels", delta.get("name") == "Super Metroid", delta.get("name"))
check("ISO release date read as a date", delta.get("release_date") == "19 Mar, 1994", delta.get("release_date"))
check("platform carried", (delta.get("categories") or [{}])[0].get("description")
      == "Super Nintendo Entertainment System", delta.get("categories"))

print("== the key goes only to hasheous.org, in its header, never redirected ==")
check("requests were made", len(sent) == 3, len(sent))
for r in sent:
    parts = urllib.parse.urlsplit(r.full_url)
    check(f"{parts.path} is https://hasheous.org", (parts.scheme, parts.hostname) == ("https", "hasheous.org"))
    check("key in the X-Client-API-Key header", r.get_header("X-client-api-key") == KEY, r.header_items())
    check("key not in the URL", KEY not in r.full_url)
check("the opener refuses redirects",
      any(isinstance(h, main._NoRedirect) for h in main._IGDB_OPENER.handlers))
real_verify = main._ssl_verifies
main._ssl_verifies = lambda ctx=None: False
before = len(sent)
try:
    main._hasheous_proxy_get_sync("Game", {"Id": 1}, KEY)
    check("without TLS verification the key is not sent", False)
except RuntimeError:
    check("without TLS verification the key is not sent", len(sent) == before)
main._ssl_verifies = real_verify

print("== the key never reaches a log, the panel's settings or the cache ==")
def rejecting_open(req, timeout=None):
    raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", None, None)
main._IGDB_OPENER.open = rejecting_open
LOG.truncate(0)
check("a rejected key degrades to no data", run(P._igdb_delta(99)) == {})
check("the failure is logged without the key", "401" in LOG.getvalue() and KEY not in LOG.getvalue(),
      LOG.getvalue())
main._IGDB_OPENER.open = fake_open
settings = run(P.get_settings())
check("the panel is told a key exists", settings.get("hasheousAppKey") is True, settings.get("hasheousAppKey"))
check("but never the key", KEY not in json.dumps(settings))
run(P.set_settings({**settings, "hasheousAppKey": True}))
on_disk = open(main.SETTINGS_FILE, encoding="utf-8").read() if os.path.exists(main.SETTINGS_FILE) else ""
check("a report, never saved as a setting", "hasheousAppKey" not in on_disk)
check("no cache write holds the key", all(KEY not in json.dumps(d) for _k, _i, d in writes))

print("== the user's own IGDB credentials win; with neither, nothing is asked ==")
sent.clear()
async def creds(self):
    return ("cid", "tok")
async def own_game(self, igdb_id, cid, token):
    return {"id": igdb_id, "name": "From IGDB itself", "cover": {"image_id": "own"}}
main.Plugin._igdb_ready = creds
main.Plugin._igdb_game = own_game
d = run(P._igdb_delta(5))
check("saved credentials are used", d.get("name") == "From IGDB itself", d)
check("and Hasheous isn't asked", not sent, [r.full_url for r in sent])
main.Plugin._igdb_ready = no_creds
put_key(None)
check("no credentials and no key: no data", run(P._igdb_delta(6)) == {})
check("and no request", not sent, [r.full_url for r in sent])

print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL - the Hasheous app key is mishandled, or its replies don't parse.")
    sys.exit(1)
print("PASS - the app key brings IGDB artwork, and goes only where it should.")
