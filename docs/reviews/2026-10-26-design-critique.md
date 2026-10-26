# Design critique: MeSquared OS, 26 October 2026

Reviewed in demo mode at 1440×900: sign-in, console portfolio, workspace
page, settings, exception queue, portal home, leads, missed opportunities,
content and money. Context: a B2B operations platform used daily by Me²
operators (console) and by a real estate office's directors and property
managers (portal), many of them on a phone between inspections. Stage:
shipped, first client live, visual design never done.

## Overall impression

It reads as a developer's default: a dark shadcn template with the content
poured in. The information architecture is good and the copy is strong
("Needs you", "Handled for you", "Money about to walk out the door"), but
nothing on screen looks designed. Every surface is the same near-black
card on near-black background with one-pixel borders, type is small and
uniformly grey, and the only colour is semantic red and green. The
biggest opportunity is not a restyle of each component but a point of
view: a light, calm, editorial look that matches the copy's confidence and
the clients it serves.

## First impression, two seconds

- What draws the eye first: the red and green numbers ("$2,050.00" at
  risk, "$30,900.00" revenue). On the portal home that is correct. On the
  console portfolio nothing draws the eye at all; five identical stat
  boxes and a table with no emphasis.
- Emotional reaction: sombre and technical. A dark theme with low contrast
  signals "admin tool for engineers", the opposite of a product sold to
  agency owners as their own operations team.
- Purpose: clear on the portal home thanks to the headings; unclear on
  the console portfolio, where "Health 68" means nothing without a legend.

## Usability

| Finding | Severity | Recommendation |
|---|---|---|
| Dark-only theme, chosen by default; no light mode, no respect for the OS preference. Most office and phone use is in daylight. | 🔴 Critical | Make light the default for the portal and offer dark as a preference. Tokens already exist; this is a palette decision. |
| Body text is 12–13 px grey on near-black across the console. Meta lines ("Meta lead form · 15m ago · worth about $3,600") are ~11 px at roughly 4:1 contrast. | 🔴 Critical | Base body 15–16 px, meta 13 px, muted text no lighter than 4.5:1. The portal is read by people in their fifties on phones. |
| Primary actions are not visually primary. "Approve", "Recovered", "Settings" and "Open client portal" are the same weight as secondary buttons; the only strong button is a pale green fill. | 🟡 Moderate | One primary button style per screen, in the brand accent, with everything else quiet. |
| The console portfolio table repeats what the five stat cards above it say, and "Health 68" has no explanation. | 🟡 Moderate | Drop the stat row or make it the per-workspace summary; show health as a labelled bar with the three things that lower it. |
| Everything is a card inside a card. Settings has a tab strip, then a card, then rows of cards; the portal home nests "Needs you" cards inside a card inside the page. Depth is conveyed by borders only. | 🟡 Moderate | One level of containment. Use whitespace and type weight to separate sections; reserve cards for things that are actually discrete (a lead, a draft). |
| Status chips carry the meaning but are tiny, lowercase-ish, and the same shape as tags ("In review", "Short form script", "Instagram", "Needs your sign-off" all look alike). | 🟡 Moderate | Separate state (one chip, coloured) from attributes (plain text or a muted tag). |
| Dates and times are relative everywhere ("15m ago", "3h ago"). Fine for home; on leads, money and the log people need the actual date. | 🟢 Minor | Relative for under 24 h, absolute after, with the full timestamp on hover. |
| The sidebar's "Data source: Demo" badge and the footer line sit under the dev overlay and read as clutter even for operators. | 🟢 Minor | Move deployment facts to the settings readiness page only. |
| Mobile was not reviewed, but the console tables (portfolio, money attribution) cannot work at phone width as built. | 🟡 Moderate | Design the portal mobile-first; the console can be desktop-first but needs a card fallback for tables. |

## Visual hierarchy

- Reading order on the portal home is right: greeting, Needs you, Missed
  opportunities, money tiles. It is undermined by every block having the
  same visual weight, so the eye has no reason to start at the top.
- On the workspace page the three bottom cards (Integrations, Modules,
  Automations) are a settings view pretending to be a dashboard and take
  half the screen; the things an operator acts on (Needs you, Missed) are
  cramped above them.
