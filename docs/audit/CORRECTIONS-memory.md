# Plan de correction : src/memory.js

Contexte : audit du 27/07/2026 (fichier 9/13). Le point 1 est CRITIQUE : la mémoire I19 est actuellement inopérante (CLIP désactivé sur macOS → saveCase échoue toujours → index jamais alimenté). Points 1 et 2 fermes, point 3 validé par Pierre (rappel assoupli).

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. saveCase : rendre l'embedding optionnel (mémoire fonctionnelle sans CLIP)

Problème : `warmup()` est commenté dans index.js (SIGSEGV macOS documenté) donc `embedder` est null : `__embed` throw et saveCase échoue APRÈS avoir écrit la miniature. Résultat : aucun cas mémorisé, .jpg orphelins, !note inopérant, fallback métadonnées de findSimilar tournant sur un index vide.

Remplacer le corps de `saveCase` :
```js
async function saveCase({ photo, description, code }) {
  __ensureDirs();
  const id = __generateId();
  const casesDir = getCasesDir();
  const indexPath = getIndexPath();
  // json d'abord : c'est la donnée maîtresse (un .jpg orphelin est bénin,
  // un .json orphelin ne l'est pas)
  const caseObj = {
    id,
    date: new Date().toISOString(),
    style: description.style || 'autre',
    type_batiment: description.type_batiment || 'inconnu',
    description,
    code,
    note: null
  };
  fs.writeFileSync(path.join(casesDir, `${id}.json`), JSON.stringify(caseObj, null, 2));
  // miniature 256px max côté long
  const thumbBuf = await sharp(photo).resize({ width: 256, height: 256, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  fs.writeFileSync(path.join(casesDir, `${id}.jpg`), thumbBuf);
  // embedding OPTIONNEL : sans CLIP (macOS ARM64, warmup désactivé), le cas est
  // quand même mémorisé — findSimilar utilise alors le fallback métadonnées,
  // et loadEmbedding retourne null pour ce cas en mode CLIP
  if (__isReady()) {
    const emb = await __embed(thumbBuf);
    fs.writeFileSync(path.join(casesDir, `${id}.emb`), Buffer.from(emb.buffer));
  }
  // index (créé si absent)
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
  index.push({ id, date: caseObj.date, style: caseObj.style, type_batiment: caseObj.type_batiment, note: null });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  return id;
}
```

## 2. updateNote : garde sur l'index + retour booléen

Remplacer la fin d'`updateNote` (à partir de la lecture de l'index) et ajouter des `return` explicites :
```js
function updateNote(id, note) {
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    console.warn(`[memory] note invalide (${note}), ignorée`);
    return false;
  }
  const casePath = path.join(getCasesDir(), `${id}.json`);
  if (!fs.existsSync(casePath)) {
    console.warn(`[memory] cas ${id} introuvable, note ignorée`);
    return false;
  }
  const caseObj = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  caseObj.note = note;
  fs.writeFileSync(casePath, JSON.stringify(caseObj, null, 2));
  const indexPath = getIndexPath();
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const entry = index.find((e) => e.id === id);
    if (entry) entry.note = note;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }
  return true;
}
```
Adaptation côté src/chat.js (compatible avec le wrapper de CORRECTIONS-chat.md point 2) :
```js
Promise.resolve(memory.updateNote(buildId, n))
  .then((ok) => bot.chat(ok
    ? `Note enregistrée : ${n}/5, merci !`
    : `${username} : construction introuvable en mémoire, note non enregistrée.`))
  .catch((err) => {
    console.warn('[chat] updateNote échoué :', err.message);
    bot.chat(`${username} : impossible d'enregistrer la note, réessaie.`);
  });
```

## 3. findSimilar : assouplir le match de type dans le fallback métadonnées

Problème : l'égalité stricte de `type_batiment` (texte libre de la vision) ne matche presque jamais (« maison_bretonne_en_pierre » ≠ « maison_pierre »).

Dans `findSimilar`, remplacer le filtre du fallback :
```js
return eligible
  .filter((e) => e.style === description.style && e.type_batiment === description.type_batiment)
```
par :
```js
// style strict, type assoupli : égalité OU inclusion croisée des textes libres
const typeMatch = (a, b) => {
  if (!a || !b) return false;
  const ta = String(a).toLowerCase();
  const tb = String(b).toLowerCase();
  return ta === tb || ta.includes(tb) || tb.includes(ta);
};
return eligible
  .filter((e) => e.style === description.style && typeMatch(e.type_batiment, description.type_batiment))
```

---

## Note (pas de correction)

Les écritures read-modify-write d'index.json (saveCase, updateNote) ne sont pas protégées contre la concurrence. En mono-process avec des saves rares, le risque est théorique : ne rien faire, mais ne pas introduire d'écritures concurrentes plus tard sans y repenser.

---

## Vérification finale

1. `node -e "require('./src/memory.js')"` charge sans erreur.
2. Test complet SANS CLIP (le cas de prod actuel sur macOS) :
```js
const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
const memory = require('./src/memory');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-test-'));
memory.__setRootDir(tmp);
const sharp = require('sharp');
(async () => {
  const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 100, b: 50 } } }).jpeg().toBuffer();
  const id = await memory.saveCase({ photo, description: { style: 'moderne', type_batiment: 'villa_contemporaine_piscine' }, code: 'x' });
  console.log('saveCase OK sans CLIP :', id);            // ne throw plus
  console.log('updateNote :', memory.updateNote(id, 4)); // true
  const found = await memory.findSimilar(photo, { style: 'moderne', type_batiment: 'villa' });
  console.log('findSimilar fallback :', found.length);   // 1 (inclusion croisée villa ⊂ villa_contemporaine_piscine)
})();
```
3. Vérifier qu'aucun fichier .emb n'a été créé dans le répertoire temporaire (embedding bien optionnel), mais que .json, .jpg et index.json existent.
4. En jeu : !photo → !go : le log doit afficher « [chat] cas mémoire enregistré : <id> » (et plus « saveCase échoué »), puis !note 4 → « Note enregistrée ».
