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
import functools
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
# Per-game store-appid matches (device-local). Lives in SETTINGS_DIR (NOT the
# cache dir) so it survives updates and is never wiped by _purge_stale_cache.
MATCHES_FILE = os.path.join(SETTINGS_DIR, "matches.json")

# Bump when fetch/cache behavior changes so an update auto-clears stale cache
# (e.g. old negative-cached SSL failures) instead of serving it after a fix.
CACHE_VERSION = "0.15.0-lang"

# Time-to-live per data kind, in seconds.
TTL = {"appdetails": 86400, "deck": 86400, "reviews": 3600, "reviews_sum": 3600,
       "reviews_recent": 3600, "news": 3600,
       # Non-Steam / emulated metadata is essentially static — cache it a week.
       "hasheous": 604800, "igdb": 604800}
# Negative results (fetch failed / success=false) are cached only briefly so a
# transient network/SSL failure doesn't linger after it's resolved.
NEGATIVE_TTL = 120
# How long past its TTL a cached entry may still be SERVED while a refresh runs
# in the background (stale-while-revalidate). Revisiting a game after the TTL
# expired used to mean sitting on the loading placeholder through a full set of
# store round-trips; now the last known content paints immediately and the fresh
# copy replaces it on the next visit. Only positive results go stale-warm.
STALE_GRACE = 7 * 86400

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

# --- Hasheous: keyless metadata for non-Steam / emulated games ---------------- #
# Public community instance. Keyless pipeline (no API key, no ROM file needed):
#   MCP hasheous_search_games (clean title match, returns reference ROM hashes)
#   -> Lookup/ByHash (bridges to the stable Hasheous game/DataObject id)
#   -> DataObjects/Game/{id} (name, AIDescription, Logo, Tags, publisher, IGDB id)
# The rich IGDB proxy (cover/screenshots/genres) is key-gated (a later, opt-in
# phase); this baseline is entirely keyless and works with the feature toggled on.
# --- IGDB enrichment (opt-in, needs a Hasheous CLIENT API key) --------------- #
# Hasheous proxies IGDB at /MetadataProxy/IGDB/*. Verified against the live
# OpenAPI spec and by probing the running service:
#   * METADATA is key-gated: /MetadataProxy/IGDB/Game?Id=… answers 401 without an
#     `X-Client-API-Key` header (securityScheme "Client API Key").
#   * IMAGES are NOT key-gated: /MetadataProxy/IGDB/Image/{hash}.jpg answers 200
#     with no key — but it serves the ORIGINAL (a cover measured at 2.7 MB), and
#     it takes no size parameter (a t_cover_big-style path 404s).
# So metadata goes through the proxy with the key, and image URLs point at IGDB's
# own public CDN, which does serve sized renditions keylessly. Measured on the
# same cover: t_thumb 3 KB / t_cover_big 21 KB / t_screenshot_med 40 KB /
# t_1080p 163 KB, versus 2.7 MB from the proxy. On a Deck over wifi, with a
# thumbnail strip of a dozen shots, that difference is the whole feature.
IGDB_IMG_CDN = "https://images.igdb.com/igdb/image/upload"
IGDB_SIZE_COVER = "t_cover_big"
IGDB_SIZE_THUMB = "t_screenshot_med"
IGDB_SIZE_FULL = "t_1080p"
# Screenshot/artwork metadata is one request PER image id, so cap how many we
# resolve: enough to fill the carousel, few enough to stay polite and quick.
IGDB_MAX_SHOTS = 12

HASHEOUS_BASE = "https://hasheous.org/api/v1"
HASHEOUS_IMAGE = HASHEOUS_BASE + "/Images/"  # + {image_hash}
# sha1("") — Hasheous stores this as a placeholder/empty Logo; never use it.
_HASHEOUS_EMPTY_IMG = "DA39A3EE5E6B4B0D3255BFEF95601890AFD80709"


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


def _http_get_json(url: str, headers: dict = None) -> dict:
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
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


def _http_post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json",
                 "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=_SSL_CTX) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(exc):
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


def _read_cache_entry(kind: str, key: str):
    """-> (data, fresh). `data` is None on a miss; `fresh` is False for an entry
    that is past its TTL but still inside the stale-serve grace window."""
    path = _cache_path(kind, key)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            blob = json.load(fh)
    except Exception:
        return None, False
    if not isinstance(blob, dict):
        return None, False  # corrupt/foreign file -> a cache miss, never raise
    age = time.time() - blob.get("fetched_at", 0)
    negative = bool(blob.get("negative"))
    ttl = NEGATIVE_TTL if negative else TTL.get(kind, 3600)
    if age < ttl:
        return blob.get("data"), True
    # A stale FAILURE is worthless — never serve it; retry instead.
    if not negative and age < ttl + STALE_GRACE:
        return blob.get("data"), False
    return None, False


def _write_negative(kind: str, key: str, res) -> None:
    """Negative-cache a failure — unless a GOOD blob is already on disk.

    A stale-while-revalidate refresh runs in the background against a blob we
    are still happily serving; if that refresh fails (offline, 429, SSL), the
    old code replaced the good blob with the failure, and the content that was
    on screen a moment ago was gone for good. Keep the positive blob instead: it
    goes on aging normally and the next read simply retries the refresh."""
    existing, _fresh = _read_cache_entry(kind, key)
    if isinstance(existing, dict) and existing.get("ok") is not False:
        return
    _write_cache(kind, key, res, negative=True)


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
# Non-Steam matching: per-game store-appid records + title search
# --------------------------------------------------------------------------- #
def _read_matches() -> dict:
    try:
        with open(MATCHES_FILE, "r", encoding="utf-8") as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _write_matches(d: dict) -> None:
    try:
        os.makedirs(SETTINGS_DIR, exist_ok=True)
        tmp = MATCHES_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(d, fh)
        os.replace(tmp, MATCHES_FILE)  # atomic
    except Exception as exc:
        decky.logger.warning(f"matches write failed: {exc}")


