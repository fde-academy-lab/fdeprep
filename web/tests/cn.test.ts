/**
 * cn joins class names. Found in the 29 September 2026 phone review: a caller
 * that passed "hidden lg:inline-flex" to a component whose own classes carry
 * "inline-flex" got both, and CSS order let inline-flex win, so the difficulty
 * meter and a keyboard hint showed on phones and squeezed the title to one
 * letter. A later display utility now replaces an earlier one at the same
 * breakpoint, which is what the caller meant.
 */
import { describe, expect, it } from "vitest";
import { cn } from "../components/ui/cn.ts";

describe("cn", () => {
  it("drops falsy parts", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("lets a caller's hidden replace a component's own display", () => {
    expect(cn("inline-flex h-5 items-center", "hidden lg:inline-flex"))
      .toBe("h-5 items-center hidden lg:inline-flex");
  });

  it("keeps display utilities at different breakpoints side by side", () => {
    expect(cn("grid", "md:flex", "lg:hidden")).toBe("grid md:flex lg:hidden");
  });

  it("replaces an earlier display at the same breakpoint only", () => {
    expect(cn("block md:grid", "md:flex")).toBe("block md:flex");
  });

  it("leaves every other utility alone, repeats included", () => {
    expect(cn("px-2 text-meta", "px-3")).toBe("px-2 text-meta px-3");
  });
});
