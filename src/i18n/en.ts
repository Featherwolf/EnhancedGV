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

  // Steam Deck compatibility
  "deck.none": "No Steam Deck compatibility report.",
  "deck.label": "Deck: {label}",

  // Update history (news)
  "news.none": "No recent updates.",
  "news.viewOnSteam": "View on Steam",

  // Reviews
  "reviews.none": "No reviews available.",
  "reviews.all": "All Reviews:",
  "reviews.recent": "Recent Reviews:",
  "reviews.langReviews": "{lang} Reviews:",
  "reviews.noScore": "No score",
  "reviews.summaryLine": "{pct}% positive · {pos} up / {neg} down",
  "reviews.chipAll": "All",
  "reviews.chipPositive": "Positive",
  "reviews.chipNegative": "Negative",
  "reviews.chipDeck": "Steam Deck",
  "reviews.deckPlayers": "Steam Deck Players:",
  "reviews.loading": "Loading reviews…",
  "reviews.emptyFilter": "No reviews for this filter.",
  "reviews.recommended": "Recommended",
  "reviews.notRecommended": "Not recommended",
  "reviews.hoursPlayed": "{hours}h played",
  "reviews.onDeck": "🎮 on Deck",
  "reviews.onDeckHours": "🎮 {hours}h on Deck",
  "reviews.earlyAccess": "Early Access",
  "reviews.readFullHint": "▸ Press A to read the full review",
  "reviews.readFullAction": "Read full review",
  "reviews.noText": "This review has no written text.",
  "reviews.helpfulOne": "1 person found this helpful",
  "reviews.helpfulMany": "{n} people found this helpful",

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
