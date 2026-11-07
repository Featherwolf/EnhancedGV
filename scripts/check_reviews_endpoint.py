"""Reviews must come from the endpoint Steam's own store page uses.

By 2026-11-07 every request to /appreviews/<appid> - the review endpoint in
Valve's partner documentation, and the one this plugin had always used - was
answered with a 302 to the store front page. Both review calls failed to parse,
and the whole reviews section, score included, disappeared from every game.

Steam's store page now loads reviews from /ajaxappreviews/<appid>, which takes
the same parameters and returns the same JSON. This gate pins the plugin to it,
so the documented URL cannot quietly come back, and checks that the reply shape
the store page relies on still parses. Synthetic and offline: it needs no network
and cannot go red because Steam is having a bad day.
"""
import asyncio, importlib.util, io, logging, os, sys, tempfile, types, urllib.parse

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-reviews-")
stub = types.ModuleType("decky")
for name, sub in (("DECKY_PLUGIN_SETTINGS_DIR", "settings"), ("DECKY_PLUGIN_RUNTIME_DIR", "data"),
                  ("DECKY_PLUGIN_LOG_DIR", "logs")):
    path = os.path.join(TMP, sub); os.makedirs(path, exist_ok=True); setattr(stub, name, path)
stub.DECKY_PLUGIN_DIR = ROOT
stub.logger = logging.getLogger("decky")
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

# The shape /ajaxappreviews answers with (keys as observed live, values made up).
def reply(n, voted_up=True):
    return {"success": 1, "cursor": "AoJ4", "rgReviewTags": [], "rgPlaytimePresetHours": [],
            "query_summary": {"num_reviews": n, "review_score": 8, "review_score_desc": "Very Positive",
                              "total_positive": 900, "total_negative": 100, "total_reviews": 1000},
            "reviews": [{"recommendationid": str(i), "voted_up": voted_up, "review": f" text {i} ",
                         "author": {"playtime_forever": 600}, "timestamp_created": 1700000000 - i,
                         "votes_up": i, "primarily_steam_deck": True,
                         "written_during_early_access": False, "language": "english"} for i in range(n)],
            "recentreviews": [], "friendreviews": []}

HISTOGRAM = {"success": 1, "results": {"recent": [
    {"date": 0, "recommendations_up": 8, "recommendations_down": 2}] * 30}}

requested = []
def fake_get(url, headers=None):
    requested.append(url)
    parts = urllib.parse.urlsplit(url)
    if "/appreviewhistogram/" in parts.path:
        return HISTOGRAM
    q = dict(urllib.parse.parse_qsl(parts.query))
    return reply(int(q.get("num_per_page", 20)), voted_up=q.get("review_type") != "negative")

main._http_get_json = fake_get
main._read_cache_entry = lambda kind, key: (None, False)
main._write_cache = lambda *a, **k: None
main._write_negative = lambda *a, **k: None
P = main.Plugin()

print("== every review request goes to /ajaxappreviews ==")
res = asyncio.run(P.get_reviews(275850, "english"))
chips = [asyncio.run(P.get_reviews_list(275850, t, "english")) for t in ("positive", "negative")]
review_urls = [u for u in requested if "/appreviewhistogram/" not in urllib.parse.urlsplit(u).path]
check("review requests were made", len(review_urls) >= 4, review_urls)
for u in review_urls:
    path = urllib.parse.urlsplit(u).path
    check(f"{path} is the ajax endpoint", path == "/ajaxappreviews/275850", u)
check("the retired /appreviews/ path is never requested",
      not any(urllib.parse.urlsplit(u).path.startswith("/appreviews/") for u in requested))

print("== the summary request asks for one review, not the twenty it ignores 0 for ==")
summary = [u for u in review_urls if dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(u).query)).get("language") == "all"]
check("one all-languages summary request", len(summary) == 1, summary)
check("it sends num_per_page=1",
      summary and dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(summary[0]).query)).get("num_per_page") == "1", summary)

print("== the reply still parses into what the panel shows ==")
check("get_reviews succeeds", res.get("ok") is True, res.get("error"))
s = res.get("summary", {})
check("all-time score text carried through", s.get("desc") == "Very Positive", s)
check("all-time totals carried through", (s.get("total_positive"), s.get("total_reviews")) == (900, 1000), s)
check("30-day summary from the histogram", res.get("recent", {}).get("total_reviews") == 300, res.get("recent"))
check("your-language summary present", (res.get("lang_summary") or {}).get("total_reviews") == 1000, res.get("lang_summary"))
check("review texts present and trimmed", [r["text"] for r in res.get("list", [])][:1] == ["text 0"], res.get("list", [])[:1])
check("playtime converted to hours", res.get("list", [{}])[0].get("playtime_hours") == 10.0, res.get("list", [{}])[:1])
check("positive chip returns only positive reviews",
      chips[0].get("ok") and chips[0]["list"] and all(r["voted_up"] for r in chips[0]["list"]), chips[0].get("error"))
check("negative chip returns only negative reviews",
      chips[1].get("ok") and chips[1]["list"] and not any(r["voted_up"] for r in chips[1]["list"]), chips[1].get("error"))

print("== a moved endpoint is reported as one, not as a JSON parse error ==")
class FakeResp(io.BytesIO):
    def __init__(self, body, final):
        super().__init__(body); self._final = final
    def geturl(self):
        return self._final
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
spec2 = importlib.util.spec_from_file_location("egv_main_net", os.path.join(ROOT, "main.py"))
fresh = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(fresh)
fresh.urllib.request.urlopen = lambda req, timeout=None, context=None: FakeResp(
    b"<!DOCTYPE html><html>store front</html>", "https://store.steampowered.com/")
try:
    fresh._http_get_json("https://store.steampowered.com/appreviews/730?json=1&key=do-not-echo")
    check("a web page in place of JSON raises", False)
except ValueError as exc:
    msg = str(exc)
    check("the error names the host and says it sent a web page", "store.steampowered.com sent a web page instead of data" in msg, msg)
    check("and where it was redirected", "redirected to https://store.steampowered.com/" in msg, msg)
    check("without echoing the query string", "do-not-echo" not in msg, msg)

print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL - reviews would not load from the endpoint Steam's store page uses.")
    sys.exit(1)
print("PASS - reviews come from /ajaxappreviews and parse as the panel expects.")
