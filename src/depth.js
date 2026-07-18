const fs = require('node:fs');
const path = require('node:path');
const ort = require('onnxruntime-node');
const sharp = require('sharp');

const MODEL_PATH = path.join(__dirname, '../models/depth_anything_v2_small.onnx');
const SIZE = 518;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise = null;

function getSession() {
  if (!fs.existsSync(MODEL_PATH)) {
    return Promise.reject(new Error('modèle de profondeur absent — lance : npm run setup:depth'));
  }
  if (!sessionPromise) sessionPromise = ort.InferenceSession.create(MODEL_PATH);
  return sessionPromise;
}

async function estimateDepth(imageBuffer, { session } = {}) {
  const s = session || await getSession();
  const { data } = await sharp(imageBuffer).removeAlpha()
    .resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const chw = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < 3; c++) {
      chw[c * SIZE * SIZE + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  const inputName = s.inputNames[0];
  const outputs = await s.run({ [inputName]: new ort.Tensor('float32', chw, [1, 3, SIZE, SIZE]) });
  const raw = outputs[s.outputNames[0]].data;
  // Depth Anything sort une disparité (grand = proche) → normaliser en 0 (proche) .. 1 (loin)
  let min = Infinity, max = -Infinity;
  for (const v of raw) { if (v < min) min = v; if (v > max) max = v; }
  const range = max - min || 1;
  const depth = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) depth[i] = 1 - (raw[i] - min) / range;
  const side = Math.round(Math.sqrt(raw.length));
  return { width: side, height: side, data: depth };
}

module.exports = { estimateDepth, MODEL_PATH };
