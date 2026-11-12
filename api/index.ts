import { handle } from "hono/vercel";
import app from "../server/app.js";

// Vercel's Node runtime calls named HTTP-method exports with a Web Request.
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
