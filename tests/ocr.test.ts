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

describe("parsePriceFromText on noisy tag reads", () => {
  it("skips pack sizes and prefers the amount with a naira mark", () => {
    expect(parsePriceFromText("PALM OIL 75cl N2,450").amount).toBe(2450);
    expect(parsePriceFromText("TOMATOES 1KG §1,400").amount).toBe(1400);
    expect(parsePriceFromText("Garri 50kg bag #38,000 2026").amount).toBe(38000);
  });

  it("does not treat a word ending in n as a naira mark", () => {
    expect(parsePriceFromText("Golden Penny semovita 900").amount).toBe(900);
  });
});