def _feature_non_steam() -> bool:
    """Whether non-Steam metadata providers (Hasheous) are enabled. OFF by
    default: read straight from the settings file so resolve_game can gate the
    provider fallback without threading a flag through the frontend call."""
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
            return bool(json.load(fh).get("nonSteamSources", False))
    except Exception:
        return False


def _igdb_key() -> str:
    """The Hasheous CLIENT API key, or "" when enrichment is off. Read from the
    settings file for the same reason as _feature_non_steam. NEVER logged."""
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as fh:
            return str(json.load(fh).get("hasheousApiKey", "") or "").strip()
    except Exception:
        return ""


def _igdb_img(image_hash: str, size: str) -> str:
    """A sized IGDB CDN URL. Keyless and public (see the note above)."""
    h = re.sub(r"[^A-Za-z0-9_-]", "", str(image_hash or ""))
    return f"{IGDB_IMG_CDN}/{size}/{h}.jpg" if h else ""


def _igdb_pick(obj, *names):
    """Read the first present key from an IGDB proxy object.

    The proxy is a C# service in front of IGDB's snake_case JSON, and the OpenAPI
    spec types most nested objects as bare `object` — so the exact casing of a
    field is not guaranteed by the contract. Rather than pin one spelling and
    break on the other, try the plausible ones. Unverified against a live keyed
    response (no key available here), so this stays deliberately forgiving.
    """
    if not isinstance(obj, dict):
        return None
    for n in names:
        for cand in (n, n[:1].upper() + n[1:], n[:1].lower() + n[1:],
                     n.replace("_", ""), n.replace("_", "").lower(),
                     "".join(w[:1].upper() + w[1:] for w in n.split("_"))):
            if cand in obj and obj[cand] not in (None, ""):
                return obj[cand]
    return None


def _rec_to_result(rec: dict) -> dict:
    """Map a persisted matches.json record to a resolve_game result. Handles
    Steam matches, non-Steam provider matches (gated by the feature flag), and
    blank/cleared records. Shared by the fast path and the under-lock re-read."""
    sa = rec.get("store_appid")
    if sa:
        return {"ok": True, "store_appid": int(sa), "provider": "steam",
                "provider_id": int(sa), "name": rec.get("name", ""),
                "year": rec.get("year", ""), "source": rec.get("source", "auto"),
                "matched": True, "from_cache": True}
    prov = rec.get("provider")
    if prov and prov != "steam" and rec.get("provider_id") is not None:
        if not _feature_non_steam():
            # Feature turned off after a provider match was saved: behave as
            # unmatched (don't surface non-Steam content) without deleting the
            # record, so re-enabling restores it instantly.
            return {"ok": True, "store_appid": None, "matched": False,
                    "name": "", "year": "", "source": rec.get("source", "auto"),
                    "reason": "non-Steam sources disabled"}
        return {"ok": True, "store_appid": None, "provider": prov,
                "provider_id": rec.get("provider_id"), "platform": rec.get("platform", ""),
                "name": rec.get("name", ""), "year": rec.get("year", ""),
                "source": rec.get("source", "auto"), "matched": True, "from_cache": True}
    # Blank/"cleared" record: stay unmatched, never auto-search over it.
    return {"ok": True, "store_appid": None, "matched": False, "name": "", "year": "",
            "source": rec.get("source", "cleared"), "reason": "cleared"}


def _year_from(release_date: str) -> str:
    m = re.search(r"\b(\d{4})\b", str(release_date or ""))
    return m.group(1) if m else ""


def _norm_title(s) -> str:
    s = re.sub(r"[™®©]", "", str(s or "")).lower()  # ™ ® ©
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _best_match(title: str, items: list):
    """Pick the store search result for a title. Exact normalized-title match
    wins; otherwise the top result (storesearch is already relevance-ranked)."""
    if not items:
        return None
    nt = _norm_title(title)
    if nt:
        for it in items:
            if _norm_title(it.get("name")) == nt:
                return it
    return items[0]


def _parse_appid(s):
    """Accept a numeric appid OR a Steam store URL (…/app/<id>/…)."""
    s = str(s or "").strip()
    m = re.search(r"/app/(\d+)", s)
    if m:
        return int(m.group(1))
    if s.isdigit():
        return int(s)
    m = re.search(r"\b(\d{3,})\b", s)  # bare number embedded in other text
    return int(m.group(1)) if m else None


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


def _esc_text(s: str) -> str:
    """Escape a run of TEXT for safe re-insertion. Steam's HTML arrives with
    pre-encoded entities (&amp; &#39; &quot; &lt;), and the regex tokenizer sees
    them raw — so unescape first, THEN re-escape, or `&amp;` becomes
    `&amp;amp;` and renders literally (this mirrors html.parser's
    convert_charrefs). `<`/`>` are always re-escaped, so no markup slips through."""
    return html.escape(html.unescape(s), quote=False)


