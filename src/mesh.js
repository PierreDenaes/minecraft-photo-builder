const sharp = require('sharp');

function parseOBJ(text) {
  const verts = [];
  const triangles = [];
  let sawMtl = false;
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') {
      verts.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    } else if (parts[0] === 'usemtl' || parts[0] === 'mtllib') {
      sawMtl = true;
    } else if (parts[0] === 'f') {
      const idx = parts.slice(1).map((p) => {
        const i = Number(p.split('/')[0]);
        return i > 0 ? i - 1 : verts.length + i;
      });
      for (let k = 1; k + 1 < idx.length; k++) {
        triangles.push({ a: verts[idx[0]], b: verts[idx[k]], c: verts[idx[k + 1]], color: null });
      }
    }
  }
  const result = { triangles };
  if (sawMtl) result.warning = 'matériaux MTL non fournis (upload mono-fichier) : blocs par défaut';
  return result;
}

function parseSTL(buffer) {
  const isBinarySized = buffer.length >= 84 && buffer.length === 84 + buffer.readUInt32LE(80) * 50;
  const head = buffer.toString('ascii', 0, Math.min(buffer.length, 512));
  if (!isBinarySized && head.trimStart().startsWith('solid') && head.includes('facet')) {
    const triangles = [];
    const verts = [];
    for (const m of buffer.toString('ascii').matchAll(/vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g)) {
      verts.push([Number(m[1]), Number(m[2]), Number(m[3])]);
      if (verts.length === 3) {
        triangles.push({ a: verts[0], b: verts[1], c: verts[2], color: null });
        verts.length = 0;
      }
    }
    return { triangles };
  }
  const count = buffer.readUInt32LE(80);
  const triangles = [];
  for (let t = 0; t < count; t++) {
    const off = 84 + t * 50 + 12;
    const v = (k) => [buffer.readFloatLE(off + k * 12), buffer.readFloatLE(off + k * 12 + 4), buffer.readFloatLE(off + k * 12 + 8)];
    triangles.push({ a: v(0), b: v(1), c: v(2), color: null });
  }
  return { triangles };
}

const GLB_COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

