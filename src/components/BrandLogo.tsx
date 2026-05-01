import logo from "@/assets/baycmc-logo.png";

interface BrandLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Full BAYCMC embroidered logo. Use ONLY on Lifers (dual-verified) gated
 * areas — it is the visual marker of secret membership.
 */
export function BrandLogo({ className, alt = "BAYCMC Lifers" }: BrandLogoProps) {
  return <img src={logo} alt={alt} className={className} draggable={false} />;
}
