"""EnhancedGV (Enhanced Game View) — Decky plugin backend.

Fetches store-page content for an appid from Steam's (mostly undocumented) store
and web APIs, normalizes/sanitizes it, caches it to disk, and hands clean data to
the frontend. Doing the messy work here keeps the React layer small and resilient
to Steam's shifting JSON shapes.

Only stdlib is used (urllib) so there is nothing to vendor under py_modules/ and no
native-extension / musl-vs-glibc risk on the Deck.
"""

import os
import re
import sys
import ssl
import json
import time
import html
import asyncio
import urllib.parse
import urllib.request
import urllib.error

import decky

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
CACHE_DIR = decky.DECKY_PLUGIN_RUNTIME_DIR
SETTINGS_DIR = decky.DECKY_PLUGIN_SETTINGS_DIR
SETTINGS_FILE = os.path.join(SETTINGS_DIR, "settings.json")

# Bump when fetch/cache behavior changes so an update auto-clears stale cache
# (e.g. old negative-cached SSL failures) instead of serving it after a fix.
CACHE_VERSION = "0.14.0-media"

# Time-to-live per data kind, in seconds.
TTL = {"appdetails": 86400, "deck": 86400, "reviews": 3600, "reviews_sum": 3600,
       "reviews_recent": 3600, "news": 3600}
# Negative results (fetch failed / success=false) are cached only briefly so a
# transient network/SSL failure doesn't linger after it's resolved.
NEGATIVE_TTL = 120

REQUEST_TIMEOUT = 15
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; SteamDeck) DeckyStorePanel/0.1"

DECK_LABELS = {0: "Unknown", 1: "Unsupported", 2: "Playable", 3: "Verified"}

# A compact map for the most common Deck-compat reviewer notes (loc_token -> text).
# Unknown tokens fall back to a prettified version of the token itself.
DECK_LOC_TOKENS = {
    "SteamDeckVerified_TestResult_DefaultControllerConfigFullySupported":
        "Default controller configuration is fully supported",
    "SteamDeckVerified_TestResult_ControllerGlyphsMatchDeckDevice":
        "In-game controller glyphs match the Deck",
    "SteamDeckVerified_TestResult_DefaultConfigurationIsPerformant":
        "Default graphics configuration performs well",
    "SteamDeckVerified_TestResult_TextIsLegible":
        "In-game text is legible",
    "SteamDeckVerified_TestResult_ResolutionSupported":
        "Native display resolution is supported",
    "SteamDeckVerified_TestResult_DisplayOutputHasBlackBars":
        "Display has black bars (non-native aspect ratio)",
    "SteamDeckVerified_TestResult_TextInputDoesNotAutomaticallyInvokesKeyboard":
        "On-screen keyboard is not brought up automatically for text input",
    "SteamDeckVerified_TestResult_LauncherInteractionIssues":
        "Launcher/setup requires extra interaction",
    "SteamDeckVerified_TestResult_ExternalControllersNotSupportedInLauncher":
        "Some functionality is not accessible with the built-in controls",
    "SteamDeckVerified_TestResult_GamepadNavigationInGameStore":
        "This game shows the on-screen keyboard when needed",
}

# Steam news BBCODE image placeholders map to the clan CDN. The placeholder is
# followed by a leading "/" in the content, so no trailing slash here.
CLAN_IMAGE_BASE = "https://clan.akamai.steamstatic.com/images"


# --------------------------------------------------------------------------- #
# Low-level HTTP + cache (all sync; run inside an executor from async methods)
# --------------------------------------------------------------------------- #
# The Decky-bundled Python on SteamOS often lacks a usable CA bundle, so HTTPS
# verification fails ("CERTIFICATE_VERIFY_FAILED: unable to get local issuer").
# Build a context from a system CA bundle if we can find one; otherwise fall back
# to an UNVERIFIED context. This is acceptable here: every request is a GET to a
# public, read-only Steam store/news endpoint — no credentials or private data.
_CA_CANDIDATES = [
    "/etc/ssl/certs/ca-certificates.crt",   # SteamOS / Debian / Arch
    "/etc/pki/tls/certs/ca-bundle.crt",     # Fedora / RHEL
    "/etc/ssl/cert.pem",                    # some minimal distros
]


def _build_ssl_context() -> ssl.SSLContext:
    for path in _CA_CANDIDATES:
        try:
            if os.path.exists(path):
                return ssl.create_default_context(cafile=path)
        except Exception:
            pass
    try:
        return ssl.create_default_context()
    except Exception:
        return ssl._create_unverified_context()


_SSL_CTX = _build_ssl_context()
_SSL_UNVERIFIED = ssl._create_unverified_context()


def _http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=_SSL_CTX) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        # Retry without verification if the failure is a certificate problem.
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(exc):
            decky.logger.warning("SSL verify failed; retrying unverified (public data)")
            with urllib.request.urlopen(
                req, timeout=REQUEST_TIMEOUT, context=_SSL_UNVERIFIED
            ) as resp:
                raw = resp.read().decode("utf-8", "replace")
        else:
            raise
    return json.loads(raw)


