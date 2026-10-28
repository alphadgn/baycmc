import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a failure inside the Relay swap box from taking down the whole
 * My activity page. Shows a small card with a retry and a link to relay.link.
 */
export class SwapErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; attempt: number }
> {
  state: { error: Error | null; attempt: number } = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[relay-swap]", error, info.componentStack);
  }

  render() {
    const { error, attempt } = this.state;
    if (!error) return <div key={attempt}>{this.props.children}</div>;
    return (
      <div
        role="alert"
        className="rounded-xl border border-border/60 bg-background/40 p-4 text-center text-sm"
      >
        <p className="font-semibold">The swap box couldn't load.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The rest of your activity is unaffected. Try again, or swap on relay.link.
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null, attempt: attempt + 1 })}
            className="min-h-10 rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground"
          >
            Try again
          </button>
          <a
            href="https://relay.link/swap"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center rounded-md border border-border px-3 py-2 text-xs"
          >
            Open relay.link ↗
          </a>
        </div>
      </div>
    );
  }
}
