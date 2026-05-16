import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { PrivyAppProvider } from "@/components/PrivyAppProvider";
import { PrivyBridgeMount } from "@/lib/auth/usePrivyBridge";
import { AppHeader } from "@/components/AppHeader";
import { InactivityWatcher } from "@/components/InactivityWatcher";
import { AuthRedirectWatcher } from "@/components/AuthRedirectWatcher";
import { Toaster } from "@/components/ui/sonner";
import { installDiagnostics } from "@/lib/diagnostics";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-5xl font-bold text-gradient-gold sm:text-7xl">404</h1>
        <h2 className="mt-4 text-lg font-semibold sm:text-xl">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This door doesn't open. Even for apes.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
          >
            Back to BAYCMC
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "BAYCmc the mobile clubhouse experience 2nd to the real exper" },
      { name: "description", content: "An exclusive social and real-time platform for verified Bored Ape Yacht Club holders." },
      { property: "og:title", content: "BAYCmc the mobile clubhouse experience 2nd to the real exper" },
      { property: "og:description", content: "An exclusive social and real-time platform for verified Bored Ape Yacht Club holders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "BAYCmc the mobile clubhouse experience 2nd to the real exper" },
      { name: "twitter:description", content: "An exclusive social and real-time platform for verified Bored Ape Yacht Club holders." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/xmS42tZ3QgXuTy3Hc7qF00PSwAX2/social-images/social-1777991694625-IMG_2602.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/xmS42tZ3QgXuTy3Hc7qF00PSwAX2/social-images/social-1777991694625-IMG_2602.webp" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Allura&family=Yellowtail&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  useEffect(() => {
    installDiagnostics();
  }, []);
  return (
    <PrivyAppProvider>
      <PrivyBridgeMount />
      <div className="min-h-screen grain">
        <AppHeader />
        <Outlet />
        <Toaster />
        <InactivityWatcher />
        <AuthRedirectWatcher />
      </div>
    </PrivyAppProvider>
  );
}
