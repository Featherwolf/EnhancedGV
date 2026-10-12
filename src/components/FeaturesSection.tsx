import type { ReactNode } from "react";
import { openExternal } from "../nav";
import { Focusable } from "@decky/ui";
import type { AppDetails } from "../types";
import { FOCUS_SCROLL_MARGIN } from "../focus";
import { useTranslation } from "../i18n";

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
  const { t } = useTranslation();
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
        <InfoRow label={t("features.developer")} value={d.developers.join(", ")} />
        <InfoRow label={t("features.publisher")} value={d.publishers.join(", ")} />
        <InfoRow
          label={t("features.released")}
          value={
            d.coming_soon
              ? t("features.comingSoon", { date: d.release_date })
              : d.release_date
          }
        />
        <InfoRow label={t("features.platforms")} value={platforms.join(" · ")} />
        {d.controller_support && (
          <InfoRow
            label={t("features.controller")}
            value={
              d.controller_support === "full"
                ? t("features.controllerFull")
                : t("features.controllerPartial")
            }
          />
        )}
        {d.achievements_total != null && d.achievements_total > 0 && (
          <InfoRow label={t("features.achievements")} value={d.achievements_total} />
        )}
        {d.metacritic && (
          <InfoRow
            label={t("features.metacritic")}
            value={
              d.metacritic.url ? (
                <Focusable
                  onActivate={() =>
                    d.metacritic?.url &&
                    openExternal(d.metacritic.url)
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
            label={t("features.price")}
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
          <div style={{ opacity: 0.55, marginBottom: 4 }}>{t("features.languages")}</div>
          <div
            style={{ lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: d.supported_languages_html }}
          />
        </div>
      )}
    </div>
  );
}
