const fs = require('node:fs');
const path = require('node:path');

// Almanach de construction : source de vérité éditoriale (data/almanach-construction.md).
// Injection SÉLECTIVE par sections dans les messages utilisateur — jamais intégrale,
// jamais dans le system (qui reste stable pour le prompt caching).
let md;
try {
  md = fs.readFileSync(path.join(__dirname, '../data/almanach-construction.md'), 'utf8');
} catch (err) {
  throw new Error(`data/almanach-construction.md manquant ou illisible (${err.message}) — l'almanach est requis par les prompts du générateur, restaure-le depuis le dépôt`);
}

const sections = new Map();
for (const chunk of md.split(/\n## /).slice(1)) {
  const num = Number.parseInt(chunk, 10);
  if (Number.isInteger(num)) sections.set(num, `## ${chunk.split('\n---')[0].trim()}`);
}

function getSections(ids) {
  return ids.map((i) => sections.get(i) || '').filter(Boolean).join('\n\n');
}

function ficheLines(sectionId) {
  return (sections.get(sectionId) || '').split('\n').filter((l) => /^- \*\*/.test(l));
}

function getFicheStyle(style) {
  const lines = ficheLines(5);
  const found = lines.find((l) => {
    const name = /^- \*\*([^*]+)\*\*/.exec(l)[1].split('/')[0].split('(')[0].trim();
    return name === style;
  });
  return found || lines.find((l) => l.includes('**Repli**')) || '';
}

function getFicheToit(forme) {
  const lines = ficheLines(3);
  const found = lines.find((l) => /^- \*\*([^*]+)\*\*/.exec(l)[1].split('(')[0].trim() === forme);
  return found || lines.find((l) => /^- \*\*deux_pans/.test(l)) || '';
}

module.exports = { getSections, getFicheStyle, getFicheToit };
