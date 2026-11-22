import type { ReactNode } from "react";
import { Brand } from "@/components/common/Brand";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { Card } from "@/components/ui/card";
import { PageTransition } from "@/motion/PageTransition";

/** The centred card for login, register and onboarding. One column, so it works unchanged on a phone. */
export function AuthLayout({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip text-foreground">
      <header className="flex h-[var(--header-height)] items-center justify-between px-4 sm:px-6">
        <Brand />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:items-center sm:pt-0">
        <PageTransition>
          <div className="w-full max-w-md">
            <Card lift={false} raised className="p-6 sm:p-8">
              <h1 className="text-title font-bold">{title}</h1>
              <p className="mt-2 text-body text-muted-foreground">{description}</p>
              <div className="mt-6">{children}</div>
            </Card>
            {footer && <p className="mt-4 text-center text-label text-muted-foreground">{footer}</p>}
          </div>
        </PageTransition>
      </main>
    </div>
  );
}
