# 06 : Réglages API transversaux

À appliquer après les fichiers 01 à 05, dans la couche d'appel API commune si elle existe, sinon appel par appel.

## 1. Températures

| Appel | temperature |
|---|---|
| Vision (prompt 1) | 0 |
| Générateur, les deux passes (prompt 2) | 0.2 |
| Comparaison (prompt 3) | 0 |
| Palette assignThemes (prompt 4) | 0 |
| Décorateur (prompt 6) | 0.3 |

Justification : reproductibilité des tests et moins de fantaisie dans le JSON et le code. Le décorateur garde un peu de marge créative.

## 2. Prompt caching

Ajouter `cache_control: {"type": "ephemeral"}` sur le dernier bloc du system pour :

- Vision (le prompt inclut désormais systématiquement la liste des 235 blocs : c'est exactement le cas d'usage du cache)
- Générateur (gros prompt, identique entre la passe 1 et la passe de correction, et entre requêtes)
- Décorateur (liste INTERIOR_BLOCKS répétée)

Structure attendue du champ system :

```javascript
system: [
  {
    type: "text",
    text: SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" }
  }
]
```

Attention : le cache exige un préfixe strictement identique. Les interpolations dynamiques (`${maxSize}`, listes de blocs) doivent être stables entre les appels d'un même flux ; si `${maxSize}` varie (96 vs 160), il y aura deux entrées de cache, c'est acceptable.

## 3. Prefill JSON

Pour les appels qui attendent du JSON strict (vision, assignThemes), pré-remplir le début de la réponse assistant :

```javascript
messages: [
  { role: "user", content: [...] },
  { role: "assistant", content: "{" }   // "[" pour assignThemes
]
```

Puis préfixer la réponse reçue avec le caractère prefillé avant le parse. Cela élimine quasi totalement les balises markdown et le texte parasite.

Ne PAS prefiller le générateur ni le décorateur (sortie code) : la sentinelle `// FIN_STRUCTURE` et le nettoyage des fences suffisent.

## 4. Nettoyage défensif conservé

Garder le strip des fences ```` ```json ```` / ```` ``` ```` existant en amont des parses, en ceinture et bretelles du prefill.

## Critères d'acceptation

- [ ] Températures appliquées par appel
- [ ] Cache actif : les réponses API renvoient `cache_read_input_tokens > 0` à partir du deuxième appel d'un même flux
- [ ] Prefill actif sur vision et assignThemes, réponse recomposée correctement avant parse
- [ ] Le flux `!photo` complet fonctionne de bout en bout avec ces réglages
