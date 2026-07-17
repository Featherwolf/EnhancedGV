import {
  Focusable,
  DialogButton,
  showModal,
  ModalRoot,
  Navigation,
} from "@decky/ui";
import type { News, NewsItem } from "../types";
import { FOCUS_SCROLL_MARGIN, CENTER_ON_FOCUS } from "../focus";

function fmtDate(unix: number): string {
  try {
    return new Date(unix * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

const NEWS_HTML_STYLE = `
.ssp-news img { max-width: 100%; height: auto; border-radius: 4px; margin: 6px 0; }
.ssp-news a { color: #66c0f4; }
.ssp-news ul, .ssp-news ol { padding-left: 20px; }
`;

function NewsModal({
  item,
  closeModal,
}: {
  item: NewsItem;
  closeModal?: () => void;
}) {
  return (
    <ModalRoot onCancel={closeModal} onEscKeypress={closeModal}>
      <style>{NEWS_HTML_STYLE}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{item.title}</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {item.feedlabel} · {fmtDate(item.date)}
        </div>
        <div
          className="ssp-news"
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            maxHeight: "60vh",
            overflowY: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: item.html }}
        />
        {item.url && (
          <DialogButton
            onClick={() => Navigation.NavigateToExternalWeb(item.url)}
          >
            View on Steam
          </DialogButton>
        )}
      </div>
    </ModalRoot>
  );
}

export function NewsSection({ news }: { news: News }) {
  if (!news || !news.ok || news.items.length === 0) {
    return <div style={{ opacity: 0.6, fontSize: 13 }}>No recent updates.</div>;
  }

  return (
    <Focusable style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {news.items.map((item) => (
        <DialogButton
          key={item.gid}
          {...CENTER_ON_FOCUS}
          onClick={() => showModal(<NewsModal item={item} />)}
          onOKButton={() => showModal(<NewsModal item={item} />)}
          style={{
            ...FOCUS_SCROLL_MARGIN,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            padding: "8px 10px",
            textAlign: "left",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: 13.5,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "100%",
            }}
          >
            {item.title}
          </span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {item.feedlabel} · {fmtDate(item.date)}
          </span>
        </DialogButton>
      ))}
    </Focusable>
  );
}
