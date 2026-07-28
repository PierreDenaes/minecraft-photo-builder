# Plan de correction : src/mesh.js

Contexte : audit du 27/07/2026 (fichier 10/13, couvre le trio mesh : meshvoxelizer.js et meshclean.js sont sains, AUCUNE modification dans ces deux fichiers). Décision de Pierre : correctif COMPLET pour les transforms GLB (point 4).

Règle générale : ne change aucun comportement fonctionnel non listé ici. Le contrat de sortie reste `{ triangles: [{a, b, c, color}], warning? }`.

---

## 1. parseSTL : gardes contre les fichiers tronqués/invalides

Problème : un binaire < 84 octets ou dont le compteur annonce plus de triangles que la taille réelle part en RangeError dans readUInt32LE/readFloatLE.

Restructurer `parseSTL` :
```js
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
```

## 2. parseOBJ : ignorer les faces aux sommets manquants

Problème : un index de face hors bornes produit un triangle avec un sommet `undefined`, qui crashe plus loin dans meshvoxelizer.

Dans `parseOBJ`, remplacer la boucle de triangulation des faces :
```js
for (let k = 1; k + 1 < idx.length; k++) {
  triangles.push({ a: verts[idx[0]], b: verts[idx[k]], c: verts[idx[k + 1]], color: null });
}
```
par (avec `let badFaces = 0;` déclaré en tête de fonction) :
```js
for (let k = 1; k + 1 < idx.length; k++) {
  const A = verts[idx[0]], B = verts[idx[k]], C = verts[idx[k + 1]];
  if (!A || !B || !C) { badFaces++; continue; }
  triangles.push({ a: A, b: B, c: C, color: null });
}
```
Et en fin de fonction, compléter le warning :
```js
const result = { triangles };
const warnings = [];
if (sawMtl) warnings.push('matériaux MTL non fournis (upload mono-fichier) : blocs par défaut');
if (badFaces > 0) warnings.push(`${badFaces} face(s) avec sommets manquants ignorée(s)`);
if (warnings.length > 0) result.warning = warnings.join(' ; ');
return result;
```

## 3. parseGLB : supporter byteStride (buffers entrelacés)

Problème : `readAccessor` ignore `view.byteStride` : un GLB entrelacé (three.js et d'autres exporteurs) est lu décalé → géométrie poubelle silencieuse.

Remplacer `readAccessor` :
```js
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
```

## 4. parseGLB : appliquer les transformations du graphe de scène (correctif complet)

Problème : `parseGLB` itère `json.meshes` sans parcourir scenes→nodes : un GLB multi-pièces positionnées par transforms (statue = corps + bras + socle) voxelise tout SUPERPOSÉ à l'origine.

a) Ajouter les helpers mat4 (hors de parseGLB, niveau module). Convention glTF : matrices colonne-major :
```js
const MAT4_IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// a × b, colonne-major
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
```

b) Dans `parseGLB`, juste avant la boucle `for (const mesh of json.meshes || [])`, construire la liste des instances de mesh avec leur matrice monde :
```js
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
```

c) Remplacer la boucle externe :
```js
for (const mesh of json.meshes || []) {
```
par :
```js
for (const { mesh, matrix } of meshInstances) {
```
et dans le corps, remplacer la fonction `p` :
```js
const p = (i) => [pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]];
```
par :
```js
const p = matrix
  ? (i) => mat4TransformPoint(matrix, pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2])
  : (i) => [pos[idx[i] * 3], pos[idx[i] * 3 + 1], pos[idx[i] * 3 + 2]];
```

---

## Annexe : limitations documentées (pas de correctif)

Ajouter en commentaire au-dessus de `parseGLB` :
```js
// Limitations connues : accessors "sparse" non supportés (rares) ; skins et
// morph targets ignorés (les meshes sont pris en pose de repos).
```

---

## Vérification finale

1. `node -e "require('./src/mesh.js')"` charge sans erreur.
2. STL tronqué : `parseModel(Buffer.alloc(50), 'stl')` rejette avec « STL invalide ou tronqué » (pas de RangeError).
3. Non-régression STL/OBJ : re-voxeliser un modèle déjà testé (!statue ou !diorama) et comparer le nombre de triangles parsés avant/après : identique.
4. Test transforms GLB (le point clé) : générer un GLB de test à deux nodes translatés, par exemple avec un script three.js/gltf-transform, OU utiliser un GLB multi-pièces connu. Vérifier :
   - avant correctif : les pièces se superposent à l'origine ;
   - après : la silhouette voxelisée respecte la disposition des pièces.
   Test mathématique rapide sans fichier :
```js
// visit d'un node translation [10,0,0] doit décaler les positions de +10 en x
// nodeLocalMatrix({translation:[10,0,0]}) → mat4TransformPoint(m, 1,2,3) === [11,2,3]
// rotation quart de tour autour Y : {rotation:[0,0.7071068,0,0.7071068]} →
// mat4TransformPoint(m, 1,0,0) ≈ [0,0,-1]
```
5. Test stride : vérifier qu'un GLB « classique » (non entrelacé) donne exactement les mêmes triangles qu'avant (le chemin rapide `stride === elemBytes` est inchangé).
6. En jeu : !statue avec un GLB auteuré multi-pièces → la statue est assemblée, pas empilée à l'origine.