def _sanitize_html_regex(raw: str) -> str:
    out: list = []
    open_stack: list = []
    pos = 0
    for m in _TOKEN_RE.finditer(raw):
        if m.start() > pos:  # text before this tag
            out.append(_esc_text(raw[pos:m.start()]))
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
        out.append(_esc_text(raw[pos:]))
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
        return _esc_text(re.sub(r"<[^>]*>", "", raw)).strip()


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
# Hasheous normalization (non-Steam / emulated games)
# --------------------------------------------------------------------------- #
def _md_to_html(md) -> str:
    """Minimal, SAFE Markdown -> HTML for Hasheous' AIDescription (## headers,
    **bold**, *italic*, - bullets, paragraphs). Output is re-run through
    _sanitize_html downstream, so this only needs to emit allowlisted tags
    (h1-h6/p/b/i/ul/li/br are all in _ALLOWED_TAGS)."""
    text = str(md or "").replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        return ""

    def inline(s: str) -> str:
        s = html.escape(s, quote=False)
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        s = re.sub(r"__(.+?)__", r"<b>\1</b>", s)
        s = re.sub(r"\*(.+?)\*", r"<i>\1</i>", s)
        s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
        return s

    out, para, bullets = [], [], []

    def flush_para():
        if para:
            out.append("<p>" + "<br>".join(inline(x) for x in para) + "</p>")
            para.clear()

    def flush_bullets():
        if bullets:
            out.append("<ul>" + "".join(f"<li>{inline(b)}</li>" for b in bullets) + "</ul>")
            bullets.clear()

    for line in text.split("\n"):
        l = line.strip()
        if not l:
            flush_bullets(); flush_para(); continue
        m = re.match(r"^(#{1,6})\s+(.*)$", l)
        if m:
            flush_bullets(); flush_para()
            lvl = min(len(m.group(1)) + 1, 6)  # "## X" -> <h3>
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            continue
        mb = re.match(r"^[-*+]\s+(.*)$", l)
        if mb:
            flush_para(); bullets.append(mb.group(1)); continue
        para.append(l)
    flush_bullets(); flush_para()
    return "".join(out)


def _hasheous_attrs(obj: dict, name: str) -> list:
    return [a for a in (obj.get("attributes") or []) if a.get("attributeName") == name]


def _hasheous_tags(obj: dict) -> list:
    """Flatten Hasheous' nested Tags attribute to a de-duped list of tag texts."""
    texts: list = []

    def walk(x):
        if isinstance(x, dict):
            t = x.get("text")
            if isinstance(t, str) and t.strip():
                texts.append(t.strip())
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    for a in _hasheous_attrs(obj, "Tags"):
        walk(a.get("value"))
    seen, out = set(), []
    for t in texts:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            out.append(t)
    return out[:16]


