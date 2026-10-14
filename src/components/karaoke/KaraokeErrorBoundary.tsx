import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Contains a failure in one karaoke piece (music machine, stage panel, audio
 * engine) so it can't take the whole room page down to the global
 * "Something went wrong" screen. Shows a small retry card with the real
 * error text so it can be reported.
 */
export class KaraokeErrorBoundary extends Component<
  { name: string; children: ReactNode; silent?: boolean },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[karaoke:${this.props.name}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div
        role="alert"
        className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,20rem)] rounded-xl border border-destructive/50 bg-background/95 p-3 text-xs shadow-lg backdrop-blur"
      >
        <p className="font-semibold text-destructive">Karaoke {this.props.name} hit a problem</p>
        <p className="mt-1 break-words font-mono text-[10px] text-muted-foreground">
          {error.message || String(error)}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-2 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );
  }
}
