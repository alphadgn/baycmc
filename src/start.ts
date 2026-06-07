import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// NOTE: do NOT import "@/lib/polyfill-shim" here. start.ts is evaluated in
// both the client and the Cloudflare Worker SSR bundle. polyfill-shim
// performs `import("buffer")` / `import("process")`, which on the SSR build
// (where vite-plugin-node-polyfills is intentionally disabled) bundles the
// CJS `process` npm package and crashes the worker at module init with
// `TypeError: Cannot set properties of undefined (setting 'exports')`.
// The shim is loaded from the client-only path inside <GlyphAppProvider>.

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));
