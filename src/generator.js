const vm = require('node:vm');
const { createClient, withRetry, stripCodeFences } = require('./llm');

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Tu écris du code JavaScript pur pour générer une structure Minecraft.
Réponds UNIQUEMENT avec le code, sans texte autour, sans balises markdown.

Contraintes strictes :
- Définis une fonction generateStructure() qui retourne un tableau [{x, y, z, block}]
- Coordonnées entières >= 0 ; x = largeur, y = hauteur (0 = sol), z = profondeur
- Reste dans les dimensions estimées de la description
- Utilise uniquement les blocs de palette_blocs, plus "air" pour les ouvertures (portes, fenêtres) et "glass_pane" pour les vitres
- Code pur : pas de require, pas d'accès réseau/fichiers, pas de récursion infinie
- Construis paramétriquement : murs pleins, ouvertures, toit selon la forme décrite
- Les intérieurs sont creux (air)`;

function runStructureCode(code, timeoutMs) {
  const context = vm.createContext(Object.create(null));
  const script = new vm.Script(`${code}\ngenerateStructure();`);
  const result = script.runInContext(context, { timeout: timeoutMs });
  if (!Array.isArray(result)) {
    throw new Error('generateStructure() doit retourner un tableau de blocs');
  }
  // Convertir les objets VM en objets du contexte hôte pour que deepStrictEqual fonctionne
  return JSON.parse(JSON.stringify(result));
}

async function generateStructure(description, { client, timeoutMs = 5000 } = {}) {
  const c = client || createClient();
  const response = await withRetry(() =>
    c.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Description du bâtiment :\n${JSON.stringify(description, null, 2)}\n\nÉcris generateStructure().`
      }]
    })
  );
  const code = stripCodeFences(response.content.find((b) => b.type === 'text').text);
  console.log('[generator] code généré :\n', code);
  return runStructureCode(code, timeoutMs);
}

module.exports = { runStructureCode, generateStructure };
