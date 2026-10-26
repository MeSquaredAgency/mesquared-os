import { Badge } from "@/components/ui/badge";
import { Empty, Panel, Section } from "@/components/shell/section";
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
        <Panel className="overflow-x-auto py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-4 pr-4 font-medium">Channel</th>
                <th scope="col" className="py-4 pr-4 font-medium">Followers</th>
                <th scope="col" className="py-4 pr-4 font-medium">Reach, 7 days</th>
                <th scope="col" className="py-4 pr-4 font-medium">Engagements, 7 days</th>
                <th scope="col" className="py-4 pr-4 font-medium">Posts, 7 days</th>
              </tr>
            </thead>
            <tbody className="divide-y border-t">
              {summaries.map((s) => (
                <tr key={s.channel.id}>
                  <td className="py-3 pr-4">
                    <p className="font-medium">{PLATFORM_LABEL[s.channel.platform]}</p>
                    <p className="text-xs text-muted-foreground">{s.channel.displayName ?? s.channel.externalAccountId}</p>
                  </td>
                  <td className="py-3 pr-4 num">
                    {n(s.followers, fmt.locale)}
                    {s.followersChange !== null && s.followersChange !== 0 && (
                      <Badge variant={s.followersChange > 0 ? "green" : "red"} className="ml-2">
                        {s.followersChange > 0 ? "+" : ""}
                        {s.followersChange}
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 pr-4 num">{n(s.reach7d, fmt.locale)}</td>
                  <td className="py-3 pr-4 num">{n(s.engagements7d, fmt.locale)}</td>
                  <td className="py-3 pr-4 num">{s.posts7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </Section>
  );
}
