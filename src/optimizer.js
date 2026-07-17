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
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isInteger(b[axis]) || b[axis] < 0) badCoord = true;
      min[axis] = Math.min(min[axis], b[axis]);
      max[axis] = Math.max(max[axis], b[axis]);
    }
    if (typeof b.block !== 'string' || !valid.has(b.block)) badNames.add(String(b.block));
  }
  if (badCoord) errors.push('coordonnées invalides : entiers >= 0 requis');
  if (badNames.size > 0) errors.push(`blocs inconnus : ${[...badNames].join(', ')}`);
  for (const axis of ['x', 'y', 'z']) {
    const span = max[axis] - min[axis] + 1;
    if (span > maxSize) errors.push(`dimension ${axis} trop grande : ${span} > ${maxSize} (max 64)`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateStructure };
