import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Terminal buttons: bold mono uppercase with wide tracking. Default variant
 * fills solid phosphor-green so the call-to-action carries weight; outline
 * and ghost variants stay quiet on the dark surface.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-mono font-bold uppercase tracking-wide text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-primary/40 bg-transparent text-primary hover:bg-primary/10 active:bg-primary/20",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-secondary/80 active:bg-secondary/70",
        ghost:
          "text-muted-foreground hover:text-foreground hover:bg-secondary active:bg-secondary/70",
        link:
          "text-primary underline-offset-4 hover:underline border-0",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-12 rounded-md px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
