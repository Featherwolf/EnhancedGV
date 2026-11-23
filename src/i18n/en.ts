// English dictionary — also the hardcoded fallback for any key missing from
// another language (see translate() in index.ts). Keep this file the source
// of truth for which keys exist: TranslationKey is derived from it, so a
// typo here is a compile error everywhere it's used.
export const en = {
  "common.loading": "Loading…",

  // Settings: this game / match editor
  "settings.thisGame": "This game",
  "settings.openStoreView": "Open store view",
  "settings.shortcutLabel": "Shortcut",
  "settings.storePageLabel": "Store page",
  "settings.setByYou": " · set by you",
  "settings.viaProvider": " · via {provider}",
  "settings.notMatched": "Not matched",
  "settings.done": "Done",
  "settings.changeMatch": "Change match",
  "settings.matchToLabel": "Match to",
  "settings.matchToDesc":
    "A Steam app ID or store link, or igdb:ID / hasheous:ID for a game Steam doesn't sell.",
  "settings.saveMatch": "Save match",
  "settings.detectAgain": "Detect again",
  "settings.leaveUnmatched": "Leave unmatched",
  "settings.lookingUp": "Looking up…",
  "settings.lookupFailed": "Lookup failed",
  "settings.matchedTo": "Matched to {name} ({year})",
  "settings.matchedToVia": "Matched to {name} ({year}) · via {provider}",
  "settings.leftUnmatchedMsg":
    "Left unmatched, so no store panel shows for this game. Enter an ID to match it, or choose Detect again.",
  "settings.detecting": "Detecting…",

  // Settings: non-Steam artwork / IGDB credentials
  "settings.credentialsSaved": "Credentials saved.",
  "settings.couldNotSave": "Could not save: {error}",
  "settings.couldNotEraseCredentials": "Could not erase credentials: {error}",
  "settings.credentialsErased":
    "Credentials erased: the ID, the secret and the cached access token are gone from this device. Regenerate the secret at dev.twitch.tv to revoke it everywhere.",
  "settings.couldNotClear": "Could not clear: {error}",
  "settings.sourceYourIgdb": "Your IGDB account",
  "settings.sourceHasheousApp": "EnhancedGV's Hasheous app",
  "settings.sourceHasheous": "Hasheous (description and logo)",
  "settings.artworkFrom": "Artwork from",
  "settings.testing": "Testing…",
  "settings.testArtworkLookup": "Test artwork lookup",
  "settings.hideIgdbAccount": "Hide IGDB account",
  "settings.igdbAccountSaved": "IGDB account (saved)",
  "settings.useOwnIgdbAccount": "Use my own IGDB account",
  "settings.igdbHintSaved":
    "Saved credentials stay through updates and reinstalls. Uninstalling the plugin doesn't remove them, so press Remove credentials first if you want them off this device.",
  "settings.igdbHintAppKey":
    "Optional. Your own credentials add IGDB's title search, which finds console games Hasheous doesn't list. They're free from dev.twitch.tv; the README has the steps.",
  "settings.igdbHintNone":
    "Optional. Without them you get Hasheous' description and logo. They're free from dev.twitch.tv; the README has the steps.",
  "settings.igdbClientId": "IGDB Client ID",
  "settings.igdbClientSecret": "IGDB Client Secret",
  "settings.igdbClientSecretDesc": "Stored on this device and sent only to id.twitch.tv.",
  "settings.saveCredentials": "Save credentials",
  "settings.removeCredentials": "Remove credentials",

  // Settings: video test / layout warning
  "settings.openGamePageFirst": "open a game page first",
  "settings.videoTestFailed": "failed: {error}",
  "settings.layoutMissingWarning":
    "EnhancedGV can't find where to place its panel on this Steam version. Steam's newest beta changed how its interface is built. Update Decky Loader, or switch Steam to the Stable channel, until EnhancedGV is updated.",

  // Settings: update banner
  "settings.updateAvailable": "Update available: v{version}",
  "settings.downloading": "Downloading…",
  "settings.updateToVersion": "Update to v{version}",
  "settings.downloadInstructions":
    "Download EnhancedGV.zip from the release, then choose Decky → Developer → Install Plugin from ZIP.",
  "settings.openReleasePage": "Open the release page",
  "settings.whatsNew": "What's new",

  // Settings: game page / non-Steam games
  "settings.chooseSections": "Choose sections",
  "settings.gamePage": "Game page",
  "settings.nonSteamGames": "Non-Steam games",
  "settings.lookupEmulatedGames": "Look up emulated games",
  "settings.lookupEmulatedGamesDesc":
    "Details, cover art and screenshots from Hasheous for games Steam doesn't sell, such as ROMs added with Steam ROM Manager. Sends the game's name to hasheous.org.",

  // Settings: updates section
  "settings.updates": "Updates",
  "settings.installed": "Installed",
  "settings.latestWithBetas": "Latest, with betas",
  "settings.latest": "Latest",
  "settings.upToDate": " · up to date",
  "settings.updateCheck": "Update check",
  "settings.checkFailed": "failed",
  "settings.checkForUpdates": "Check for updates",
  "settings.betaChannel": "Beta channel",
  "settings.betaChannelDesc": "Also offer test builds of the next release.",
  "settings.installAnotherVersion": "Install another version",
  "settings.openReleasesPage": "Open the releases page",
  "settings.patchNotesForVersion": "Patch notes for this version",

  // Settings: language
  "settings.language": "Language",
  "settings.languageDesc": "Menus and labels in EnhancedGV. Store content follows your Steam language.",
  "settings.languageAuto": "Automatic (System)",

  // Settings: troubleshooting
  "settings.troubleshooting": "Troubleshooting",
  "settings.status": "Status",
  "settings.backendOkWithError": "Backend OK · last game page had an error",
  "settings.backendOk": "Backend OK",
  "settings.lastError": "Last error",
  "settings.clearCacheButton": "Clear cached store data",
  "settings.clearedFiles": "Cleared {n} cached file(s)",
  "settings.clearFailed": "Failed to clear cache",
  "settings.showDiagnostics": "Show diagnostics",
  "settings.diagBackend": "Backend",
  "settings.diagIntegration": "Integration",
  "settings.diagNavBridge": "Nav bridge",
  "settings.diagVideo": "Video",
  "settings.diagCodecs": "Codecs",
  "settings.diagStoreLanguage": "Store language",
  "settings.diagFetch": "Fetch",
  "settings.diagData": "Data (details/reviews/news/deck)",
  "settings.diagSanitizer": "Sanitizer",
  "settings.diagLayoutClass": "Layout class",
  "settings.diagRenderFunc": "renderFunc",
  "settings.diagAppid": "appid",
  "settings.diagNote": "Note",
  "settings.diagPanelRenders": "Panel renders",
  "settings.diagPanelState": "Panel state",
  "settings.diagRoute": "Route / attach / miss",
  "settings.diagMounts": "Mounts (in/out)",
  "settings.diagAges": "Ages",
  "settings.diagNavBridgeFull": "Nav bridge (full)",
  "settings.diagLastMiss": "Last miss",
  "settings.diagPanelBox": "Panel box (w×h @top)",
  "settings.backendNotResponding": "NOT RESPONDING — restart Steam",
  "settings.backendError": "error: {error}",
  "settings.testTrailerConnectivity": "Test trailer connectivity",

  // Sections modal
  "sections.media": "Videos & screenshots",
  "sections.about": "About",
  "sections.features": "Features & details",
  "sections.deck": "Steam Deck compatibility",
  "sections.reviews": "Reviews",
  "sections.news": "Update history",
  "sections.hidden": "Hidden",
  "sections.collapsed": "Collapsed",
  "sections.expanded": "Expanded",
  "sections.shown": "Shown",
  "sections.title": "Game page sections",
  "sections.subtitle": "Choose what shows under a game, and what starts open. Changes apply right away.",
  "sections.summary": "{shown} of {total} shown · {open} start expanded",

  // Version picker modal
  "versionPicker.unavailable": "Unavailable",
  "versionPicker.reinstall": "Reinstall",
  "versionPicker.update": "Update",
  "versionPicker.downgrade": "Downgrade",
  "versionPicker.title": "Install a version",
  "versionPicker.subtitle":
    "Installed: v{current}. Stable releases are finished builds; betas test the next one. Decky asks you to confirm first, and your settings are kept.",
  "versionPicker.couldntLoad": "Couldn't load the list of releases.",
  "versionPicker.noReleases": "No installable releases were found.",
  "versionPicker.installedSuffix": " · installed",
  "versionPicker.beta": "Beta",
  "versionPicker.stable": "Stable",
  "versionPicker.updatesByHand": " · updates by hand from there",

  "update.installNotStarted": "The install didn't start.",

  // Patch notes modal
  "patchNotes.title": "EnhancedGV {ver} — patch notes",
  "patchNotes.couldntLoad": "Couldn't load patch notes.",
  "patchNotes.none": "No patch notes recorded for this version.",

  // Store panel (game page)
  "store.title": "Store",
  "store.notMatchedYet":
    "This game isn't matched to a store page yet. To pick one, open Quick Access → EnhancedGV → This game → Change match.",
  "store.unavailable": "Store content unavailable ({why})",
  "store.sectionFailed": "Couldn't load this section. Try again in a minute.",
  "store.viaProvider": "via {provider}",
  "store.viaProviderIgdb": "via {provider} + IGDB",
  "store.whatsThisAbout": "What's this game about?",
  "store.sectionAbout": "About this game",
  "store.sectionFeatures": "Features & details",
  "store.sectionDeck": "Steam Deck",
  "store.sectionReviews": "Reviews",
  "store.sectionNews": "Update history",
  "store.noStoreData": "no store data",

  // Description section
  "description.none": "No description available.",

  // Features section
  "features.developer": "Developer",
  "features.publisher": "Publisher",
  "features.released": "Released",
  "features.comingSoon": "{date} (Coming soon)",
  "features.platforms": "Platforms",
  "features.controller": "Controller",
  "features.fullSupport": "Full support",
  "features.partialSupport": "Partial support",
  "features.achievements": "Achievements",
  "features.metacritic": "Metacritic",
  "features.price": "Price",
  "features.priceDiscount": "{price}  (-{discount}%)",
  "features.languages": "Languages",

  // Steam Deck compatibility
  "deck.label": "Deck: {label}",
  "deck.none": "No Steam Deck compatibility report.",
  "deck.cat.0": "Unknown",
  "deck.cat.1": "Unsupported",
  "deck.cat.2": "Playable",
  "deck.cat.3": "Verified",

  // Reviews
  "reviews.recommended": "Recommended",
  "reviews.notRecommended": "Not recommended",
  "reviews.hoursPlayed": "{hours}h played",
  "reviews.onDeck": "🎮 on Deck",
  "reviews.onDeckHours": "🎮 {hours}h on Deck",
  "reviews.earlyAccess": "Early Access",
  "reviews.noText": "This review has no written text.",
  "reviews.helpfulOne": "1 person found this helpful",
  "reviews.helpfulMany": "{n} people found this helpful",
  "reviews.readFullAction": "Read full review",
  "reviews.readFullHint": "▸ Press A to read the full review",
  "reviews.noScore": "No score",
  "reviews.all": "All Reviews:",
  "reviews.recent": "Recent Reviews:",
  "reviews.deckPlayers": "Steam Deck Players:",
  "reviews.langReviews": "{lang} Reviews:",
  "reviews.summaryLine": "{pos} up / {neg} down",
  "reviews.chipAll": "All",
  "reviews.chipPositive": "Positive",
  "reviews.chipNegative": "Negative",
  "reviews.chipDeck": "Steam Deck",
  "reviews.loading": "Loading reviews…",
  "reviews.emptyFilter": "No reviews for this filter.",
  "reviews.none": "No reviews available.",

  // Steam store-API language codes (reviews.lang / the "{lang} Reviews:" row)
  // — the code itself ("brazilian", "schinese", …) is an internal API slug,
  // not fit to show as-is. Matches lang.ts's STORE_LANGS exactly.
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

  // Update history (news)
  "news.none": "No recent updates.",
  "news.viewOnline": "View online",
  "news.readFullArticle": "Read the full article on {site}",

  // Media gallery (button glyphs A/B/X and arrows are literal gamepad
  // hardware, kept as-is in every language — only the words are translated)
  "media.none": "No media available.",
  "media.pause": "Pause",
  "media.play": "Play",
  "media.fullscreen": "Fullscreen",
  "media.unmute": "Unmute",
  "media.mute": "Mute",
  "media.exitFullscreen": "Exit Fullscreen",
  "media.browse": "Browse",
  "media.playPause": "Play/Pause",
  "media.exit": "Exit",
  "media.previewUnavailable": " · preview unavailable",

  // Non-Steam data source labels
  "provider.hasheous": "Hasheous",
  "provider.igdb": "IGDB",
  "provider.steam": "Steam",
} as const;

export type TranslationKey = keyof typeof en;
