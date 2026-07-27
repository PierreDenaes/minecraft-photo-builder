# Plan de correction : src/builder.js

Contexte : audit du 27/07/2026 (fichier 6/13). Points 1 à 3 : correctifs. Points 4 et 5 : commentaires de limitation à ajouter, sans changement de comportement.

Règle générale : ne change aucun comportement fonctionnel non listé ici. Ce fichier travaille avec src/chat.js (CORRECTIONS-chat.md point 3 : garde !go côté chat) : les deux corrections sont complémentaires, appliquer les deux.

---

## 1. Suspendre la file quand le bot est déconnecté (au lieu de crasher chaque tick)

Problème : `this.bot.chat(...)` dans le setInterval lève une exception non rattrapée si le bot est kické en pleine construction ; les commandes dépilées pendant la coupure sont perdues (trous dans le bâtiment). La reconnexion d'index.js réassigne `builder.bot`, la file doit donc simplement attendre.

Dans `enqueue`, remplacer le corps du setInterval :
```js
this.timer = setInterval(() => {
  for (let i = 0; i < this.cmdsPerTick && this.queue.length > 0; i++) {
    this.bot.chat(this.queue.shift());
    this.progress.done++;
  }
  if (this.queue.length === 0) {
    clearInterval(this.timer);
    this.timer = null;
    this.progress.active = false;
  }
}, TICK_MS);
```
par :
```js
this.timer = setInterval(() => {
  // Bot déconnecté (kick, redémarrage serveur) : on suspend, la file reprendra
  // après la reconnexion automatique (builder.bot est réassigné par index.js)
  if (!this.bot || !this.bot.entity) return;
  for (let i = 0; i < this.cmdsPerTick && this.queue.length > 0; i++) {
    const cmd = this.queue.shift();
    try {
      this.bot.chat(cmd);
      this.progress.done++;
    } catch (err) {
      // échec d'envoi : on remet la commande en tête et on réessaie au tick suivant
      this.queue.unshift(cmd);
      console.warn('[builder] envoi suspendu :', err.message);
      return;
    }
  }
  if (this.queue.length === 0) {
    clearInterval(this.timer);
    this.timer = null;
    this.progress.active = false;
  }
}, TICK_MS);
```
Note : `bot.entity` n'existe que quand le bot est apparu en jeu (spawn) — c'est le test de disponibilité le plus simple avec mineflayer.
Si le point 3 (curseur) est appliqué, adapter ce code à la version curseur (le `unshift` devient un simple recul du curseur : `this.cursor--`... voir point 3).

## 2. startBuild : refuser si une construction est active (défense en profondeur)

Problème : un deuxième `startBuild` pendant une construction écrase `this.snapshot` et `this.lastBuild` : !undo ne peut plus restaurer la première zone.

Au début de `startBuild`, ajouter :
```js
if (this.progress.active) return null;
```
Et dans `src/chat.js` (bloc !go), tolérer ce refus même si la garde chat est déjà passée (course possible) :
```js
const started = builder.startBuild(p.blocks, origin, p.size);
if (!started) {
  bot.chat(`${username} : une construction est déjà en cours, réessaie après.`);
  pending.set(pkey, p); // on restitue la proposition consommée
  return;
}
const { total } = started;
```
(Attention : dans le code actuel, `pending.delete(pkey)` et `lastBuilt.set(...)` sont AVANT startBuild — soit déplacer le delete après le succès, soit restituer comme ci-dessus. Préférer : ne faire `pending.delete` et `lastBuilt.set` qu'APRÈS un startBuild réussi.)

## 3. File de commandes : curseur au lieu de shift (O(n²) → O(n))

Problème : `queue.shift()` déplace tout le tableau à chaque commande.

Dans le constructeur, ajouter `this.cursor = 0;`.

Dans `enqueue`, remplacer la logique de dépilage par un curseur :
```js
enqueue(cmds) {
  for (let i = 0; i < cmds.length; i++) this.queue.push(cmds[i]);
  if (this.timer) {
    this.progress.total += cmds.length;
    return;
  }
  this.progress = { active: true, done: 0, total: this.queue.length };
  this.timer = setInterval(() => {
    if (!this.bot || !this.bot.entity) return;
    for (let i = 0; i < this.cmdsPerTick && this.cursor < this.queue.length; i++) {
      const cmd = this.queue[this.cursor];
      try {
        this.bot.chat(cmd);
        this.cursor++;
        this.progress.done++;
      } catch (err) {
        console.warn('[builder] envoi suspendu :', err.message);
        return;
      }
    }
    if (this.cursor >= this.queue.length) {
      clearInterval(this.timer);
      this.timer = null;
      this.queue = [];
      this.cursor = 0;
      this.progress.active = false;
    }
  }, TICK_MS);
}
```
(Cette version intègre le point 1 : l'échec d'envoi n'avance simplement pas le curseur.)

## 4. Commentaire : le snapshot ne restaure pas les états de blocs

Au-dessus de `takeSnapshot`, ajouter :
```js
// Limitation connue : on sauvegarde block.name SANS les états ([facing=...]).
// Un !undo par-dessus des stairs/portes préexistantes les restaure sans
// orientation. Acceptable : la zone écrasée est presque toujours du terrain
// naturel sans états.
```

## 5. Commentaire : limite vanilla /fill

Au-dessus de `flattenCommands`, ajouter :
```js
// Limite vanilla : /fill refuse au-delà de 32768 blocs par commande.
// Chaque couche fait (size.x+2)*(size.z+2) : OK jusqu'à ~180×180 d'emprise.
// Si un jour cfg.limits.diorama.size_x dépasse ~180, découper les fills.
```

---

## Vérification finale

1. `node -e "const { Builder } = require('./src/builder'); new Builder(null, { maxBlocks: 1000 })"` charge sans erreur.
2. En jeu : construction normale !photo → !go : la construction se déroule comme avant, !status cohérent, !undo restaure.
3. En jeu : lancer une grosse construction puis couper le serveur Minecraft 10 s et le relancer : le bot se reconnecte et la construction REPREND sans exception dans les logs ni trou dans le bâtiment (les commandes émises pendant la coupure ne sont pas perdues).
4. Vérifier qu'un deuxième !go pendant une construction est refusé et que la proposition n'est PAS perdue (un !go après la fin fonctionne).
