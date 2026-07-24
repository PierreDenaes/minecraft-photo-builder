// Primitives de construction : le LLM appelle ces fonctions au lieu de poser des
// blocs. Chacune retourne un tableau [{x, y, z, block}] et vérifie ses arguments.

const OPPOSITE = { nord: 'south', sud: 'north', est: 'west', ouest: 'east' };
const FACADE_AXIS = {
  nord: (b) => ({ fixed: 'z', side: 'max' }),   // façade nord = z maximum
  sud: (b) => ({ fixed: 'z', side: 'min' }),    // façade sud = z minimum
  est: (b) => ({ fixed: 'x', side: 'max' }),
  ouest: (b) => ({ fixed: 'x', side: 'min' })
};

function checkPositiveBox(x1, x2, z1, z2, y0, y1) {
  if (x2 < x1 || z2 < z1) throw new Error(`dimensions invalides : x2>=x1 et z2>=z1 requis (${x1},${z1}→${x2},${z2})`);
  if (y1 !== undefined && y1 < y0) throw new Error(`dimensions invalides : y1>=y0 requis (${y0}→${y1})`);
}

function boite({ x1, z1, x2, z2, y0, y1, murs, fondation, plancher }) {
  checkPositiveBox(x1, x2, z1, z2, y0, y1);
  if (!murs) throw new Error('boite : materiau des murs manquant');
  const out = [];
  // dalle basse (fondation ou murs)
  const bas = fondation || murs;
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y: y0, z, block: bas });
  // 4 murs pleins entre y0+1 et y1-1
  for (let y = y0 + 1; y < y1; y++) {
    for (let x = x1; x <= x2; x++) { out.push({ x, y, z: z1, block: murs }); out.push({ x, y, z: z2, block: murs }); }
    for (let z = z1 + 1; z < z2; z++) { out.push({ x: x1, y, z, block: murs }); out.push({ x: x2, y, z, block: murs }); }
  }
  // plancher haut (facultatif)
  if (plancher) {
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y: y1, z, block: plancher });
  }
  return out;
}

// Perce un mur : ouverture 1×hauteur + linteau, plus la porte battante orientée
// vers l'intérieur du bâtiment (facing = direction dans laquelle la porte s'ouvre).
function porte({ facade, x, z, y0 = 0, hauteur = 2, materiau }) {
  if (!(facade in OPPOSITE)) throw new Error(`porte : facade "${facade}" inconnue (nord|sud|est|ouest)`);
  if (!materiau) throw new Error('porte : materiau manquant');
  const out = [];
  const facing = OPPOSITE[facade]; // nord → south, sud → north...
  for (let dy = 1; dy <= hauteur; dy++) out.push({ x, y: y0 + dy, z, block: 'air' });
  out.push({ x, y: y0 + hauteur + 1, z, block: materiau }); // linteau
  // porte battante 2 blocs (la primitive pose un oak_door par défaut ; le materiau ne s'applique qu'au linteau)
  out.push({ x, y: y0 + 1, z, block: `oak_door[facing=${facing},half=lower]` });
  out.push({ x, y: y0 + 2, z, block: `oak_door[facing=${facing},half=upper]` });
  return out;
}

// Baie vitrée : rangée de glass_pane à l'emplacement donné, encadrement autour
function baie({ facade, x1, z1, x2, z2, y1, y2, encadrement }) {
  if (!(facade in OPPOSITE)) throw new Error(`baie : facade "${facade}" inconnue`);
  if (!encadrement) throw new Error('baie : encadrement manquant');
  if (y2 < y1) throw new Error('baie : y2>=y1 requis');
  const out = [];
  const onFacade = facade === 'nord' || facade === 'sud';
  // ligne de vitres
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) for (let y = y1; y <= y2; y++) {
    out.push({ x, y, z, block: 'glass_pane' });
  }
  // encadrement : appui (y=y1-1), linteau (y=y2+1), jambages (aux extrémités)
  const xa = x1 - (onFacade ? 1 : 0);
  const xb = x2 + (onFacade ? 1 : 0);
  const za = z1 - (onFacade ? 0 : 1);
  const zb = z2 + (onFacade ? 0 : 1);
  for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
    out.push({ x, y: y1 - 1, z, block: encadrement });
    out.push({ x, y: y2 + 1, z, block: encadrement });
  }
  for (let y = y1; y <= y2; y++) {
    if (onFacade) {
      for (let z = z1; z <= z2; z++) { out.push({ x: xa, y, z, block: encadrement }); out.push({ x: xb, y, z, block: encadrement }); }
    } else {
      for (let x = x1; x <= x2; x++) { out.push({ x, y, z: za, block: encadrement }); out.push({ x, y, z: zb, block: encadrement }); }
    }
  }
  return out;
}

