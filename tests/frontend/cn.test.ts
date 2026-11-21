import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";

describe("cn knows the design-token type scale", () => {
  it("keeps a custom font size next to a text colour (they are different things)", () => {
    expect(cn("text-label", "text-muted-foreground")).toBe("text-label text-muted-foreground");
    expect(cn("text-label font-medium", "text-on-gradient")).toBe("text-label font-medium text-on-gradient");
    expect(cn("text-body text-primary-foreground")).toBe("text-body text-primary-foreground");
  });

  it("still lets a later size replace an earlier size, and a later colour replace an earlier colour", () => {
    expect(cn("text-label", "text-heading")).toBe("text-heading");
    expect(cn("text-muted-foreground", "text-foreground")).toBe("text-foreground");
    expect(cn("text-sm", "text-caption")).toBe("text-caption");
  });

  it("works for every size in the scale", () => {
    for (const s of ["hero", "display", "title", "heading", "body", "label", "caption", "overline"]) {
      expect(cn(`text-${s}`, "text-foreground")).toBe(`text-${s} text-foreground`);
    }
  });
});
