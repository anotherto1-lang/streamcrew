import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function hex(color) {
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ];
}

const VIOLET = hex("#8b5cf6");
const CYAN = hex("#22d3ee");
const NAVY = hex("#0b0d12");

function gradient(t) {
  return [
    Math.round(VIOLET[0] + (CYAN[0] - VIOLET[0]) * t),
    Math.round(VIOLET[1] + (CYAN[1] - VIOLET[1]) * t),
    Math.round(VIOLET[2] + (CYAN[2] - VIOLET[2]) * t),
  ];
}

function inRoundRect(x, y, rx, ry, rw, rh, r) {
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const dx = Math.abs(x - cx) - (rw / 2 - r);
  const dy = Math.abs(y - cy) - (rh / 2 - r);
  if (dx > 0 && dy > 0) return dx * dx + dy * dy <= r * r;
  return Math.abs(x - cx) <= rw / 2 && Math.abs(y - cy) <= rh / 2;
}

function inTriangle(px, py, [x1, y1, x2, y2, x3, y3]) {
  const d1 = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d2 = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const d3 = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function render(size, { transparent, pad = 0, solidBg = false }) {
  const ss = 3;
  const big = size * ss;
  const buf = Buffer.alloc(size * size * 4);
  const scale = (big / 32) * (1 - pad);

  for (let py = 0; py < big; py++) {
    for (let px = 0; px < big; px++) {
      const x = (px - big / 2) / scale + 16;
      const y = (py - big / 2) / scale + 16;
      let r, g, b, a;

      if (solidBg) {
        const t = Math.min(1, Math.max(0, (x + y) / 64));
        [r, g, b] = gradient(t);
        a = 255;
        if (inRoundRect(x, y, 2, 6, 20, 14, 3)) {
          [r, g, b] = NAVY;
        }
        if (inTriangle(x, y, [20, 10.5, 28, 6.5, 28, 19.5, 20, 15.5])) {
          [r, g, b] = NAVY;
        }
        if ((x - 9) ** 2 + (y - 26) ** 2 <= 2.4 ** 2) [r, g, b] = NAVY;
        if ((x - 15) ** 2 + (y - 26) ** 2 <= 2.4 ** 2) [r, g, b] = NAVY;
      } else {
        const t = Math.min(1, Math.max(0, (x + y) / 64));
        [r, g, b] = gradient(t);
        a = 0;
        if (inRoundRect(x, y, 2, 6, 20, 14, 3)) a = 255;
        if (inTriangle(x, y, [20, 10.5, 28, 6.5, 28, 19.5, 20, 15.5])) a = 255;
        if ((x - 9) ** 2 + (y - 26) ** 2 <= 2.4 ** 2) a = 255;
        if ((x - 15) ** 2 + (y - 26) ** 2 <= 2.4 ** 2) a = 255;
        if (!transparent && !a) {
          r = 11; g = 13; b = 18;
          a = 255;
        }
      }

      const ox = px - (big - size * ss) / 2;
      const oy = py - (big - size * ss) / 2;
      if (ox < 0 || oy < 0 || ox >= size * ss || oy >= size * ss) continue;
      const ix = Math.floor(ox / ss);
      const iy = Math.floor(oy / ss);
      const i = (iy * size + ix) * 4;
      const na = (a / 255) * 255;
      const oa = buf[i + 3];
      const mixA = na + oa * (1 - na / 255);
      if (mixA > 0) {
        buf[i] = Math.round((r * na + buf[i] * oa * (1 - na / 255)) / mixA);
        buf[i + 1] = Math.round((g * na + buf[i + 1] * oa * (1 - na / 255)) / mixA);
        buf[i + 2] = Math.round((b * na + buf[i + 2] * oa * (1 - na / 255)) / mixA);
        buf[i + 3] = Math.round(mixA);
      }
    }
  }
  return png(size, size, buf);
}

const targets = [
  ["icon-192.png", render(192, { transparent: true })],
  ["icon-512.png", render(512, { transparent: true })],
  ["maskable-192.png", render(192, { solidBg: true })],
  ["maskable-512.png", render(512, { solidBg: true })],
  ["apple-touch-icon.png", render(180, { solidBg: true })],
];

for (const [name, data] of targets) {
  writeFileSync(join(outDir, name), data);
  console.log(`${name}: ${data.length} bytes`);
}
