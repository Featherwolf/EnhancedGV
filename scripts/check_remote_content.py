"""Text from Steam's news feed must render as the note its author wrote, and
nothing a remote reply contains may become live markup or a redirect.

Update history had stopped matching the notes Steam serves. Steam's event editor
writes [p] paragraphs, [*]...[/*] list items, [img src="..."] and quoted
[url="..."], none of which the converter knew, so a CS2 patch note came out as
one run-on block with a literal "[/*]" after every line (97 of them), most of a
Helldivers 2 post's images vanished (5 of 31) and its links pointed nowhere. Its
catch-all also deleted any bracketed text, so "[Xbox only] Fixed trees" read as
a fix for every platform. And with no feed filter, press articles filled the
list (all ten items for Baldur's Gate 3), shown as raw HTML.

This gate pins the converter to Steam's current format, checks that hostile
input still comes out inert through BOTH sanitizer engines (the regex one is
what runs on the Deck), that the sanitizer stays linear on unterminated
comments, and that the host pins on update and media URLs can't be bypassed
with a backslash. Offline and synthetic.
"""
import asyncio, html.parser, importlib.util, logging, os, sys, tempfile, time, types, urllib.parse

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-remote-")
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

def news(contents, feed_type=1):
    item = {"gid": "1", "title": "t", "contents": contents, "feed_type": feed_type, "url": ""}
    return main._normalize_news({"appnews": {"newsitems": [item]}})["items"][0]["html"]

print("== the request asks only for the game's own posts and Valve's update notes ==")
asked = []
main._http_get_json = lambda url, headers=None: asked.append(url) or {"appnews": {"newsitems": []}}
main._read_cache_entry = lambda kind, key: (None, False)
main._write_cache = lambda *a, **k: None
main._write_negative = lambda *a, **k: None
asyncio.run(main.Plugin().get_news(1086940))
feeds = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(asked[0]).query)).get("feeds") if asked else None
check("feeds=steam_community_announcements,steam_updates", feeds == "steam_community_announcements,steam_updates", asked)

print("== Steam's current BBCode renders as written ==")
h = news("[p]First.[/p][p]Second.[/p]")
check("[p] paragraphs become <p>", h.count("<p>") == 2 and "[p]" not in h, h)
h = news("[list][*][p]Fixed a crash[/p][/*][*][p]Fixed a typo[/p][/*][/list]")
check("[/*] closes a list item instead of showing", "[/*]" not in h and h.count("<li>") == 2, h)
h = news('[p][img src="{STEAM_CLAN_IMAGE}/44156989/abc.jpg"][/img][/p]')
check("[img src=...] shows the image", '<img src="https://' in h and "abc.jpg" in h, h)
h = news('[url="https://store.steampowered.com/app/553850/"]Store page[/url]')
check('quoted [url="..."] links where it says', 'href="https://store.steampowered.com/app/553850/"' in h, h)
h = news("[p][Xbox only] Fixed trees rendering incorrectly[/p]")
check("bracketed labels are kept", "[Xbox only] Fixed trees" in h, h)
h = news("[p]\\[PC] Reduced hitching[/p]")
check("Steam's escaped \\[ shows as [ without the backslash", "[PC] Reduced hitching" in h and "\\" not in h, h)
h = news("[p]\n[b]Hi[/b][/p]\n[p]There[/p]")
check("source newlines next to block tags add no blank lines", "<br>" not in h, h)
h = news("Line one\nLine two")
check("older posts' newlines still break lines", "<br>" in h, h)
h = news('An update<br/><ul style="padding-bottom: 0px;"><li>Fixed cp_wildcat</li></ul>', feed_type=0)
check("Valve's HTML update notes render as HTML, not visible tags", "&lt;" not in h and "<li>" in h, h)

print("== hostile input stays inert through both sanitizer engines ==")
class Live(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.found = []
    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k.lower().startswith("on"):
                self.found.append(f"{tag} {k}")
            if k.lower() in ("href", "src") and v and v.strip().lower().startswith(("javascript:", "data:", "vbscript:")):
                self.found.append(f"{tag} {k}={v}")
HOSTILE = ['[img src="javascript:alert(1)"][/img]', '[img src="https://x/a.png" onerror="alert(1)"][/img]',
           '[url="javascript:alert(1)"]x[/url]', '[url="https://a.com/" onclick="x"]y[/url]',
           '[img]https://x/p.png" onerror="alert(1)[/img]', '[p onmouseover=alert(1)]t[/p]',
           '[url="&#106;avascript:alert(1)"]q[/url]', '<img src=x onerror=alert(1)>',
           '<a href="javascript:alert(1)">a</a>', '[url=data:text/html,<script>alert(1)</script>]z[/url]']
for engine, sanitize in (("regex", main._sanitize_html_regex), ("default", main._sanitize_html)):
    found = []
    for raw in HOSTILE:
        for body in (main._bbcode_to_html(raw), raw):
            p = Live(); p.feed(sanitize(body)); p.close()
            found += [f"{raw!r}: {x}" for x in p.found]
    check(f"no event handler or script URL survives ({engine} engine)", not found, found[:3])

print("== the on-device sanitizer stays linear on unterminated comments ==")
for payload in ("<!--" * 16384, "<![CDATA[" * 8000, "<!" * 32768):
    t0 = time.time(); main._sanitize_html_regex(payload); took = time.time() - t0
    check(f"{len(payload) // 1024} KB of {payload[:4]!r}... in under 1 s ({took:.3f}s)", took < 1.0)

print("== update and media URLs can't escape their host pin ==")
for fn, url in ((main._github_url, "https://evil.example\\@github.com/x"),
                (main._github_url, "https://evil.example\\.github.com/x"),
                (main._steam_media_url, "https://evil.example\\.steamstatic.com/a.mpd"),
                (main._steam_media_url, "https://cdn.akamai.steamstatic.com/a\nb.mpd")):
    check(f"{fn.__name__} rejects {url!r}", fn(url) == "")
check("a real release URL still passes",
      main._github_url("https://github.com/Featherwolf/EnhancedGV/releases/tag/v0.20.0")
      == "https://github.com/Featherwolf/EnhancedGV/releases/tag/v0.20.0")
check("a real trailer URL still passes",
      main._steam_media_url("https://video.akamai.steamstatic.com/store_trailers/1/dash_av1.mpd") != "")

print(f"\n{ok} passed, {fail} failed")
if fail:
    print("FAIL - remote text would render wrongly or unsafely.")
    sys.exit(1)
print("PASS - news renders as written, and remote content stays inert.")
