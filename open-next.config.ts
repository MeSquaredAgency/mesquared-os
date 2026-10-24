import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache binding: every page in the app is dynamic (per-tenant, per-user), so there is nothing to cache in R2.
export default defineCloudflareConfig({});
