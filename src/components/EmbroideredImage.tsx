import { cn } from "@/lib/utils";
import baycmcLogo from "@/assets/baycmc-embroidered.png";
import boredApesImg from "@/assets/bored-apes-embroidered.png";

const SOURCES = {
  baycmc: { src: baycmcLogo, alt: "BAYCmc" },
  "bored-apes": { src: boredApesImg, alt: "Bored Apes" },
} as const;

export type EmbroideredVariant = keyof typeof SOURCES;
export type EmbroideredSize = "sm" | "md" | "lg" | "xl";

/**
 * Default responsive clamp() heights. Override per-page via the `sizes` prop
 * or globally by spreading {@link DEFAULT_EMBROIDERED_SIZES}.
 */
export const DEFAULT_EMBROIDERED_SIZES: Record<EmbroideredSize, string> = {
  sm: "clamp(2rem, 6vw, 3.5rem)",
  md: "clamp(3rem, 10vw, 6rem)",
  lg: "clamp(2.5rem, 9vw, 5rem)",
  xl: "clamp(3rem, 12vw, 6rem)",
};

interface EmbroideredImageProps {
  variant: EmbroideredVariant;
  size?: EmbroideredSize;
  /** Override the entire preset map (theme-style). */
  sizes?: Partial<Record<EmbroideredSize, string>>;
  /** One-off override — wins over `sizes` and `size`. */
  clamp?: string;
  alt?: string;
  className?: string;
}

export function EmbroideredImage({
  variant,
  size = "md",
  sizes,
  clamp,
  alt,
  className,
}: EmbroideredImageProps) {
  const { src, alt: defaultAlt } = SOURCES[variant];
  const height = clamp ?? sizes?.[size] ?? DEFAULT_EMBROIDERED_SIZES[size];

  return (
    <img
      src={src}
      alt={alt ?? defaultAlt}
      draggable={false}
      className={cn("block w-auto max-w-full select-none object-contain", className)}
      style={{ height }}
    />
  );
}
