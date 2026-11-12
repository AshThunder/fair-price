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

describe("parsePriceFromText in other currencies", () => {
  it("reads dollar, pound, rupee, shilling and real tags", () => {
    expect(parsePriceFromText("EGGS LARGE 12CT $4.49", "USD")).toMatchObject({ amount: 4.49, currencyGuess: "USD" });
    expect(parsePriceFromText("Hovis 800g £1.40", "GBP")).toMatchObject({ amount: 1.4, currencyGuess: "GBP" });
    expect(parsePriceFromText("Petrol ₹111.21 /L", "INR")).toMatchObject({ amount: 111.21, currencyGuess: "INR" });
    expect(parsePriceFromText("Sugar 1kg KSh 165", "KES")).toMatchObject({ amount: 165, currencyGuess: "KES" });
    expect(parsePriceFromText("Gasolina R$ 6,49", "BRL")).toMatchObject({ amount: 6.49, currencyGuess: "BRL" });
  });
});
