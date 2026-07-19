# Changelog

## v0.17.0

- **Plays nicely with other plugins.** EnhancedGV no longer patches Steam's app-page
  render function or touches its render output. Earlier builds turned the page's
  child element into an array, which crashed **SDH-PlayTime** (it reads that same
  render output) and destabilised **TabMaster** with extra re-render pressure. The
  panel is now injected entirely from EnhancedGV's own component in Decky's tree:
  it finds the visible app page in the DOM, reads that page's app ID from its React
  fiber, and portals the panel in — re-providing the page's gamepad-focus node so
  it stays controller-navigable. No shared Steam React internals are patched.
- **Sharper scaling across displays.** Trailers, screenshots, thumbnails and
  description images now size relative to the screen (Steam Deck 800p, 1080p
  handhelds, 4K TV) instead of a fixed pixel size tuned for a single display.
- **The "What's this game about?" summary is now selectable.** It's a D-pad focus
  stop, so it scrolls into view and can be read on a gamepad — previously the
  cursor skipped over it between the media and the sections.
- **Beta channel.** A new **Beta channel (test builds)** toggle in QAM → Updates
  opts you into pre-release builds. Off by default, and pre-releases are excluded
  from the normal (stable) update check, so a broken beta can't reach stable users.
- **Update panel** now clearly shows the new version, a download/install call to
  action, and an **Open the release page** button.
- **View patch notes (this version)** button in QAM → Updates opens the current
  version's changelog in a popup (CHANGELOG is now bundled with the plugin).

## v0.16.1

- **Fixes special characters** (ampersands, quotes, apostrophes) showing as raw
  codes like `&amp;` / `&#39;` / `&quot;` in About / Features / Update history.
  The HTML sanitizer that runs on the Deck was double-escaping entities that
  Steam had already encoded; it now decodes them first, so `Rock &amp; Roll`
  reads as *Rock & Roll* everywhere. (Angle brackets stay neutralized — no
  security change.)
- **Trailer connectivity test now works for matched non-Steam games.** It was
  probing the non-Steam shortcut's id (no store data); it now uses the matched
  Steam store appid, so it reports the real trailers.