- Typography has two sizes that matter (page title, everything else) and
  one weight that matters (semibold titles). Numbers are the only large
  type and they are coloured, so the page hierarchy is "numbers, then
  grey".
- Whitespace is even and tight everywhere, which is why nothing feels
  important. Generous space around the one thing per screen that matters
  would do more than any colour.

## Consistency

| Element | Issue | Recommendation |
|---|---|---|
| Colour | Semantic green and red are used for state ("Qualified", "Needs attention"), money ("recovered", "at risk"), and buttons ("Approve", "Recovered"). Three meanings, one hue each. | Keep red and green strictly for money direction and risk; give states a neutral chip scale and buttons the brand accent. |
| Type scale | Page title 20 px, section 14 px semibold, body 13 px, meta 11 px, stat 24 px. Too compressed; sections and body barely differ. | A five-step scale: 28 / 20 / 16 / 14 / 12 with weight doing the work. |
| Chips and badges | At least four visual styles for the same idea (status badge, tag, pill with icon, outlined label). | One chip component with two variants: state (coloured) and attribute (muted). |
| Spacing | Card padding varies (16, 20, 24 px) between console and portal; row gaps differ between lists. | 4-point scale, fixed card padding, fixed list rhythm. |
| Iconography | Lucide icons at 14–16 px, sometimes decorative (flame on a lead), sometimes meaning-bearing (phone = call). | Icons only where they carry meaning; the flame should be a plain "hot" chip or nothing. |
| Branding | The workspace's own colour (APN lime) appears nowhere in the portal, while emails already carry it. | Use the tenant's brand colour as the portal accent so the client sees their own product. |

## Accessibility

- Colour contrast: body grey on the card background is around 4:1 or
  below in several places (meta lines, muted descriptions, the sidebar
  secondary labels). Fails AA for small text. The coloured numbers on
  dark pass, the status chips mostly pass.
- Touch targets: list rows have no target at all on the portal (the lead
  row is not a link); buttons are 32 px tall in the console. Portal
  buttons should be 44 px and whole rows tappable.
- Text readability: 11–13 px at 1.4 line height is below comfortable for
  the audience. Nothing is truncated badly, which is good.
- Focus and keyboard were not tested here; the earlier code review found
  labels and roles mostly in place.

## What works well

- The language. Clients never see system words, and every section says
  what it is for in one line. Keep every word.
- The information architecture: a home that says what needs a person,
  then money, then content, is the right order and few products get it.
- Dense, honest data: nothing is hidden behind a click, and the activity
  log reads like a colleague wrote it.
- The components are already shadcn with tokens, so a redesign is a
  palette, type and spacing change plus a few new components, not a
  rewrite.

## Priority recommendations

1. **Pick a direction and set the tokens.** Light, warm, editorial: an
   off-white page, white cards used sparingly, ink text, one brand accent
   per tenant, red and green reserved for money and risk. Larger type with
   a real scale. This single change lifts every screen at once because the
   whole app reads from the token file.
2. **Give each screen one hero and one action.** Portal home: the Needs
   you list is the hero and "Call" is the action. Console workspace:
   Needs you and Missed are the hero, the settings-like cards move behind
   a "Setup" tab. Portfolio: the table is the hero, the stat row goes.
3. **Rebuild the five shared pieces** everyone sees: the sidebar and
   header, the stat tile, the chip, the list row (lead, opportunity, draft)
   and the button set. Those five account for most of what is on screen;
   the studios (settings, content, money) inherit them.

## Proposed direction, for you to accept or redirect

- Background `#F6F4EE`-ish warm off-white, text `#17171A` ink, muted
  `#6D6E71`, hairlines `#DAD6CB`, the same family the email layout already
  uses so the product and its emails match.
- Accent: the tenant's brand colour in the portal, Me²'s own in the
  console. Money up in green, money at risk in a warm red, nothing else
  coloured.
- Type: a humanist sans at 16 px body (Public Sans or Inter), 28 px page
  titles, tabular numerals for money.
- Dark mode kept as an opt-in for operators who want it.

Say yes to the direction, or describe a product whose look you admire,
and the next step is the design system file and a rebuilt portal home for
side-by-side comparison.
