import { defineConfig } from "astro/config";

// GitHub Pages serves a project repository under its own name, so every
// internal link goes through BASE_URL rather than a bare "/". Both values move
// together the day a custom domain lands.
export default defineConfig({
  site: "https://sandrocaseiro-dev.github.io",
  base: "/playfield-site",
  trailingSlash: "always",
  build: { format: "directory" },
});
