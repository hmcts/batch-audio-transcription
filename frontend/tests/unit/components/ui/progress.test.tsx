import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("renders with aria attributes", () => {
    const { container } = render(<Progress value={50} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeDefined();
    expect(bar?.getAttribute("aria-valuenow")).toBe("50");
  });

  it("clamps value above 100 to 100", () => {
    const { container } = render(<Progress value={150} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("clamps negative value to 0", () => {
    const { container } = render(<Progress value={-10} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("fills inner div width proportionally", () => {
    const { container } = render(<Progress value={75} />);
    const inner = container.querySelector('[role="progressbar"] div');
    expect((inner as HTMLElement).style.width).toBe("75%");
  });
});
