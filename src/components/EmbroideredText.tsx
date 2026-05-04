import { type ElementType, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Reusable embroidered-gold text styling.
 *
 * Use the `text-embroidered-gold` class directly anywhere, or use this
 * component as a polymorphic wrapper for headings and badges.
 *
 *   <EmbroideredText as="h2" className="text-4xl">Bored Apes</EmbroideredText>
 *   <span className="text-embroidered-gold text-2xl">BAYCmc</span>
 */
type EmbroideredTextProps<T extends ElementType = "span"> = {
  as?: T;
} & HTMLAttributes<HTMLElement>;

export function EmbroideredText<T extends ElementType = "span">({
  as,
  className,
  children,
  ...rest
}: EmbroideredTextProps<T>) {
  const Tag = (as ?? "span") as ElementType;
  return (
    <Tag className={cn("text-embroidered-gold", className)} {...rest}>
      {children}
    </Tag>
  );
}
