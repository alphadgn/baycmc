/**
 * Intentionally empty plugin set.
 *
 * This project does Tailwind processing through the `@tailwindcss/vite` plugin
 * (Tailwind v4), NOT through a PostCSS plugin. We still need *a* PostCSS config
 * here so `postcss-load-config` stops searching at the project root — without
 * it, the search walks up the directory tree and picks up a stray
 * `postcss.config.mjs` higher up (e.g. on the Desktop) that registers the
 * legacy Tailwind v3 PostCSS plugin, which then chokes on our v4 `@layer base`
 * directives ("`@layer base` is used but no matching `@tailwind base`").
 *
 * @type {import('postcss-load-config').Config}
 */
export default {
  plugins: {},
};
