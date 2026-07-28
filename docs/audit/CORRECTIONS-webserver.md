# Plan de correction : src/webserver.js + src/websearch.js

Contexte : audit du 27/07/2026 (fichier 13/13 des correctifs par module ; optimizer.js audité et sain, aucune modification). Le point 1 est une correction de SÉCURITÉ, à appliquer en priorité.

Règle générale : ne change aucun comportement fonctionnel non listé ici.

---

## 1. webserver.js : assainir username dans le POST (injection de commande Minecraft)

Problème : le GET assainit le pseudo, mais le POST `/build-from-photo` transmet `req.body.username` BRUT aux handlers, où il finit en TÊTE de messages chat (`bot.chat(\`${username} : ...\`)`). Un POST forgé avec `username = "/give @p diamond 64"` fait exécuter la commande par le bot (qui a les droits op). Le formulaire HTML n'est pas le seul client possible.

Dans le handler POST, remplacer :
```js
if (!req.body.username) return res.status(400).json({ ok: false, error: 'pseudo manquant' });
```
par :
```js
// Même règle d'assainissement que le GET + longueur pseudo Minecraft (16).
// Indispensable : le pseudo finit en tête de bot.chat(...) — un pseudo
// commençant par "/" ferait exécuter une commande par le bot (op).
const username = String(req.body.username || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
if (!username) return res.status(400).json({ ok: false, error: 'pseudo manquant ou invalide' });
```
Puis remplacer TOUTES les occurrences de `req.body.username` restantes dans le handler par `username` (les appels onModel/onDiorama/onPortrait/onSchema/onPhoto et les deux console.log).

## 2. websearch.js : garde sur le bloc texte de pickBest

Problème : `response.content.find((b) => b.type === 'text').text` hors try/catch : une réponse sans bloc texte plante !build avec une TypeError au lieu du chemin propre « aucune photo utilisable ».

Remplacer :
```js
const raw = response.content.find((b) => b.type === 'text').text.trim().toLowerCase();
```
par :
```js
const textBlock = response.content.find((b) => b.type === 'text');
if (!textBlock) {
  console.warn(`[websearch] pickBest sans bloc texte (stop_reason: ${response.stop_reason})`);
  return null;
}
const raw = textBlock.text.trim().toLowerCase();
```

## 3. websearch.js : filtrer les thumbnails non-image avant l'API vision

Problème : un serveur qui répond du HTML à la place d'une image fait échouer l'appel API (400) et donc tout le !build.

Dans `downloadOne`, remplacer :
```js
const buf = Buffer.from(await resp.arrayBuffer());
const mimeType = resp.headers.get('content-type') || 'image/jpeg';
return { image: { base64: buf.toString('base64'), mimeType }, candidate: c };
```
par :
```js
const mimeType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0];
if (!mimeType.startsWith('image/')) return null;
const buf = Buffer.from(await resp.arrayBuffer());
return { image: { base64: buf.toString('base64'), mimeType }, candidate: c };
```
(Le pipeline tolère déjà les candidats éliminés : `if (!r) continue;`.)

---

## Annexe : notes sans correctif (hypothèse serveur LAN)

- Limite multer à 100 Mo (nécessaire pour les modèles 3D) mais plafond image de 5 Mo vérifié APRÈS chargement en mémoire : un POST de 100 Mo étiqueté image occupe la RAM avant rejet. À durcir seulement si le serveur est exposé au-delà du LAN (multer accepte une fonction limits par requête, ou vérifier content-length en amont).
- Aucune authentification sur l'upload : quiconque atteint le port déclenche des générations (dépense API). Un jeton simple dans l'URL (`/upload/:username/:token`) suffirait si besoin.
- `REFINE_MODEL`/`PICK_MODEL` en dur : voir la note transverse de centralisation des modèles (synthèse finale).

---

## Vérification finale

1. `node -e "require('./src/webserver.js'); require('./src/websearch.js')"` charge sans erreur.
2. Test injection (serveur lancé) :
```
curl -s -X POST http://localhost:PORT/build-from-photo \
  -F 'username=/give @p diamond 64' -F 'photo=@une_photo.jpg'
```
attendu : réponse 400 « pseudo manquant ou invalide » OU traitement sous le pseudo assaini `giveapdiamond64` : dans les DEUX cas, AUCUNE commande /give ne doit partir dans le chat du bot. Vérifier les logs [mc].
3. Test upload normal via le formulaire GET : comportement inchangé.
4. !build avec une requête normale : fonctionne comme avant ; si un thumbnail renvoie du HTML, il est ignoré silencieusement (plus d'erreur 400 API).
