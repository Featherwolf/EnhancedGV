import { ModalRoot } from "@decky/ui";
import { StorePanel } from "./StorePanel";

// Full store view inside a modal. Modals are native gamepad focus ROOTS in
// Steam's UI, so — unlike the inline panel, whose focus reachability is hostage
// to page tree politics — every control in here (hero, thumbnails, sections)
// is guaranteed D-pad navigable. B closes it.
export function FullStoreModal({
  appid,
  closeModal,
}: {
  appid: number;
  closeModal?: () => void;
}) {
  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal} bAllowFullSize>
      <div style={{ maxHeight: "82vh", overflowY: "auto", padding: "0 2px" }}>
        <StorePanel appid={appid} slot="modal" />
      </div>
    </ModalRoot>
  );
}
