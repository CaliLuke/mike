import Link from "next/link";

import { LukeIcon } from "@/components/chat/luke-icon";

interface SiteLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  animate?: boolean;
  asLink?: boolean;
}

export function SiteLogo({
  size = "md",
  className = "",
  animate = false,
  asLink = false,
}: SiteLogoProps) {
  const landingHref =
    process.env.NODE_ENV === "production" ? "https://lukeoss.com" : "http://localhost:3000";
  const sizeClasses = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-4xl",
    xl: "text-6xl",
  };

  const iconSizes = {
    sm: 20,
    md: 22,
    lg: 32,
    xl: 48,
  };

  const logo = (
    <h1
      className={`flex items-center gap-1.5 ${sizeClasses[size]} font-serif font-light ${
        animate ? "sidebar-fade-in" : ""
      } ${className}`}
    >
      <LukeIcon size={iconSizes[size]} />
      <span>Luke</span>
    </h1>
  );

  if (asLink) {
    return (
      <Link href={landingHref} className="cursor-pointer transition-opacity hover:opacity-80">
        {logo}
      </Link>
    );
  }

  return logo;
}
