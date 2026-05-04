import { cn } from "@/lib/utils";
import baycmcLogo from "@/assets/baycmc-embroidered.png";
import boredApesImg from "@/assets/bored-apes-embroidered.png";

const SOURCES = {
  baycmc: { src: baycmcLogo, alt: "BAYCmc" },
  "bored-apes": { src: boredApesImg, alt: "Bored Apes" },
} as const;

export type EmbroideredVariant = keyof typeof SOURCES;

type SizeKey = "sm" | "md" | "lg" | "xl";

/**
 * Responsive clamp() heights — scale smoothly between viewports without
 * abrupt breakpoint jumps. Min/max keep them readable on small screens
 * and capped on huge ones.
 */
const SIZE_CLAMPS: Record<SizeKey, string> = {
  sm: "clamp(2rem, 6vw, 3.5rem)",
  md: "clamp(3rem, 10vw, 6rem)",
  lg: "clamp(4rem, 16vw, 12rem)",
  xl: "clamp(6rem, 28vw, 22rem)",
};

interface EmbroideredImageProps {
  variant: EmbroideredVariant;
  size?: SizeKey;
  alt?: string;
  className?: string;
}

export function EmbroideredImage({
  variant,
  size = "md",
  alt,
  className,
}: EmbroideredImageProps) {
  const { src, alt: defaultAlt } = SOURCES[variant];

  return (
    <img
      src={src}
      alt={alt ?? defaultAlt}
      draggable={false}
      className={cn(
        "block w-auto max-w-full select-none object-contain",
        className,
      )}
      style={{ height: SIZE_CLAMPS[size] }}
    />
  );
}