async function parseGLB(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('GLB invalide : magic absent');
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB invalide : chunks JSON/BIN manquants');

  const GLB_COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

  function readAccessor(i) {
    const acc = json.accessors[i];
    const view = json.bufferViews[acc.bufferView];
    const Type = GLB_COMPONENT[acc.componentType];
    const comps = GLB_COMPS[acc.type] || 1;
    const start = bin.byteOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
    return new Type(bin.buffer.slice(start, start + acc.count * comps * Type.BYTES_PER_ELEMENT));
  }

  // Décodage paresseux des textures baseColor (photogrammétrie : couleurs dans les textures)
  const texCache = new Map();
  async function textureImage(texIndex) {
    if (texCache.has(texIndex)) return texCache.get(texIndex);
    let decoded = null;
    const src = json.textures?.[texIndex]?.source;
    const img = json.images?.[src];
    if (img !== undefined && img.bufferView !== undefined) {
      const view = json.bufferViews[img.bufferView];
      const start = bin.byteOffset + (view.byteOffset || 0);
      const bytes = Buffer.from(bin.buffer.slice(start, start + view.byteLength));
      try {
        const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        decoded = { data, width: info.width, height: info.height };
      } catch {
        decoded = null; // texture illisible → repli baseColorFactor/défaut
      }
    }
    texCache.set(texIndex, decoded);
    return decoded;
  }

  function sampleTexture(tex, u, v) {
    const wu = u - Math.floor(u);
    const wv = v - Math.floor(v);
    const px = Math.min(tex.width - 1, Math.round(wu * (tex.width - 1)));
    const py = Math.min(tex.height - 1, Math.round(wv * (tex.height - 1)));
    const i = (py * tex.width + px) * 3;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  }

  const triangles = [];
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const mode = prim.mode === undefined ? 4 : prim.mode;
      if (![4, 5, 6].includes(mode)) continue;
      const pos = readAccessor(prim.attributes.POSITION);
      const rawIdx = prim.indices !== undefined ? readAccessor(prim.indices)
        : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      // STRIP (5) et FAN (6) triangulés en listes de triangles
      let idx;
      if (mode === 5) {
        const out = [];
        for (let i = 0; i + 2 < rawIdx.length; i++) out.push(rawIdx[i], rawIdx[i + 1], rawIdx[i + 2]);
        idx = out;
      } else if (mode === 6) {
        const out = [];
        for (let i = 1; i + 1 < rawIdx.length; i++) out.push(rawIdx[0], rawIdx[i], rawIdx[i + 1]);
        idx = out;
      } else {
        idx = rawIdx;
      }
      let color = null;
      let tex = null;
      let uv = null;
      let vcol = null;
      let vcolComps = 3;
      let vcolScale = 1;
      if (prim.attributes.COLOR_0 !== undefined) {
        const acc = json.accessors[prim.attributes.COLOR_0];
        vcolComps = acc.type === 'VEC4' ? 4 : 3;
        vcol = readAccessor(prim.attributes.COLOR_0);
        vcolScale = acc.componentType === 5126 ? 255 : acc.componentType === 5123 ? 255 / 65535 : 1;
      }
      if (prim.material !== undefined) {
        const matFull = json.materials?.[prim.material];
        const mat = matFull?.pbrMetallicRoughness;
        const specGloss = matFull?.extensions?.KHR_materials_pbrSpecularGlossiness;
        // matériau totalement transparent = géométrie invisible dans la source → ignorée
        const alpha = specGloss?.diffuseFactor?.[3] ?? mat?.baseColorFactor?.[3] ?? 1;
        if (alpha < 0.1) continue;
        const texRef = mat?.baseColorTexture ?? specGloss?.diffuseTexture;
        if (texRef !== undefined && prim.attributes.TEXCOORD_0 !== undefined) {
          tex = await textureImage(texRef.index);
          if (tex) uv = readAccessor(prim.attributes.TEXCOORD_0);
        }
        const factor = mat?.baseColorFactor ?? specGloss?.diffuseFactor;
        if (!tex && factor) {
          color = [Math.round(factor[0] * 255), Math.round(factor[1] * 255), Math.round(factor[2] * 255)];
        }
      }
      const p = (i) => [pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]];
      const vertColor = (i) => {
        const o = idx[i] * vcolComps;
        return [vcol[o] * vcolScale, vcol[o + 1] * vcolScale, vcol[o + 2] * vcolScale];
      };
      for (let i = 0; i + 2 < idx.length; i += 3) {
        let triColor = color;
        if (tex && uv) {
          const u = (uv[idx[i] * 2] + uv[idx[i + 1] * 2] + uv[idx[i + 2] * 2]) / 3;
          const v = (uv[idx[i] * 2 + 1] + uv[idx[i + 1] * 2 + 1] + uv[idx[i + 2] * 2 + 1]) / 3;
          triColor = sampleTexture(tex, u, v);
        } else if (vcol) {
          const c1 = vertColor(i);
          const c2 = vertColor(i + 1);
          const c3 = vertColor(i + 2);
          triColor = [0, 1, 2].map((k) => Math.round((c1[k] + c2[k] + c3[k]) / 3));
        }
        triangles.push({ a: p(i), b: p(i + 1), c: p(i + 2), color: triColor });
      }
    }
  }
  return { triangles };
}

async function parseModel(buffer, ext) {
  if (ext === 'obj') return parseOBJ(buffer.toString('utf8'));
  if (ext === 'stl') return parseSTL(buffer);
  if (ext === 'glb') return parseGLB(buffer);
  throw new Error(`format non supporté : ${ext}`);
}

module.exports = { parseModel };
