const sharp = require('sharp');

function parseOBJ(text) {
  const verts = [];
  const triangles = [];
  let sawMtl = false;
  let badFaces = 0;
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
        const A = verts[idx[0]], B = verts[idx[k]], C = verts[idx[k + 1]];
        if (!A || !B || !C) { badFaces++; continue; }
        triangles.push({ a: A, b: B, c: C, color: null });
      }
    }
  }
  const result = { triangles };
  const warnings = [];
  if (sawMtl) warnings.push('matériaux MTL non fournis (upload mono-fichier) : blocs par défaut');
  if (badFaces > 0) warnings.push(`${badFaces} face(s) avec sommets manquants ignorée(s)`);
  if (warnings.length > 0) result.warning = warnings.join(' ; ');
  return result;
}

function parseSTLAscii(text) {
  const triangles = [];
  const verts = [];
  for (const m of text.matchAll(/vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g)) {
    verts.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (verts.length === 3) {
      triangles.push({ a: verts[0], b: verts[1], c: verts[2], color: null });
      verts.length = 0;
    }
  }
  return { triangles };
}

function parseSTL(buffer) {
  const head = buffer.toString('ascii', 0, Math.min(buffer.length, 512));
  const looksAscii = head.trimStart().startsWith('solid') && head.includes('facet');
  const isBinarySized = buffer.length >= 84 && buffer.length === 84 + buffer.readUInt32LE(80) * 50;
  if (!isBinarySized && looksAscii) return parseSTLAscii(buffer.toString('ascii'));
  if (buffer.length < 84) throw new Error('STL invalide ou tronqué (en-tête binaire incomplet)');
  const declared = buffer.readUInt32LE(80);
  const count = Math.min(declared, Math.floor((buffer.length - 84) / 50));
  if (count < declared) console.warn(`[mesh] STL tronqué : ${count}/${declared} triangles lus`);
  const triangles = [];
  for (let t = 0; t < count; t++) {
    const off = 84 + t * 50 + 12;
    const v = (k) => [buffer.readFloatLE(off + k * 12), buffer.readFloatLE(off + k * 12 + 4), buffer.readFloatLE(off + k * 12 + 8)];
    triangles.push({ a: v(0), b: v(1), c: v(2), color: null });
  }
  return { triangles };
}

const GLB_COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

const MAT4_IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// a × b, colonne-major (convention glTF)
function mat4Multiply(a, b) {
  const out = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// matrice locale d'un node : node.matrix si présent, sinon composition T×R×S
// (quaternion glTF [x,y,z,w])
function nodeLocalMatrix(node) {
  if (node.matrix) return node.matrix;
  const t = node.translation || [0, 0, 0];
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1
  ];
}

function mat4TransformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ];
}

// Limitations connues : accessors "sparse" non supportés (rares) ; skins et
// morph targets ignorés (les meshes sont pris en pose de repos).
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
    const elemBytes = comps * Type.BYTES_PER_ELEMENT;
    const stride = view.byteStride || elemBytes;
    const base = bin.byteOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
    if (stride === elemBytes) {
      return new Type(bin.buffer.slice(base, base + acc.count * elemBytes));
    }
    // buffer entrelacé : recopie élément par élément
    // (offsets alignés par spec glTF sur BYTES_PER_ELEMENT)
    const out = new Type(acc.count * comps);
    for (let e = 0; e < acc.count; e++) {
      const src = new Type(bin.buffer, base + e * stride, comps);
      out.set(src, e * comps);
    }
    return out;
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

  // Parcours du graphe de scène : chaque node portant un mesh donne une instance
  // (mesh, matrice monde). Un même mesh instancié par plusieurs nodes est
  // volontairement dupliqué. Repli : GLB sans scenes/nodes → meshes à l'identité.
  const meshInstances = [];
  const roots = (json.scenes || []).flatMap((sc) => sc.nodes || []);
  if (roots.length > 0 && Array.isArray(json.nodes)) {
    const visit = (nodeIndex, parentM) => {
      const node = json.nodes[nodeIndex];
      if (!node) return;
      const world = mat4Multiply(parentM, nodeLocalMatrix(node));
      if (node.mesh !== undefined && json.meshes?.[node.mesh]) {
        meshInstances.push({ mesh: json.meshes[node.mesh], matrix: world });
      }
      for (const child of node.children || []) visit(child, world);
    };
    for (const r of roots) visit(r, MAT4_IDENTITY);
  }
  if (meshInstances.length === 0) {
    for (const mesh of json.meshes || []) meshInstances.push({ mesh, matrix: null });
  }

  const triangles = [];
  for (const { mesh, matrix } of meshInstances) {
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
      const p = matrix
        ? (i) => mat4TransformPoint(matrix, pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2])
        : (i) => [pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]];
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

module.exports = { parseModel, nodeLocalMatrix, mat4Multiply, mat4TransformPoint };
