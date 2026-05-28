// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// GitHub Pages project site: https://wdm33.github.io/ade-atlas/
// Override SITE / BASE via env when deploying to a custom domain.
const site = process.env.SITE_URL ?? "https://wdm33.github.io";
const base = process.env.BASE_PATH ?? "/ade-atlas";

export default defineConfig({
  site,
  base,
  output: "static",
  trailingSlash: "ignore",
  integrations: [react()],
  build: { format: "directory" },
});
