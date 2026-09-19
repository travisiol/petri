/* Token images: uploads land in DATA_DIR/i/<sha1>.<ext> and are served at /i/…; agent-born tokens get a generated mark. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const dir = path.join(config.dataDir, "i");
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
export let publicBase = ""; // set by the server from PUBLIC_URL or the first request's host
export const setPublicBase = (b) => { if (!publicBase) publicBase = b; };

export function saveUpload(buf, type) {
  const ext = EXT[type]; if (!ext) throw new Error("png, jpeg, webp or gif only");
  if (buf.length > 5 * 1024 * 1024) throw new Error("5 MB max");
  const name = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 20) + "." + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return { name, url: `${publicBase}/i/${name}` };
}
/* a mark for tokens agents launch: the ticker on an amber-lit dish */
export function saveGeneratedImage(ticker) {
  const hue = 28 + (parseInt(crypto.createHash("md5").update(ticker).digest("hex").slice(0, 4), 16) % 40) - 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="g" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="hsl(${hue},95%,72%)"/><stop offset=".55" stop-color="hsl(${hue},80%,45%)"/><stop offset="1" stop-color="#1a1410"/></radialGradient></defs><rect width="256" height="256" fill="#0d0c0a"/><circle cx="128" cy="128" r="104" fill="url(#g)"/><circle cx="128" cy="128" r="104" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="4"/><text x="128" y="146" text-anchor="middle" font-family="Geist, Inter, Arial, sans-serif" font-weight="700" font-size="${ticker.length > 5 ? 44 : 58}" fill="#0d0c0a" letter-spacing="-2">${ticker.slice(0, 6)}</text></svg>`;
  return saveUpload(Buffer.from(svg, "utf8"), "image/svg+xml");
}
export const imagesDir = dir;