function toitPlat({ x1, z1, x2, z2, y, materiau, acrotere = true, debord = 1 }) {
  checkPositiveBox(x1, x2, z1, z2, y);
  if (!materiau) throw new Error('toitPlat : materiau manquant');
  const out = [];
  const X1 = x1 - debord;
  const X2 = x2 + debord;
  const Z1 = z1 - debord;
  const Z2 = z2 + debord;
  for (let x = X1; x <= X2; x++) for (let z = Z1; z <= Z2; z++) out.push({ x, y, z, block: materiau });
  if (acrotere) {
    const wall = /_bricks$|_planks$/.test(materiau)
      ? materiau.replace(/_planks$|_bricks$/, (m) => m === '_planks' ? '_wall' : '_brick_wall')
      : 'cobblestone_wall';
    for (let x = X1; x <= X2; x++) { out.push({ x, y: y + 1, z: Z1, block: wall }); out.push({ x, y: y + 1, z: Z2, block: wall }); }
    for (let z = Z1 + 1; z < Z2; z++) { out.push({ x: X1, y: y + 1, z, block: wall }); out.push({ x: X2, y: y + 1, z, block: wall }); }
  }
  return out;
}

function toitDeuxPans({ x1, z1, x2, z2, y_base, faitage, materiau, debord = 1 }) {
  checkPositiveBox(x1, x2, z1, z2, y_base);
  if (faitage !== 'x' && faitage !== 'z') throw new Error('toitDeuxPans : faitage doit être "x" ou "z"');
  if (!materiau) throw new Error('toitDeuxPans : materiau manquant');
  const stairs = `${materiau}_stairs`;
  const planks = `${materiau}_planks`;
  const out = [];
  if (faitage === 'x') {
    const zMid = (z1 + z2) / 2;
    const halfZ = Math.floor((z2 - z1) / 2);
    for (let i = 0; i <= halfZ; i++) {
      const y = y_base + i;
      const zNord = z1 + i;
      const zSud = z2 - i;
      // débord au premier rang
      const xa = x1 - (i === 0 ? debord : 0);
      const xb = x2 + (i === 0 ? debord : 0);
      for (let x = xa; x <= xb; x++) {
        out.push({ x, y, z: zNord, block: `${stairs}[facing=south,half=bottom]` });
        if (zSud !== zNord) out.push({ x, y, z: zSud, block: `${stairs}[facing=north,half=bottom]` });
      }
      // pignons remplis en dessous du versant à chaque rang
      for (let x of [x1, x2]) {
        for (let yy = y_base; yy < y; yy++) {
          if (!out.some((b) => b.x === x && b.y === yy && b.z === zNord)) out.push({ x, y: yy, z: zNord, block: planks });
          if (zSud !== zNord && !out.some((b) => b.x === x && b.y === yy && b.z === zSud)) out.push({ x, y: yy, z: zSud, block: planks });
        }
      }
    }
    // faîtage : rang unique au milieu si emprise impaire, sinon deux versants se rejoignent
    if ((z2 - z1) % 2 === 0) {
      const zM = z1 + halfZ;
      const y = y_base + halfZ;
      for (let x = x1; x <= x2; x++) out.push({ x, y: y + 1, z: zM, block: planks });
    }
    // remplissage pignons entre les versants (colonnes x=x1 et x=x2)
    for (const x of [x1, x2]) {
      for (let z = z1 + 1; z < z2; z++) {
        const dz = Math.min(z - z1, z2 - z);
        for (let y = y_base; y < y_base + dz; y++) {
          out.push({ x, y, z, block: planks });
        }
      }
    }
  } else {
    // symétrique en z ↔ x
    const halfX = Math.floor((x2 - x1) / 2);
    for (let i = 0; i <= halfX; i++) {
      const y = y_base + i;
      const xNord = x1 + i;
      const xSud = x2 - i;
      const za = z1 - (i === 0 ? debord : 0);
      const zb = z2 + (i === 0 ? debord : 0);
      for (let z = za; z <= zb; z++) {
        out.push({ x: xNord, y, z, block: `${stairs}[facing=east,half=bottom]` });
        if (xSud !== xNord) out.push({ x: xSud, y, z, block: `${stairs}[facing=west,half=bottom]` });
      }
      // pignons remplis sous les versants aux extrémités z=z1 et z=z2
      for (const z of [z1, z2]) {
        for (let yy = y_base; yy < y; yy++) {
          if (!out.some((b) => b.x === xNord && b.y === yy && b.z === z)) out.push({ x: xNord, y: yy, z, block: planks });
          if (xSud !== xNord && !out.some((b) => b.x === xSud && b.y === yy && b.z === z)) out.push({ x: xSud, y: yy, z, block: planks });
        }
      }
    }
    if ((x2 - x1) % 2 === 0) {
      const xM = x1 + halfX;
      const y = y_base + halfX;
      for (let z = z1; z <= z2; z++) out.push({ x: xM, y: y + 1, z, block: planks });
    }
    for (const z of [z1, z2]) {
      for (let x = x1 + 1; x < x2; x++) {
        const dx = Math.min(x - x1, x2 - x);
        for (let y = y_base; y < y_base + dx; y++) out.push({ x, y, z, block: planks });
      }
    }
  }
  return out;
}

