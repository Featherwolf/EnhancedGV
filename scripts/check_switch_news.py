"""Switch update history comes only from perfectly-nintendo.com, shows no more
than the latest releases' changes, stays inert, and never holds the game page
up. A game the site has no article for shows no update history, and no other
site is asked.

The lookup scrapes a third-party site, so everything it fetches is pinned to
it (links taken from its pages, and redirects too), and it identifies itself
with the plugin's own User-Agent. From a perfectly-nintendo.com article it keeps
only the changes of the newest PN_MAX_RELEASES releases: no intro, no release
dates, sources or links, and a "Ver. 7.01" sub-version stays inside its hotfix
release. get_all_provider waits only SWITCH_NEWS_WAIT for it; a slower lookup
finishes in the background, and the answer is marked transient so the panel
asks again. Offline and synthetic.
"""
import asyncio, importlib.util, logging, os, re, sys, tempfile, types, urllib.request

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-switch-")
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

PN = main._PN_HOSTS

print("== only perfectly-nintendo.com's own https URLs are fetched ==")
for url, hosts in (("https://www.perfectly-nintendo.com/mario-kart-8-deluxe-software-updates/", PN),
                   ("https://perfectly-nintendo.com/x/", PN)):
    check(f"pinned: {url}", main._pinned_url(url, hosts) == url)
for url, hosts in (("https://evil.example/x", PN),
                   ("https://www.perfectly-nintendo.com.evil.example/x", PN),
                   ("http://www.perfectly-nintendo.com/x", PN),
                   ("https://user@www.perfectly-nintendo.com/x", PN),
                   ("https://www.perfectly-nintendo.com:8443/x", PN),
                   ("https://evil.example\\@www.perfectly-nintendo.com/x", PN),
                   ("https://www.nintendo.com/us/whatsnew/x/", PN),
                   ("/relative/path", PN),
                   ("javascript:alert(1)", PN)):
    check(f"refused: {url!r}", main._pinned_url(url, hosts) == "")
try:
    main._http_get_text("https://evil.example/x", PN)
    check("_http_get_text refuses an unpinned URL before any request", False)
except ValueError:
    check("_http_get_text refuses an unpinned URL before any request", True)

print("== redirects stay on the pinned site ==")
handler = main._PinnedRedirect(PN)
req = urllib.request.Request("https://www.perfectly-nintendo.com/a/")
for target in ("https://evil.example/a/", "http://www.perfectly-nintendo.com/a/",
               "https://www.perfectly-nintendo.com.evil.example/a/"):
    try:
        handler.redirect_request(req, None, 302, "Found", {}, target)
        check(f"redirect to {target} refused", False)
    except ValueError:
        check(f"redirect to {target} refused", True)
followed = handler.redirect_request(req, None, 301, "Moved", {}, "https://perfectly-nintendo.com/b/")
check("redirect within the site followed", followed is not None
      and followed.full_url == "https://perfectly-nintendo.com/b/")

print("== the plugin's own User-Agent, and a pinned final URL ==")
sent = []
class _Resp:
    def __init__(self, final): self.final = final
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def geturl(self): return self.final
    def read(self, n): return b"<html></html>"
class _Opener:
    def __init__(self, final): self.final = final
    def open(self, r, timeout=None):
        sent.append(r); return _Resp(self.final)
real_opener = main._pinned_opener
main._pinned_opener = lambda hosts: _Opener("https://www.perfectly-nintendo.com/a/")
main._http_get_text("https://www.perfectly-nintendo.com/a/", PN)
check("User-Agent is the plugin's, not a browser's",
      sent and sent[0].get_header("User-agent") == main.USER_AGENT, sent and sent[0].headers)
check("no browser User-Agent constant left", not hasattr(main, "PN_USER_AGENT"))
main._pinned_opener = lambda hosts: _Opener("https://evil.example/a/")
try:
    main._http_get_text("https://www.perfectly-nintendo.com/a/", PN)
    check("a response that ended off-site is refused", False)
except ValueError:
    check("a response that ended off-site is refused", True)
main._pinned_opener = real_opener

print("== the search result picks this game's update article ==")
def results(*items):
    return "".join(f'<h2 class="cm-entry-title"> <a href="{h}" title="{t}">' for h, t in items)
base = "https://www.perfectly-nintendo.com/"
page = results((base + "mario-kart-8-deluxe-review/", "Mario Kart 8 Deluxe review"),
               (base + "mario-kart-world-switch-2-all-the-updates/", "Mario Kart World: all the updates"),
               (base + "mario-kart-8-deluxe-software-updates/", "Mario Kart 8 Deluxe: all the updates"))
check("matches the game's update article, not a review or another game",
      main._parse_pn_search(page, "Mario Kart 8 Deluxe") == base + "mario-kart-8-deluxe-software-updates/")
bundle = results((base + "super-mario-galaxy-switch-software-updates/",
                  "Super Mario Galaxy + Super Mario Galaxy 2: all the updates"))
check("matches a bundled article", main._parse_pn_search(bundle, "Super Mario Galaxy 2") != "")
accented = results((base + "pokemon-legends-z-a-switch-software-updates/",
                    "Pok&eacute;mon Legends: Z-A: all the updates"))
check("matches an accented title", main._parse_pn_search(accented, "Pokémon Legends: Z-A") != "")
check("no match for another game", main._parse_pn_search(page, "Splatoon 3") == "")

