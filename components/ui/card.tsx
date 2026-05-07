import * as React from "react"

import { cn } from "@/lib/utils"

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render small ink-corner ornaments on the card. */
  ornament?: boolean
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, ornament = false, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "codex-card relative rounded-md border bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      {ornament && (
        <>
          <CornerMark className="absolute top-1.5 left-1.5" />
          <CornerMark className="absolute top-1.5 right-1.5" rotate={90} />
          <CornerMark className="absolute bottom-1.5 right-1.5" rotate={180} />
          <CornerMark className="absolute bottom-1.5 left-1.5" rotate={270} />
        </>
      )}
      {children}
    </div>
  )
)
Card.displayName = "Card"

function CornerMark({
  className,
  rotate = 0,
}: {
  className?: string
  rotate?: number
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.8"
      style={{ transform: `rotate(${rotate}deg)` }}
      className={cn(
        "text-[hsl(var(--ink-faded))] opacity-60 pointer-events-none",
        className
      )}
      aria-hidden
    >
      <path d="M1 4 L1 1 L4 1" />
      <circle cx="1" cy="1" r="0.6" fill="currentColor" />
    </svg>
  )
}

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-2xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
