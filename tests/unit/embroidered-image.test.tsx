import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmbroideredImage,
  DEFAULT_EMBROIDERED_SIZES,
  type EmbroideredSize,
  type EmbroideredVariant,
} from "@/components/EmbroideredImage";

const VARIANTS: EmbroideredVariant[] = ["baycmc", "bored-apes"];
const SIZES: EmbroideredSize[] = ["sm", "md", "lg", "xl"];

// Common viewport widths — sanity-bound the clamp() output for each size so
// the rendered height never exceeds the viewport (which would imply the image
// could overflow horizontally given its natural aspect ratio).
const BREAKPOINTS = [320, 375, 414, 768, 1024, 1280, 1536, 1920];

function evalClamp(expr: string, vw: number): number {
  // Parse: clamp(<min>rem, <pref>vw, <max>rem)
  const m = expr.match(/clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)rem\s*\)/);
  if (!m) throw new Error(`Unparseable clamp: ${expr}`);
  const [, min, pref, max] = m;
  const px = (parseFloat(pref) / 100) * vw;
  const minPx = parseFloat(min) * 16;
  const maxPx = parseFloat(max) * 16;
  return Math.max(minPx, Math.min(maxPx, px));
}

describe("EmbroideredImage", () => {
  it("always emits overflow-safe classes", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const html = renderToStaticMarkup(<EmbroideredImage variant={variant} size={size} />);
        expect(html).toContain("max-w-full");
        expect(html).toContain("object-contain");
        expect(html).toContain("w-auto");
      }
    }
  });

  it("clamp heights stay within viewport across breakpoints", () => {
    for (const size of SIZES) {
      const expr = DEFAULT_EMBROIDERED_SIZES[size];
      for (const vw of BREAKPOINTS) {
        const px = evalClamp(expr, vw);
        // Height must never exceed viewport width — combined with max-w-full +
        // object-contain this guarantees no horizontal scroll.
        expect(px).toBeLessThan(vw);
      }
    }
  });

  it("respects custom clamp prop overrides", () => {
    const html = renderToStaticMarkup(
      <EmbroideredImage variant="baycmc" clamp="clamp(1rem, 2vw, 2rem)" />,
    );
    expect(html).toContain("clamp(1rem, 2vw, 2rem)");
  });

  it("respects sizes preset overrides", () => {
    const html = renderToStaticMarkup(
      <EmbroideredImage variant="bored-apes" size="lg" sizes={{ lg: "clamp(1rem, 3vw, 4rem)" }} />,
    );
    expect(html).toContain("clamp(1rem, 3vw, 4rem)");
  });
});
