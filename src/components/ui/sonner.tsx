import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Global toaster, on brand: clubhouse card colours, Space Grotesk, and a
 * gold border on every toast (success / error / info alike). The rest of
 * the look lives in styles.css under `.baycmc-toaster`.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group baycmc-toaster"
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--gold)",
          "--success-bg": "var(--card)",
          "--success-text": "var(--foreground)",
          "--success-border": "var(--gold)",
          "--error-bg": "var(--card)",
          "--error-text": "var(--foreground)",
          "--error-border": "var(--gold)",
          "--info-bg": "var(--card)",
          "--info-text": "var(--foreground)",
          "--info-border": "var(--gold)",
          "--warning-bg": "var(--card)",
          "--warning-text": "var(--foreground)",
          "--warning-border": "var(--gold)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "baycmc-toast",
          title: "font-sans-display",
          description: "font-sans-display !text-muted-foreground",
          actionButton: "!bg-gradient-gold !text-gold-foreground !font-semibold",
          cancelButton: "!bg-muted !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