- **Separate Clear and Re-detect** in QAM → Store data source: **Clear (leave
  blank)** erases the match and keeps the game unmatched (won't auto-match again),
  while **Re-detect automatically** re-runs the title search.

## v0.16.0

- **Non-Steam games now get store content too.** When you open a non-Steam game
  (an emulator shortcut, an Epic/GOG title added to Steam, etc.), the plugin
  searches the Steam store by the game's title and auto-matches the best result,
  behind the scenes. The match is remembered so it's only looked up once.
- **Every game's Steam App ID is shown and editable** in Quick Access →
  EnhancedGV → **Store data source**, alongside the matched **Title (Year)** so
  you can confirm the right store page loaded. If a match is wrong, type the
  correct App ID (or paste a `store.steampowered.com/app/…` URL) and save — your
  choice is sticky and never overwritten automatically. **Clear / re-detect**
  wipes it and re-runs auto-matching.
- Matches are stored locally (`matches.json`) and survive updates. A non-Steam
  game with no Steam counterpart stays cleanly "not identified" instead of
  erroring.

## v0.15.0

- **Follows your Steam language.** Store content (description, reviews, news) now
  loads in the language your Steam client is set to, instead of always English.
  The language and store region are detected from Steam's `LocalizationManager`
  (falling back to the client locale) and mapped to the store API using Steam's
  own language table, so e.g. a French client gets French descriptions and a
  Brazilian client gets Brazilian Portuguese. Detection is fully automatic; QAM →
  Status shows a **Store language** row so the detected value is visible.

## v0.14.0

- **Animated graphics and videos now show in the description.** Steam embeds
  autoplaying muted `<video>` clips in "About this game" — for some games (e.g.
  *Thank Goodness You're Here!*) the *entire* description is these clips, so the
  old sanitizer (which dropped every `<video>`) left the section blank, which read
  as "invisible text." `<video>`/`<source>` are now allowed through (safely — no
  event handlers or script URLs), kicked into playing, and paused when scrolled
  off-screen to save battery.
- **Description images now render even without AVIF support.** Steam serves images
  as AVIF, which the Deck client may not decode. Each `<img>` is now a `<picture>`
  offering the AVIF plus an automatic PNG/JPG fallback (the CDN's original), so
  images appear on any client — AVIF-capable ones still get the smaller file.
- **Reviews are now selectable and expandable.** Each review in the list is a
  D-pad focus stop; press **A** to open the full review in a popup you can scroll.
  The list keeps its 5-line preview.
- Set the LICENSE/package author to the `Featherwolf` pseudonym for consistency.

## v0.13.5

- **Actually restores description formatting on the device.** The real cause was
  found: the Decky/SteamOS Python runtime does not provide `html.parser`, so the
  sanitizer was silently falling back to a path that stripped *every* tag, turning
  each store description into a wall of plain text — the v0.13.4 style fix lived in
  the html.parser path that never ran on the handheld. The sanitizer no longer
  depends on `html.parser`: an allowlist tokenizer preserves formatting (line
  breaks, images, lists, safe inline styles) on any runtime. It runs the same
  URL/style/attribute filtering as before and was verified against real store HTML
  and a battery of XSS/overlay payloads (event handlers, `javascript:`/`data:`
  URLs, entity- and tab-obfuscated scripts, `url()`/`position:fixed` overlays) —
  all neutralized, formatting intact.
- Added a **Sanitizer** row to QAM → Advanced diagnostics (engine, whether
  html.parser is present, a live tag self-test, and the Python version) so the
  active path is verifiable on-device instead of guessed.

## v0.13.4

- **Restores description formatting** (images, centering, sizing) that the
  security sanitizer had been stripping. The sanitizer now keeps a safe subset of
  inline styles (text-align, spacing, sizing) and image width/height attributes,
  while still blocking anything executable or tracking-related (event handlers,
  javascript:/data: URLs, url()/position overlays). Cached data refreshes on load.

## v0.13.3

- **Actually fixes the two v0.13.2 issues** (both were real bugs, found by
  analysis):
  - *Streaming trailers*: the cache version wasn't bumped when the stream URL
    field was added, so cached games never received it and streaming could never
    start. Bumped — cached data auto-refreshes on load, no manual clear needed.
  - *Details scrolling*: the content blocks lacked an activation handler, so
    Steam's navigation didn't treat them as focus stops and the D-pad skipped
    right past them. Fixed — the D-pad now steps through About/Features and the
    page scrolls to follow.

## v0.13.2

- **Details scroll on the game page with the D-pad** — no more needing the QAM
  store view. About and Features are now focusable content blocks: press down and
  focus steps through them while the page scrolls to follow (the same mechanism
  the rest of the panel uses). This replaces the fixed-height box, which couldn't
  scroll here because Steam's navigation claimed the D-pad press to move focus and
  right-stick scrolling isn't available in this region.
- **Streaming trailers more robust**: the AV1 stream player now tolerates Steam's
  long-form codec strings (some clients only accept the short form) and reports
  the exact reason in the Video diagnostic if a stream can't play. If a
  manifest-only trailer (e.g. Denshattack's Launch Trailer) still shows a poster,
  press *Clear cached store data* once so the backend re-fetches the stream URL.

## v0.13.1

- **Fixes the backend failing to start in v0.13.0** ("Backend: NOT RESPONDING").
  v0.13.0's new HTML sanitizer imported html.parser at module load; if that ever
  fails on Decky's Python, the whole backend died and every feature hung. The
  import and sanitizer are now fully guarded — the backend always starts, falling
  back to a plain-text description strip if html.parser is unavailable.
- Faster failure surfacing: settings call times out in 6s (was 45s) so a genuinely
  dead backend shows an error quickly instead of an endless placeholder.

## v0.13.0

- **Built-in trailer streaming**: Steam's newest trailers ship only as streaming
  manifests (no downloadable files) — these now play via a lightweight built-in
  AV1 streamer instead of showing just a poster.
- **Security hardening**: replaced the HTML sanitizer with an allowlist parser,
  closing XSS bypasses in game descriptions/news (event handlers, javascript:/
  data: URLs, svg/iframe payloads).
- **Settings persistence fixed**: "Expanded by default" choices are no longer
  reset on Steam restart, and rapid toggles can't be reverted by a slow save.
- **Battery/stability**: diagnostics stop polling when the plugin menu is closed;
  a background trailer can no longer keep decoding invisibly; the carousel
  recovers after a fullscreen trailer ends; review filters can't stick on
  "Loading"; per-game caches are capped; disabling/reloading the plugin fully
  tears down its on-screen panels and timers.

## v0.12.2

- **Fixed About/Features being cut off with no way in** (v0.12.1 regression:
  the scroll box never registered as a focus stop). The box is now reliably
  focusable — **D-pad scrolls the text, A expands/collapses the whole section
  in place** as a guaranteed fallback, with a hint line showing the controls.
- Known limitation identified: some of the very newest trailers (e.g.
  Denshattack's Launch Trailer) exist only as streaming manifests on Steam's
  CDN — no direct video files at all. They show their poster for now; proper
  playback for these needs a streaming player, under consideration.

## v0.12.1

- **Gamepad-scrollable section bodies**: About and Features & details now live in
  their own scroll boxes — focus one with the D-pad and UP/DOWN scroll the text
  itself; at the top/bottom edge the same press moves focus onward. Long
  descriptions are fully readable with the D-pad alone (this replaces the old
  "Read more" clamp). A subtle bottom fade hints when there's more to scroll.

## v0.12.0

- **Self-updater removed** (user decision): with it goes the `_root` privilege —
  the backend runs unprivileged again, the most conservative security posture.
  The *Updates* section still checks GitHub and shows release notes; installing
  a new version is via Decky → Developer → Install Plugin from ZIP.

## v0.11.9

- **Center-on-focus landing**: the hero, thumbnails, Read more/Show less, section
  headers, chips and update-history entries now take direct control of their
  focus landing via Steam's own scroll-handler hook — focused items are centered
  in the viewport, which structurally cannot leave them clipped at an edge.
- **Removed the pointless "Recent" review chip** (the list is already the ~30
  most recent reviews).
- **Privileged-updater hardening**: the update download now requires verified
  TLS and only accepts this repo's release URLs — tightening the `_root`
  surface to the minimum.

## v0.11.8

- **Trailers fixed via VP9-first sources**: the on-device connectivity test
  proved the network fetches trailers at full speed while the player rejects
  every mp4 with `NotSupportedError` — pointing at a Steam client update
  dropping H.264 decode. Steam's CDN hosts royalty-free **VP9 WebM** variants of
  every modern trailer (and plain WebM for classics); the source ladder now
  prefers those, with mp4 kept as fallback. New **Codecs** row in the plugin
  panel shows exactly what this client can decode (h264/vp9/av1).

## v0.11.7

- **In-plugin updates actually work now**: the update failed with "Decky's folder
  is not writable" because plugin backends run unprivileged by default. The
  plugin now declares Decky's `_root` flag so the updater can write the plugin
  folder. Requires ONE more install via zip (flags apply at install); after
  that, the Update button is fully functional. Also removed the `debug` flag.

## v0.11.6

- **Trailer connectivity self-test**: new button in the plugin panel — fetches
  the first chunk of the current game's trailer candidates *from the device
  itself* and reports status/size/speed per URL. One press now distinguishes
  "the CDN is refusing/throttling this device" from "a playback problem in the
  player," which is the open question behind the recurring video failures.

## v0.11.5

- **Bigger, universal focus-landing buffer**: 140px top / 180px bottom on every
  focusable element in the panel — including the Features Metacritic link and
  Update-history entries that previously had none — so navigated items always
  land fully visible with comfortable breathing room.
- **Video resilience**: manually selecting a trailer (thumbnail or ◄ ► on the
  player) retries it even if it previously failed — transient network hiccups no
  longer condemn a trailer for the whole visit. *Note:* if videos broke for you
  after the v0.11.3 update hang, that hang could leave a partially-updated
  install — do one clean install of this release via Decky → Install Plugin from
  ZIP, restart Steam, and press *Clear cached store data* once.

## v0.11.4

- **Fixed the in-plugin updater hanging on "Updating…"**: replacing the plugin's
  own files could make Decky reload the backend mid-call, so the button never got
  its answer. The updater now downloads and stages everything first, replies
  immediately, then swaps the files in a background step (with automatic rollback
  if the swap fails). Added a write-permission preflight with a clear message if
  Decky protects the plugins folder, and a hard frontend timeout so the button
  can never stick.

## v0.11.3

- **Focus-scroll landing buffer**: focused items now stop with breathing room
  (72px top / 120px bottom) instead of landing flush at the screen edge or under
  the bottom button legend when navigating up/down through the panel.
- **Version reporting**: `plugin.json` now carries the version too, kept in sync
  with `package.json`, so every Decky surface reports the same number.

## v0.11.2

- **Exact review scores from Steam's own data**: Recent Reviews now come from the
  store page's review-histogram endpoint (precise 30-day up/down totals, one
  request — no more sampling). Added the store-style language row too:
  "*English* Reviews: Very Positive (N)" using the language-filtered summary.

## v0.11.1

- **Expanded-by-default toggles**: new *Expanded by default* section in the plugin
  panel — choose which sections (About, Features, Steam Deck, Reviews, Update
  history) start open on the game page.
- **Game summary styling**: the short description is now a store-blue accent card
  with a "What's this game about?" header.
- **Older games' trailers**: widened the video source ladder with the legacy CDN
  webm variants (verified live for classic titles) and support for legacy API
  shapes. If an older game still shows "preview unavailable", press *Clear cached
  store data* once — pre-fix source lists may be cached for up to a day.

## v0.11.0

- **Reviews**: Recent Reviews score is now computed from the actual last 30 days of
  reviews (the previous number mistakenly repeated the all-time totals). New filter
  chips on the Reviews section — **All / Recent / Positive / Negative** — always
  sorted most recent first.
- **Media**: the carousel never auto-advances past a playing trailer — videos move
  on only when they finish. Focus-highlight animations removed (they read as judder
  while scrolling).
- **Updates from within Decky**: new *Updates* section in the plugin panel —
  installed version, check-for-updates, one-tap update to the latest release
  (restart Steam to apply), with release notes shown inline.
- **Cleaner plugin panel**: diagnostics slimmed to a short Status block; the full
  debug readout now lives behind an *Advanced diagnostics* toggle.

## v0.10.x

- **Gamepad nav bridge**: the store panel joins Steam's focus tree at its true
  position — D-pad flows header → panel → tabs with native focus scrolling
  (product of reverse-engineering Valve's FocusNavNode system).
- Fixed the focus trap at the media hero (Valve handler convention: unhandled
  directions must return `false`).
- Fixed trailers never playing: Steam's API stopped shipping progressive video
  URLs; they are now derived from the movie ID against the live CDN, driven by a
  deterministic single-`src` source ladder.

## v0.9.x

- Store-style media hero: big 16:9 autoplaying muted trailers, D-pad browsing,
  A play/pause · X mute · Y fullscreen · B exit.
- Animated skeleton placeholder while store data loads.
- Fully controller-navigable **Open store view** modal from the plugin panel.
- Reviews: All-time + Recent score rows; review texts in the user's language.
- About this game defaults to fully expanded.

## Earlier

- The long road: store data backend (SSL fixes for SteamOS), panel injection
  surviving Steam's tab machinery and plugin conflicts, three-tier self-healing
  delivery (courier portal + Decky-global backup), full diagnostics readout.
