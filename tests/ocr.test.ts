import { describe, expect, it } from "vitest";
import { parsePriceFromText } from "../shared/ocr.js";

describe("parsePriceFromText", () => {
  it("reads a naira amount from a stall ticket line", () => {
    const hint = parsePriceFromText("Rice 1kg  ₦2,150");
    expect(hint.amount).toBe(2150);
    expect(hint.currencyGuess).toBe("NGN");
  });

  it("returns null when no amount is present", () => {
    expect(parsePriceFromText("fresh tomatoes").amount).toBeNull();
  });
});
