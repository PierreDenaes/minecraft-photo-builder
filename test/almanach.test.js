const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getSections, getFicheStyle, getFicheToit } = require('../src/almanach');
const { STYLES } = require('../src/vision');

test('getSections concatène les sections demandées', () => {
  const t = getSections([1, 10]);
  assert.ok(t.includes('1 bloc = 1 mètre'));
  assert.ok(t.includes('Anti-patterns'));
  assert.ok(!t.includes('Typologie des toits'));
});

test('getFicheStyle : fiche exacte, préfixe (primitif), et Repli pour autre/inconnu', () => {
  assert.ok(getFicheStyle('medieval').includes('colombages'));
  assert.ok(getFicheStyle('primitif').includes('néolithique'));
  assert.ok(getFicheStyle('baroque_classique').includes('fronton'));
  assert.ok(getFicheStyle('autre').includes('Repli'));
  assert.ok(getFicheStyle('style_inconnu_xyz').includes('Repli'));
});

test('getFicheToit : ligne de la forme, repli deux_pans', () => {
  assert.ok(getFicheToit('conique').includes('anneaux'));
  assert.ok(getFicheToit('deux_pans').includes('faîtage'));
  assert.ok(getFicheToit('forme_inconnue').includes('deux_pans'));
});

test('synchronisation : chaque style de l\'enum (sauf autre) a sa fiche, et réciproquement', () => {
  for (const s of STYLES) {
    if (s === 'autre') continue;
    const fiche = getFicheStyle(s);
    assert.ok(fiche && !fiche.includes('**Repli**'), `pas de fiche pour le style « ${s} »`);
  }
  const md = fs.readFileSync(path.join(__dirname, '../data/almanach-construction.md'), 'utf8');
  const section5 = md.split(/\n## /).find((s) => s.startsWith('5.'));
  for (const m of section5.matchAll(/^- \*\*([^*]+)\*\*/gm)) {
    const name = m[1].split('/')[0].split('(')[0].trim();
    if (name === 'Repli') continue;
    assert.ok(STYLES.includes(name), `fiche « ${name} » absente de l'enum STYLES`);
  }
});

test('tous les noms de blocs snake_case cités dans l\'almanach sont dans la liste blanche', () => {
  const md = fs.readFileSync(path.join(__dirname, '../data/almanach-construction.md'), 'utf8');
  const valid = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/valid_blocks.json'), 'utf8')));
  // vocabulaire non-bloc du texte (schéma, formes, termes descriptifs)
  const NON_BLOC = new Set(['deux_pans', 'quatre_pans', 'type_batiment', 'palette_blocs', 'zone_batiment',
    'materiau_suggere', 'toit_hay', 'glazed_terracotta', 'concrete_powder', 'facing_south', 'half_top',
    'asiatique_japonais', 'asiatique_chinois', 'art_deco', 'baroque_classique', 'chateau_fort',
    'desert_mediterraneen', 'hors_oeuvre', 'dark_oak', 'sea_lanterns', 'neige_glace', 'couleurs_vives', 'scene_complete']);
  const bad = [];
  for (const m of md.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)) {
    const name = m[1];
    if (NON_BLOC.has(name) || STYLES.includes(name)) continue;
    if (!valid.has(name)) bad.push(name);
  }
  assert.deepStrictEqual([...new Set(bad)], [], `noms hors liste blanche : ${[...new Set(bad)].join(', ')}`);
});
