function validateStructure(blocks, { maxSize, maxBlocks, validBlocks }) {
  const errors = [];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { ok: false, errors: ['structure vide ou invalide'] };
  }
  if (blocks.length > maxBlocks) {
    errors.push(`trop de blocs : ${blocks.length} > ${maxBlocks}`);
  }
  const valid = new Set(validBlocks);
  const badNames = new Set();
  let badCoord = false;
  let min = { x: Infinity, y: Infinity, z: Infinity };
  let max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of blocks) {
    if (typeof b !== 'object' || b === null) {
      return { ok: false, errors: ['élément de structure invalide : objet {x, y, z, block} requis'] };
    }
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isInteger(b[axis]) || b[axis] < 0) badCoord = true;
      min[axis] = Math.min(min[axis], b[axis]);
      max[axis] = Math.max(max[axis], b[axis]);
    }
    // le nom peut porter un état de bloc ([facing=...], [persistent=...]) : on valide le nom de base
    if (typeof b.block !== 'string' || !valid.has(b.block.replace(/\[[^\]]*\]$/, ''))) badNames.add(String(b.block));
  }
  if (badCoord) errors.push('coordonnées invalides : entiers >= 0 requis');
  if (badNames.size > 0) errors.push(`blocs inconnus : ${[...badNames].join(', ')}`);
  for (const axis of ['x', 'y', 'z']) {
    const span = max[axis] - min[axis] + 1;
    if (span > maxSize) errors.push(`dimension ${axis} trop grande : ${span} > ${maxSize} (max 64)`);
  }
  return { ok: errors.length === 0, errors };
}

// Feuilles posées par commande : persistent=true, sinon elles se décomposent
// sans tronc à moins de 6 blocs (fresques, haies, surfaces végétales)
const cmdBlock = (name) => (name.endsWith('_leaves') ? `${name}[persistent=true]` : name);

function optimizeToCommands(blocks, origin) {
  const byCoord = new Map();
  for (const b of blocks) {
    if (b.block === 'air') { byCoord.delete(`${b.x},${b.y},${b.z}`); continue; }
    byCoord.set(`${b.x},${b.y},${b.z}`, b);
  }
  const rows = new Map();
  for (const b of byCoord.values()) {
    const key = `${b.y}|${b.z}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(b);
  }
  const keys = [...rows.keys()].sort((a, b) => {
    const [ya, za] = a.split('|').map(Number);
    const [yb, zb] = b.split('|').map(Number);
    return ya - yb || za - zb;
  });
  const commands = [];
  for (const key of keys) {
    const row = rows.get(key).sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < row.length) {
      let j = i;
      while (
        j + 1 < row.length &&
        row[j + 1].x === row[j].x + 1 &&
        row[j + 1].block === row[i].block
      ) j++;
      const a = row[i];
      const b = row[j];
      const ax = origin.x + a.x, ay = origin.y + a.y, az = origin.z + a.z;
      if (i === j) {
        commands.push(`/setblock ${ax} ${ay} ${az} ${cmdBlock(a.block)}`);
      } else {
        commands.push(`/fill ${ax} ${ay} ${az} ${origin.x + b.x} ${ay} ${az} ${cmdBlock(a.block)}`);
      }
      i = j + 1;
    }
  }
  return commands;
}

module.exports = { validateStructure, optimizeToCommands };
