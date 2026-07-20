const { detectFloors, dimsOf } = require('./rooms');

// L'escalier n'est plus confié au code du LLM : les volées enchevêtrées sont
// retirées et UNE cage propre est taillée mécaniquement entre chaque paire
// d'étages (marches alignées, trémie percée, masse de soutien pleine).

const baseOf = (n) => n.replace(/\[[^\]]*\]$/, '');

function carveStaircase(blocks) {
  const floors = detectFloors(blocks);
  if (floors.length < 2) return { blocks, carved: 0 };
  const d = dimsOf(blocks);
  const occ = new Map();
  for (const b of blocks) occ.set(`${b.x},${b.y},${b.z}`, b);

  // 1. Retirer les escaliers intérieurs du LLM (entre planchers, hors coquille)
  const isInterior = (b) => b.x > 0 && b.x < d.x - 1 && b.z > 0 && b.z < d.z - 1;
  const betweenFloors = (y) => floors.some((f, i) => i + 1 < floors.length && y > f && y <= floors[i + 1]);
  let kept = blocks.filter((b) => {
    if (!/_stairs(\[|$)/.test(b.block)) return true;
    if (/half=top/.test(b.block)) return true; // corniches
    return !(isInterior(b) && betweenFloors(b.y));
  });

  let carved = 0;
  for (let fi = 0; fi + 1 < floors.length; fi++) {
    const [f1, f2] = [floors[fi], floors[fi + 1]];
    const gap = f2 - f1;
    if (gap < 2 || gap > 8) continue;
    // on ne monte que vers un VRAI étage : un niveau sans rien au-dessus est un toit
    if (!kept.some((b) => b.y > f2)) continue;
    const solid = new Set(kept.map((b) => `${b.x},${b.y},${b.z}`));
    const has = (x, y, z) => solid.has(`${x},${y},${z}`);
    const solidAt = has;
    // 2. Chercher une bande de `gap` cases en +x, sur plancher f1, dégagée jusqu'à f2
    let strip = null;
    for (let z = 1; z < d.z - 1 && !strip; z++) {
      for (let x0 = 1; x0 + gap < d.x - 1 && !strip; x0++) {
        let ok = true;
        for (let i = 0; i < gap && ok; i++) {
          const x = x0 + i;
          if (!solidAt(x, f1, z)) ok = false; // sol requis
          for (let y = f1 + 1; y < f2 && ok; y++) {
            if (solidAt(x, y, z)) ok = false; // volume libre
          }
          // dégagement de tête à l'arrivée (au-dessus de la trémie)
          if (i >= 1 && solidAt(x, f2 + 1, z)) ok = false;
        }
        if (ok) strip = { x0, z };
      }
    }
    if (!strip) continue;
    const { x0, z } = strip;
    // 3. Trémie : retirer le plancher f2 au-dessus des marches hautes (têtes libres)
    const tremie = new Set();
    for (let i = 1; i < gap; i++) tremie.add(`${x0 + i},${f2},${z}`);
    tremie.add(`${x0 + gap},${f2},${z}`); // palier d'arrivée dégagé ? non : le palier est SUR f2
    tremie.delete(`${x0 + gap},${f2},${z}`);
    kept = kept.filter((b) => !tremie.has(`${b.x},${b.y},${b.z}`));
    // 4. Marches + masse de soutien pleine sous chaque marche
    for (let i = 0; i < gap; i++) {
      const x = x0 + i;
      const y = f1 + 1 + i;
      kept.push({ x, y, z, block: 'oak_stairs[facing=east,half=bottom]' });
      for (let yy = f1 + 1; yy < y; yy++) {
        if (!has(x, yy, z)) kept.push({ x, y: yy, z, block: 'oak_planks' });
      }
    }
    carved++;
  }
  return { blocks: kept, carved };
}

module.exports = { carveStaircase };