print("== a perfectly-nintendo.com article: only the latest releases' changes ==")
def release(name, changes, hotfix_subs=()):
    subs = "".join(f"<h4>Ver. {v}</h4><ul><li>fix {v}</li></ul>" for v in hotfix_subs)
    return (f'<h3><span style="color:red">Game &#8211; {name}</span></h3>'
            f"<ul><li><strong>Release date</strong>: Jan 1st 2026</li><li>File size: 1GB</li>"
            f"<li><strong>Patch notes</strong>:</li></ul><hr />{subs}<ul><li>{changes}</li></ul><hr />"
            f"<ul><li><strong>Additional notes</strong>: none.</li>"
            f'<li><strong>Source</strong>: <a href="https://src.example">Src</a></li></ul>')
article = ('<h1 class="cm-entry-title">Game: all the updates (latest: Ver. 5.0)</h1>'
           '<div class="cm-entry-summary"><p>In this post, you will find all there is to know.</p>'
           '<p><a href="https://www.perfectly-nintendo.com/nintendo-updates/">Click here</a></p>'
           + release("Ver. 5.0 Hotfixes", "hotfix notes", ("5.01", "5.02"))
           + release("Ver. 5.0", "big update")
           + '<h3>Game &#8211; Ver. 4.1</h3><ul><li>Release date: x</li>'
             '<li>Patch notes: Minor bug fixes</li></ul><ul><li>Additional notes: none</li></ul>'
           + release("Ver. 4.0", "old update")
           + "</div>")
art = main._parse_pn_article(article)
out = art["html"] if art else ""
text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", out))
heads = re.findall(r"<h3>(.*?)</h3>", out)
check("title is the article's", art and art["title"].startswith("Game: all the updates"), art and art["title"])
check(f"only the {main.PN_MAX_RELEASES} newest releases",
      heads == ["Game – Ver. 5.0 Hotfixes", "Game – Ver. 5.0", "Game – Ver. 4.1"], heads)
check("a hotfix's sub-versions stay inside it", "Ver. 5.01" in text and "fix 5.02" in text, text)
check("a one-line 'Patch notes: …' value is kept", "Minor bug fixes" in text, text)
check("the changes are kept", "hotfix notes" in text and "big update" in text, text)
for gone in ("In this post", "Click here", "Release date", "File size", "Patch notes",
             "Additional notes", "Source", "src.example", "old update"):
    check(f"dropped: {gone!r}", gone not in out, text)
check("an article with no release heading yields nothing",
      main._parse_pn_article('<div class="cm-entry-summary"><h3>General</h3><p>x</p></div>') is None)
hostile = main._parse_pn_article(
    '<div class="cm-entry-summary"><h3>Game – Ver. 1 <img src=x onerror=alert(1)></h3>'
    '<ul><li>Patch notes: <script>alert(2)</script>&lt;b&gt;hi</li></ul>'
    '<p onclick="x()">ok<a href="javascript:alert(3)">l</a><iframe src="https://e.x"></iframe></p></div>')
h = hostile["html"] if hostile else ""
check("hostile article HTML comes out inert",
      h and not re.search(r"<script|<iframe|<img|\son\w+=|javascript:", h, re.I), h)

print("== no article: no update history, and no other site is asked ==")
asked = []
def fake_pn_get(url):
    asked.append(url)
    return results((base + "some-other-game-switch-software-updates/", "Some Other Game: all the updates"))
real_pn_get = main._pn_http_get_text
main._pn_http_get_text = fake_pn_get
none_res = asyncio.run(main.Plugin().get_switch_news("Splatoon 3"))
main._pn_http_get_text = real_pn_get
check("answers with an empty list, shown as no recent updates",
      none_res.get("ok") is True and none_res.get("items") == [], none_res)
check("only perfectly-nintendo.com was asked",
      asked and all(main._pinned_url(u, PN) for u in asked), asked)
check("the Nintendo eShop fallback is gone",
      not hasattr(main.Plugin, "_get_nintendo_eshop_news")
      and not hasattr(main, "_NINTENDO_HOSTS"))

print("== the game page doesn't wait on a slow lookup ==")
async def slow_lookup():
    calls, finished = [], []
    plugin = main.Plugin()
    async def get_switch_news(title):
        if finished:  # the real lookup answers from its cache once filled
            return {"ok": True, "items": [{"gid": "1"}]}
        calls.append(title)
        await asyncio.sleep(0.3)
        finished.append(title)
        return {"ok": True, "items": [{"gid": "1"}]}
    plugin.get_switch_news = get_switch_news
    main.SWITCH_NEWS_WAIT = 0.05
    switch = {"name": "Game", "categories": [{"description": "Nintendo Switch"}]}
    first = await plugin._switch_news_for(switch)
    second = await plugin._switch_news_for(switch)
    lookups_while_running = len(calls)
    await asyncio.sleep(0.4)
    third = await plugin._switch_news_for(switch)
    return first, second, third, lookups_while_running, finished
first, second, third, lookups_while_running, finished = asyncio.run(slow_lookup())
check("answers without the history once the wait is over, marked transient",
      first.get("ok") is False and first.get("transient") is True, first)
check("a revisit while it runs reuses the same lookup",
      lookups_while_running == 1 and second.get("transient") is True, lookups_while_running)
check("the slow lookup still finishes in the background", finished == ["Game"], finished)
check("a later visit gets the result", third.get("ok") is True, third)
not_switch = asyncio.run(main.Plugin()._switch_news_for({"name": "x", "categories": [{"description": "SNES"}]}))
check("a non-Switch game isn't looked up", not_switch.get("ok") is False and not not_switch.get("transient"))

print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL - Switch update history could escape its sites, show too much, or hold the page up.")
    sys.exit(1)
print("PASS - Switch update history stays on its sites, shows only the latest changes, and never holds the page up.")
