// Renders every Ada pose to a static contact sheet for visual review.
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Mascot, type MascotMood } from "../src/components/Mascot";
import puppeteer from "puppeteer-core";

const moods: MascotMood[] = ["idle", "think", "fair", "high", "low", "uncertain"];
const cells = moods
  .map((m) => `<figure style="margin:0;text-align:center;font:600 14px sans-serif">${renderToStaticMarkup(<Mascot mood={m} size={220} />)}<figcaption>${m}</figcaption></figure>`)
  .join("");
const html = `<!doctype html><body style="margin:0;background:#f6e7c1;display:grid;grid-template-columns:repeat(3,240px);gap:12px;padding:12px">${cells}</body>`;
writeFileSync("/tmp/ada-sheet.html", html);
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 780, height: 640, deviceScaleFactor: 1.5 });
await page.goto("file:///tmp/ada-sheet.html");
await page.screenshot({ path: process.env.OUT ?? "/tmp/ada.png", fullPage: true });
await browser.close();
console.log("ok");
