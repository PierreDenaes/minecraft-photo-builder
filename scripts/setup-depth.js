// Télécharge Depth Anything V2 small (ONNX) — ~50 Mo, hors git
const fs = require('node:fs');
const path = require('node:path');

const URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx';
const DEST = path.join(__dirname, '../models/depth_anything_v2_small.onnx');

async function main() {
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  console.log('téléchargement du modèle de profondeur...');
  const res = await fetch(URL);
  if (!res.ok) {
    console.error(`échec HTTP ${res.status} — cherche "depth-anything-v2-small onnx" sur huggingface.co et télécharge model.onnx vers ${DEST}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(DEST, buf);
  console.log(`ok : ${DEST} (${(buf.length / 1e6).toFixed(1)} Mo)`);
}
main();
