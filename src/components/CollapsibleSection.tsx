import { useState } from "react";
import type { ReactNode } from "react";
import { Focusable } from "@decky/ui";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";
import { FOCUS_SCROLL_MARGIN, CENTER_ON_FOCUS } from "../focus";

interface Props {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ margin: "6px 0" }}>
      <Focusable
        {...CENTER_ON_FOCUS}
        // onActivate fires for both gamepad OK and pointer/touch — binding
        // onClick too would double-toggle on a pointer click.
        onActivate={() => setOpen((o) => !o)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        focusWithinClassName="gpfocuswithin"
        style={{
          ...FOCUS_SCROLL_MARGIN,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          borderRadius: 4,
          // Unmistakable gamepad-focus feedback (on-device feedback: focus
          // state was too subtle to see from a couch).
          // No transition: animated focus styles repaint during focus-driven
          // page scrolling and read as judder.
          background: focused ? "rgba(26,159,255,0.35)" : "rgba(255,255,255,0.05)",
          outline: focused ? "2px solid #1a9fff" : "2px solid transparent",
          outlineOffset: -2,
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", opacity: 0.85 }}>
          {open ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
        </span>
        <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{title}</span>
        {subtitle && (
          <span style={{ fontSize: 12, opacity: 0.6 }}>{subtitle}</span>
        )}
      </Focusable>
      {open && <div style={{ padding: "10px 4px 4px" }}>{children}</div>}
    </div>
  );
}
