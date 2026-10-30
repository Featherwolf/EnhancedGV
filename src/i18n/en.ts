/**
 * English (default/fallback) UI strings.
 *
 * This is the plugin's OWN interface text (section titles, settings labels,
 * empty-state messages, button legends) — never the Steam store content
 * itself (descriptions, reviews, news), which Steam already serves in the
 * language resolved by lang.ts/resolveLanguage. The two are independent: a
 * user can read the store description in French while the plugin's own
 * buttons stay in Portuguese, or vice versa.
 */
export const en = {
  // Store panel chrome
  "store.title": "Store",
  "store.unmatched":
    "This game isn’t matched to a Steam store page yet. Set its Steam App ID from Quick Access → EnhancedGV → Store data source to pull content.",
  "store.unavailable": "Store content unavailable ({reason})",
  "store.noStoreData": "no store data",
  "store.whatsThisAbout": "What's this game about?",
  "store.via": "via {provider}",

  // Collapsible section titles
  "section.about": "About this game",
  "section.features": "Features & details",
  "section.deck": "Steam Deck",
  "section.reviews": "Reviews",
  "section.news": "Update history",

  // Data-source provider labels
  "provider.steam": "Steam",
  "provider.igdb": "IGDB",
  "provider.hasheous": "Hasheous",

  // About / description
  "description.none": "No description available.",

  // Features & details
  "features.developer": "Developer",
  "features.publisher": "Publisher",
  "features.released": "Released",
  "features.comingSoon": "{date} (Coming soon)",
  "features.platforms": "Platforms",
  "features.controller": "Controller",
  "features.controllerFull": "Full support",
  "features.controllerPartial": "Partial support",
  "features.achievements": "Achievements",
  "features.metacritic": "Metacritic",
  "features.price": "Price",
  "features.languages": "Languages",

  // Best-effort translation for genre/theme pills. Steam's own genres/
  // categories already arrive pre-localized (via get_appdetails' l= param),
  // so these keys never match them and they render unchanged either way.
  // They exist for non-Steam (Hasheous) games, whose AI-generated tags have
  // no translation API to call — an open, ever-growing vocabulary across
  // every game, so this covers only the common, reusable genre/theme words;
  // anything not listed here renders as the original English tag text
  // (see tagLabel in FeaturesSection.tsx).
  "tag.platform": "Platform",
  "tag.platformer": "Platformer",
  "tag.action": "Action",
  "tag.adventure": "Adventure",
  "tag.action_adventure": "Action-Adventure",
  "tag.puzzle": "Puzzle",
  "tag.shooter": "Shooter",
  "tag.racing": "Racing",
  "tag.rpg": "RPG",
  "tag.strategy": "Strategy",
  "tag.simulation": "Simulation",
  "tag.sports": "Sports",
  "tag.horror": "Horror",
  "tag.stealth": "Stealth",
  "tag.survival": "Survival",
  "tag.fighting": "Fighting",
  "tag.arcade": "Arcade",
  "tag.indie": "Indie",
  "tag.retro": "Retro",
  "tag.multiplayer": "Multiplayer",
  "tag.singleplayer": "Singleplayer",
  "tag.single_player": "Single-Player",
  "tag.card": "Card",
  "tag.party": "Party",
  "tag.music": "Music",
  "tag.rhythm": "Rhythm",
  "tag.educational": "Educational",
  "tag.trivia": "Trivia",
  "tag.roguelike": "Roguelike",
  "tag.sandbox": "Sandbox",
  "tag.exploration": "Exploration",
  "tag.combat": "Combat",
  "tag.competitive": "Competitive",
  "tag.turn_based": "Turn-Based",
  "tag.top_down": "Top-Down",
  "tag.side_view": "Side View",
  "tag.collect": "Collect",
  "tag.construction": "Construction",

  // Steam Deck compatibility
  "deck.none": "No Steam Deck compatibility report.",
  "deck.label": "Deck: {label}",
  // Category labels (Steam's own compat-report endpoint never localizes —
  // verified live: l=brazilian and l=english come back byte-identical — so
  // these are translated here instead of trusting the backend's label).
  "deck.cat.0": "Unknown",
  "deck.cat.1": "Unsupported",
  "deck.cat.2": "Playable",
  "deck.cat.3": "Verified",
  // Per-note explanations, keyed by the normalized loc_token (see
  // DeckCompat.notes[].token in types.ts). Same reasoning as deck.cat.* —
  // Steam sends only the raw token, never resolved text, in any language.
  "deck.note.DefaultControllerConfigFullySupported":
    "Default controller configuration is fully supported",
  "deck.note.DefaultControllerConfigFullyFunctional":
    "Default controller configuration is fully supported",
  "deck.note.ControllerGlyphsMatchDeckDevice":
    "In-game controller glyphs match the Deck",
  "deck.note.DefaultConfigurationIsPerformant":
    "Default graphics configuration performs well",
  "deck.note.TextIsLegible": "In-game text is legible",
  "deck.note.InterfaceTextIsLegible": "In-game text is legible",
  "deck.note.ResolutionSupported": "Native display resolution is supported",
  "deck.note.DisplayOutputHasBlackBars":
    "Display has black bars (non-native aspect ratio)",
  "deck.note.TextInputDoesNotAutomaticallyInvokesKeyboard":
    "On-screen keyboard is not brought up automatically for text input",
  "deck.note.LauncherInteractionIssues":
    "Launcher/setup requires extra interaction",
  "deck.note.ExternalControllersNotSupportedInLauncher":
    "Some functionality is not accessible with the built-in controls",
  "deck.note.GamepadNavigationInGameStore":
    "This game shows the on-screen keyboard when needed",

  // Update history (news)
  "news.none": "No recent updates.",
  // Opens the item's own link (Steam's announcement page, or a Nintendo
  // eShop article for a Switch game) — not source-specific, unlike the old
  // "View on Steam" wording, which was wrong for every non-Steam item.
  "news.viewOnline": "View online",

  // Reviews
  "reviews.none": "No reviews available.",
  "reviews.all": "All Reviews:",
  "reviews.recent": "Recent Reviews:",
  "reviews.langReviews": "{lang} Reviews:",
  "reviews.noScore": "No score",
  // Bucket for the 30-day score (recent.desc) — computed locally from the
  // histogram, not fetched from Steam, so it has no Steam reply to localize
  // (unlike summary.desc/lang_summary.desc, which come back already in the
  // right language via get_reviews' own l= param).
  "reviews.bucket.overwhelmingly_positive": "Overwhelmingly Positive",
  "reviews.bucket.very_positive": "Very Positive",
  "reviews.bucket.mostly_positive": "Mostly Positive",
  "reviews.bucket.mixed": "Mixed",
  "reviews.bucket.mostly_negative": "Mostly Negative",
  "reviews.bucket.very_negative": "Very Negative",
  // Display name for a Steam store-API language code (reviews.lang / the
  // "{lang} Reviews:" row) — the code itself ("brazilian", "schinese", …) is
  // an internal API slug, not fit to show as-is. Matches lang.ts's
  // STORE_LANGS exactly.
  "lang.english": "English",
  "lang.german": "German",
  "lang.french": "French",
  "lang.italian": "Italian",
  "lang.koreana": "Korean",
  "lang.latam": "Spanish (Latin America)",
  "lang.spanish": "Spanish",
  "lang.schinese": "Chinese (Simplified)",
  "lang.tchinese": "Chinese (Traditional)",
  "lang.russian": "Russian",
  "lang.thai": "Thai",
  "lang.japanese": "Japanese",
  "lang.brazilian": "Portuguese (Brazil)",
  "lang.portuguese": "Portuguese",
  "lang.polish": "Polish",
  "lang.danish": "Danish",
  "lang.dutch": "Dutch",
  "lang.finnish": "Finnish",
  "lang.norwegian": "Norwegian",
  "lang.swedish": "Swedish",
  "lang.hungarian": "Hungarian",
  "lang.czech": "Czech",
  "lang.romanian": "Romanian",
  "lang.turkish": "Turkish",
  "lang.arabic": "Arabic",
  "lang.bulgarian": "Bulgarian",
  "lang.greek": "Greek",
  "lang.ukrainian": "Ukrainian",
  "lang.vietnamese": "Vietnamese",
  "lang.indonesian": "Indonesian",
  "reviews.summaryLine": "{pct}% positive · {pos} up / {neg} down",
  "reviews.chipAll": "All",
  "reviews.chipPositive": "Positive",
  "reviews.chipNegative": "Negative",
  "reviews.loading": "Loading reviews…",
  "reviews.emptyFilter": "No reviews for this filter.",
  "reviews.recommended": "Recommended",
  "reviews.notRecommended": "Not recommended",
  "reviews.hoursPlayed": "{hours}h played",
  "reviews.onDeck": "🎮 on Deck",
  "reviews.earlyAccess": "Early Access",
  "reviews.readFullHint": "▸ Press A to read the full review",
  "reviews.readFullAction": "Read full review",
  "reviews.noText": "This review has no written text.",

  // Media gallery (button glyphs A/B/X and arrows are literal gamepad
  // references kept outside these strings — only the action word is localized)
  "media.none": "No media available.",
  "media.browse": "Browse",
  "media.playPause": "Play/Pause",
  "media.mute": "Mute",
  "media.unmute": "Unmute",
  "media.exit": "Exit",
  "media.fullscreen": "Fullscreen",
  "media.exitFullscreen": "Exit Fullscreen",
  "media.play": "Play",
  "media.pause": "Pause",

  // Patch notes modal
  "patchNotes.title": "EnhancedGV {version} — patch notes",
  "patchNotes.loading": "Loading…",
  "patchNotes.loadError": "Couldn't load patch notes.",
  "patchNotes.none": "No patch notes recorded for this version.",

  // Quick Access Settings — store data source
  "settings.openStoreView": "Open store view (fully controller-navigable)",
  "settings.storeDataSource": "Store data source",
  "settings.game": "Game",
  "settings.sourceIdLabel": "Source ID or URL",
  "settings.sourceIdDesc":
    "A Steam app ID or store URL, or igdb:12345 / hasheous:12345 to point at a non-Steam listing. Useful when a retro game matched the wrong platform, or a modern console game found nothing.",
  "settings.matched": "Matched",
  "settings.notIdentified": "not identified",
  "settings.saveId": "Save ID",
  "settings.clearBlank": "Clear (leave blank)",
  "settings.redetect": "Re-detect automatically",
  "settings.lookingUp": "Looking up…",
  "settings.lookupFailed": "Lookup failed",
  "settings.setTo": "Set to {name} ({year})",
  "settings.setToVia": "Set to {name} ({year}) · via {provider}",
  "settings.clearedBlank":
    "Cleared — left blank. Enter an ID above to match it, or Re-detect.",
  "settings.redetecting": "Re-detecting…",

  // Quick Access Settings — non-Steam / IGDB
  "settings.nonSteamTitle": "Non-Steam games (experimental)",
  "settings.nonSteamToggle": "Metadata for emulated / non-Steam games",
  "settings.nonSteamDesc":
    "When a non-Steam game has no Steam store page, pull a description, artwork and details from Hasheous (a free, keyless community database). Off by default. Works best for games added as their own Steam shortcut (e.g. via Steam ROM Manager).",
  "settings.igdbClientId": "IGDB Client ID (optional)",
  "settings.igdbClientIdDescSaved":
    "IGDB credentials are saved. Retro games get covers, screenshots, genres and developers instead of just a logo and description. They stay saved across plugin updates and reinstalls, and uninstalling the plugin does not remove them — press Remove credentials first if you want them off the device.",
  "settings.igdbClientIdDescUnsaved":
    "Without these you get the keyless baseline: logo + description. Free to obtain: create a Twitch account, enable two-factor, then register an application at dev.twitch.tv/console with Client Type set to Confidential. Full steps are in the plugin README.",
  "settings.igdbClientSecret": "IGDB Client Secret",
  "settings.igdbClientSecretDesc":
    "Generated with [New Secret] on that same Twitch application page. Stored on this device and sent only to id.twitch.tv to mint an access token.",
  "settings.saveCredentials": "Save credentials",
  "settings.removeCredentials": "Remove credentials",
  "settings.testArtwork": "Test artwork lookup",
  "settings.testing": "Testing…",
  "settings.credentialsSaved": "Credentials saved.",
  "settings.couldNotSave": "Could not save: {error}",
  "settings.credentialsErased":
    "Credentials erased — the id, the secret and the cached access token are gone from this device. Regenerate the secret at dev.twitch.tv to revoke it everywhere.",
  "settings.couldNotClear": "Could not clear: {error}",
  "settings.result": "Result",

  // Quick Access Settings — sections shown / expanded
  "settings.sectionsShown": "Sections shown on the game page",
  "settings.expandedByDefault": "Expanded by default",
  "settings.sectionMedia": "Media (videos & screenshots)",
  "settings.sectionAbout": "About / description",
  "settings.sectionFeaturesDetails": "Features & details",
  "settings.sectionDeckCompat": "Steam Deck compatibility",
  "settings.sectionReviews": "Reviews",
  "settings.sectionUpdateHistory": "Update history",

  // Quick Access Settings — cache
  "settings.cache": "Cache",
  "settings.clearCache": "Clear cached store data",
  "settings.cacheClearedToast": "Cleared {count} cached file(s)",
  "settings.cacheClearFailedToast": "Failed to clear cache",

  // Quick Access Settings — updates
  "settings.updates": "Updates",
  "settings.installedVersion": "Installed version",
  "settings.latestBeta": "Latest (beta channel)",
  "settings.latestRelease": "Latest release",
  "settings.updateAvailableSuffix": " — update available!",
  "settings.upToDateSuffix": " — up to date",
  "settings.updateCheckLabel": "Update check",
  "settings.updateCheckFailed": "failed",
  "settings.viewPatchNotes": "View patch notes (this version)",
  "settings.checkForUpdates": "Check for updates",
  "settings.betaChannel": "Beta channel (test builds)",
  "settings.betaChannelDesc":
    "Include pre-release test builds in the update check. Off by default. A beta carries the version number it will become, and you'll be offered the final release when it ships.",
  "settings.updateAvailable": "Update available: v{version}",
  "settings.downloadInstructions":
    "Download <b>EnhancedGV.zip</b> from the GitHub release, then in Decky choose <b>Developer → Install Plugin from ZIP</b> and restart Steam.",
  "settings.openReleasePage": "Open the release page",

  // Quick Access Settings — language
  "settings.language": "Language",
  "settings.languageAuto": "Automatic (System)",
  "settings.languageEnglish": "English",
  "settings.languagePortuguese": "Português (Brasil)",

  // Quick Access Settings — status / diagnostics
  "settings.statusTitle": "Status",
  "settings.statusBackend": "Backend",
  "settings.statusIntegration": "Integration",
  "settings.statusNavBridge": "Nav bridge",
  "settings.statusVideo": "Video",
  "settings.statusCodecs": "Codecs",
  "settings.statusStoreLanguage": "Store language",
  "settings.statusFetch": "Fetch",
  "settings.statusDataOk": "Data (details/reviews/news/deck)",
  "settings.statusDataError": "Data error",
  "settings.testTrailerConnectivity": "Test trailer connectivity (current game)",
  "settings.advancedDiagnostics": "Advanced diagnostics",
  "settings.diagSanitizer": "Sanitizer",
  "settings.diagLayoutClass": "Layout class",
  "settings.diagRenderFunc": "renderFunc",
  "settings.diagAppid": "appid",
  "settings.diagNote": "Note",
  "settings.diagPanelRenders": "Panel renders",
  "settings.diagPanelState": "Panel state",
  "settings.diagRouteAttachMiss": "Route / attach / miss",
  "settings.diagMounts": "Mounts (in/out)",
  "settings.diagAges": "Ages",
  "settings.diagNavBridgeFull": "Nav bridge (full)",
  "settings.diagLastMiss": "Last miss",
  "settings.diagPanelBox": "Panel box (w×h @top)",
  "settings.diagMissing": "MISSING",

  "settings.backendChecking": "checking…",
  "settings.backendOk": "ok",
  "settings.backendError": "error: {error}",
  "settings.backendNotResponding": "NOT RESPONDING — restart Steam",
  "settings.videoTestNoGame": "open a game page first",
  "settings.videoTestTesting": "testing…",
  "settings.videoTestFailed": "failed: {error}",

  // Short yes/no/unknown, used by the diagnostics readout
  "common.yes": "yes",
  "common.no": "NO",
};

export type TranslationKey = keyof typeof en;
