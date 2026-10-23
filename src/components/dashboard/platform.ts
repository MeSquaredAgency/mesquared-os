import type { SocialPlatform } from "@/lib/types";

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  LINKEDIN: "LinkedIn",
};

/** Caption limits per platform, used to warn before the engine shortens copy. */
export const PLATFORM_LIMIT: Record<SocialPlatform, number> = {
  FACEBOOK: 63206,
  INSTAGRAM: 2200,
  TIKTOK: 2200,
  YOUTUBE: 5000,
  LINKEDIN: 3000,
};