function toitQuatrePans({ x1, z1, x2, z2, y_base, materiau, debord = 1 }) {
  checkPositiveBox(x1, x2, z1, z2, y_base);
  if (!materiau) throw new Error('toitQuatrePans : materiau manquant');
  const stairs = `${materiau}_stairs`;
  const planks = `${materiau}_planks`;
  const out = [];
  const rayon = Math.min(Math.floor((x2 - x1) / 2), Math.floor((z2 - z1) / 2));
  for (let i = 0; i <= rayon; i++) {
    const y = y_base + i;
    const X1 = x1 + i - (i === 0 ? debord : 0);
    const X2 = x2 - i + (i === 0 ? debord : 0);
    const Z1 = z1 + i - (i === 0 ? debord : 0);
    const Z2 = z2 - i + (i === 0 ? debord : 0);
    for (let x = X1; x <= X2; x++) {
      out.push({ x, y, z: Z1, block: `${stairs}[facing=south,half=bottom]` });
      if (Z2 !== Z1) out.push({ x, y, z: Z2, block: `${stairs}[facing=north,half=bottom]` });
    }
    for (let z = Z1 + 1; z < Z2; z++) {
      out.push({ x: X1, y, z, block: `${stairs}[facing=east,half=bottom]` });
      if (X2 !== X1) out.push({ x: X2, y, z, block: `${stairs}[facing=west,half=bottom]` });
    }
  }
  // pointe centrée (si emprise carrée impaire, un bloc plein, sinon petite dalle)
  const cx1 = x1 + rayon; const cx2 = x2 - rayon;
  const cz1 = z1 + rayon; const cz2 = z2 - rayon;
  const y = y_base + rayon + 1;
  for (let x = cx1; x <= cx2; x++) for (let z = cz1; z <= cz2; z++) out.push({ x, y, z, block: planks });
  return out;
}

const STAIR_STEP = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };

function escalier({ x, z, y_bas, y_haut, facing, materiau, tremie = true, largeur = 1 }) {
  if (!(facing in STAIR_STEP)) throw new Error(`escalier : facing "${facing}" inconnu`);
  if (!materiau) throw new Error('escalier : materiau manquant');
  const gap = y_haut - y_bas;
  if (gap < 1) throw new Error(`escalier : y_haut>y_bas requis (${y_bas}→${y_haut})`);
  const [dx, dz] = STAIR_STEP[facing];
  const stairs = `${materiau}_stairs`;
  const planks = `${materiau}_planks`;
  const out = [];
  for (let i = 1; i <= gap; i++) {
    const cx = x + dx * (i - 1);
    const cz = z + dz * (i - 1);
    const cy = y_bas + i;
    for (let w = 0; w < largeur; w++) {
      const wx = cx + (facing === 'east' || facing === 'west' ? 0 : w);
      const wz = cz + (facing === 'north' || facing === 'south' ? 0 : w);
      out.push({ x: wx, y: cy, z: wz, block: `${stairs}[facing=${facing},half=bottom]` });
      // masse de soutien pleine sous chaque marche
      for (let yy = y_bas + 1; yy < cy; yy++) out.push({ x: wx, y: yy, z: wz, block: planks });
    }
  }
  // trémie : cases air au niveau y_haut au-dessus des marches, SAUF au sommet
  // (la marche du sommet est elle-même à y_haut — on ne l'écrase pas avec air)
  if (tremie) {
    for (let i = 1; i < gap; i++) {
      const cx = x + dx * (i - 1);
      const cz = z + dz * (i - 1);
      for (let w = 0; w < largeur; w++) {
        const wx = cx + (facing === 'east' || facing === 'west' ? 0 : w);
        const wz = cz + (facing === 'north' || facing === 'south' ? 0 : w);
        out.push({ x: wx, y: y_haut, z: wz, block: 'air' });
      }
    }
  }
  return out;
}

function piscine({ x1, z1, x2, z2, y_surface, profondeur = 2, bordure }) {
  checkPositiveBox(x1, x2, z1, z2, y_surface);
  if (!bordure) throw new Error('piscine : bordure manquante');
  const fond = y_surface - profondeur;
  if (fond < 0) throw new Error(`piscine : y_surface=${y_surface} trop bas pour profondeur=${profondeur} — il faut y_surface>=profondeur pour que le fond soit à y>=0. Si la maison est au sol y=0, la piscine s'enterre : appelle avec y_surface=${profondeur} et laisse la maison à y0=0.`);
  const out = [];
  // fond plein
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y: fond, z, block: bordure });
  // parois pleines
  for (let y = fond + 1; y <= y_surface; y++) {
    for (let x = x1; x <= x2; x++) { out.push({ x, y, z: z1, block: bordure }); out.push({ x, y, z: z2, block: bordure }); }
    for (let z = z1 + 1; z < z2; z++) { out.push({ x: x1, y, z, block: bordure }); out.push({ x: x2, y, z, block: bordure }); }
  }
  // eau à l'intérieur, sur toute la hauteur de la piscine
  for (let x = x1 + 1; x < x2; x++) for (let z = z1 + 1; z < z2; z++) {
    for (let y = fond + 1; y <= y_surface; y++) out.push({ x, y, z, block: 'water' });
  }
  return out;
}

// Préfixes bois connus : le materiau se décline en _planks (dalles) et _log (paroi)
const WOOD_PREFIX = new Set(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'crimson', 'warped']);

