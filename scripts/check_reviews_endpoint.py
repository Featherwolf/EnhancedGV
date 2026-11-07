"""Reviews must come from the endpoint Steam's own store page uses.

By 2026-11-07 every request to /appreviews/<appid> - the review endpoint in
Valve's partner documentation, and the one this plugin had always used - was
answered with a 302 to the store front page. Both review calls failed to parse,
and the whole reviews section, score included, disappeared from every game.

Steam's store page now loads reviews from /ajaxappreviews/<appid>, which takes
the same parameters and returns the same JSON. This gate pins the plugin to it,
so the documented URL cannot quietly come back, checks that each score and filter
asks Steam for what the panel shows (the 30-day window, Steam Deck players), and
that the reply shape the store page relies on still parses. Synthetic and offline: it needs no network
and cannot go red because Steam is having a bad day.
"""
import asyncio, importlib.util, io, logging, os, sys, tempfile, time, types, urllib.parse

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
# Each query gets its own summary so a result can be traced to the request that
# produced it: Steam answers date_range_type=include with the 30-day figures and
# playtime_type=deck with Steam Deck players' figures.
SUMMARIES = {
    "all": ("Very Positive", 8, 900, 100),
    "30d": ("Mostly Positive", 6, 210, 90),
    "deck": ("Overwhelmingly Positive", 9, 48, 2),
    "german": ("No user reviews", 0, 0, 0),
}

def reply(q):
    n = int(q.get("num_per_page", 20))
    if q.get("date_range_type") == "include":
        key = "30d"
    elif q.get("playtime_type") == "deck":
        key = "deck"
    elif q.get("language") == "german":
        key, n = "german", 0
    else:
        key = "all"
    desc, score, pos, neg = SUMMARIES[key]
    voted_up = q.get("review_type") != "negative"
    reviews = []
    for i in range(n):
        author = {"playtime_forever": 600}
        if key == "deck":
            author["deck_playtime_at_review"] = 90
        reviews.append({"recommendationid": str(i), "voted_up": voted_up, "review": f" text {i} ",
                        "author": author, "timestamp_created": 1700000000 - i, "votes_up": i,
                        "primarily_steam_deck": key == "deck",
                        "written_during_early_access": False, "language": "english"})
    return {"success": 1, "cursor": "AoJ4", "rgReviewTags": [], "rgPlaytimePresetHours": [],
            "query_summary": {"num_reviews": n, "review_score": score, "review_score_desc": desc,
                              "total_positive": pos, "total_negative": neg,
                              "total_reviews": pos + neg},
            "reviews": reviews, "recentreviews": [], "friendreviews": []}

requested = []
def fake_get(url, headers=None):
    requested.append(url)
    return reply(dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query)))

def query(u):
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(u).query))

main._http_get_json = fake_get
main._read_cache_entry = lambda kind, key: (None, False)
main._write_cache = lambda *a, **k: None
main._write_negative = lambda *a, **k: None
P = main.Plugin()

print("== every review request goes to /ajaxappreviews ==")
before = time.time()
res = asyncio.run(P.get_reviews(275850, "english"))
after = time.time()
first = list(requested)
chips = [asyncio.run(P.get_reviews_list(275850, t, "english")) for t in ("positive", "negative", "deck")]
check("review requests were made", len(requested) >= 7, requested)
for u in requested:
    path = urllib.parse.urlsplit(u).path
    check(f"{path} is the ajax endpoint", path == "/ajaxappreviews/275850", u)
check("the retired /appreviews/ path is never requested",
      not any(urllib.parse.urlsplit(u).path.startswith("/appreviews/") for u in requested))

print("== each score asks Steam for one review, not the twenty it ignores 0 for ==")
summaries = [u for u in first if query(u).get("language") == "all"]
check("three all-languages summaries (all time, 30 days, Deck players)", len(summaries) == 3, summaries)
check("each sends num_per_page=1", all(query(u).get("num_per_page") == "1" for u in summaries), summaries)
window = [query(u) for u in summaries if query(u).get("date_range_type") == "include"]
check("the 30-day score is a date-windowed query", len(window) == 1, summaries)
if window:
    start, end = int(window[0]["start_date"]), int(window[0]["end_date"])
    check("covering the last 30 days", end - start == 30 * 86400 and before - 2 <= end <= after + 2,
          (start, end, before))
check("the Deck players' score asks for playtime_type=deck",
      sum(query(u).get("playtime_type") == "deck" for u in summaries) == 1, summaries)

print("== the replies parse into what the panel shows ==")
check("get_reviews succeeds", res.get("ok") is True, res.get("error"))
s = res.get("summary", {})
check("all-time score text carried through", s.get("desc") == "Very Positive", s)
check("all-time totals carried through", (s.get("total_positive"), s.get("total_reviews")) == (900, 1000), s)
recent = res.get("recent") or {}
check("30-day score is Steam's own label and count",
      (recent.get("desc"), recent.get("score"), recent.get("total_reviews")) == ("Mostly Positive", 6, 300), recent)
deck = res.get("deck") or {}
check("Deck players' score carried through",
      (deck.get("desc"), deck.get("score"), deck.get("total_reviews")) == ("Overwhelmingly Positive", 9, 50), deck)
check("your-language summary present", (res.get("lang_summary") or {}).get("total_reviews") == 1000, res.get("lang_summary"))
lists = [query(u) for u in first if query(u).get("language") == "english"]
check("review texts are the newest (filter=recent), like every chip",
      len(lists) == 1 and lists[0].get("filter") == "recent", lists)
check("review texts present and trimmed", [r["text"] for r in res.get("list", [])][:1] == ["text 0"], res.get("list", [])[:1])
first_review = (res.get("list") or [{}])[0]
check("playtime converted to hours", first_review.get("playtime_hours") == 10.0, first_review)
check("date and helpful votes passed through",
      (first_review.get("timestamp"), first_review.get("votes_up")) == (1700000000, 0), first_review)
check("positive chip returns only positive reviews",
      chips[0].get("ok") and chips[0]["list"] and all(r["voted_up"] for r in chips[0]["list"]), chips[0].get("error"))
check("negative chip returns only negative reviews",
      chips[1].get("ok") and chips[1]["list"] and not any(r["voted_up"] for r in chips[1]["list"]), chips[1].get("error"))
deck_q = query(requested[-1])
check("Steam Deck chip asks for Deck players' reviews, newest first",
      (deck_q.get("playtime_type"), deck_q.get("review_type"), deck_q.get("filter")) == ("deck", "all", "recent"), deck_q)
check("Steam Deck chip reviews carry Deck hours at review time",
      chips[2].get("ok") and chips[2]["list"]
      and all(r["steam_deck"] and r["deck_hours"] == 1.5 for r in chips[2]["list"]), chips[2].get("list", [])[:1])

print("== a language with no reviews falls back to English texts, not English totals ==")
de = asyncio.run(P.get_reviews(275850, "german"))
check("English review texts are shown", de.get("ok") and len(de.get("list", [])) > 0, de.get("list"))
check("no language row with English totals under German", de.get("lang_summary") is None, de.get("lang_summary"))

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
