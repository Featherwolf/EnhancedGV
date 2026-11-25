"""A non-Steam shortcut's system is read from its launch command, and IGDB and
Hasheous matches stay on that system.

Emulated games are matched by title, and one title is on many systems: "Link's
Awakening" is a Game Boy, Game Boy Color, 3DS and Switch game, and Hasheous has
next to no Switch games, so a Switch game used to land on a Game Boy dump or an
N64 rom hack. resolve_game now reads the system from the shortcut (the ROM's
extension, its ROM folder, the emulator) and only accepts listings on it.

Checks that:
- real launch commands (EmuDeck, RetroDECK, RetroArch cores, Flatpaks,
  AppImages, Windows paths) give the right system, and PC games give none;
- Hasheous and IGDB platform names, in all their naming families, are told
  apart (Game Boy from Game Boy Color, Wii from Wii U, Mega Drive from 32X);
- Hasheous and IGDB lookups take only entries on the system, and a lookup
  without one behaves exactly as before;
- an automatic match saved before the system was known is redone once, and
  manual, cleared and same-system matches are left alone;
- the shortcut's paths never leave the device: only a system's name goes out.
Offline and synthetic.
"""
import asyncio, importlib.util, json, logging, os, sys, tempfile, types

ROOT = os.environ.get("EGV_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TMP = tempfile.mkdtemp(prefix="egv-platform-")
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

SW, WIIU, WII, GC = "Nintendo Switch", "Wii U", "Wii", "Nintendo GameCube"
N64, SNES, NES, FDS = "Nintendo 64", "Super Nintendo Entertainment System", "Nintendo Entertainment System", "Family Computer Disk System"
GB, GBC, GBA, DS, N3DS, VB = "Game Boy", "Game Boy Color", "Game Boy Advance", "Nintendo DS", "Nintendo 3DS", "Virtual Boy"
PS1, PS2, PS3, PSP, VITA = "PlayStation", "PlayStation 2", "PlayStation 3", "PlayStation Portable", "PlayStation Vita"
XBOX, X360 = "Xbox", "Xbox 360"
MD, SMS, GG, SCD, S32X, SAT, DC = ("Sega Mega Drive/Genesis", "Sega Master System/Mark III", "Sega Game Gear",
                                   "Sega CD", "Sega 32X", "Sega Saturn", "Dreamcast")
PCE, A2600 = "TurboGrafx-16/PC Engine", "Atari 2600"

def order(*names):
    """Systems in the table's order, as _detect_platform returns them."""
    return tuple(p for p in main._PLATFORMS if p in names)

print("== the system comes from the shortcut's launch command ==")
LAUNCHES = [
    ("EmuDeck Ryujinx launcher + .nsp",
     '"/home/deck/Emulation/tools/launchers/ryujinx.sh"',
     '"/run/media/mmcblk0p1/Emulation/roms/switch/Super Mario Odyssey [0100000000010000].nsp"',
     '"/home/deck/Emulation/tools/launchers/"', order(SW)),
    ("yuzu AppImage + .xci", '"/home/deck/Applications/yuzu-mainline.AppImage"',
     '-f -g "/home/deck/Games/Zelda TOTK.xci"', '"/home/deck/Applications"', order(SW)),
    ("Eden Flatpak, game folder without an extension", '"/usr/bin/flatpak"',
     'run dev.eden_emu.eden "/home/deck/Games/Some Game"', "", order(SW)),
    ("Citron on Windows", r'"C:\Emulators\Citron\citron.exe"', r'"D:\ROMs\Switch\Metroid Dread.nsp"',
     r'"C:\Emulators\Citron\"', order(SW)),
    ("Ryubing, emulator only", '"/home/u/Applications/Ryubing.AppImage"', "", "", order(SW)),
    ("RetroArch Flatpak, snes9x core + .sfc", '"flatpak"',
     'run org.libretro.RetroArch -L /home/deck/.var/app/org.libretro.RetroArch/config/retroarch/cores/'
     'snes9x_libretro.so "/run/media/deck/SD/Emulation/roms/snes/Super Mario World (USA).sfc"', "", order(SNES)),
    ("RetroArch, zipped ROM in roms/snes", '"/home/deck/Emulation/tools/launchers/retroarch.sh"',
     '-L ~/.var/app/org.libretro.RetroArch/config/retroarch/cores/snes9x_libretro.so '
     '"/home/deck/Emulation/roms/snes/Chrono Trigger.zip"', "", order(SNES)),
    ("RetroArch, zipped ROM, folder only (gba)", '"/home/deck/Emulation/tools/launchers/retroarch.sh"',
     '"/home/deck/Emulation/roms/gba/Pokemon Emerald.zip"', "", order(GBA)),
    ("mGBA + .gb: the extension narrows the emulator", '"/usr/bin/mgba-qt"', '"/home/u/roms/Tetris.gb"', "",
     order(GB)),
    ("mGBA alone: its three systems", '"mgba-qt"', "", "", order(GB, GBC, GBA)),
    ("Dolphin + .rvz in roms/gc", '"/home/deck/Emulation/tools/launchers/dolphin-emu.sh"',
     '"/home/deck/Emulation/roms/gc/Metroid Prime.rvz"', "", order(GC)),
    ("Dolphin + .rvz in roms/wii", '"/home/deck/Emulation/tools/launchers/dolphin-emu.sh"',
     '"/home/deck/Emulation/roms/wii/Metroid Prime 3.rvz"', "", order(WII)),
    ("Dolphin Flatpak + .rvz anywhere: GameCube or Wii", '"flatpak"',
     'run org.DolphinEmu.dolphin-emu -b -e "/home/u/Games/Metroid Prime.rvz"', "", order(GC, WII)),
    ("Dolphin + .wbfs", '"dolphin-emu"', '-e "/home/u/Games/Wii Sports.wbfs"', "", order(WII)),
    ("Slippi (a GameCube-only Dolphin)", '"/home/deck/Applications/Slippi_Online-x86_64.AppImage"',
     '-e "/home/deck/Games/Melee.iso"', "", order(GC)),
    ("Cemu + .wua", '"/home/deck/Applications/Cemu.AppImage"',
     '-g "/home/deck/Emulation/roms/wiiu/Mario Kart 8.wua"', "", order(WIIU)),
    ("Cemu + .rpx", '"Cemu.exe"', '-g "D:/WiiU/games/MK8/code/Turbo.rpx"', "", order(WIIU)),
    ("Azahar + .3ds", '"azahar"', '"/home/u/roms/n3ds/Pokemon Y.3ds"', "", order(N3DS)),
    ("melonDS + .nds", '"melonDS"', '"/home/u/roms/nds/Mario Kart DS.nds"', "", order(DS)),
    ("mupen64plus core + .z64", '"retroarch"',
     '-L cores/mupen64plus_next_libretro.so "/x/roms/n64/Super Mario 64.z64"', "", order(N64)),
    ("Nestopia + .fds", '"nestopia"', '"/x/Zelda no Densetsu.fds"', "", order(FDS)),
    ("DuckStation + .chd in roms/psx", '"/home/deck/Emulation/tools/launchers/duckstation.sh"',
     '"/home/deck/Emulation/roms/psx/Crash Bandicoot.chd"', "", order(PS1)),
    ("PCSX2 + an .iso whose title names another emulator", '"pcsx2-qt"',
     '"/home/u/Games/Garden of Eden.iso"', "", order(PS2)),
    ("PPSSPP + .cso", '"ppsspp"', '"/x/God of War.cso"', "", order(PSP)),
    ("RPCS3 + EBOOT.BIN", '"rpcs3"', '--no-gui "/home/u/PS3/dev_hdd0/game/BLUS30443/USRDIR/EBOOT.BIN"', "",
     order(PS3)),
    ("xemu", '"xemu"', '-dvd_path "/x/Halo.iso"', "", order(XBOX)),
    ("Xenia Canary", '"xenia_canary.exe"', '"D:/360/Halo 3.iso"', "", order(X360)),
    ("Flycast + .gdi", '"flycast"', '"/x/Sonic Adventure.gdi"', "", order(DC)),
    ("Genesis Plus GX + .md", '"retroarch"', '-L cores/genesis_plus_gx_libretro.so "/x/Sonic.md"', "",
     order(MD)),
    ("Genesis Plus GX + .gg", '"retroarch"', '-L cores/genesis_plus_gx_libretro.so "/x/Sonic.gg"', "",
     order(GG)),
    ("Genesis Plus GX + .chd in roms/segacd", '"retroarch"',
     '-L cores/genesis_plus_gx_libretro.so "/x/roms/segacd/Sonic CD.chd"', "", order(SCD)),
    ("RetroDECK Flatpak + roms/n64", '"flatpak"',
     "run net.retrodeck.retrodeck '/home/deck/retrodeck/roms/n64/Zelda OOT.z64'", "", order(N64)),
    ("Windows paths, spelled-out ROM folder", r'"C:\RetroArch\retroarch.exe"',
     r'"E:\ROMs\Nintendo 64\Paper Mario.zip"', "", order(N64)),
    ("user called gg, ROM in roms/snes: SNES, not Game Gear",
     '"/home/gg/Emulation/tools/launchers/retroarch.sh"', '"/home/gg/Emulation/roms/snes/F-Zero.zip"', "",
     order(SNES)),
    ("an extension beats a contradicting folder", '"mgba"', '"/home/u/roms/snes/Wario Land.gba"', "",
     order(GBA)),
    ("a ROM named after an emulator is no clue", '"mgba"', '"/x/Dolphin Island.gba"', "", order(GBA)),
    # Not emulated: nothing to go on, so matching behaves as before.
    ("Linux PC game", '"/home/deck/Games/Celeste/Celeste"', "", '"/home/deck/Games/Celeste"', ()),
    ("Windows PC game", r'"C:\Games\Hades\Hades.exe"', "", r'"C:\Games\Hades"', ()),
    ("Playnite launch", r'"C:\Playnite\Playnite.DesktopApp.exe"', "--start 1234-abcd", "", ()),
    ("user called stella (an Atari emulator's name), PC game",
     '"/home/stella/Games/Celeste/Celeste"', "", '"/home/stella/Games/Celeste"', ()),
    ("a Doom WAD is not a Wii channel", '"gzdoom"', '-iwad "/home/u/doom/DOOM2.WAD"', "", ()),
]
for label, exe, args, start, want in LAUNCHES:
    got = main._detect_platform({"exe": exe, "args": args, "dir": start})
    check(f"{label}: {' / '.join(want) or 'none'}", got == want, f"got {got}")
check("no launch command: none", main._detect_platform(None) == ())
check("junk values: none", main._detect_platform({"exe": 5, "args": None, "dir": []}) == ())
check("an enormous command is clamped, not choked on",
      main._detect_platform({"exe": "x", "args": "a" * 200000}) == ())

print("== platform names are told apart, in every naming family ==")
NAMES = [
    ("Nintendo - Game Boy (Parent-Clone)", {GB}), ("Game Boy", {GB}),
    ("Game Boy Color", {GBC}), ("Nintendo - Game Boy Color (Parent-Clone)", {GBC}),
    ("Game Boy Advance", {GBA}), ("Nintendo - Game Boy Advance", {GBA}),
    ("SNES/Super Famicom", {SNES}), ("SNES", {SNES}),
    ("Nintendo - Super Nintendo Entertainment System", {SNES}), ("Super Famicom", {SNES}),
    ("NES", {NES}), ("NES/Famicom", {NES}), ("Nintendo - Nintendo Entertainment System (Headered)", {NES}),
    ("Nintendo Famicom & Entertainment System", {NES}), ("Family Computer", {NES}),
    ("Nintendo - Family Computer Disk System (FDS)", {FDS}), ("Family Computer Disk System", {FDS}),
    ("FDS", {FDS}),
    ("Nintendo 64", {N64}), ("Nintendo - Nintendo 64 (BigEndian)", {N64}), ("-Nintendo 64 (Rom Hacks)-", {N64}),
    ("Nintendo DS", {DS}), ("Nintendo - Nintendo DS (Decrypted)", {DS}), ("Nintendo DSi", {DS}),
    ("Nintendo 3DS", {N3DS}), ("Nintendo - Nintendo 3DS (Digital) (Deprecated)", {N3DS}),
    ("New Nintendo 3DS", {N3DS}),
    ("Nintendo - Wii", {WII}), ("Nintendo - Wii (Digital) (CDN)", {WII}), ("Wii", {WII}),
    ("Nintendo - Wii U", {WIIU}), ("Wii U", {WIIU}), ("Nintendo - Wii U (Digital) (CDN)", {WIIU}),
    ("Nintendo - GameCube", {GC}), ("Nintendo GameCube", {GC}), ("GameCube", {GC}),
    ("Nintendo Switch", {SW}), ("Nintendo Switch 2", set()), ("Virtual Boy", {VB}),
    ("Nintendo - amiibo", set()), ("Audio CD", set()), ("Nintendo - Misc", set()),
    ("Nintendo - Wallpapers", set()), ("Game & Watch", set()), ("Arcade", set()), ("DOS", set()),
    ("PC (Microsoft Windows)", set()),
    ("Sony - PlayStation", {PS1}), ("Sony - PlayStation (PS one Classics) (PSN)", {PS1}), ("PlayStation", {PS1}),
    ("Sony - PlayStation 2", {PS2}), ("Sony - PlayStation 3", {PS3}), ("PlayStation 4", set()),
    ("PSP", {PSP}), ("Sony PlayStation Portable", {PSP}), ("Sony - PlayStation Portable (PSN) (Decrypted)", {PSP}),
    ("Sony - PlayStation Vita (PSN) (Content)", {VITA}), ("PlayStation Vita", {VITA}),
    ("Microsoft - Xbox", {XBOX}), ("Xbox", {XBOX}), ("Microsoft - Xbox 360", {X360}), ("Xbox 360", {X360}),
    ("Xbox One", set()), ("Xbox Series X|S", set()),
    ("Sega - Mega Drive - Genesis", {MD}), ("Genesis/Mega Drive", {MD}), ("Sega Mega Drive & Genesis", {MD}),
    ("Sega Mega Drive/Genesis", {MD}),
    ("Megadrive 32X", {S32X}), ("Sega - 32X", {S32X}), ("Sega 32X", {S32X}),
    ("Sega - Mega CD & Sega CD", {SCD}), ("Sega Mega-CD & Sega CD", {SCD}), ("Sega CD", {SCD}),
    ("Sega - Master System - Mark III", {SMS}), ("Sega Mark III & Master System", {SMS}),
    ("Sega Master System/Mark III", {SMS}),
    ("Sega - Game Gear", {GG}), ("Sega Game Gear", {GG}), ("Sega - Saturn", {SAT}), ("Sega Saturn", {SAT}),
    ("Sega - Dreamcast", {DC}), ("Dreamcast", {DC}),
    ("PC Engine/TurboGrafx-16", {PCE}), ("TurboGrafx-16/PC Engine", {PCE}),
    ("Atari 2600 & VCS", {A2600}), ("Atari 2600", {A2600}),
]
for name, want in NAMES:
    got = {p for p in main._PLATFORMS if main._platform_name_is(name, (p,))}
    check(f"{name!r}: {' / '.join(sorted(want)) or 'none'}", got == want, f"got {sorted(got)}")
check("hint with two systems", main._platforms_from_hint(f"{GC}|{WII}") == order(GC, WII))
check("free-text hint", main._platforms_from_hint("Sega Mega Drive") == order(MD))
check("empty or unknown hint: none",
      main._platforms_from_hint("") == () and main._platforms_from_hint("Toaster") == ())
for p, (filters, _inc, _exc) in main._PLATFORMS.items():
    if not all(main._platform_name_is(f, (p,)) or p == FDS and f == "Disk System" for f in filters):
        check(f"{p}: its own Hasheous filters are recognised as it", False, str(filters))

# --- A Hasheous double: the real search and lookup code runs against it ---- #
HASHEOUS = [  # name, platform, sha1, game id (dumps of one game share an id)
    ("Super Mario Odyssey 64", "-Nintendo 64 (Rom Hacks)-", "h-smo64", 9001),
    ("Super Mario Odyssey", "Nintendo - Wallpapers", "h-smowall", 9002),
    ("Super Mario Odyssey - Original Soundtrack", "Audio CD", "h-smocd", 9003),
    ("Legend Of Zelda - Link's Awakening Dx, The", "Game Boy Color", "h-ladx", 101),
    ("Legend of Zelda, The - Link's Awakening", "Nintendo - Game Boy", "h-lagb", 102),
    ("Legend of Zelda, The - Link's Awakening", "Nintendo - amiibo", "h-laamiibo", 103),
    ("Legend Of Zelda, The - Link's Awakening", "Nintendo 3DS", "h-la3ds", 104),
    ("Super Mario World", "Nintendo - Wii U (Digital) (CDN)", "h-smwwiiu", 201),
    ("Super Mario World", "SNES/Super Famicom", "h-smwsnes", 202),
    ("Super Mario World", "Nintendo - Super Nintendo Entertainment System", "h-smwsnes2", 202),
    ("Metroid Prime", "Nintendo - GameCube", "h-mpgc", 301),
]
BY_HASH = {sha: (gid, name) for name, _plat, sha, gid in HASHEOUS}
SENT = []

def fake_post(url, payload):
    SENT.append(("POST", url, json.dumps(payload)))
    args = payload["params"]["arguments"]
    name, plat = args["name"].lower(), str(args.get("platform") or "").lower()
    games = [{"name": n, "platform": {"name": p}, "year": "",
              "roms": [{"sha1": sha}] if args.get("includeRoms") else []}
             for n, p, sha, _gid in HASHEOUS
             if name in n.lower() and plat in p.lower()][: int(args.get("limit") or 8)]
    return {"result": {"content": [{"text": json.dumps({"games": games})}]}}

def fake_get(url, headers=None):
    SENT.append(("GET", url, ""))
    sha = url.rsplit("/", 1)[-1]
    if sha not in BY_HASH:
        raise OSError("404")
    gid, name = BY_HASH[sha]
    return {"id": gid, "name": name}

main._http_post_json = fake_post
main._http_get_json = fake_get
plugin = main.Plugin()

def run(coro):
    return asyncio.run(coro)

def searches():
    return [json.loads(body)["params"]["arguments"] for kind, _u, body in SENT if kind == "POST"]

print("== Hasheous takes only entries on the shortcut's system ==")
SENT.clear()
r = run(plugin._hasheous_resolve("Super Mario Odyssey", SW))
check("Switch game Hasheous lacks: no match, rather than an N64 rom hack",
      r.get("ok") is False and "Nintendo Switch" in r.get("error", ""), str(r))
s = searches()
check("...searched with the Switch filter first, then without",
      [a.get("platform") for a in s] == ["Switch", None], str(s))
check("...and no hash of another system's dump was looked up",
      not any(k == "GET" for k, _u, _b in SENT))
SENT.clear()
r = run(plugin._hasheous_resolve("Super Mario Odyssey", ""))
check("the same title without a system still takes the old best guess (the bug this fixes)",
      r.get("ok") is True and r.get("id") in (9001, 9002, 9003), str(r))
check("...with no platform filter in its single search",
      len(searches()) == 1 and "platform" not in searches()[0])
SENT.clear()
r = run(plugin._hasheous_resolve("Link's Awakening", GB))
check("Game Boy ROM: the Game Boy dump, not the Color DX one listed first",
      r.get("ok") is True and r.get("id") == 102, str(r))
r = run(plugin._hasheous_resolve("Link's Awakening", ""))
check("...which is what it got without the system", r.get("ok") is True and r.get("id") == 101, str(r))
r = run(plugin._hasheous_resolve("Link's Awakening", GBC))
check("Game Boy Color ROM: the DX dump", r.get("ok") is True and r.get("id") == 101, str(r))
SENT.clear()
r = run(plugin._hasheous_resolve("Super Mario World", SNES))
check("SNES ROM: the SNES dump, not the Wii U Virtual Console one listed first",
      r.get("ok") is True and r.get("id") == 202, str(r))
check("...found by the first filter, in one search", [a.get("platform") for a in searches()] == ["SNES"])
r = run(plugin._hasheous_resolve("Metroid Prime", f"{GC}|{WII}"))
check("GameCube-or-Wii ROM: the GameCube dump", r.get("ok") is True and r.get("id") == 301, str(r))

print("== IGDB takes only games released on the system ==")
LA_GB = {"id": 1027, "name": "The Legend of Zelda: Link's Awakening", "category": 0,
         "first_release_date": 741484800, "platforms": [{"name": "Game Boy"}, {"name": "Nintendo 3DS"}]}
LA_SW = {"id": 115289, "name": "The Legend of Zelda: Link's Awakening", "category": 0,
         "first_release_date": 1569456000, "platforms": [{"name": "Nintendo Switch"}]}
async def fake_igdb_search(title, limit=8):
    return [LA_GB, LA_SW]
plugin._igdb_search = fake_igdb_search
r = run(plugin._igdb_resolve("The Legend of Zelda: Link's Awakening", SW))
check("Switch ROM: the 2019 Switch game, not the same-named 1993 one",
      r.get("ok") is True and r.get("id") == 115289 and r.get("platform") == SW, str(r))
r = run(plugin._igdb_resolve("The Legend of Zelda: Link's Awakening", ""))
check("without the system: unchanged (IGDB's own order)", r.get("ok") is True and r.get("id") == 1027, str(r))
r = run(plugin._igdb_resolve("The Legend of Zelda: Link's Awakening", GB))
check("Game Boy ROM: the 1993 game, its platform shown as Game Boy",
      r.get("ok") is True and r.get("id") == 1027 and r.get("platform") == GB, str(r))
r = run(plugin._igdb_resolve("The Legend of Zelda: Link's Awakening", PS2))
check("no game on the system: no match", r.get("ok") is False, str(r))

print("== saved matches: redone once when the system becomes known ==")
main._feature_non_steam = lambda: True
main._igdb_configured = lambda: False
async def no_steam(term, lang, cc):
    return {"ok": True, "items": []}
plugin._search_store = no_steam
RYUJINX = {"exe": '"/home/deck/Emulation/tools/launchers/ryujinx.sh"',
           "args": '"/run/media/mmcblk0p1/Emulation/roms/switch/Super Mario Odyssey.nsp"',
           "dir": '"/home/deck/Emulation/tools/launchers/"'}
SNES9X = {"exe": '"/home/deck/Emulation/tools/launchers/retroarch.sh"',
          "args": '-L cores/snes9x_libretro.so "/home/deck/Emulation/roms/snes/Super Mario World.sfc"',
          "dir": ""}
PC_GAME = {"exe": '"/home/deck/Games/Celeste/Celeste"', "args": "", "dir": '"/home/deck/Games/Celeste"'}
old_guess = {"provider": "hasheous", "provider_id": 9001, "platform": "-Nintendo 64 (Rom Hacks)-",
             "name": "Super Mario Odyssey 64", "year": "", "source": "auto",
             "gen": main.MATCH_GENERATION, "ts": 1}
main._write_matches({
    "111": dict(old_guess),
    "222": dict(old_guess, source="manual"),
    "333": dict(old_guess, hint=SW),
    "444": dict(old_guess),
    "666": dict(old_guess),
    "777": {"store_appid": None, "name": "", "year": "", "source": "cleared"},
})
SENT.clear()
r = run(plugin.resolve_game(111, True, "Super Mario Odyssey", "english", "us", "", RYUJINX))
saved = main._read_matches()
check("old N64-rom-hack guess for a Switch game is redone, and dropped when nothing on Switch matches",
      r.get("matched") is False and "111" not in saved, str(r))
check("...and the Quick Access panel is told the system", r.get("system") == [SW], str(r.get("system")))
SENT.clear()
r = run(plugin.resolve_game(222, True, "Super Mario Odyssey", "english", "us", "", RYUJINX))
check("a match the user set is never redone (and nothing is asked)",
      r.get("provider_id") == 9001 and r.get("source") == "manual" and not SENT, str(r))
r = run(plugin.resolve_game(333, True, "Super Mario Odyssey", "english", "us", "", RYUJINX))
check("a match made with the same system is kept (and nothing is asked)",
      r.get("provider_id") == 9001 and not SENT, str(r))
r = run(plugin.resolve_game(444, True, "Celeste", "english", "us", "", PC_GAME))
check("no system to go on: the saved match is kept (and nothing is asked)",
      r.get("provider_id") == 9001 and r.get("system") == [] and not SENT and "444" in main._read_matches(),
      str(r))
r = run(plugin.resolve_game(777, True, "Super Mario Odyssey", "english", "us", "", RYUJINX))
check("a match the user cleared stays cleared", r.get("matched") is False and not SENT
      and main._read_matches().get("777", {}).get("source") == "cleared", str(r))
SENT.clear()
r = run(plugin.resolve_game(555, True, "Super Mario World", "english", "us", "", SNES9X))
rec = main._read_matches().get("555", {})
check("new SNES shortcut: matched to the SNES game and saved with its system",
      r.get("provider_id") == 202 and rec.get("provider_id") == 202 and rec.get("hint") == SNES, str(rec))
SENT.clear()
r = run(plugin.resolve_game(555, True, "Super Mario World", "english", "us", "", SNES9X))
check("...and reused from then on (nothing is asked)", r.get("provider_id") == 202 and not SENT)
main._feature_non_steam = lambda: False
SENT.clear()
r = run(plugin.resolve_game(666, True, "Super Mario Odyssey", "english", "us", "", RYUJINX))
check("with non-Steam sources off, a saved provider match is kept for when they're back on",
      r.get("matched") is False and "666" in main._read_matches() and not SENT, str(r))
main._feature_non_steam = lambda: True
async def steam_name(appid, lang, cc):
    return {"ok": True, "name": "Counter-Strike 2", "year": "2023"}
plugin._name_year = steam_name
r = run(plugin.resolve_game(730, False, "", "english", "us"))
check("a Steam game is not given a system", "system" not in r, str(r))

print("== IGDB is searched through EnhancedGV's Hasheous app first; the user's account is the fallback ==")
calls = []
real_app_search, real_own_search = plugin._hasheous_igdb_resolve, plugin._igdb_resolve
def app_answer(result):
    async def fake(title, platform):
        calls.append(("app", platform))
        return dict(result)
    return fake
def own_answer(result):
    async def fake(title, platform=""):
        calls.append(("own", platform))
        return dict(result)
    return fake
APP_EXACT = {"ok": True, "provider": "igdb", "id": 145, "name": "Kirby and the Forgotten Land",
             "year": "2022", "platform": SW, "exact": True}
APP_LOOSE = dict(APP_EXACT, id=146, name="Kirby and the Forgotten Land: Expansion Pass", exact=False)
OWN_EXACT = dict(APP_EXACT, id=777)
OWN_LOOSE = dict(APP_LOOSE, id=778)
NO_MATCH = {"ok": False, "error": "no igdb match"}
for label, appid, launch, has_creds, app_r, own_r, want_id, want_calls in (
        ("found through the app: the user's account isn't asked",
         1001, RYUJINX, True, APP_EXACT, OWN_EXACT, 145, ["app"]),
        ("the app finds nothing: the user's account answers",
         1002, RYUJINX, True, NO_MATCH, OWN_EXACT, 777, ["app", "own"]),
        ("the app finds no exact title but the user's account does: that one",
         1003, RYUJINX, True, APP_LOOSE, OWN_EXACT, 777, ["app", "own"]),
        ("neither finds an exact title: the app's answer stands",
         1004, RYUJINX, True, APP_LOOSE, OWN_LOOSE, 146, ["app", "own"]),
        ("no system, so the app can't search: the user's account answers",
         1005, PC_GAME, True, APP_EXACT, OWN_EXACT, 777, ["own"]),
        ("no account saved: the app's answer, nothing else asked",
         1006, RYUJINX, False, APP_EXACT, OWN_EXACT, 145, ["app"])):
    calls.clear()
    plugin._hasheous_igdb_resolve = app_answer(app_r)
    plugin._igdb_resolve = own_answer(own_r)
    main._igdb_configured = (lambda v: (lambda: v))(has_creds)
    r = run(plugin.resolve_game(appid, True, "Kirby and the Forgotten Land", "english", "us", "", launch))
    check(label, r.get("provider_id") == want_id and [c for c, _p in calls] == want_calls,
          (r.get("provider_id"), calls))
calls.clear()
SENT.clear()
plugin._hasheous_igdb_resolve = app_answer(NO_MATCH)
main._igdb_configured = lambda: False
r = run(plugin.resolve_game(1007, True, "Kirby and the Forgotten Land", "english", "us", "", RYUJINX))
check("the app finds nothing and no account: Hasheous' ROM index is asked last",
      [c for c, _p in calls] == ["app"] and len(searches()) >= 1 and r.get("matched") is False,
      (calls, searches(), r))
plugin._hasheous_igdb_resolve, plugin._igdb_resolve = real_app_search, real_own_search

print("== the shortcut's paths never leave the device ==")
SENT.clear()
def proxy_open(req, timeout=None):   # Hasheous' IGDB proxy: keyed, no games found
    SENT.append(("PROXY", req.full_url, ""))
    raise main.urllib.error.HTTPError(req.full_url, 404, "Not Found", None, None)
main._IGDB_OPENER.open = proxy_open
main._hasheous_app_key = lambda: "egv-test-key-0123456789abcdef"
for appid, launch in ((901, RYUJINX), (902, SNES9X)):
    run(plugin.resolve_game(appid, True, "Super Mario World", "english", "us", "", launch))
everything = " ".join(url + " " + body for _k, url, body in SENT).lower()
leaks = [frag for frag in ("/home/deck", "emulation", "/roms/", ".nsp", ".sfc", "launchers", "retroarch",
                           "mmcblk0p1", "ryujinx", "snes9x") if frag in everything]
check("no part of a launch command is in any request", not leaks, str(leaks))
filters = {a.get("platform") for a in searches()} - {None}
allowed = {f for fs, _i, _e in main._PLATFORMS.values() for f in fs}
check("only a system's name goes out, as a Hasheous platform filter", filters <= allowed, str(filters))
proxied = [main.urllib.parse.urlsplit(url) for kind, url, _b in SENT if kind == "PROXY"]
check("the app's IGDB searches were made, for both systems",
      sorted(p.path.rsplit("/", 2)[-2] for p in proxied) == ["130", "19"], [p.path for p in proxied])
check("...each carrying only the game's title and IGDB's platform id",
      all(main.re.fullmatch(r"/api/v1/MetadataProxy/IGDB/Search/Platform/\d+/Game", p.path)
          and dict(main.urllib.parse.parse_qsl(p.query)) == {"SearchString": "Super Mario World"}
          for p in proxied), [p.geturl() for p in proxied])

print(f"\n{ok} passed, {fail} failed")
if fail:
    sys.exit(1)
print("PASS - a shortcut's system is read from its launch command, and matches stay on it.")