def _cache_path(kind: str, key: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{kind}_{key}")
    return os.path.join(CACHE_DIR, f"{safe}.json")


def _read_cache(kind: str, key: str):
    path = _cache_path(kind, key)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
    except Exception:
        return None
    if not isinstance(blob, dict):
        return None  # corrupt/foreign file -> treat as a cache miss, never raise
    age = time.time() - blob.get("fetched_at", 0)
    ttl = NEGATIVE_TTL if blob.get("negative") else TTL.get(kind, 3600)
    if age < ttl:
        return blob.get("data")
    return None


def _write_cache(kind: str, key: str, data, negative: bool = False) -> None:
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        path = _cache_path(kind, key)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(
                {"fetched_at": time.time(), "negative": negative, "data": data},
                fh,
            )
        os.replace(tmp, path)  # atomic
    except Exception as exc:  # caching is best-effort
        decky.logger.warning(f"cache write failed ({kind}/{key}): {exc}")


# --------------------------------------------------------------------------- #
# Text helpers: HTML sanitize + BBCODE -> HTML
# --------------------------------------------------------------------------- #
def _safe_url(u) -> str:
    """Only allow http(s) (and protocol-relative / relative / anchor) URLs in
    HTML rendered via dangerouslySetInnerHTML; neutralize javascript:/data:/
    vbscript:/etc. Decodes entities and strips control chars first so tricks
    like `java&#09;script:` or leading whitespace can't smuggle a scheme."""
    u = html.unescape(str(u or "")).strip()
    u = "".join(ch for ch in u if ord(ch) >= 0x20)  # drop TAB/NEWLINE/etc.
    low = u.lower()
    if low.startswith(("http://", "https://", "//", "/", "#", "mailto:")):
        return u
    # Relative path with no scheme (no colon before the first / ? #) is safe.
    scheme = low.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if ":" not in scheme:
        return u
    return "#"


# Allowlist HTML sanitizer — replaces the previous regex denylist, which had
# bypasses (e.g. `<svg/onload=…>`, unquoted `href=javascript:…`). Since the
# output is dangerouslySetInnerHTML'd in the Steam UI, we parse and REBUILD the
# HTML from an explicit allowlist: unknown tags are dropped (content kept),
# `on*` handlers and non-http(s) URLs are stripped.
#
# CRITICAL: this whole section must NEVER abort module import. A backend that
# fails to import is dead and every callable hangs ("Backend: NOT RESPONDING",
# observed on-device). So the html.parser import and class definition are
# guarded — if they fail for any reason on Decky's bundled Python, sanitizing
# falls back to a conservative regex strip and the backend still starts.
try:
    from html.parser import HTMLParser as _HTMLParser
except Exception:  # pragma: no cover - defensive
    _HTMLParser = object  # class still defines cleanly; _sanitize_html guards use

_HAVE_HTMLPARSER = _HTMLParser is not object

_ALLOWED_TAGS = {
    "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "sup", "sub",
    "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
    "a", "img", "span", "div", "hr", "pre", "code", "table", "thead", "tbody",
    "tr", "td", "th",
    # Steam descriptions embed autoplaying muted <video> clips ("animated
    # graphics") — e.g. some games' ENTIRE About is video, so dropping these
    # left the section blank. picture/source support a <picture> avif+png
    # fallback (see _post_sanitize).
    "video", "source", "picture",
}
_VOID_TAGS = {"br", "img", "hr", "source"}
_URL_ATTRS = {"href", "src", "poster"}
# Layout attrs kept so Steam's descriptions keep their look (centered images,
# sizing) — they can't execute anything. `style` is kept but property-filtered.
# The <video> boolean attrs (autoplay/muted/loop/playsinline) + poster/type make
# the animated clips play like the store page; none can execute anything.
_ALLOWED_ATTRS = {
    "href", "src", "alt", "title", "align", "width", "height", "style",
    "poster", "type", "autoplay", "muted", "loop", "playsinline",
    "controls", "preload",
}
# Inline style properties safe to keep: purely presentational, no external loads
# or overlays. Everything else (position, url(), expression, behavior, @import…)
# is dropped.
_SAFE_STYLE_PROPS = {
    "text-align", "font-weight", "font-style", "text-decoration",
    "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
    "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
    "width", "max-width", "height", "max-height", "float", "clear",
    "display", "vertical-align", "line-height", "font-size",
}


def _safe_style(val: str) -> str:
    out = []
    for decl in str(val or "").split(";"):
        if ":" not in decl:
            continue
        prop, _, pval = decl.partition(":")
        prop = prop.strip().lower()
        pval = pval.strip()
        pl = pval.lower()
        if prop not in _SAFE_STYLE_PROPS:
            continue
        # Reject any value that could load or execute (defense in depth).
        if any(bad in pl for bad in ("url(", "expression", "javascript:", "@import", "/*")):
            continue
        if prop in ("position",) or "fixed" in pl or "sticky" in pl:
            continue
        out.append(f"{prop}: {pval}")
    return "; ".join(out)


def _filter_attrs(attrs) -> str:
    """Allowlist + value-filter a list of (name, value) attribute tuples. Shared
    by BOTH sanitizer engines (html.parser class and the regex tokenizer) so the
    security-critical filtering is identical on every runtime."""
    parts = []
    for name, val in attrs:
        name = (name or "").lower()
        if name.startswith("on") or name not in _ALLOWED_ATTRS:
            continue
        val = "" if val is None else str(val)
        if name in _URL_ATTRS:
            val = _safe_url(val)
        elif name == "style":
            val = _safe_style(val)
            if not val:
                continue
        elif name in ("width", "height"):
            # numeric / percentage only
            if not re.match(r"^\d+%?$", val.strip()):
                continue
        parts.append(f' {name}="{html.escape(val, quote=True)}"')
    return "".join(parts)


class _Sanitizer(_HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list = []
        self._open: list = []  # allowed tags we actually emitted (to close)

    def _emit_attrs(self, attrs) -> str:
        return _filter_attrs(attrs)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in _ALLOWED_TAGS:
            return  # drop the tag; its text content still flows through
        if tag in _VOID_TAGS:
            self.out.append(f"<{tag}{self._emit_attrs(attrs)}>")
        else:
            self.out.append(f"<{tag}{self._emit_attrs(attrs)}>")
            self._open.append(tag)

    def handle_startendtag(self, tag, attrs):
        # Self-closing form: emit balanced. Void tags stay open (<br>); non-void
        # get an immediate close so nothing is left dangling (<div/> -> <div></div>).
        tag = tag.lower()
        if tag not in _ALLOWED_TAGS:
            return
        open_tag = f"<{tag}{self._emit_attrs(attrs)}>"
        self.out.append(open_tag if tag in _VOID_TAGS else f"{open_tag}</{tag}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in _VOID_TAGS or tag not in _ALLOWED_TAGS:
            return
        if tag in self._open:
            # Close nested unclosed tags up to and including this one.
            while self._open:
                t = self._open.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def handle_data(self, data):
        self.out.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self._open:
            self.out.append(f"</{self._open.pop()}>")
        return "".join(self.out)


# --- html.parser-FREE allowlist sanitizer ----------------------------------- #
# The Decky/SteamOS Python runtime this ships on does NOT provide html.parser
# (importing it fails on device — the whole reason _HAVE_HTMLPARSER exists), so
# on the handheld the old fallback stripped EVERY tag and turned each store
# description into a wall of plain text. This tokenizer is what actually runs
# there: it preserves formatting (br / img / lists / safe styling) while running
# the SAME _filter_attrs / _safe_url / _safe_style filtering as the parser path.
# Proven equivalent to the html.parser output on real Steam HTML and a battery
# of XSS/overlay payloads (parse-the-output live-danger check) — see CHANGELOG
# v0.13.5. Anything it can't parse as a clean tag is escaped to inert text;
# anything it emits as a tag has been attribute-filtered.
_TOKEN_RE = re.compile(
    r"<!--.*?-->"                                        # comments
    r"|<!\[CDATA\[.*?\]\]>"                              # cdata
    r"|<![^>]*>"                                         # doctype/declaration
    r"|<\s*/\s*([a-zA-Z][a-zA-Z0-9]*)\s*>"              # end tag        -> grp1
    r"|<\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\s*(/?)\s*>",  # start -> grp2/3/4
    re.S,
)
_ATTR_RE = re.compile(
    r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)"                     # name
    r"(?:\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s\"'>]+))?"      # optional value
)


def _parse_attrs(s):
    out = []
    for m in _ATTR_RE.finditer(s or ""):
        name = m.group(1)
        raw = m.group(2)
        if raw is None:
            val = None
        elif raw[:1] in ("\"", "'"):
            val = raw[1:-1]
        else:
            val = raw
        if val is not None:
            val = html.unescape(val)
        out.append((name, val))
    return out


def _sanitize_html_regex(raw: str) -> str:
    out: list = []
    open_stack: list = []
    pos = 0
    for m in _TOKEN_RE.finditer(raw):
        if m.start() > pos:  # text before this tag -> escaped
            out.append(html.escape(raw[pos:m.start()], quote=False))
        pos = m.end()
        end_name, start_name = m.group(1), m.group(2)
        if end_name is not None:
            tag = end_name.lower()
            if tag in _VOID_TAGS or tag not in _ALLOWED_TAGS:
                continue
            if tag in open_stack:
                while open_stack:
                    t = open_stack.pop()
                    out.append(f"</{t}>")
                    if t == tag:
                        break
        elif start_name is not None:
            tag = start_name.lower()
            if tag not in _ALLOWED_TAGS:
                continue  # drop tag; inner text still flows through as text
            out.append(f"<{tag}{_filter_attrs(_parse_attrs(m.group(3)))}>")
            if tag not in _VOID_TAGS and m.group(4) != "/":
                open_stack.append(tag)
        # comments / cdata / doctype -> dropped entirely
    if pos < len(raw):
        out.append(html.escape(raw[pos:], quote=False))
    while open_stack:
        out.append(f"</{open_stack.pop()}>")
    return "".join(out).strip()


# Which engine _sanitize_html actually used last (surfaced in QAM diagnostics so
# the on-device path is verifiable, not guessed).
SANITIZER_ENGINE = "regex" if not _HAVE_HTMLPARSER else "htmlparser?"

# Steam serves store images as <img src="....avif">, but the Steam Deck client
# may not decode AVIF — so the images silently didn't show. The CDN returns the
# ORIGINAL png/jpg when the ".avif" extension is dropped (verified). Rewrite each
# <img> into a <picture> that offers the avif first and falls back to the
# extensionless original: AVIF-capable clients get the small avif, others get the
# png/jpg. POSTER images (".poster.avif") have NO extensionless fallback (404),
# so the negative lookbehind leaves them untouched. Applied to OUR OWN already-
# sanitized output, so the injected <picture>/<source> are not attacker-supplied.
_IMG_AVIF_RE = re.compile(
    r'<img\b([^>]*?)\bsrc="([^"]+?)(?<!\.poster)\.avif((?:\?[^"]*)?)"([^>]*)>'
)


def _post_sanitize(out: str) -> str:
    def repl(m):
        pre, base, q, post = m.group(1), m.group(2), m.group(3), m.group(4)
        if "steamstatic" not in base:
            return m.group(0)  # only trust Steam's CDN for the ext-drop trick
        avif = f"{base}.avif{q}"
        png = f"{base}{q}"  # extensionless -> original png/jpg
        return (
            f'<picture><source srcset="{avif}" type="image/avif">'
            f"<img{pre}src=\"{png}\"{post}></picture>"
        )
    return _IMG_AVIF_RE.sub(repl, out)


def _sanitize_html(raw) -> str:
    """Allowlist-sanitize Steam-supplied HTML (rendered via
    dangerouslySetInnerHTML on the frontend). Unknown/dangerous tags and all
    event handlers / non-http URLs are removed. Uses html.parser when available,
    else the equivalent formatting-preserving regex tokenizer above."""
    global SANITIZER_ENGINE
    if not raw or not isinstance(raw, str):
        return ""
    if _HAVE_HTMLPARSER:
        try:
            p = _Sanitizer()
            p.feed(raw)
            p.close()
            SANITIZER_ENGINE = "htmlparser"
            return _post_sanitize(p.result().strip())
        except Exception as exc:
            decky.logger.warning(f"htmlparser sanitize failed, using regex: {exc}")
    # No html.parser on this runtime (the case on the handheld), or it errored:
    # the regex tokenizer PRESERVES formatting instead of flattening to text.
    try:
        SANITIZER_ENGINE = "regex"
        return _post_sanitize(_sanitize_html_regex(raw))
    except Exception as exc:
        # Absolute last resort — should never hit; keep output safe as text.
        decky.logger.warning(f"regex sanitize failed, stripping to text: {exc}")
        SANITIZER_ENGINE = "striptext"
        return html.escape(re.sub(r"<[^>]*>", "", raw)).strip()


def _expand_clan_images(text: str) -> str:
    text = text.replace("{STEAM_CLAN_IMAGE}", CLAN_IMAGE_BASE)
    text = text.replace("{STEAM_CLAN_LOC_IMAGE}", CLAN_IMAGE_BASE)
    return text


def _bbcode_to_html(text) -> str:
    """Convert the BBCODE that Steam news `contents` uses into a small, safe
    HTML subset. Unknown tags are dropped rather than shown raw."""
    if not text or not isinstance(text, str):
        return ""
    t = _expand_clan_images(text)

    # Images first (before we escape), capture the URL.
    t = re.sub(r"\[img\](.*?)\[/img\]",
               lambda m: f'\x00IMG\x00{m.group(1).strip()}\x00', t,
               flags=re.IGNORECASE | re.DOTALL)
    # Links: [url=x]label[/url] and [url]x[/url]
    t = re.sub(r"\[url=([^\]]+)\](.*?)\[/url\]",
               lambda m: f'\x00A\x00{m.group(1).strip()}\x00{m.group(2)}\x00/A\x00',
               t, flags=re.IGNORECASE | re.DOTALL)
    t = re.sub(r"\[url\](.*?)\[/url\]",
               lambda m: f'\x00A\x00{m.group(1).strip()}\x00{m.group(1).strip()}\x00/A\x00',
               t, flags=re.IGNORECASE | re.DOTALL)

    # Escape everything else so raw user text can't inject markup.
    t = html.escape(t)

    # Restore the tokens we set aside, as real (safe) HTML.
    t = t.replace("\x00/A\x00", "</a>")
    t = re.sub(r"\x00A\x00(.*?)\x00",
               lambda m: f'<a href="{_safe_url(m.group(1))}" target="_blank" rel="noreferrer">', t)
    t = re.sub(r"\x00IMG\x00(.*?)\x00",
               lambda m: f'<img src="{_safe_url(m.group(1))}" style="max-width:100%;border-radius:4px;" />', t)

    # Block/inline formatting tags -> HTML.
    replacements = [
        (r"\[/?b\]", lambda m: "</b>" if m.group(0)[1] == "/" else "<b>"),
        (r"\[/?i\]", lambda m: "</i>" if m.group(0)[1] == "/" else "<i>"),
        (r"\[/?u\]", lambda m: "</u>" if m.group(0)[1] == "/" else "<u>"),
        (r"\[/?strike\]", lambda m: "</s>" if m.group(0)[1] == "/" else "<s>"),
        (r"\[h1\]", lambda m: "<h3>"), (r"\[/h1\]", lambda m: "</h3>"),
        (r"\[h2\]", lambda m: "<h3>"), (r"\[/h2\]", lambda m: "</h3>"),
        (r"\[h3\]", lambda m: "<h4>"), (r"\[/h3\]", lambda m: "</h4>"),
        (r"\[/?list\]", lambda m: "</ul>" if m.group(0)[1] == "/" else "<ul>"),
        (r"\[/?olist\]", lambda m: "</ol>" if m.group(0)[1] == "/" else "<ol>"),
        (r"\[\*\]", lambda m: "<li>"),
        (r"\[/?quote(=[^\]]*)?\]",
         lambda m: "</blockquote>" if m.group(0)[1] == "/" else "<blockquote>"),
        (r"\[/?code\]", lambda m: "</code>" if m.group(0)[1] == "/" else "<code>"),
    ]
    for pattern, repl in replacements:
        t = re.sub(pattern, repl, t, flags=re.IGNORECASE)

    # Drop any BBCODE tag we didn't explicitly handle.
    t = re.sub(r"\[/?[a-zA-Z][^\]]*\]", "", t)
    # Newlines -> <br> (Steam news relies on literal newlines).
    t = t.replace("\r\n", "\n").replace("\n", "<br>")
    return t.strip()


# --------------------------------------------------------------------------- #
# Normalizers: raw Steam JSON -> clean shapes the frontend expects
# --------------------------------------------------------------------------- #
def _derive_movie_sources(movie: dict) -> dict:
    """appdetails no longer returns progressive mp4/webm keys (only dash/hls
    manifests). The progressive files still exist on the CDN keyed by the MOVIE
    ID (verified live: cdn.akamai/steam/apps/{movie_id}/movie480.mp4 -> 200,
    video/mp4). The previous thumbnail-path derivation pointed at
    store_item_assets and 404'd every trailer. 480p first: max variants buffer
    too slowly over WiFi and trip playback watchdogs."""
    thumb = movie.get("thumbnail", "") or ""
    mid = movie.get("id")
    candidates = []
    # Legacy API shape (regional/old caches): explicit mp4/webm URL dicts win.
    for key in ("mp4", "webm"):
        v = movie.get(key)
        if isinstance(v, dict):
            for q in ("480", "max"):
                if v.get(q):
                    candidates.append(v[q])
    if mid:
        # VP9 WebM FIRST: royalty-free codec that CEF always decodes. On-device
        # (2026-07-17) every mp4 failed with NotSupportedError while the network
        # fetched them fine at full speed — a Steam client update dropping H.264
        # decode is the prime suspect, and modern movies all have movie480_vp9
        # variants (verified 200 on both hosts); old movies have plain .webm.
        # H.264 mp4s stay as fallbacks for clients where they still work.
        candidates += [
            f"https://video.akamai.steamstatic.com/store_trailers/{mid}/movie480_vp9.webm",
            f"https://cdn.akamai.steamstatic.com/steam/apps/{mid}/movie480_vp9.webm",
            f"https://cdn.akamai.steamstatic.com/steam/apps/{mid}/movie480.webm",
            f"https://video.akamai.steamstatic.com/store_trailers/{mid}/movie480.mp4",
            f"https://cdn.akamai.steamstatic.com/steam/apps/{mid}/movie480.mp4",
            f"https://video.akamai.steamstatic.com/store_trailers/{mid}/movie_max_vp9.webm",
            f"https://cdn.akamai.steamstatic.com/steam/apps/{mid}/movie_max.webm",
            f"https://video.akamai.steamstatic.com/store_trailers/{mid}/movie_max.mp4",
        ]
    # Manifests are NOT playable as a plain <video> src — keep them out of the
    # progressive ladder and expose them separately for the MSE streaming
    # player (Steam's newest uploads are manifest-only: zero progressive files).
    return {
        "id": movie.get("id"),
        "name": movie.get("name", ""),
        "thumb": thumb,
        "sources": candidates,
        "hls": movie.get("hls_h264"),
        "dash": movie.get("dash_av1") or movie.get("dash_h264"),
    }


def _normalize_appdetails(data: dict) -> dict:
    def reqs(obj):
        if isinstance(obj, dict):
            return {
                "minimum": _sanitize_html(obj.get("minimum")),
                "recommended": _sanitize_html(obj.get("recommended")),
            }
        return None

    price = None
    po = data.get("price_overview")
    if isinstance(po, dict):
        price = {
            "final": po.get("final_formatted", ""),
            "initial": po.get("initial_formatted", ""),
            "discount": po.get("discount_percent", 0),
            "is_free": False,
        }
    elif data.get("is_free"):
        price = {"final": "Free To Play", "initial": "", "discount": 0, "is_free": True}

    meta = data.get("metacritic")
    metacritic = None
    if isinstance(meta, dict) and meta.get("score") is not None:
        metacritic = {"score": meta.get("score"), "url": meta.get("url", "")}

    rd = data.get("release_date") or {}

    return {
        "name": data.get("name", ""),
        "type": data.get("type", ""),
        "short_description": data.get("short_description", ""),
        "about_html": _sanitize_html(data.get("about_the_game")),
        "detailed_html": _sanitize_html(data.get("detailed_description")),
        "header_image": data.get("header_image", ""),
        "background": data.get("background_raw") or data.get("background", ""),
        "developers": data.get("developers", []) or [],
        "publishers": data.get("publishers", []) or [],
        "release_date": rd.get("date", ""),
        "coming_soon": bool(rd.get("coming_soon")),
        "website": data.get("website"),
        "controller_support": data.get("controller_support"),
        "platforms": data.get("platforms", {}) or {},
        "genres": [
            {"id": str(g.get("id")), "description": g.get("description", "")}
            for g in (data.get("genres") or [])
        ],
        "categories": [
            {"id": c.get("id"), "description": c.get("description", "")}
            for c in (data.get("categories") or [])
        ],
        "screenshots": [
            {"id": s.get("id"),
             "thumb": s.get("path_thumbnail", ""),
             "full": s.get("path_full", "")}
            for s in (data.get("screenshots") or [])
        ],
        "movies": [_derive_movie_sources(m) for m in (data.get("movies") or [])],
        "metacritic": metacritic,
        "price": price,
        "recommendations_total": (data.get("recommendations") or {}).get("total"),
        "achievements_total": (data.get("achievements") or {}).get("total"),
        "supported_languages_html": _sanitize_html(data.get("supported_languages")),
        "pc_requirements": reqs(data.get("pc_requirements")),
        "content_descriptor_notes": (data.get("content_descriptors") or {}).get("notes"),
    }


def _normalize_reviews(data: dict) -> dict:
    qs = data.get("query_summary") or {}
    reviews = []
    for r in (data.get("reviews") or [])[:30]:
        author = r.get("author") or {}
        reviews.append({
            "id": r.get("recommendationid"),
            "voted_up": bool(r.get("voted_up")),
            "text": (r.get("review") or "").strip(),
            "playtime_hours": round((author.get("playtime_forever") or 0) / 60, 1),
            "timestamp": r.get("timestamp_created"),
            "votes_up": r.get("votes_up", 0),
            "steam_deck": bool(r.get("primarily_steam_deck")),
            "early_access": bool(r.get("written_during_early_access")),
        })
    return {
        "summary": {
            "desc": qs.get("review_score_desc", ""),
            "score": qs.get("review_score", 0),
            "total_positive": qs.get("total_positive", 0),
            "total_negative": qs.get("total_negative", 0),
            "total_reviews": qs.get("total_reviews", 0),
        },
        "list": reviews,
    }


def _normalize_news(data: dict) -> dict:
    items = []
    for n in ((data.get("appnews") or {}).get("newsitems") or []):
        items.append({
            "gid": n.get("gid"),
            "title": n.get("title", ""),
            "html": _bbcode_to_html(n.get("contents", "")),
            "date": n.get("date"),
            "url": n.get("url", ""),
            "external": bool(n.get("is_external_url")),
            "feedlabel": n.get("feedlabel", ""),
            "author": n.get("author", ""),
        })
    return {"items": items}


def _normalize_deck(data: dict) -> dict:
    results = data.get("results") or {}
    cat = results.get("resolved_category", 0)
    notes = []
    for item in (results.get("resolved_items") or []):
        tok = item.get("loc_token", "")
        notes.append({
            "display_type": item.get("display_type"),
            "text": DECK_LOC_TOKENS.get(
                tok, re.sub(r"(?<!^)(?=[A-Z])", " ",
                            tok.split("_")[-1]) if tok else ""),
        })
    return {
        "category": cat,
        "label": DECK_LABELS.get(cat, "Unknown"),
        "steamos_category": results.get("steamos_resolved_category"),
        "notes": notes,
        "blog_url": results.get("steam_deck_blog_url", ""),
    }


# --------------------------------------------------------------------------- #
# Plugin
# --------------------------------------------------------------------------- #
class Plugin:
    async def _main(self):
        self.loop = asyncio.get_event_loop()
        self._inflight = {}
        os.makedirs(CACHE_DIR, exist_ok=True)
        self._purge_stale_cache()
        decky.logger.info("EnhancedGV backend started (SSL ctx: %s)",
                          type(_SSL_CTX).__name__)

    def _purge_stale_cache(self):
        """Drop the on-disk cache when CACHE_VERSION changes, so a fix ships with
        a clean slate instead of serving old negative-cached failures."""
        marker = os.path.join(CACHE_DIR, ".cache_version")
        try:
            old = ""
            if os.path.exists(marker):
                with open(marker, "r", encoding="utf-8") as fh:
                    old = fh.read().strip()
            if old != CACHE_VERSION:
                removed = 0
                for name in os.listdir(CACHE_DIR):
                    if name.endswith(".json"):
                        try:
                            os.remove(os.path.join(CACHE_DIR, name))
                            removed += 1
                        except Exception:
                            pass
                with open(marker, "w", encoding="utf-8") as fh:
                    fh.write(CACHE_VERSION)
                decky.logger.info(
                    "purged %d cached file(s) on version change %r -> %r",
                    removed, old, CACHE_VERSION)
        except Exception as exc:
            decky.logger.warning("cache purge failed: %s", exc)

    async def _unload(self):
        decky.logger.info("EnhancedGV backend unloading")

    async def _uninstall(self):
        decky.logger.info("EnhancedGV backend uninstalling")

    # --- generic fetch with cache + in-flight dedup ------------------------ #
    async def _fetch(self, kind: str, key: str, url: str, normalize):
        cached = _read_cache(kind, key)
        if cached is not None:
            return cached

        # Always schedule on the loop that is executing THIS call. A loop captured
        # once in _main can be stale (observed on-device: get_settings answered
        # "ok" while get_all hung forever — run_in_executor on the wrong loop never
        # completes, and the hung task then poisons the dedup map below so every
        # later request for the same resource awaits it too).
        loop = asyncio.get_running_loop()
        if not hasattr(self, "_inflight"):
            self._inflight = {}

        # De-dup concurrent/rapid requests for the same resource.
        inflight_key = f"{kind}:{key}"
        existing = self._inflight.get(inflight_key)
        if existing is not None and not existing.done():
            return await existing

        async def _do():
            try:
                raw = await loop.run_in_executor(None, _http_get_json, url)
                result = normalize(raw)
                if result.get("ok"):
                    _write_cache(kind, key, result)
                else:
                    _write_cache(kind, key, result, negative=True)
                return result
            except urllib.error.HTTPError as exc:
                decky.logger.error(f"{kind} HTTP {exc.code} for {key}")
                res = {"ok": False, "error": f"HTTP {exc.code}"}
                _write_cache(kind, key, res, negative=True)
                return res
            except Exception as exc:
                decky.logger.error(f"{kind} fetch failed for {key}: {exc}")
                res = {"ok": False, "error": str(exc)}
                _write_cache(kind, key, res, negative=True)
                return res

        task = asyncio.create_task(_do())
        self._inflight[inflight_key] = task
        try:
            return await task
        finally:
            # Pop in the awaiter (not inside _do) so even a cancelled/never-run
            # task cannot leave a permanent poisoned entry behind.
            self._inflight.pop(inflight_key, None)

    # --- individual endpoints ---------------------------------------------- #
    async def get_appdetails(self, appid: int, lang: str = "english", cc: str = "us"):
        url = "https://store.steampowered.com/api/appdetails?" + urllib.parse.urlencode(
            {"appids": appid, "l": lang, "cc": cc}
        )

        def norm(raw):
            env = raw.get(str(appid)) if isinstance(raw, dict) else None
            if not env or not env.get("success") or "data" not in env:
                return {"ok": False, "error": "no store data (success=false)"}
            out = _normalize_appdetails(env["data"])
            out["ok"] = True
            return out

        return await self._fetch("appdetails", f"{appid}_{lang}_{cc}", url, norm)

    async def get_reviews(self, appid: int, lang: str = "english"):
        """Store-page-style reviews: ALL-TIME and RECENT (30d) scores computed
        across every language, review TEXTS in the user's language (falling back
        to English when the localized list is empty)."""
        base = f"https://store.steampowered.com/appreviews/{appid}?"

        def summary_url(extra: dict) -> str:
            q = {"json": 1, "language": "all", "purchase_type": "all",
                 "num_per_page": 0, "filter": "all", "review_type": "all"}
            q.update(extra)
            return base + urllib.parse.urlencode(q)

        def list_url(language: str) -> str:
            return base + urllib.parse.urlencode(
                {"json": 1, "language": language, "purchase_type": "all",
                 "num_per_page": 20, "filter": "all", "review_type": "all"}
            )

        def norm_summary(raw):
            if not raw or raw.get("success") != 1:
                return {"ok": False, "error": "reviews unavailable"}
            qs = raw.get("query_summary") or {}
            return {
                "ok": True,
                "desc": qs.get("review_score_desc", ""),
                "score": qs.get("review_score", 0),
                "total_positive": qs.get("total_positive", 0),
                "total_negative": qs.get("total_negative", 0),
                "total_reviews": qs.get("total_reviews", 0),
            }

        def norm_list(raw):
            if not raw or raw.get("success") != 1:
                return {"ok": False, "error": "reviews unavailable"}
            out = _normalize_reviews(raw)
            out["ok"] = True
            return out

        alltime, recent, localized = await asyncio.gather(
            self._fetch("reviews_sum", str(appid), summary_url({}), norm_summary),
            # NOTE: appreviews' day_range does NOT restrict query_summary (the
            # totals stay all-time — observed on-device as identical numbers),
            # so the 30-day score is computed by paginating recent reviews.
            self._recent_summary(appid),
            self._fetch(f"reviews_list_{lang}", str(appid), list_url(lang), norm_list),
            return_exceptions=True,
        )
        alltime = alltime if isinstance(alltime, dict) else {"ok": False}
        recent = recent if isinstance(recent, dict) else {"ok": False}
        localized = localized if isinstance(localized, dict) else {"ok": False}

        # Fallback: no reviews written in the user's language -> English texts.
        if lang != "english" and (not localized.get("ok") or not localized.get("list")):
            fallback = await self._fetch(
                "reviews_list_english", str(appid), list_url("english"), norm_list
            )
            if isinstance(fallback, dict) and fallback.get("ok") and fallback.get("list"):
                localized = fallback

        if not alltime.get("ok") and not localized.get("ok"):
            return {"ok": False, "error": alltime.get("error", "reviews unavailable")}

        return {
            "ok": True,
            "summary": {
                "desc": alltime.get("desc", ""),
                "score": alltime.get("score", 0),
                "total_positive": alltime.get("total_positive", 0),
                "total_negative": alltime.get("total_negative", 0),
                "total_reviews": alltime.get("total_reviews", 0),
            },
            "recent": recent if recent.get("ok") else {
                "desc": "", "total_positive": 0, "total_negative": 0,
                "total_reviews": 0, "capped": False,
            },
            # Language-filtered summary rides along free in the localized list
            # response (query_summary respects the language param) — the store
            # page's "ENGLISH REVIEWS (N)" row.
            "lang_summary": (localized.get("summary")
                             if localized.get("ok") else None),
            "lang": lang,
            "list": localized.get("list", []),
        }

    @staticmethod
    def _score_label(pos: int, total: int) -> str:
        if total == 0:
            return ""
        pct = pos / total * 100
        if pct >= 95:
            return "Overwhelmingly Positive"
        if pct >= 80:
            return "Very Positive"
        if pct >= 70:
            return "Mostly Positive"
        if pct >= 40:
            return "Mixed"
        if pct >= 20:
            return "Mostly Negative"
        return "Very Negative"

    async def _recent_summary(self, appid: int):
        """EXACT 30-day totals from appreviewhistogram — the endpoint the store
        page's own review graph uses (results.recent = 30 daily up/down buckets).
        One request; no pagination/sampling. (appreviews' day_range does NOT
        window query_summary — verified: identical totals.)"""

        def norm(raw):
            results = (raw or {}).get("results") or {}
            recent = results.get("recent")
            if recent is None:
                return {"ok": False, "error": "no histogram data"}
            pos = sum(int(x.get("recommendations_up") or 0) for x in recent)
            neg = sum(int(x.get("recommendations_down") or 0) for x in recent)
            total = pos + neg
            return {
                "ok": True,
                "desc": Plugin._score_label(pos, total),
                "total_positive": pos,
                "total_negative": neg,
                "total_reviews": total,
                "capped": False,
            }

        url = f"https://store.steampowered.com/appreviewhistogram/{appid}?l=english"
        return await self._fetch("reviews_recent30", str(appid), url, norm)

    async def get_reviews_list(self, appid: int, review_type: str = "all",
                               lang: str = "english"):
        """Filtered review texts, most recent first (QAM/panel filter chips)."""
        try:
            appid = int(appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}
        if review_type not in ("all", "positive", "negative"):
            review_type = "all"

        def build(language: str) -> str:
            return f"https://store.steampowered.com/appreviews/{appid}?" + urllib.parse.urlencode(
                {"json": 1, "language": language, "purchase_type": "all",
                 "num_per_page": 30, "filter": "recent",
                 "review_type": review_type}
            )

        def norm(raw):
            if not raw or raw.get("success") != 1:
                return {"ok": False, "error": "reviews unavailable"}
            out = _normalize_reviews(raw)
            out["ok"] = True
            return out

        res = await self._fetch(
            f"reviews_list_{review_type}_{lang}", str(appid), build(lang), norm
        )
        if lang != "english" and (not res.get("ok") or not res.get("list")):
            res = await self._fetch(
                f"reviews_list_{review_type}_english", str(appid), build("english"), norm
            )
        return res

    async def get_news(self, appid: int, count: int = 10):
        url = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?" + urllib.parse.urlencode(
            {"appid": appid, "count": count, "maxlength": 0,
             "format": "json"}
        )

        def norm(raw):
            if not raw or "appnews" not in raw:
                return {"ok": False, "error": "news unavailable"}
            out = _normalize_news(raw)
            out["ok"] = True
            return out

        return await self._fetch("news", str(appid), url, norm)

    async def get_deck(self, appid: int, lang: str = "english"):
        url = ("https://store.steampowered.com/saleaction/"
               "ajaxgetdeckappcompatibilityreport?" + urllib.parse.urlencode(
                   {"nAppID": appid, "l": lang}))

        def norm(raw):
            if not raw or raw.get("success") != 1 or "results" not in raw:
                return {"ok": False, "error": "deck report unavailable"}
            out = _normalize_deck(raw)
            out["ok"] = True
            return out

        return await self._fetch("deck", str(appid), url, norm)

    # --- aggregate: the frontend calls THIS -------------------------------- #
    async def get_all(self, appid: int, lang: str = "english", cc: str = "us"):
        try:
            appid = int(appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}

        # Hard upper bound: each section is HTTP-bounded (~15s + SSL retry), so a
        # healthy gather always finishes well under this. If something wedges at
        # the asyncio/executor layer, return a real error instead of hanging the
        # frontend callable forever.
        try:
            appdetails, reviews, news, deck = await asyncio.wait_for(
                asyncio.gather(
                    self.get_appdetails(appid, lang, cc),
                    self.get_reviews(appid, lang),
                    self.get_news(appid, 10),
                    self.get_deck(appid, lang),
                    return_exceptions=True,  # one failing section must not sink the rest
                ),
                timeout=40,
            )
        except asyncio.TimeoutError:
            decky.logger.error(f"get_all({appid}) timed out at the backend")
            return {"ok": False, "error": "backend fetch timed out (40s)"}

        def _coerce(section):
            if isinstance(section, BaseException):
                decky.logger.error(f"get_all section failed: {section}")
                return {"ok": False, "error": str(section)}
            return section

        return {
            "ok": True,
            "appid": appid,
            "appdetails": _coerce(appdetails),
            "reviews": _coerce(reviews),
            "news": _coerce(news),
            "deck": _coerce(deck),
        }

    async def clear_cache(self):
        removed = 0
        try:
            for name in os.listdir(CACHE_DIR):
                if name.endswith(".json"):
                    os.remove(os.path.join(CACHE_DIR, name))
                    removed += 1
        except Exception as exc:
            decky.logger.warning(f"clear_cache: {exc}")
        return {"ok": True, "removed": removed}

    async def get_backend_info(self):
        """Report which HTML sanitizer engine actually runs on THIS device, plus
        a live self-test. If html.parser is missing (the case on-device), the
        engine is 'regex' and this must still show tags surviving — proving
        descriptions keep their formatting instead of flattening to text."""
        probe = '<b>x</b><br><img src="/a" width="10">'
        try:
            out = _sanitize_html(probe)
        except Exception as exc:
            out = f"ERR {exc}"
        return {
            "ok": True,
            "html_parser": bool(_HAVE_HTMLPARSER),
            "engine": SANITIZER_ENGINE,
            "selftest_tags": {
                "b": out.count("<b>"),
                "br": out.count("<br"),
                "img": out.count("<img"),
            },
            "python": sys.version.split()[0],
        }

    # --- settings ---------------------------------------------------------- #
    async def get_settings(self):
        defaults = {
            "sections": {
                "media": True, "about": True, "features": True,
                "reviews": True, "news": True, "deck": True,
            },
            # Which sections start expanded (must mirror the frontend
            # DEFAULT_EXPANDED). Previously omitted here, so a saved value was
            # dropped on load and reset to defaults every Steam restart.
            "expanded": {
                "about": True, "features": False, "deck": False,
                "reviews": False, "news": False,
            },
            "language": "english",
            "country": "us",
        }
        _sub = ("sections", "expanded")  # merged as sub-dicts, not replaced
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
            if isinstance(saved, dict):
                defaults.update(
                    {k: v for k, v in saved.items()
                     if k in defaults and k not in _sub}
                )
                for key in _sub:
                    if isinstance(saved.get(key), dict):
                        defaults[key].update(saved[key])
        except Exception:
            pass
        return defaults

    async def set_settings(self, settings: dict):
        try:
            os.makedirs(SETTINGS_DIR, exist_ok=True)
            tmp = SETTINGS_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(settings, fh, indent=2)
            os.replace(tmp, SETTINGS_FILE)
            return {"ok": True}
        except Exception as exc:
            decky.logger.error(f"set_settings failed: {exc}")
            return {"ok": False, "error": str(exc)}

    # --- video connectivity self-test --------------------------------------- #
    async def test_video(self, appid: int):
        """Fetch the first 64KB of each trailer candidate FROM THIS DEVICE and
        report status/bytes/ms — splits 'CDN refuses this device' from
        'client-side playback problem' in one press."""
        try:
            appid = int(appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}
        details = await self.get_appdetails(appid)
        movies = (details or {}).get("movies") or []
        if not movies:
            return {"ok": False, "error": "no trailers for this game"}
        sources = (movies[0].get("sources") or [])[:4]
        if not sources:
            return {"ok": False, "error": "no source candidates"}

        def probe(url: str) -> dict:
            req = urllib.request.Request(
                url, headers={"User-Agent": USER_AGENT, "Range": "bytes=0-65535"}
            )
            t0 = time.time()
            try:
                try:
                    resp = urllib.request.urlopen(req, timeout=12, context=_SSL_CTX)
                except urllib.error.URLError:
                    resp = urllib.request.urlopen(req, timeout=12, context=_SSL_UNVERIFIED)
                with resp:
                    data = resp.read(65536)
                    return {
                        "url": url.split("steamstatic.com")[-1][:60],
                        "status": getattr(resp, "status", 200),
                        "bytes": len(data),
                        "ms": int((time.time() - t0) * 1000),
                    }
            except Exception as exc:
                return {
                    "url": url.split("steamstatic.com")[-1][:60],
                    "status": 0,
                    "error": str(exc)[:120],
                    "ms": int((time.time() - t0) * 1000),
                }

        loop = asyncio.get_running_loop()
        results = await asyncio.gather(
            *[loop.run_in_executor(None, probe, u) for u in sources]
        )
        return {"ok": True, "results": list(results)}

    # --- in-plugin updates -------------------------------------------------- #
    def _installed_version(self) -> str:
        try:
            with open(os.path.join(decky.DECKY_PLUGIN_DIR, "package.json"),
                      "r", encoding="utf-8") as fh:
                return json.load(fh).get("version", "0.0.0")
        except Exception:
            return "0.0.0"

    @staticmethod
    def _ver_tuple(v: str):
        try:
            return tuple(int(x) for x in re.sub(r"[^0-9.]", "", v).split(".") if x)
        except Exception:
            return (0,)

    async def check_update(self):
        """Latest GitHub release vs the installed version (+ release notes)."""
        current = self._installed_version()
        try:
            loop = asyncio.get_running_loop()
            raw = await loop.run_in_executor(
                None,
                _http_get_json,
                "https://api.github.com/repos/Featherwolf/EnhancedGV/releases/latest",
            )
            latest = str(raw.get("tag_name", "")).lstrip("v")
            notes = raw.get("body") or ""
            zip_url = ""
            for a in raw.get("assets") or []:
                if a.get("name") == "EnhancedGV.zip":
                    zip_url = a.get("browser_download_url", "")
                    break
            return {
                "ok": True,
                "current": current,
                "latest": latest,
                "notes": notes,
                "has_update": self._ver_tuple(latest) > self._ver_tuple(current),
                "zip_url": zip_url,
            }
        except Exception as exc:
            decky.logger.error(f"check_update failed: {exc}")
            return {"ok": False, "error": str(exc), "current": current}

