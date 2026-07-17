import { FocusableBlocks } from "./FocusableBlocks";

interface Props {
  aboutHtml: string;
  short: string;
}

// Scoped styling so Steam's embedded <img>/<h2>/<ul> don't overflow the panel.
const HTML_STYLE = `
.ssp-desc img, .ssp-desc video { max-width: 100%; height: auto; border-radius: 4px; margin: 6px 0; }
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
  const html = aboutHtml || short;
  if (!html) {
    return <div style={{ opacity: 0.6, fontSize: 13 }}>No description available.</div>;
  }
  return (
    <div>
      <style>{HTML_STYLE}</style>
      <FocusableBlocks html={html} blockClass="ssp-desc" />
    </div>
  );
}