function tour({ x, z, rayon, y_bas, y_haut, materiau, toit_conique = true, creneaux = false }) {
  if (!materiau) throw new Error('tour : materiau manquant');
  if (rayon < 1) throw new Error(`tour : rayon>=1 requis (${rayon})`);
  if (y_haut <= y_bas) throw new Error(`tour : hauteur y_haut>y_bas requise (${y_bas}→${y_haut})`);
  const isWood = WOOD_PREFIX.has(materiau);
  const dalle = isWood ? `${materiau}_planks` : materiau;
  const paroi = isWood ? `${materiau}_log` : materiau;
  const out = [];
  const r2 = rayon * rayon;
  const inDisk = (dx, dz) => dx * dx + dz * dz <= r2;
  // Coquille 4-connectée par balayage angulaire : chaque pas d'angle échantillonne
  // le cercle discret, on unique-ise les cellules obtenues (garantit la continuité)
  const shellSet = new Set();
  const steps = Math.max(32, rayon * 12);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.round(Math.cos(a) * rayon);
    const dz = Math.round(Math.sin(a) * rayon);
    shellSet.add(`${dx},${dz}`);
  }
  // les cellules manquantes pour connectivité 4 : combler par le prédicat classique
  const isCard = (dx, dz) => !inDisk(dx, dz) ? false
    : (!inDisk(dx + 1, dz) || !inDisk(dx - 1, dz) || !inDisk(dx, dz + 1) || !inDisk(dx, dz - 1));
  for (let dx = -rayon; dx <= rayon; dx++) for (let dz = -rayon; dz <= rayon; dz++) {
    if (isCard(dx, dz)) shellSet.add(`${dx},${dz}`);
  }
  const onShell = (dx, dz) => shellSet.has(`${dx},${dz}`);
  // dalle basse (cercle plein) et dalle haute
  for (let dx = -rayon; dx <= rayon; dx++) for (let dz = -rayon; dz <= rayon; dz++) {
    if (inDisk(dx, dz)) {
      out.push({ x: x + dx, y: y_bas, z: z + dz, block: dalle });
      out.push({ x: x + dx, y: y_haut, z: z + dz, block: dalle });
    }
  }
  // paroi cylindrique creuse
  for (let y = y_bas + 1; y < y_haut; y++) {
    for (let dx = -rayon; dx <= rayon; dx++) for (let dz = -rayon; dz <= rayon; dz++) {
      if (onShell(dx, dz)) out.push({ x: x + dx, y, z: z + dz, block: paroi });
    }
  }
  // Créneaux alternés : angle discrétisé en secteurs de π/N → 1 sur 2 en merlon
  if (creneaux) {
    const shellCells = [];
    for (let dx = -rayon; dx <= rayon; dx++) for (let dz = -rayon; dz <= rayon; dz++) {
      if (onShell(dx, dz)) shellCells.push({ dx, dz, angle: Math.atan2(dz, dx) });
    }
    shellCells.sort((a, b) => a.angle - b.angle);
    const placed = new Set();
    // parcours angulaire : on pose un merlon si aucun voisin 4-connecté déjà posé
    for (const c of shellCells) {
      const key = `${c.dx},${c.dz}`;
      const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => placed.has(`${c.dx + dx},${c.dz + dz}`));
      if (adj) continue;
      // on saute aussi le voisin angulaire immédiat (pour aérer)
      if (placed.size > 0) {
        const last = [...placed].pop();
        const [lx, lz] = last.split(',').map(Number);
        if (Math.abs(c.dx - lx) + Math.abs(c.dz - lz) === 1) continue;
      }
      placed.add(key);
      out.push({ x: x + c.dx, y: y_haut + 1, z: z + c.dz, block: dalle });
    }
  }
  // toit conique : anneaux rétrécissants
  if (toit_conique) {
    const y0 = y_haut + (creneaux ? 2 : 1);
    let r = rayon;
    let level = 0;
    while (r > 0) {
      const rr2 = r * r;
      const inR = (dx, dz) => dx * dx + dz * dz <= rr2;
      const onR = (dx, dz) => inR(dx, dz) && !(inR(dx + 1, dz) && inR(dx - 1, dz) && inR(dx, dz + 1) && inR(dx, dz - 1));
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        // r=1 : anneau plein (le disque unité est déjà minimal)
        if ((r === 1 && inR(dx, dz)) || (r > 1 && onR(dx, dz))) {
          out.push({ x: x + dx, y: y0 + level, z: z + dz, block: dalle });
        }
      }
      r--;
      level++;
    }
    // pointe finale
    out.push({ x, y: y0 + level, z, block: dalle });
  }
  return out;
}

// -------- Primitives d'extérieur et de détail --------

function lampadaire({ x, z, y0, hauteur = 5, materiau = 'dark_oak_fence' }) {
  if (hauteur < 1) throw new Error(`lampadaire : hauteur>=1 requise (${hauteur})`);
  const out = [];
  for (let dy = 0; dy < hauteur; dy++) out.push({ x, y: y0 + dy, z, block: materiau });
  out.push({ x, y: y0 + hauteur, z, block: 'lantern' });
  return out;
}

