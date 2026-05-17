import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../src/node-http.js";

export default function handler(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  sendJson(res, 200, { ok: true });
}
