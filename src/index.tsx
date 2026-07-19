import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaStore } from "react-icons/fa";
import { patchLibraryApp, unpatchLibraryApp } from "./patchLibraryApp";
import { QuickAccessSettings } from "./components/QuickAccessSettings";

export default definePlugin(() => {
  console.log("[EnhancedGV] initializing");

  // Register the library app-page patch. This is the plugin's core function.
  const routePatch = patchLibraryApp();

  return {
    name: "EnhancedGV",
    titleView: <div className={staticClasses.Title}>EnhancedGV</div>,
    // Quick Access panel = section toggles + cache controls.
    content: <QuickAccessSettings />,
    icon: <FaStore />,
    onDismount() {
      console.log("[EnhancedGV] unloading");
      unpatchLibraryApp(routePatch);
    },
  };
});