function terrasse({ x1, z1, x2, z2, y, materiau, bordure }) {
  checkPositiveBox(x1, x2, z1, z2, y);
  if (!materiau) throw new Error('terrasse : materiau manquant');
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y, z, block: materiau });
  if (bordure) {
    for (let x = x1; x <= x2; x++) { out.push({ x, y: y + 1, z: z1, block: bordure }); out.push({ x, y: y + 1, z: z2, block: bordure }); }
    for (let z = z1 + 1; z < z2; z++) { out.push({ x: x1, y: y + 1, z, block: bordure }); out.push({ x: x2, y: y + 1, z, block: bordure }); }
  }
  return out;
}

function pontonBois({ x1, z1, x2, z2, y, materiau = 'oak_planks', pilotis = true }) {
  checkPositiveBox(x1, x2, z1, z2, y);
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y, z, block: materiau });
  if (pilotis && y > 0) {
    for (const [px, pz] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
      for (let yy = 0; yy < y; yy++) out.push({ x: px, y: yy, z: pz, block: 'oak_fence' });
    }
  }
  return out;
}

// Feuilles persistent : sinon elles se décomposent sans tronc voisin
const withPersist = (block) => (block.endsWith('_leaves') ? `${block}[persistent=true]` : block);

function haie({ x1, z1, x2, z2, y, essence = 'oak_leaves', hauteur = 2 }) {
  checkPositiveBox(x1, x2, z1, z2, y);
  const block = withPersist(essence);
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) for (let dy = 0; dy < hauteur; dy++) {
    out.push({ x, y: y + dy, z, block });
  }
  return out;
}

function bordurePlantes({ x1, z1, x2, z2, y, materiau = 'azalea_leaves' }) {
  checkPositiveBox(x1, x2, z1, z2, y);
  const block = withPersist(materiau);
  const out = [];
  for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) out.push({ x, y, z, block });
  return out;
}

// facing = direction où se trouve la PORTE (les marches montent vers elle)
function perron({ x, z, y0 = 0, largeur = 3, marches = 2, materiau, facing }) {
  if (!materiau) throw new Error('perron : materiau manquant');
  if (!(facing in STAIR_STEP)) throw new Error(`perron : facing "${facing}" inconnu`);
  if (largeur % 2 === 0) throw new Error(`perron : largeur impaire requise pour rester centré sur la porte (${largeur})`);
  const stairs = /_stairs$/.test(materiau) ? materiau : `${materiau}_stairs`;
  const [dxDir, dzDir] = STAIR_STEP[facing];
  const out = [];
  const halfW = Math.floor((largeur - 1) / 2);
  for (let i = 0; i < marches; i++) {
    // les marches partent LOIN de la porte et s'en approchent en montant
    const step = marches - 1 - i;
    const bx = x - dxDir * step;
    const bz = z - dzDir * step;
    for (let w = -halfW; w <= halfW; w++) {
      const wx = bx + (facing === 'east' || facing === 'west' ? 0 : w);
      const wz = bz + (facing === 'north' || facing === 'south' ? 0 : w);
      out.push({ x: wx, y: y0 + i, z: wz, block: `${stairs}[facing=${facing},half=bottom]` });
    }
  }
  return out;
}

function gardeCorps({ x1, z1, x2, z2, y, materiau = 'iron_bars' }) {
  checkPositiveBox(x1, x2, z1, z2, y);
  const out = [];
  for (let x = x1; x <= x2; x++) { out.push({ x, y, z: z1, block: materiau }); if (z2 !== z1) out.push({ x, y, z: z2, block: materiau }); }
  for (let z = z1 + 1; z < z2; z++) { out.push({ x: x1, y, z, block: materiau }); if (x2 !== x1) out.push({ x: x2, y, z, block: materiau }); }
  return out;
}

module.exports = { boite, porte, baie, toitPlat, toitDeuxPans, toitQuatrePans, escalier, piscine, tour,
  lampadaire, terrasse, pontonBois, haie, bordurePlantes, perron, gardeCorps };
