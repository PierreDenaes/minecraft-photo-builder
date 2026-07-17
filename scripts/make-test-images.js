// Génère test/fixtures/maison.png et paysage.png sans dépendance externe (encodeur PNG minimal)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const W = 256, H = 256;

function canvas(color) {
  const buf = Buffer.alloc(W * H * 3);
  rect(buf, 0, 0, W, H, color);
  return buf;
}

function px(buf, x, y, [r, g, b]) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
}

function rect(buf, x1, y1, x2, y2, c) {
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) px(buf, x, y, c);
}

// --- maison.png : pavillon simple, toit deux pans, porte, deux fenêtres, cheminée
const maison = canvas([160, 205, 235]);            // ciel
rect(maison, 0, 200, W, H, [92, 158, 72]);         // pelouse
rect(maison, 66, 122, 192, 200, [226, 208, 168]);  // façade crème
for (let y = 68; y < 122; y++) {                   // toit rouge sombre à deux pans
  const t = (y - 68) / 54;
  const half = Math.round(8 + t * 72);
  rect(maison, 129 - half, y, 129 + half, y + 1, [148, 62, 48]);
}
rect(maison, 158, 52, 176, 96, [110, 58, 46]);     // cheminée
rect(maison, 116, 156, 142, 200, [104, 66, 38]);   // porte
rect(maison, 82, 138, 106, 162, [176, 216, 236]);  // fenêtre gauche
rect(maison, 152, 138, 176, 162, [176, 216, 236]); // fenêtre droite
rect(maison, 93, 138, 95, 162, [90, 90, 90]);      // croisillons
rect(maison, 82, 149, 106, 151, [90, 90, 90]);
rect(maison, 163, 138, 165, 162, [90, 90, 90]);
rect(maison, 152, 149, 176, 151, [90, 90, 90]);

// --- paysage.png : collines + ciel + soleil, aucun bâtiment
const paysage = canvas([135, 190, 235]);
for (let y = 0; y < 120; y++) rect(paysage, 0, y, W, y + 1, [120 + Math.round(y / 4), 185, 235]);
for (let x = 0; x < W; x++) {                      // collines
  const h1 = Math.round(150 + 28 * Math.sin(x / 34));
  const h2 = Math.round(185 + 18 * Math.sin(x / 21 + 2));
  for (let y = h1; y < H; y++) px(paysage, x, y, [70, 140, 60]);
  for (let y = h2; y < H; y++) px(paysage, x, y, [52, 118, 48]);
}
for (let y = -18; y <= 18; y++) for (let x = -18; x <= 18; x++) {  // soleil
  if (x * x + y * y <= 18 * 18) px(paysage, 208 + x, 40 + y, [252, 226, 120]);
}

const dir = path.join(__dirname, '../test/fixtures');
fs.writeFileSync(path.join(dir, 'maison.png'), encodePNG(W, H, maison));
fs.writeFileSync(path.join(dir, 'paysage.png'), encodePNG(W, H, paysage));
console.log('images écrites dans test/fixtures/ (maison.png, paysage.png)');
