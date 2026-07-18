const sharp = require('sharp');

async function renderVoxels(blocks, colors, { scale = 2 } = {}) {
  if (!blocks.length) throw new Error('rien à rendre');
  const proj = (b) => ({ u: b.x - b.z, v: Math.round((b.x + b.z) / 2) - b.y });
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const b of blocks) {
    const { u, v } = proj(b);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const W = (maxU - minU + 2) * scale;
  const H = (maxV - minV + 3) * scale;
  const img = Buffer.alloc(W * H * 3, 235);
  const put = (px, py, [r, g, b2]) => {
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const xx = px + dx;
        const yy = py + dy;
        if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
        const i = (yy * W + xx) * 3;
        img[i] = r; img[i + 1] = g; img[i + 2] = b2;
      }
    }
  };
  const ordered = [...blocks].sort((a, b2) => (a.x + a.z) - (b2.x + b2.z) || a.y - b2.y);
  for (const b of ordered) {
    const c = colors.get(b.block) || [128, 128, 128];
    const { u, v } = proj(b);
    const px = (u - minU) * scale;
    const py = (v - minV) * scale;
    put(px, py, c);                                            // face top
    put(px, py + scale, [Math.round(c[0] * 0.6), Math.round(c[1] * 0.6), Math.round(c[2] * 0.6)]); // flanc
  }
  return sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

module.exports = { renderVoxels };
