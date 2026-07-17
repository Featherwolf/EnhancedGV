# Type stub for the `decky` runtime module (IntelliSense only).
# At runtime the real module is injected by decky-loader; this file is not shipped-critical.
# Mirrors the constants/functions exposed by decky-loader/plugin/imports/decky.py.
import logging
from typing import Any

# --- Environment / path constants -------------------------------------------
HOME: str
USER: str
DECKY_VERSION: str
DECKY_USER: str
DECKY_USER_HOME: str
DECKY_HOME: str

DECKY_PLUGIN_DIR: str            # /home/deck/homebrew/plugins/<plugin>
DECKY_PLUGIN_SETTINGS_DIR: str   # /home/deck/homebrew/settings/<plugin>
DECKY_PLUGIN_RUNTIME_DIR: str    # /home/deck/homebrew/data/<plugin>
DECKY_PLUGIN_LOG_DIR: str        # /home/deck/homebrew/logs/<plugin>

DECKY_PLUGIN_NAME: str
DECKY_PLUGIN_VERSION: str
DECKY_PLUGIN_AUTHOR: str
DECKY_PLUGIN_LOG: str

# --- Logger -----------------------------------------------------------------
logger: logging.Logger

# --- Backend -> frontend events ---------------------------------------------
async def emit(event: str, *args: Any) -> None: ...

# --- Migration helpers ------------------------------------------------------
def migrate_any(target_dir: str, *files: str) -> dict: ...
def migrate_settings(*files: str) -> dict: ...
def migrate_runtime(*files: str) -> dict: ...
def migrate_logs(*files: str) -> dict: ...
