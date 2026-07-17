import type { ReactNode } from "react";
import { Focusable, Navigation } from "@decky/ui";
import type { AppDetails } from "../types";
import { FOCUS_SCROLL_MARGIN } from "../focus";

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        padding: "3px 9px",
        borderRadius: 11,
        background: "rgba(255,255,255,0.10)",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.6 }}>
      <span style={{ opacity: 0.55, minWidth: 96 }}>{label}</span>
      <span style={{ flex: 1 }}>{value}</span>
    </div>
  );
}

export function FeaturesSection({ d }: { d: AppDetails }) {
  const platforms = [
    d.platforms?.windows && "Windows",
    d.platforms?.mac && "macOS",
    d.platforms?.linux && "Linux / SteamOS",
  ].filter(Boolean) as string[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {(d.genres.length > 0 || d.categories.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {d.genres.map((g) => (
            <Pill key={`g-${g.id}`}>{g.description}</Pill>
          ))}
          {d.categories.map((c) => (
            <Pill key={`c-${c.id}`}>{c.description}</Pill>
          ))}
        </div>
      )}

      <div>
        <InfoRow label="Developer" value={d.developers.join(", ")} />
        <InfoRow label="Publisher" value={d.publishers.join(", ")} />
        <InfoRow
          label="Released"
          value={d.coming_soon ? `${d.release_date} (Coming soon)` : d.release_date}
        />
        <InfoRow label="Platforms" value={platforms.join(" · ")} />
        {d.controller_support && (
          <InfoRow
            label="Controller"
            value={
              d.controller_support === "full" ? "Full support" : "Partial support"
            }
          />
        )}
        {d.achievements_total != null && d.achievements_total > 0 && (
          <InfoRow label="Achievements" value={d.achievements_total} />
        )}
        {d.metacritic && (
          <InfoRow
            label="Metacritic"
            value={
              d.metacritic.url ? (
                <Focusable
                  onActivate={() =>
                    d.metacritic?.url &&
                    Navigation.NavigateToExternalWeb(d.metacritic.url)
                  }
                  style={{
                    ...FOCUS_SCROLL_MARGIN,
                    display: "inline-block",
                    cursor: "pointer",
                    color: "#a1cd44",
                    fontWeight: 600,
                  }}
                >
                  {d.metacritic.score}
                </Focusable>
              ) : (
                <span style={{ color: "#a1cd44", fontWeight: 600 }}>
                  {d.metacritic.score}
                </span>
              )
            }
          />
        )}
        {d.price && (
          <InfoRow
            label="Price"
            value={
              d.price.discount > 0
                ? `${d.price.final}  (-${d.price.discount}%)`
                : d.price.final
            }
          />
        )}
      </div>

      {d.supported_languages_html && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ opacity: 0.55, marginBottom: 4 }}>Languages</div>
          <div
            style={{ lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: d.supported_languages_html }}
          />
        </div>
      )}
    </div>
  );
}
