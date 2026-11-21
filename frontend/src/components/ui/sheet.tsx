import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A panel that slides in from the left (the phone navigation). Built on Radix Dialog: focus trap, Escape, scroll lock. */
export function SheetLeft({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  /** Where focus goes when the panel closes (Radix cannot know: the opener lives outside the dialog). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40" />
        <Dialog.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn("sheet-panel fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-sidebar shadow-lg", className)}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
