const { detectFloors, mainBuilding } = require('./rooms');

// comparaison sur le nom de base : « oak_stairs[facing=north] » compte aussi
const STAIR_OR_LADDER = /_stairs(\[|$)|^ladder(\[|$)/;
const MIN_CLEARANCE = 3;

// Audit mécanique d'habitabilité : mesures sur les blocs, pas d'IA.
// Retourne une liste de défauts précis, injectés dans la passe de correction.
// description (optionnelle) : la sortie vision, pour les attentes déclarées (baies...)
function auditHabitability(blocks, description = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];
  const occ = new Set();
  const d = { x: 0, y: 0, z: 0 };
  for (const b of blocks) {
    occ.add(`${b.x},${b.y},${b.z}`);
    d.x = Math.max(d.x, b.x + 1);
    d.y = Math.max(d.y, b.y + 1);
    d.z = Math.max(d.z, b.z + 1);
  }
  // dédoublonnage par position (les générations peuvent superposer des blocs)
  blocks = [...new Map(blocks.map((b) => [`${b.x},${b.y},${b.z}`, b])).values()];
  const defects = [];
  const mask = mainBuilding(blocks);
  const isBoundary = (x, z) => mask.columns.has(`${x},${z}`)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !mask.columns.has(`${x + dx},${z + dz}`));
  const floors = detectFloors(blocks);

  // 1. Hauteur libre par plancher (médiane des cellules sous plafond ;
  // un plancher sans plafond est un toit-terrasse, ignoré)
  const habitable = [];
  for (const fy of floors) {
    const clearances = [];
    let cells = 0;
    for (const b of blocks) {
      if (b.y !== fy) continue;
      if (!mask.columns.has(`${b.x},${b.z}`)) continue; // hors bâtiment principal
      cells++;
      let h = 0;
      let ceiling = false;
      for (let y = fy + 1; y < d.y; y++) {
        if (occ.has(`${b.x},${y},${b.z}`)) { ceiling = true; break; }
        h++;
      }
      if (ceiling) clearances.push(h);
    }
    if (cells === 0 || clearances.length < cells * 0.5) continue; // toit / terrasse
    habitable.push(fy);
    clearances.sort((a, b) => a - b);
    const median = clearances[Math.floor(clearances.length / 2)];
    if (median < MIN_CLEARANCE) {
      defects.push(`plancher y=${fy} : hauteur libre médiane ${median} bloc(s) sous le plafond — vise au moins 4`);
    }
  }

  // 2. Entrée au rez-de-chaussée : ouverture 1x2 sous linteau dans une colonne
  // de la bande périmétrique (≤ 2 du bord — un puits central n'est pas une porte)
  const ground = habitable[0] ?? floors[0] ?? 0;
  let entrance = false;
  for (let x = 0; x < d.x && !entrance; x++) {
    for (let z = 0; z < d.z && !entrance; z++) {
      if (!isBoundary(x, z)) continue; // la porte est dans un mur du bâtiment principal
      // ouverture d'au moins 2 blocs consécutifs à partir de ground+1, avec linteau plein au-dessus
      if (occ.has(`${x},${ground + 1},${z}`) || occ.has(`${x},${ground + 2},${z}`)) continue;
      for (let h = 2; h <= 4 && !entrance; h++) {
        if (h > 2 && occ.has(`${x},${ground + h},${z}`)) break;
        if (occ.has(`${x},${ground + h + 1},${z}`)) entrance = true;
      }
    }
  }
  if (!entrance) {
    defects.push('aucune entrée praticable (ouverture 1x2 sous linteau) au rez-de-chaussée — perce une porte');
  }

  // 3. Accès vertical entre niveaux habitables consécutifs
  for (let i = 0; i + 1 < habitable.length; i++) {
    const [f1, f2] = [habitable[i], habitable[i + 1]];
    const linked = blocks.some((b) => STAIR_OR_LADDER.test(b.block) && b.y > f1 && b.y < f2);
    if (!linked) {
      defects.push(`aucun escalier ni échelle entre les niveaux y=${f1} et y=${f2} — relie-les (trémie dans le plancher + escaliers alignés)`);
    }
  }

  // 4. Façades trop uniformes (almanach, règle de la profondeur) : < 3 matériaux
  const baseOf = (n) => n.replace(/\[[^\]]*\]$/, '');
  const inMask = (b) => mask.columns.has(`${b.x},${b.z}`);
  const facades = [
    [`x=${mask.box.x1}`, (b) => b.x === mask.box.x1 && inMask(b), (b) => b.z],
    [`x=${mask.box.x2}`, (b) => b.x === mask.box.x2 && inMask(b), (b) => b.z],
    [`z=${mask.box.z1}`, (b) => b.z === mask.box.z1 && inMask(b), (b) => b.x],
    [`z=${mask.box.z2}`, (b) => b.z === mask.box.z2 && inMask(b), (b) => b.x]
  ];
  for (const [name, pred] of facades) {
    const wall = blocks.filter(pred);
    if (wall.length < 30) continue;
    const mats = new Set(wall.map((b) => baseOf(b.block)));
    if (mats.size < 3) {
      defects.push(`façade ${name} : ${mats.size} matériau(x) seulement — varie (3 à 5, stairs/slabs/walls de la palette compris)`);
    }
  }

  // 4bis. Eau : chaque bloc d'eau doit avoir un fond (bloc plein directement dessous)
  const eauLibre = blocks.filter((b) => baseOf(b.block) === 'water'
    && !occ.has(`${b.x},${b.y - 1},${b.z}`));
  if (eauLibre.length > 0) {
    defects.push(`eau non contenue : ${eauLibre.length} bloc(s) d'eau sans fond — creuse un bassin étanche (fond + parois)`);
  }

  // 4ter. Fenêtres promises par la vision mais absentes du bâti
  const attendFenetres = /fenetre|fenêtre|baie|vitr/i.test(JSON.stringify(description.elements || []));
  if (attendFenetres) {
    const vitresMur = blocks.filter((b) => /^glass(\[|$)|^glass_pane(\[|$)/.test(b.block) && isBoundary(b.x, b.z)).length;
    const minVitres = Math.max(4, (description.etages || 1) * 2);
    if (vitresMur < minVitres) {
      defects.push(`la photo montre des baies vitrées mais les murs n'ont que ${vitresMur} vitre(s) — perce de vraies fenêtres en glass_pane encadrées sur les façades`);
    }
  }

  // 5. Alignement vertical des fenêtres entre niveaux consécutifs (par façade)
  for (const [name, pred, coord] of facades) {
    for (let i = 0; i + 1 < habitable.length; i++) {
      const [f1, f2] = [habitable[i], habitable[i + 1]];
      const gap = f2 - f1;
      const winsIn = (yMin, yMax) => new Set(blocks
        .filter((b) => pred(b) && baseOf(b.block) === 'glass_pane' && b.y > yMin && b.y <= yMax)
        .map(coord));
      const bas = winsIn(f1, f2 - 1);
      const haut = winsIn(f2, f2 + gap);
      if (bas.size === 0 || haut.size === 0) continue;
      if (![...haut].some((c) => bas.has(c))) {
        defects.push(`fenêtres désalignées sur la façade ${name} entre les niveaux y=${f1} et y=${f2} — aligne les colonnes de baies`);
      }
    }
  }

  return defects;
}

module.exports = { auditHabitability };
