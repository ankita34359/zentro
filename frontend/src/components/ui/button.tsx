import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-label font-medium whitespace-nowrap transition-[background-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] motion-safe:active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-gradient-brand-strong text-on-gradient shadow-sm hover:shadow-glow hover:brightness-110",
        outline: "border border-input bg-card text-foreground shadow-xs hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
