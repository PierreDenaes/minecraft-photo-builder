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

function parseGLB(buffer) {
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

  function readAccessor(i) {
    const acc = json.accessors[i];
    const view = json.bufferViews[acc.bufferView];
    const Type = GLB_COMPONENT[acc.componentType];
    const comps = acc.type === 'VEC3' ? 3 : 1;
    const start = bin.byteOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
    return new Type(bin.buffer.slice(start, start + acc.count * comps * Type.BYTES_PER_ELEMENT));
  }

  const triangles = [];
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue;
      const pos = readAccessor(prim.attributes.POSITION);
      const idx = prim.indices !== undefined ? readAccessor(prim.indices)
        : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      let color = null;
      if (prim.material !== undefined) {
        const f = json.materials[prim.material]?.pbrMetallicRoughness?.baseColorFactor;
        if (f) color = [Math.round(f[0] * 255), Math.round(f[1] * 255), Math.round(f[2] * 255)];
      }
      const p = (i) => [pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]];
      for (let i = 0; i + 2 < idx.length; i += 3) {
        triangles.push({ a: p(i), b: p(i + 1), c: p(i + 2), color });
      }
    }
  }
  return { triangles };
}

function parseModel(buffer, ext) {
  if (ext === 'obj') return parseOBJ(buffer.toString('utf8'));
  if (ext === 'stl') return parseSTL(buffer);
  if (ext === 'glb') return parseGLB(buffer);
  throw new Error(`format non supporté : ${ext}`);
}

module.exports = { parseModel };
