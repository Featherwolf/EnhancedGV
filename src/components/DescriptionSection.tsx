import { FocusableBlocks } from "./FocusableBlocks";

interface Props {
  aboutHtml: string;
  short: string;
}

// Scoped styling so Steam's embedded <img>/<h2>/<ul> don't overflow the panel.
const HTML_STYLE = `
.ssp-desc img, .ssp-desc video { max-width: 100%; max-height: 60vh; height: auto; border-radius: 4px; margin: 6px 0; }
.ssp-desc picture { display: block; }
.ssp-desc h1, .ssp-desc h2 { font-size: 16px; margin: 10px 0 6px; }
.ssp-desc ul, .ssp-desc ol { padding-left: 20px; margin: 6px 0; }
.ssp-desc a { color: #66c0f4; }
.ssp-desc p { margin: 6px 0; }
`;

// Full description, no clamp/box: rendered as focusable blocks so the D-pad
// scrolls through it in place (the page follows focus) without needing the QAM
// modal or right-stick scrolling.
export function DescriptionSection({ aboutHtml, short }: Props) {
  // `aboutHtml` has been through the backend's allowlist sanitizer. `short` has
  // NOT — it is a plain-text field, passed through verbatim — so it must never
  // reach FocusableBlocks, whose only sink is dangerouslySetInnerHTML. Using it
  // as an HTML fallback turned an unsanitized string into markup.
  if (aboutHtml) {
    return (
      <div>
        <style>{HTML_STYLE}</style>
        <FocusableBlocks html={aboutHtml} blockClass="ssp-desc" />
      </div>
    );
  }
  if (short) {
    return <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{short}</div>;
  }
  return <div style={{ opacity: 0.6, fontSize: 13 }}>No description available.</div>;
}