def _normalize_hasheous(obj: dict) -> dict:
    """Map a Hasheous DataObjects/Game object onto the AppDetails contract.
    reviews/news/deck are supplied as {ok:False} by the caller and hide cleanly."""
    name = obj.get("name") or ""

    desc_md = ""
    ad = _hasheous_attrs(obj, "AIDescription")
    if ad:
        desc_md = ad[0].get("value") or ""
    about_html = _sanitize_html(_md_to_html(desc_md))
    # Plain-text lead-in for the "what's this game about" card (strip md syntax).
    short = re.sub(r"[#*_`>]", "", str(desc_md))
    short = re.sub(r"\s+", " ", short).strip()[:320]

    header = ""
    for a in _hasheous_attrs(obj, "Logo"):
        h = a.get("value")
        if h and str(h) != _HASHEOUS_EMPTY_IMG:
            header = HASHEOUS_IMAGE + str(h)
            break

    publishers = []
    pub = obj.get("publisher")
    if isinstance(pub, dict) and pub.get("name"):
        publishers.append(pub["name"])

    platform_name = ""
    pl = _hasheous_attrs(obj, "Platform")
    if pl and isinstance(pl[0].get("value"), dict):
        sd = pl[0]["value"].get("signatureDataObjects") or []
        if sd:
            platform_name = sd[0].get("Platform") or ""

    website = None
    igdb_id = 0
    for m in (obj.get("metadata") or []):
        if m.get("source") == "IGDB" and m.get("status") == "Mapped":
            if m.get("link") and not website:
                website = m["link"]
            # `id` (== immutableId) is the IGDB game id — the handle the keyed
            # MetadataProxy needs. Verified on a live DataObject: Super Metroid
            # (Hasheous 6292) carries IGDB id 1103.
            try:
                igdb_id = int(m.get("id") or m.get("immutableId") or 0)
            except Exception:
                igdb_id = 0
            if website and igdb_id:
                break

    year = ""
    for sd in (obj.get("signatureDataObjects") or []):
        y = _year_from(sd.get("Year", ""))
        if y:
            year = y
            break

    langs = ""
    la = _hasheous_attrs(obj, "Language")
    if la and la[0].get("value"):
        langs = html.escape(str(la[0]["value"]), quote=False)

    genres = [{"id": t, "description": t[:1].upper() + t[1:]} for t in _hasheous_tags(obj)]
    categories = ([{"id": "platform", "description": platform_name}] if platform_name else [])

    return {
        "ok": True,
        "name": name,
        "type": "game",
        "short_description": short,
        "about_html": about_html,
        "detailed_html": "",
        "header_image": header,
        "background": "",
        "developers": [],
        "publishers": publishers,
        "release_date": year,
        "coming_soon": False,
        "website": website,
        "controller_support": None,
        "platforms": {},
        "genres": genres,
        "categories": categories,
        "screenshots": [],
        "movies": [],
        "metacritic": None,
        "price": None,
        "recommendations_total": None,
        "achievements_total": None,
        "supported_languages_html": langs,
        "pc_requirements": None,
        "content_descriptor_notes": None,
        # Handle for the opt-in IGDB enrichment pass (0 = unmapped).
        "igdb_id": igdb_id,
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
    def _clear_inflight(self, inflight_key: str, task) -> None:
        if getattr(self, "_inflight", {}).get(inflight_key) is task:
            self._inflight.pop(inflight_key, None)

    async def _fetch(self, kind: str, key: str, url: str, normalize):
        cached, fresh = _read_cache_entry(kind, key)
        if cached is not None and fresh:
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
            # A stale-but-usable copy beats waiting on the refresh that is
            # already running for it.
            if cached is not None:
                return cached
            return await existing

        async def _do():
            try:
                raw = await loop.run_in_executor(None, _http_get_json, url)
                result = normalize(raw)
                if result.get("ok"):
                    _write_cache(kind, key, result)
                else:
                    _write_negative(kind, key, result)
                return result
            except urllib.error.HTTPError as exc:
                decky.logger.error(f"{kind} HTTP {exc.code} for {key}")
                res = {"ok": False, "error": f"HTTP {exc.code}"}
                _write_negative(kind, key, res)
                return res
            except Exception as exc:
                decky.logger.error(f"{kind} fetch failed for {key}: {exc}")
                res = {"ok": False, "error": str(exc)}
                _write_negative(kind, key, res)
                return res

        task = asyncio.create_task(_do())
        self._inflight[inflight_key] = task
        # Always clear the slot when the task ends, so a task nobody awaits
        # (the background refresh below) can't leave a poisoned entry behind.
        task.add_done_callback(lambda t: self._clear_inflight(inflight_key, t))

        if cached is not None:
            # Stale-while-revalidate: answer NOW with the last known-good copy
            # and let the refresh land in the cache for the next read. `_do`
            # swallows its own exceptions, so this task never goes unretrieved.
            return cached

        try:
            return await task
        finally:
            # Pop in the awaiter too (not only inside _do) so even a
            # cancelled/never-run task cannot leave a permanent poisoned entry.
            self._clear_inflight(inflight_key, task)

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

    # --- non-Steam matching ------------------------------------------------ #
    def _matches_lock(self):
        # Serializes the read-modify-write of matches.json across
        # resolve_game/set_match/clear_match. Lazily created on the running loop.
        if not hasattr(self, "_mlock_obj"):
            self._mlock_obj = asyncio.Lock()
        return self._mlock_obj

    async def _search_store(self, term: str, lang: str, cc: str):
        url = "https://store.steampowered.com/api/storesearch/?" + urllib.parse.urlencode(
            {"term": term, "l": lang, "cc": cc}
        )

        def norm(raw):
            out = []
            for it in ((raw or {}).get("items") or []):
                aid = it.get("id")
                typ = (it.get("type") or "app").lower()
                # Only real apps have appids usable with appdetails (skip
                # bundles/packages whose id is a different namespace).
                if isinstance(aid, int) and aid > 0 and typ in ("app", "game"):
                    out.append({"appid": aid, "name": it.get("name", ""),
                                "image": it.get("tiny_image", "")})
            return {"ok": True, "items": out}

        key = _norm_title(term) or "_"
        return await self._fetch("storesearch", key, url, norm)

    async def _name_year(self, appid: int, lang: str, cc: str):
        """Store name + release year for an appid, reusing the appdetails cache
        (so a later get_all for the same id doesn't refetch)."""
        d = await self.get_appdetails(int(appid), lang, cc)
        if isinstance(d, dict) and d.get("ok"):
            return {"ok": True, "appid": int(appid),
                    "name": d.get("name", ""), "year": _year_from(d.get("release_date", ""))}
        err = d.get("error") if isinstance(d, dict) else None
        return {"ok": False, "appid": int(appid), "error": err or "no store data"}

    # --- Hasheous (non-Steam / emulated metadata) -------------------------- #
    async def _hasheous_search(self, title: str, platform: str = "") -> list:
        """MCP hasheous_search_games -> signature game records (with reference
        ROM hashes). Keyless. The cleanest title matcher Hasheous offers."""
        args = {"name": title, "limit": 8, "includeRoms": True}
        if platform:
            args["platform"] = platform
        payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                   "params": {"name": "hasheous_search_games", "arguments": args}}
        loop = asyncio.get_running_loop()
        raw = await loop.run_in_executor(
            None, _http_post_json, HASHEOUS_BASE + "/Mcp", payload)
        content = ((raw or {}).get("result") or {}).get("content") or []
        text = content[0].get("text") if content else None
        data = json.loads(text) if text else {}
        return data.get("games") or []

    async def _hasheous_lookup_hash(self, alg: str, value: str):
        url = f"{HASHEOUS_BASE}/Lookup/ByHash/{alg}/{value}"
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _http_get_json, url)

    async def _hasheous_resolve(self, title: str, platform: str = ""):
        """Keyless title -> stable Hasheous game (DataObject) id. Search by name,
        pick the best normalized-title match that carries a reference ROM hash,
        then bridge that hash to the metadata-side game id via Lookup/ByHash."""
        try:
            games = await self._hasheous_search(title, platform)
        except Exception as exc:
            decky.logger.warning(f"hasheous search failed: {exc}")
            return {"ok": False, "error": f"hasheous search: {exc}"}
        if not games:
            return {"ok": False, "error": "no hasheous match"}
        nt = _norm_title(title)
        ranked = [g for g in games if _norm_title(g.get("name")) == nt] or games
        for g in ranked:
            for rom in (g.get("roms") or []):
                for alg in ("sha1", "md5", "crc"):
                    hv = rom.get(alg)
                    if not hv:
                        continue
                    try:
                        res = await self._hasheous_lookup_hash(alg, hv)
                    except Exception:
                        continue
                    rec = res[0] if isinstance(res, list) and res else res
                    if isinstance(rec, dict) and rec.get("id"):
                        return {"ok": True, "id": int(rec["id"]),
                                "name": rec.get("name") or g.get("name") or title,
                                "year": _year_from(g.get("year", "")),
                                "platform": (g.get("platform") or {}).get("name", "")}
        return {"ok": False, "error": "no resolvable rom hash"}

    # --- IGDB enrichment (opt-in; needs a Hasheous client API key) --------- #
    async def _igdb_get(self, path: str, params: dict, key: str):
        """One keyed GET against the IGDB metadata proxy."""
        url = f"{HASHEOUS_BASE}/MetadataProxy/IGDB/{path}?" + urllib.parse.urlencode(params)
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, functools.partial(_http_get_json, url, {"X-Client-API-Key": key})
        )

    async def _igdb_image_hash(self, kind: str, image_id, key: str):
        """Resolve one Cover/Screenshot/Artwork id to its IGDB image hash."""
        try:
            obj = await self._igdb_get(kind, {"Id": int(image_id)}, key)
        except Exception:
            return None
        return _igdb_pick(obj, "image_id", "imageId", "hash")

    async def _igdb_names(self, kind: str, ids, key: str, limit: int = 12):
        """Resolve a list of ids (Genre, Company, …) to their display names."""
        out = []
        for chunk in [list(ids)[:limit]]:
            got = await asyncio.gather(
                *[self._igdb_get(kind, {"Id": int(i)}, key) for i in chunk],
                return_exceptions=True,
            )
            for o in got:
                if isinstance(o, BaseException):
                    continue
                n = _igdb_pick(o, "name")
                if n:
                    out.append(str(n))
        return out

    async def _igdb_delta(self, igdb_id: int, key: str) -> dict:
        """Fetch the IGDB-derived fields for a game. CACHED ON ITS OWN — never
        cache the merged result: the merge depends on what the Hasheous baseline
        already had, so a cached merge made against one baseline would be served
        over a different one. Returns {} on any failure."""
        cached = _read_cache_entry("igdb", str(igdb_id))[0]
        if isinstance(cached, dict):
            return cached

        try:
            game = await self._igdb_get("Game", {"Id": int(igdb_id)}, key)
        except urllib.error.HTTPError as exc:
            # 401/403 = missing/rejected key. Logged without the key itself.
            decky.logger.error(f"igdb: HTTP {exc.code} for game {igdb_id}")
            return {}
        except Exception as exc:
            decky.logger.error(f"igdb: game {igdb_id} failed: {exc}")
            return {}
        if not isinstance(game, dict):
            return {}

        delta = {}

        cover_id = _igdb_pick(game, "cover")
        if cover_id:
            h = await self._igdb_image_hash("Cover", cover_id, key)
            if h:
                delta["header_image"] = _igdb_img(h, IGDB_SIZE_COVER)

        # Screenshots (+ artworks as filler) — the media hero is the whole point
        # of this phase; the keyless baseline has none.
        pairs = ([("Screenshot", i) for i in (_igdb_pick(game, "screenshots") or [])] +
                 [("Artwork", i) for i in (_igdb_pick(game, "artworks") or [])])[:IGDB_MAX_SHOTS]
        shots = []
        if pairs:
            hashes = await asyncio.gather(
                *[self._igdb_image_hash(k, i, key) for k, i in pairs],
                return_exceptions=True,
            )
            for (_kind, ident), h in zip(pairs, hashes):
                if isinstance(h, BaseException) or not h:
                    continue
                shots.append({"id": int(ident),
                              "thumb": _igdb_img(h, IGDB_SIZE_THUMB),
                              "full": _igdb_img(h, IGDB_SIZE_FULL)})
        if shots:
            delta["screenshots"] = shots

        gids = list(_igdb_pick(game, "genres") or [])
        if gids:
            names = await self._igdb_names("Genre", gids, key)
            if names:
                delta["genres"] = [{"id": n, "description": n} for n in names]

        ic_ids = list(_igdb_pick(game, "involved_companies") or [])
        if ic_ids:
            devs, pubs = [], []
            got = await asyncio.gather(
                *[self._igdb_get("InvolvedCompany", {"Id": int(i)}, key)
                  for i in ic_ids[:8]],
                return_exceptions=True,
            )
            for ic in got:
                if isinstance(ic, BaseException) or not isinstance(ic, dict):
                    continue
                cid = _igdb_pick(ic, "company")
                if not cid:
                    continue
                try:
                    comp = await self._igdb_get("Company", {"Id": int(cid)}, key)
                except Exception:
                    continue
                nm = _igdb_pick(comp, "name")
                if not nm:
                    continue
                if _igdb_pick(ic, "developer"):
                    devs.append(str(nm))
                elif _igdb_pick(ic, "publisher"):
                    pubs.append(str(nm))
            if devs:
                delta["developers"] = devs
            if pubs:
                delta["publishers"] = pubs

        summary = _igdb_pick(game, "summary")
        if summary:
            delta["summary_html"] = _sanitize_html(
                "<p>" + html.escape(str(summary), quote=False).replace("\n", "<br>") + "</p>")
            delta["summary_text"] = re.sub(r"\s+", " ", str(summary)).strip()[:320]

        url_ = _igdb_pick(game, "url")
        if url_:
            delta["website"] = _safe_url(url_)

        if delta:
            _write_cache("igdb", str(igdb_id), delta)
        return delta

    async def _igdb_enrich(self, igdb_id: int, base: dict) -> dict:
        """Layer IGDB artwork/details onto a normalized Hasheous AppDetails.

        Best-effort throughout: a bad key, a rate limit or an unexpected shape
        degrades to the keyless baseline rather than blanking the panel. Hasheous
        data WINS wherever it has some — IGDB only fills what was empty. The one
        exception is `screenshots`, which the baseline can never populate.
        """
        key = _igdb_key()
        if not key or not igdb_id:
            return base
        delta = await self._igdb_delta(int(igdb_id), key)
        if not delta:
            return base

        out = dict(base)
        if delta.get("screenshots"):
            out["screenshots"] = delta["screenshots"]
        for field in ("header_image", "website", "developers", "publishers"):
            if delta.get(field) and not out.get(field):
                out[field] = delta[field]
        # Genres: the baseline's are Hasheous tag soup, so prefer IGDB's when it
        # has any — this is a quality upgrade, not a gap-fill.
        if delta.get("genres"):
            out["genres"] = delta["genres"]
        if delta.get("summary_html") and not (base.get("about_html") or "").strip():
            out["about_html"] = delta["summary_html"]
            if not (base.get("short_description") or "").strip():
                out["short_description"] = delta.get("summary_text", "")
        out["igdb_enriched"] = True
        return out

    async def test_igdb(self, game_appid=0):
        """Per-step IGDB probe for the QAM, so a beta tester can see exactly
        where enrichment stops instead of just 'no artwork appeared'. Never
        returns the key itself — only whether one is set and how long it is."""
        key = _igdb_key()
        steps = []

        def step(name, ok, detail=""):
            steps.append({"name": name, "ok": bool(ok), "detail": str(detail)[:200]})

        step("Non-Steam sources enabled", _feature_non_steam(),
             "on" if _feature_non_steam() else "turn it on above")
        step("API key present", bool(key), f"{len(key)} chars" if key else "no key saved")
        if not key:
            return {"ok": False, "steps": steps, "error": "no API key"}

        # Which game? The one on screen if it resolves to Hasheous, else a known
        # public mapping (Super Metroid) so the key itself can still be tested.
        igdb_id, label = 0, ""
        try:
            rec = _read_matches().get(str(int(game_appid or 0)))
        except Exception:
            rec = None
        if isinstance(rec, dict) and rec.get("provider") == "hasheous":
            try:
                raw = await self._fetch(
                    "hasheous", str(rec["provider_id"]),
                    f"{HASHEOUS_BASE}/DataObjects/Game/{int(rec['provider_id'])}",
                    lambda r: _normalize_hasheous(r) if isinstance(r, dict) and r.get("name")
                    else {"ok": False, "error": "no hasheous data"})
                igdb_id = int((raw or {}).get("igdb_id") or 0)
                label = (raw or {}).get("name") or ""
            except Exception as exc:
                step("Look up this game on Hasheous", False, str(exc))
        if igdb_id:
            step("This game maps to IGDB", True, f"{label} -> IGDB {igdb_id}")
        else:
            igdb_id, label = 1103, "Super Metroid (fallback probe)"
            step("This game maps to IGDB", False,
                 "no IGDB mapping for this game; testing the key against a known title")

        try:
            game = await self._igdb_get("Game", {"Id": igdb_id}, key)
            step("IGDB metadata (key accepted)", isinstance(game, dict),
                 _igdb_pick(game, "name") or "no name field")
        except urllib.error.HTTPError as exc:
            step("IGDB metadata (key accepted)", False,
                 f"HTTP {exc.code}" + (" — key rejected" if exc.code in (401, 403) else ""))
            return {"ok": False, "steps": steps, "error": f"HTTP {exc.code}"}
        except Exception as exc:
            step("IGDB metadata (key accepted)", False, str(exc))
            return {"ok": False, "steps": steps, "error": str(exc)}

        shots = list(_igdb_pick(game, "screenshots") or [])
        step("Screenshots listed", bool(shots), f"{len(shots)} found")
        sample = ""
        if shots:
            h = await self._igdb_image_hash("Screenshot", shots[0], key)
            sample = _igdb_img(h, IGDB_SIZE_THUMB) if h else ""
            step("Image address resolved", bool(sample), sample or "no image id on the object")
        return {"ok": True, "steps": steps, "igdb_id": igdb_id,
                "name": label, "sample_image": sample}

    async def resolve_game(self, game_appid, is_shortcut: bool = False,
                           title: str = "", lang: str = "english", cc: str = "us",
                           platform: str = ""):
        """Resolve a library game (Steam or non-Steam shortcut) to the SOURCE to
        fetch content for. A saved match wins. Otherwise a Steam game maps to
        itself, and a non-Steam shortcut is searched on Steam first (best result
        auto-accepted); if Steam has nothing AND non-Steam sources are enabled,
        it falls back to Hasheous by title (+platform). The match is PERSISTED so
        it's never re-identified — only the user changes it. `platform`, when the
        frontend can infer it, disambiguates the Hasheous lookup."""
        try:
            game_appid = int(game_appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}
        rec = _read_matches().get(str(game_appid))
        if rec is not None:
            return _rec_to_result(rec)

        if is_shortcut:
            res = await self._search_store(title or "", lang, cc)
            items = res.get("items") if isinstance(res, dict) and res.get("ok") else []
            nt = _norm_title(title or "")
            exact = next((it for it in items if _norm_title(it.get("name")) == nt), None) if nt else None
            if exact:
                # An exact Steam title match is the best possible source (full
                # store page, media, reviews) — always prefer it.
                store_appid = int(exact["appid"])
            else:
                # No EXACT Steam match. When non-Steam sources are on, try Hasheous
                # BEFORE accepting Steam's fuzzy guess: a retro/emulated title
                # ("Sonic the Hedgehog" for a Genesis ROM) is usually the wrong
                # Steam hit ("Sonic 4"), but Hasheous has the real entry. With the
                # feature OFF this is byte-identical to the old behavior (Steam's
                # best guess, else unmatched).
                if _feature_non_steam():
                    h = await self._hasheous_resolve(title or "", platform)
                    if h.get("ok"):
                        prov_rec = {
                            "provider": "hasheous", "provider_id": int(h["id"]),
                            "platform": h.get("platform", ""), "name": h.get("name", ""),
                            "year": h.get("year", ""), "source": "auto",
                            "ts": int(time.time())}
                        async with self._matches_lock():
                            cur = _read_matches()
                            existing = cur.get(str(game_appid))
                            if existing is not None:
                                return _rec_to_result(existing)
                            cur[str(game_appid)] = prov_rec
                            _write_matches(cur)
                        return _rec_to_result(prov_rec)
                best = _best_match(title or "", items or [])
                if not best:
                    return {"ok": True, "store_appid": None, "matched": False,
                            "name": "", "year": "", "reason": "no store match for title"}
                store_appid = int(best["appid"])
        else:
            store_appid = game_appid

        ny = await self._name_year(store_appid, lang, cc)
        if not ny.get("ok"):
            # Don't persist a broken record. A Steam game still points at itself
            # (its panel shows the normal "unavailable" path); a non-Steam guess
            # that has no store page stays unmatched.
            return {"ok": True,
                    "store_appid": None if is_shortcut else store_appid,
                    "provider": None if is_shortcut else "steam",
                    "provider_id": None if is_shortcut else store_appid,
                    "matched": bool(not is_shortcut), "name": "", "year": "",
                    "reason": ny.get("error", "no store data")}
        # Persist atomically. Re-read UNDER THE LOCK (the snapshot from the top of
        # this method is stale after the awaits above): a manual set_match — or
        # another game's resolve — may have written meanwhile. Honor an existing
        # record instead of overwriting, so auto-match can NEVER clobber a user's
        # manual choice or drop another game's entry.
        async with self._matches_lock():
            cur = _read_matches()
            existing = cur.get(str(game_appid))
            if existing is not None:
                return _rec_to_result(existing)
            cur[str(game_appid)] = {
                "store_appid": store_appid, "name": ny["name"], "year": ny["year"],
                "source": "auto", "ts": int(time.time())}
            _write_matches(cur)
        return {"ok": True, "store_appid": store_appid, "provider": "steam",
                "provider_id": store_appid, "name": ny["name"], "year": ny["year"],
                "source": "auto", "matched": True, "from_cache": False}

    async def lookup_store_app(self, id_or_url, lang: str = "english", cc: str = "us"):
        """Validate a user-entered Steam app ID or store URL -> name + year."""
        appid = _parse_appid(id_or_url)
        if not appid:
            return {"ok": False, "error": "Enter a numeric Steam app ID or a store URL."}
        ny = await self._name_year(appid, lang, cc)
        if not ny.get("ok"):
            return {"ok": False, "appid": appid,
                    "error": ny.get("error") or "No store data for that ID."}
        return {"ok": True, "appid": appid, "name": ny["name"], "year": ny["year"]}

    async def set_match(self, game_appid, store_appid, name: str = "",
                        year: str = "", source: str = "manual"):
        try:
            game_appid = int(game_appid)
            store_appid = int(store_appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}
        async with self._matches_lock():
            matches = _read_matches()
            matches[str(game_appid)] = {
                "store_appid": store_appid, "name": name or "", "year": year or "",
                "source": source or "manual", "ts": int(time.time())}
            _write_matches(matches)
        return {"ok": True}

    async def blank_match(self, game_appid):
        """Clear to BLANK: write a sticky 'cleared' record so the game stays
        unmatched and is never auto-matched again (until Re-detect deletes it)."""
        try:
            game_appid = int(game_appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}
        async with self._matches_lock():
            matches = _read_matches()
            matches[str(game_appid)] = {
                "store_appid": 0, "name": "", "year": "",
                "source": "cleared", "ts": int(time.time())}
            _write_matches(matches)
        return {"ok": True}

    async def clear_match(self, game_appid):
        try:
            game_appid = int(game_appid)
        except Exception:
            return {"ok": False, "error": "invalid appid"}
        async with self._matches_lock():
            matches = _read_matches()
            existed = matches.pop(str(game_appid), None) is not None
            _write_matches(matches)
        return {"ok": True, "existed": existed}

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
            # "auto" -> the frontend resolves it to the Steam client language /
            # region at fetch time (resolveLanguage/resolveCountry in lang.ts).
            # An explicit language name here would be a manual override.
            "language": "auto",
            "country": "auto",
            # Opt in to pre-release "beta" builds in the update check. Default off
            # so risky test builds never reach stable users.
            "beta": False,
            # Opt in to non-Steam / emulated-game metadata via external providers
            # (Hasheous). OFF by default: when off, resolve_game does Steam
            # title-search only and non-Steam misses stay "unmatched".
            "nonSteamSources": False,
            # Hasheous CLIENT API key. Empty = the keyless baseline (logo +
            # description only). With a key, non-Steam games are enriched from
            # IGDB (cover, screenshots, genres, developers). Stored locally in
            # the plugin's settings file and sent ONLY to hasheous.org.
            "hasheousApiKey": "",
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
        """Order versions with prereleases BELOW the release they precede.

        The old form stripped every non-digit, so "0.19.0-beta" collapsed to
        (0,19,0) — identical to the finished 0.19.0, meaning a beta tester was
        told "up to date" forever and never offered the real release. Worse,
        "0.17.0-beta.1" became (0,17,0,1), which sorts ABOVE (0,17,0) and offered
        a prerelease as an upgrade over the finished version.

        Now: compare the numeric core first, then rank release (1) above
        prerelease (0), tie-broken by the prerelease label so beta.2 > beta.1.
        """
        try:
            core, _, pre = str(v).lstrip("vV").partition("-")
            nums = tuple(int(x) for x in re.sub(r"[^0-9.]", "", core).split(".") if x)
            if not nums:
                return ((0,), 1, ())
            # Natural order for the label: "beta.10" must beat "beta.9", which
            # plain string comparison gets wrong.
            label = tuple((0, int(p)) if p.isdigit() else (1, p) for p in pre.split(".") if p)
            return (nums, 0 if pre else 1, label)
        except Exception:
            return ((0,), 1, ())

    async def check_update(self, beta: bool = False):
        """Newest GitHub release vs the installed version (+ notes + download URL).

        Stable channel uses the `releases/latest` endpoint, which EXCLUDES
        pre-releases — so a `-beta` build is invisible to stable users. The beta
        channel looks at all releases (pre-releases included) and takes the
        highest version, so opting in is the ONLY way to be offered a beta, and
        a beta tester is still offered the stable release once it ships.
        """
        current = self._installed_version()
        try:
            loop = asyncio.get_running_loop()
            if beta:
                # Beta channel: consider pre-releases too, and take the HIGHEST
                # version rather than the most recently created — a stable
                # release cut after a beta must still win over it.
                rels = await loop.run_in_executor(
                    None, _http_get_json,
                    "https://api.github.com/repos/Featherwolf/EnhancedGV/releases?per_page=20")
                cands = [r for r in (rels if isinstance(rels, list) else [])
                         if isinstance(r, dict) and not r.get("draft")]
                raw = max(cands, key=lambda r: self._ver_tuple(str(r.get("tag_name", ""))),
                          default={})
            else:
                raw = await loop.run_in_executor(
                    None, _http_get_json,
                    "https://api.github.com/repos/Featherwolf/EnhancedGV/releases/latest")
            latest = str(raw.get("tag_name", "")).lstrip("v")
            zip_url = ""
            for a in raw.get("assets") or []:
                if a.get("name") == "EnhancedGV.zip":
                    zip_url = a.get("browser_download_url", "")
                    break
            return {
                "ok": True,
                "current": current,
                "latest": latest,
                "notes": raw.get("body") or "",
                "has_update": bool(latest) and self._ver_tuple(latest) > self._ver_tuple(current),
                "prerelease": bool(raw.get("prerelease")),
                "channel": "beta" if beta else "stable",
                "url": raw.get("html_url", ""),
                "zip_url": zip_url,
            }
        except Exception as exc:
            decky.logger.error(f"check_update failed: {exc}")
            return {"ok": False, "error": str(exc), "current": current,
                    "channel": "beta" if beta else "stable"}

    async def get_patch_notes(self, version: str = ""):
        """Return the CHANGELOG section for a version (default: the installed one).
        CHANGELOG.md is bundled in the plugin, so this works offline."""
        version = (version or self._installed_version()).lstrip("v")
        try:
            with open(os.path.join(decky.DECKY_PLUGIN_DIR, "CHANGELOG.md"),
                      "r", encoding="utf-8") as fh:
                text = fh.read()
        except Exception as exc:
            return {"ok": False, "version": version, "error": str(exc)}
        base = version.split("-", 1)[0]
        m = (re.search(rf"^## v{re.escape(version)}\s*?\n(.*?)(?=^## |\Z)",
                       text, re.S | re.M)
             # A beta build is stamped "X.Y.Z-beta" but its notes live under
             # "## vX.Y.Z" — a beta carries the version it becomes.
             or re.search(rf"^## v{re.escape(base)}\s*?\n(.*?)(?=^## |\Z)",
                          text, re.S | re.M))
        return {"ok": True, "version": version,
                "notes": m.group(1).strip() if m else ""}

