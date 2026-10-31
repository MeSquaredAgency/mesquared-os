/** Region and timezone presets: each sets the locale, currency and messaging rules (consent, quiet hours) for a workspace. No server imports, so client forms can use it. */
export const REGION_PRESETS: { region: string; timezone: string; locale: string; currency: string; label: string }[] = [
  { region: "AU", timezone: "Australia/Adelaide", locale: "en-AU", currency: "AUD", label: "Australia (Adelaide)" },
  { region: "AU", timezone: "Australia/Sydney", locale: "en-AU", currency: "AUD", label: "Australia (Sydney / Melbourne)" },
  { region: "AU", timezone: "Australia/Brisbane", locale: "en-AU", currency: "AUD", label: "Australia (Brisbane)" },
  { region: "AU", timezone: "Australia/Perth", locale: "en-AU", currency: "AUD", label: "Australia (Perth)" },
  { region: "NZ", timezone: "Pacific/Auckland", locale: "en-NZ", currency: "NZD", label: "New Zealand" },
  { region: "GB", timezone: "Europe/London", locale: "en-GB", currency: "GBP", label: "United Kingdom" },
  { region: "US", timezone: "America/New_York", locale: "en-US", currency: "USD", label: "United States (Eastern)" },
  { region: "US", timezone: "America/Los_Angeles", locale: "en-US", currency: "USD", label: "United States (Pacific)" },
  { region: "KH", timezone: "Asia/Phnom_Penh", locale: "en-AU", currency: "USD", label: "Cambodia" },
  { region: "SG", timezone: "Asia/Singapore", locale: "en-SG", currency: "SGD", label: "Singapore" },
];
