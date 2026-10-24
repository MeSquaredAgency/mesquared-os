import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import type { ChannelSummary } from "@/lib/social/metrics";
import type { FormatContext } from "@/lib/utils";

const n = (v: number | null, locale: string) => (v === null ? "—" : v.toLocaleString(locale));

/** Channel numbers in plain words: followers, reach and engagement this week. */
export function ChannelSummaryCard({ summaries, fmt }: { summaries: ChannelSummary[]; fmt: Pick<FormatContext, "locale" | "timezone"> }) {
  return (
    <Card aria-labelledby="channels-title">
      <CardHeader>
        <CardTitle id="channels-title">Your channels</CardTitle>
        <CardDescription>Numbers come from each platform once a day.</CardDescription>
      </CardHeader>
      <CardContent>
        {summaries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No channels connected yet. Ask Me² to connect your pages.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Channel</th>
                  <th className="py-1.5 pr-3 font-medium">Followers</th>
                  <th className="py-1.5 pr-3 font-medium">Reach, 7 days</th>
                  <th className="py-1.5 pr-3 font-medium">Engagements, 7 days</th>
                  <th className="py-1.5 pr-3 font-medium">Posts, 7 days</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summaries.map((s) => (
                  <tr key={s.channel.id}>
                    <td className="py-2 pr-3">
                      <p className="font-medium">{PLATFORM_LABEL[s.channel.platform]}</p>
                      <p className="text-xs text-muted-foreground">{s.channel.displayName ?? s.channel.externalAccountId}</p>
                    </td>
                    <td className="py-2 pr-3">
                      {n(s.followers, fmt.locale)}
                      {s.followersChange !== null && s.followersChange !== 0 && (
                        <Badge variant={s.followersChange > 0 ? "green" : "red"} className="ml-1.5 text-[10px]">
                          {s.followersChange > 0 ? "+" : ""}
                          {s.followersChange}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3">{n(s.reach7d, fmt.locale)}</td>
                    <td className="py-2 pr-3">{n(s.engagements7d, fmt.locale)}</td>
                    <td className="py-2 pr-3">{s.posts7d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
