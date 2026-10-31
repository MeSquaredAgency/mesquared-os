import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Empty, Section } from "@/components/shell/section";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import type { ChannelSummary } from "@/lib/social/metrics";
import type { FormatContext } from "@/lib/utils";

const n = (v: number | null, locale: string) => (v === null ? "—" : v.toLocaleString(locale));

/** Channel numbers in plain words: followers, reach and engagement this week. */
export function ChannelSummaryCard({ summaries, fmt }: { summaries: ChannelSummary[]; fmt: Pick<FormatContext, "locale" | "timezone"> }) {
  return (
    <Section id="channels-title" title="Your channels" lede="Numbers come from each platform once a day.">
      {summaries.length === 0 ? (
        <Empty>No channels connected yet. Ask Me² to connect your pages.</Empty>
      ) : (
        <div className="surface overflow-hidden">
          <Table className="min-w-[560px]">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Channel</TH>
                <TH numeric>Followers</TH>
                <TH numeric>Reach or views, 7 days</TH>
                <TH numeric>Engagements, 7 days</TH>
                <TH numeric>Posts, 7 days</TH>
              </TR>
            </THead>
            <TBody>
              {summaries.map((s) => (
                <TR key={s.channel.id}>
                  <TD>
                    <p className="font-medium">{PLATFORM_LABEL[s.channel.platform]}</p>
                    <p className="text-xs text-muted-foreground">{s.channel.displayName ?? s.channel.externalAccountId}</p>
                  </TD>
                  <TD numeric>
                    <span className="inline-flex items-center justify-end gap-2">
                      {n(s.followers, fmt.locale)}
                      {s.followersChange !== null && s.followersChange !== 0 && (
                        <Badge variant={s.followersChange > 0 ? "green" : "red"}>
                          {s.followersChange > 0 ? "+" : ""}
                          {s.followersChange}
                        </Badge>
                      )}
                    </span>
                  </TD>
                  <TD numeric>{n(s.reach7d ?? s.views7d, fmt.locale)}</TD>
                  <TD numeric>{n(s.engagements7d, fmt.locale)}</TD>
                  <TD numeric>{s.posts7d}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Section>
  );
}
