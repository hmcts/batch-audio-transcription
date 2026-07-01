import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders text", () => {
    render(<Badge>COMPLETED</Badge>);
    expect(screen.getByText("COMPLETED")).toBeDefined();
  });

  it("applies success variant classes", () => {
    render(<Badge variant="success">Done</Badge>);
    expect(screen.getByText("Done").className).toContain("bg-green-100");
  });

  it("applies destructive variant classes", () => {
    render(<Badge variant="destructive">Failed</Badge>);
    expect(screen.getByText("Failed").className).toContain("bg-destructive");
  });
});
