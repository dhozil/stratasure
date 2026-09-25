import type { SVGProps } from "react";

export type LogoVariant = "full" | "mark" | "wordmark";
export type LogoSize = "sm" | "md" | "lg";
export type LogoTheme = "light" | "dark";

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  theme?: LogoTheme;
  className?: string;
}

const sizes = {
  sm: { mark: "h-7 w-7", text: "text-base" },
  md: { mark: "h-8 w-8", text: "text-lg" },
  lg: { mark: "h-10 w-10", text: "text-2xl" },
};

function StrataMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-label="StrataSure mark"
      className={className}
      fill="none"
      viewBox="0 0 40 40"
      {...props}
    >
      <path d="M5 28.5 12.5 20 20 26l7.5-12 7.5 9" stroke="currentColor" strokeWidth="2.4" />
      <path d="M5 32.5h30M5 35.5h30" stroke="currentColor" strokeOpacity=".35" />
      <path d="M20 4v12" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="20" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  variant = "full",
  size = "md",
  theme = "dark",
  className = "",
}: LogoProps) {
  const colorClass = theme === "dark" ? "text-[var(--ink-950)]" : "text-[var(--paper)]";
  const { mark, text } = sizes[size];

  if (variant === "mark") {
    return <StrataMark className={`${mark} ${colorClass} ${className}`} />;
  }

  if (variant === "wordmark") {
    return (
      <span className={`${text} font-semibold tracking-[-0.04em] ${colorClass} ${className}`}>
        StrataSure
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <StrataMark className={`${mark} ${colorClass}`} />
      <span className={`${text} font-semibold tracking-[-0.04em] ${colorClass}`}>
        StrataSure
      </span>
    </span>
  );
}
