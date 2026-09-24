"""The appdetails reply must be read by its contents, not by its key.

Around 2026-09-24 most Steam games in EnhancedGV started showing "Store content
unavailable: no store data (success=false)". Steam was answering correctly, but
it had started labelling many replies with a different, larger appid: 275850 (No
Man's Sky) came back under "3380990", one of its DLC, with the right game inside.
Across 120 sampled games, 67 were labelled this way, including every game that
lists DLC and 12 of the 65 that list none. The plugin looked the reply up under
the appid it had asked for, found nothing, and blamed Steam.

The outer key is not a contract; data.steam_appid is. These cases are synthetic,
so the gate needs no network and cannot go red because Steam is having a bad day.
Every malformed payload is also driven through get_appdetails itself, because
the first version of this gate only exercised the helper and so missed a crash
one layer up.
"""
import importlib.util, logging, os, sys, tempfile, types

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-appdetails-")
stub = types.ModuleType("decky")
stub.DECKY_PLUGIN_SETTINGS_DIR = os.path.join(TMP, "settings")
stub.DECKY_PLUGIN_RUNTIME_DIR = os.path.join(TMP, "data")
stub.DECKY_PLUGIN_LOG_DIR = os.path.join(TMP, "logs")
stub.DECKY_PLUGIN_DIR = ROOT
stub.logger = logging.getLogger("decky")
async def _emit(event, *args):
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

pick = main._appdetails_envelope
GOOD = {"success": True, "data": {"steam_appid": 275850, "name": "No Man's Sky"}}

print("== the envelope is found however Steam keys it ==")
check("keyed by the appid we asked for", pick({"275850": GOOD}, 275850) is GOOD)
check("keyed by some other appid (the live regression)",
      pick({"3380990": GOOD}, 275850) is GOOD)
check("appid passed as a string works too", pick({"3380990": GOOD}, "275850") is GOOD)
check("picked out of several entries by steam_appid",
      pick({"1": {"success": True, "data": {"steam_appid": 111, "name": "Other"}},
            "3380990": GOOD}, 275850) is GOOD)

print("== but never at the cost of showing the wrong game ==")
other = {"success": True, "data": {"steam_appid": 999, "name": "Somebody Else's Game"}}
check("a lone envelope naming a DIFFERENT app is refused",
      pick({"999": other}, 275850) is None)
check("several envelopes, none matching, are all refused",
      pick({"1": other, "2": other}, 275850) is None)

print("== genuine failures still read as failures ==")
dead = {"success": False}
check("a lone success:false envelope is returned as-is",
      pick({"1070560": dead}, 1070560) is dead)
check("a success:false envelope under an odd key is still returned",
      pick({"999": dead}, 1070560) is dead)

MALFORMED = (None, [], "", {}, {"1": None}, {"1": "not a dict"},
             {"1": {"success": True, "data": None}},
             {"1": {"success": True, "data": []}},
             {"275850": {"success": True, "data": None}},
             {"275850": {"success": True, "data": []}},
             {"1": {"success": True, "data": {"steam_appid": None}}})

print("== the picker never throws ==")
for bad in MALFORMED:
    try:
        pick(bad, 275850)
        check(f"picker survives {bad!r}", True)
    except Exception as exc:
        check(f"picker survives {bad!r}", False, f"raised {exc!r}")

print("== end to end through get_appdetails' own normalizer ==")
import asyncio
P = main.Plugin()
def norm_via(raw, appid=275850):
    """Drive the real norm() closure by stubbing the HTTP layer."""
    main._http_get_json = lambda url, headers=None: raw
    main._read_cache_entry = lambda kind, key: (None, False)
    main._write_cache = lambda *a, **k: None
    main._write_negative = lambda *a, **k: None
    return asyncio.run(P.get_appdetails(appid))

res = norm_via({"3380990": GOOD})
check("a mismatched key yields a normal, successful result", res.get("ok") is True, res.get("error"))
check("and carries the right game", res.get("name") == "No Man's Sky", res.get("name"))

res = norm_via({"1070560": {"success": False}}, 1070560)
check("a real success:false is still reported as such",
      res.get("ok") is False and "success=false" in str(res.get("error")), res.get("error"))

res = norm_via({"999": other})
check("a wrong-game payload reports no entry, not the wrong game",
      res.get("ok") is False and "no entry" in str(res.get("error")), res.get("error"))

res = norm_via({"100": {"success": True, "data": {"steam_appid": 80, "name": "Counter-Strike: Condition Zero"}}}, 100)
check("a redirected appid still resolves through its own key",
      res.get("ok") is True and res.get("name") == "Counter-Strike: Condition Zero", res)

for empty in (None, {}, []):
    res = norm_via(empty)
    check(f"an empty reply ({empty!r}) is reported as one, not as success=false",
          res.get("ok") is False and "empty reply" in str(res.get("error")), res.get("error"))

# The regression the first version of this gate missed: a lone envelope carrying
# success:true but no usable data reached _normalize_appdetails and raised.
for bad in MALFORMED:
    if not isinstance(bad, dict) or not bad:
        continue
    res = norm_via(bad)
    check(f"get_appdetails fails cleanly on {bad!r}",
          res.get("ok") is False and "object has no attribute" not in str(res.get("error"))
          and "NoneType" not in str(res.get("error")), res.get("error"))

print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL — the appdetails reply is not being parsed safely.")
    sys.exit(1)
print("PASS — appdetails is read by its contents, not its key.")
