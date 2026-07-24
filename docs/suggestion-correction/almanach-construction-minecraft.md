# Almanach de construction Minecraft (1.20)

Base de connaissances pour le bot constructeur. Chaque section est autonome : elle peut être injectée seule dans un prompt (générateur, vision, décorateur) selon le contexte détecté. Synthèse des principes du Minecraft Wiki (Tutorial:Architectural terms, Roof types, Walls and buttresses, Color palette, Furniture, Creating shapes) et des pratiques communautaires, reformulée en vocabulaire exécutable.

---

## 1. Échelle et proportions

- 1 bloc = 1 mètre. Porte = 2 blocs de haut. Étage habitable = 4 à 5 blocs de sol à sol (3 à 4 d'espace libre + 1 de plancher). Fenêtre standard = 1×2 ou 2×2, appui à 1 bloc du sol.
- Hauteur totale ≈ etages × 4 + hauteur du toit. Un toit deux pans sur une emprise de largeur L ajoute environ L/2 blocs de haut.
- Ratios agréables : façade principale entre 1:1 et 2:1 (largeur:hauteur hors toit). Une tour est convaincante à partir d'un rapport hauteur/diamètre de 3:1.
- Nombre impair de blocs en largeur = axe de symétrie net pour centrer porte et faîtage. Préférer les emprises impaires quand la description est symétrique.

## 2. Vocabulaire architectural (terme -> réalisation Minecraft)

- **Corniche** : rangée de stairs inversées (half=top) sous le débord de toit ou en couronnement de mur.
- **Pilastre** : colonne plate en saillie de 1 bloc sur la façade, du sol à la corniche, tous les 4 à 6 blocs. Casse les murs plats.
- **Contrefort** : appui extérieur oblique contre un mur haut ; empilement dégressif de blocs pleins terminé en stairs. Typique des églises et châteaux.
- **Corbeau / encorbellement** : rangée en surplomb de 1 bloc portée par des stairs inversées ; permet à un étage de déborder sur le rez-de-chaussée (colombages).
- **Lucarne** : petite avancée sur le versant du toit avec sa propre fenêtre et son mini-toit deux pans perpendiculaire au versant.
- **Meneau** : montant vertical (log, fence ou bloc plein) divisant une grande baie vitrée en sections.
- **Linteau et appui** : bloc différencié au-dessus (linteau) et au-dessous (appui, souvent une slab ou une stair inversée) de chaque fenêtre.
- **Embrasure** : épaississement du mur autour d'une ouverture, percé en biseau ; pour les meurtrières et portails.
- **Créneau** : alternance merlon (1 à 2 blocs pleins) / créneau (1 vide) au sommet d'un rempart, posée sur un chemin de ronde en surplomb de 1 bloc (stairs inversées en dessous).
- **Arche** : ouverture dont le sommet est adouci par des stairs inversées dans les coins supérieurs (arche 3 de large = 2 stairs + 1 plein central au-dessus).
- **Soubassement** : 1 à 2 rangées de blocs plus sombres/bruts à la base des murs (cobblestone, stone bricks) : ancre le bâtiment au sol.

## 3. Typologie des toits (avec orientation des stairs)

Convention : facing = direction que la montée de l'escalier regarde. Un versant qui descend vers le nord se construit en stairs facing=south.

- **plate** : dalle de slabs ou blocs pleins, acrotère (muret de 1 bloc ou walls) en pourtour. Moderne, désert, méditerranéen.
- **monopente (appentis)** : un seul versant, pente douce 1:2 (1 de haut pour 2 d'avance, en alternant stair et slab) ou 1:1. Extensions, granges.
- **deux_pans (pignon)** : le standard. Deux versants en pente 1:1 se rejoignant sur un faîtage de slabs ou de blocs pleins ; pignons triangulaires remplis dans le matériau des murs. Débord de 1 bloc sur les gouttereaux.
- **quatre_pans (croupe)** : quatre versants, les rangées rétrécissent de 1 bloc sur les 4 côtés à chaque niveau ; les arêtes se traitent avec les stairs d'angle naturelles ou des blocs pleins. Manoirs, mairies.
- **mansarde** : versant inférieur très raide (2:1, blocs pleins ou stairs empilées) puis versant supérieur doux (1:2). Haussmannien, hôtels particuliers.
- **conique** : pour tours cylindriques ; anneaux de rayon décroissant (r, r-1, ...) en stairs orientées vers l'extérieur, pointe en fence/wall + slab. Rayon du premier anneau = rayon de la tour + 1 (débord).
- **dome** : superposition d'anneaux suivant un quart de cercle (rétrécissement lent en bas, rapide au sommet). Églises orthodoxes, observatoires, palais orientaux.
- **Règles communes** : toit COMPLET sans trou, pignons remplis, débord de 1 bloc maximum, sous-face du débord soulignée par des stairs inversées (corniche). Une cheminée traverse le versant et dépasse le faîtage de 1 à 2 blocs.

## 4. Façades : la règle de la profondeur

Un mur plat est l'erreur numéro un. Chaque façade doit combiner au moins deux de ces techniques :
- Pilastres ou colombages (logs verticaux/horizontaux affleurants ou en saillie de 1).
- Retrait ou saillie de 1 bloc d'une travée entière (avant-corps central, ailes en retrait).
- Encadrements de fenêtres (linteau + appui + jambages dans un matériau contrastant).
- Soubassement différencié + corniche sommitale.
- Variation de matériau par bandeau horizontal (1 rangée contrastante entre étages).
- Trapdoors en volets, walls en grilles, flower_pot/lanterne en ponctuation (si autorisés).

Rythme des ouvertures : fenêtres alignées verticalement d'un étage à l'autre, espacement régulier (2 à 3 blocs de trumeau entre fenêtres), la porte principale centrée ou clairement marquée par un porche (2 colonnes + toit monopente ou arche).

## 5. Fiches d'époque et de style (palette + signatures)

Chaque fiche donne : palette murs / toit / accents, et 3 signatures obligatoires. Injecter la fiche correspondant au style détecté par la vision. Le style encode l'ÉPOQUE et la culture ; la fonction (église, maison, usine) vient de type_batiment et se combine avec l'époque (une église gothique et une église moderne n'ont que la fonction en commun).

### Antiquité et mondes anciens

- **primitif / néolithique** : murs cobblestone brut + dirt, toit hay ou spruce_leaves (chaume, branchages), aucun accent. Signatures : plan circulaire ou ovale, toit conique descendant très bas, foyer central (campfire), aucune fenêtre vitrée.
- **egyptien** : murs sandstone + smooth_sandstone, pas de toit visible (masses pleines ou plate), accents chiseled_sandstone et gold_block avec parcimonie. Signatures : murs en fruit (inclinés, retrait de 1 tous les 3 à 4 de haut), pylônes trapézoïdaux encadrant l'entrée, formes massives pleines (pyramide, mastaba).
- **antique (gréco-romain)** : murs quartz_block + smooth_quartz ou smooth_stone, toit deux_pans doux (1:2) en bricks ou terracotta, accents chiseled_quartz. Signatures : colonnade en façade (quartz_pillar espacés de 2), fronton triangulaire au-dessus, entablement filant (rangée de slabs) ; les temples sont périptères (colonnes sur tout le pourtour, cella pleine au centre).
- **asiatique_japonais** : murs white_concrete ou smooth_sandstone (enduits clairs) + dark_oak_log en ossature apparente, toit deux_pans ou quatre_pans à pente douce en dark_prismarine ou deepslate_tiles, accents dark_oak. Signatures : débords de toit très marqués (autorisés jusqu'à 2 avec stairs inversées en sous-face), coins de toit retroussés (dernière stair inversée), galerie sur pilotis (engawa) ; pagodes = étages rétrécissant avec toit débordant à chaque niveau.
- **asiatique_chinois** : murs red_terracotta ou bricks + spruce_log, toit quatre_pans en glazed ou oxidized_copper (tuiles vernissées vertes) ou red/yellow_terracotta, accents gold_block ponctuels. Signatures : faîtage orné surélevé (walls + slabs), toits superposés, lanternes rouges (redstone_lamp ou lantern sur chains).
- **oriental / islamique** : murs smooth_sandstone + white_terracotta, toit plate ou dome (bulbe : anneaux qui s'élargissent puis se resserrent), accents cyan/blue_glazed_terracotta. Signatures : arcs outrepassés (ouverture élargie au-dessus des jambages), dôme central + minarets fins, moucharabiehs (walls ou trapdoors en claustra).

### Moyen Âge et Renaissance

- **medieval** : murs cobblestone + oak_planks (colombages en oak_log), toit deux_pans raide en dark_oak stairs ou deepslate_tiles, accents stone_bricks. Signatures : colombages, encorbellement de l'étage, fenêtres étroites 1×2 à meneaux.
- **gothique** : murs stone_bricks + deepslate_bricks, toit deux_pans très raide (2:1) en deepslate, accents polished_blackstone. Signatures : verticalité exagérée (hauteur > 1,5× largeur), contreforts et arcs-boutants, baies hautes en arche brisée (stairs inversées se rejoignant en pointe), flèches et pinacles (fences + walls effilés).
- **chateau_fort** : murs stone_bricks + cobblestone (mélange bruité), toits coniques sur tours + chemins de ronde, accents cracked_stone_bricks. Signatures : créneaux et mâchicoulis (surplomb sur stairs inversées), tours d'angle cylindriques, portail à double vantail sous arche avec herse (iron_bars).
- **renaissance** : murs bricks + smooth_stone en chaînages et bandeaux, toit quatre_pans ou deux_pans en deepslate, accents polished_diorite. Signatures : symétrie stricte, superposition d'ordres (pilastres à chaque étage), fenêtres à meneaux en croix, lucarnes ouvragées.

### Époque moderne (XVIIe-XIXe)

- **baroque_classique** : murs smooth_quartz + stone_bricks, toit mansarde ou quatre_pans en deepslate, accents chiseled_quartz et gold ponctuel. Signatures : avant-corps central en saillie couronné d'un fronton, corniche filante puissante, rythme colossal de pilastres, symétrie parfaite.
- **haussmannien** : murs smooth_stone + stone_bricks (pierre de taille), toit mansarde en deepslate avec lucarnes, accents polished_andesite, garde-corps iron_bars. Signatures : 5 à 6 niveaux, balcon filant aux 2e et 5e étages (slabs en surplomb + iron_bars), alignement strict des baies 1×2, rez-de-chaussée en refends (rainures horizontales suggérées par des slabs en léger retrait).
- **victorien** : murs bricks + white accents (smooth_quartz linteaux), toit deux_pans raides multiples et croisés, accents dark_oak. Signatures : asymétrie pittoresque, tourelle d'angle polygonale ou ronde à toit conique, porche en bois ouvragé (fences, stairs), pignons décorés.
- **colonial** : murs white_concrete ou birch_planks, toit quatre_pans doux en dark_oak, accents spruce (volets trapdoors). Signatures : véranda périphérique sur poteaux (galerie couverte), symétrie de façade, fenêtres à volets régulières.

### XXe siècle et au-delà

- **industriel** : murs bricks + iron/stone, toit monopente, deux_pans doux ou sheds (dents de scie : succession de monopentes), grandes portes 3×3. Signatures : structure apparente, fenêtres en bandeau haut ou grandes verrières à meneaux réguliers, cheminée d'usine cylindrique en bricks.
- **art_deco** : murs smooth_sandstone ou quartz + black_concrete en bandeaux, toit plate à gradins, accents gold_block linéaires. Signatures : élévation par retraits successifs (ziggourat), verticales soulignées (pilastres filants dépassant l'acrotère), motifs géométriques en façade (chiseled).
- **moderne** : murs white_concrete + gray_concrete, larges baies glass_pane ou glass, toit plate avec acrotère. Signatures : volumes décalés en porte-à-faux, bandeaux horizontaux sombres, absence totale d'ornement.
- **brutaliste** : murs gray_concrete + stone (béton brut), toit plate, aucun accent. Signatures : masses géométriques lourdes en porte-à-faux, petites ouvertures profondes (embrasures de 1 en retrait), trames répétitives, pilotis massifs.
- **futuriste** : murs white_concrete + light_gray_concrete + glass, toit plate ou dome, accents sea_lantern et cyan (lumière intégrée). Signatures : courbes et cylindres, parois vitrées continues, éclairage encastré (sea_lanterns affleurants), passerelles et anneaux.

### Hors époque

- **rustique** : murs spruce_planks ou mud_bricks, soubassement cobblestone, toit deux_pans en spruce ou hay (chaume). Signatures : cheminée cobblestone hors-oeuvre, appentis latéral, barrières spruce_fence. À utiliser quand la photo montre du vernaculaire sans époque marquée.
- **desert_mediterraneen** : murs sandstone + smooth_sandstone ou white_terracotta, toit plate, accents terracotta. Signatures : acrotère léger, ouvertures en arche, patio intérieur si l'emprise le permet.
- **fantaisie** : murs au choix + accents colorés (terracotta, wool en drapeaux), tours cylindriques à toits coniques débordants, ponts et passerelles. Signatures : asymétrie assumée, exagération des débords, lanternes suspendues (chains).
- **Repli** : style non identifiable -> rustique pour le vernaculaire, moderne pour le contemporain, selon les matériaux dominants de la photo.

## 6. Tours, cylindres et formes courbes

- Cercle par test de distance : bloc présent si dx*dx + dz*dz <= r*r (plein) ou r*r-r < dx*dx+dz*dz <= r*r (anneau/mur). Rayons utiles : r=2 donne un cylindre de 5 de diamètre (minimum crédible), r=3 à 5 pour les tours principales.
- Une tour perce le toit du corps principal ou s'y accole ; jamais posée dessus sans continuité de mur jusqu'au sol.
- Sommet de tour : soit créneaux + chemin de ronde en surplomb, soit toit conique débordant de 1.
- Sphères et dômes : mêmes tests en 3D (dx²+dy²+dz² <= r²), tranche par tranche.

## 7. Intérieurs

- Plancher plein à chaque étage, matériau distinct des murs (oak_planks sur murs pierre, inversement).
- Escalier : volée droite de stairs de même facing, 1 bloc de large minimum, trémie (trou du plancher) de la longueur de la volée + 1 ; alignement vertical strict entre étages.
- Découpage : 2 à 4 pièces par étage, cloisons de 1 bloc, chaque pièce accessible par porte ou baie 1×2 donnant sur un couloir ou la cage d'escalier.
- Éclairage : 1 source (lanterne, torche murale) tous les 5 à 6 blocs le long des murs ; jamais au centre des axes de passage.
- Mobilier par fonction : repas (table = fence + pressure_plate ou slab, sièges = stairs), rangement (barrels, chests contre les murs), travail (crafting_table, furnace, bookshelf), repos (lit orienté tête au mur). 10 à 20 éléments par pièce maximum, circulation toujours libre.

## 8. Palettes de couleurs par thème de matière

Pour le mapping RGB -> blocs (dioramas et rendus voxel). Toujours 2 à 3 blocs par thème pour éviter les aplats, mélange bruité déterministe.

- **roche** : stone, andesite, tuff, cobblestone (ombre : deepslate ; clair : diorite avec parcimonie).
- **terre** : dirt, coarse_dirt, rooted_dirt ; chemins : dirt_path, gravel.
- **vegetation** : grass_block ; feuillage : oak_leaves/spruce_leaves selon essence ; buissons : azalea_leaves.
- **bois** : oak_planks/spruce_planks (clair/foncé), troncs : oak_log, spruce_log.
- **maconnerie** : stone_bricks, bricks, mud_bricks selon la teinte (gris/rouge/beige).
- **sable** : sand, sandstone, smooth_sandstone.
- **neige_glace** : snow_block, powder d'aspect : white_concrete_powder ; glace : packed_ice.
- **eau** : water ; peu profond : ajouter sand/gravel en fond.
- **couleurs_vives** : terracottas colorées d'abord (saturation modérée, mate), concrete si saturation forte, wool en dernier recours (drapeaux, textiles).
- **metal** : iron_block, anvil d'aspect : polished_deepslate ; cuivre oxydé : oxidized_copper pour les toits verts.
- Règle de nuançage : pour toute grande surface (>30 blocs d'un même thème), mélanger le bloc principal (70 à 80 %) avec 1 ou 2 variantes proches (20 à 30 %) via un bruit déterministe type (x*7+z*13+y*31)%10.

## 9. Terrain et abords (dioramas, scene_complete)

- Le bâtiment s'ancre : fondation qui épouse le terrain (descendre les murs jusqu'au sol partout, jamais de coin flottant), 1 rangée de soubassement débordant.
- Chemin d'accès de la porte principale vers le bord de la scène : dirt_path ou gravel, 1 à 2 de large, tracé légèrement irrégulier.
- Arbres selon densité détectée : epars = 1 arbre / 15×15, dense = 1 / 7×7 ; chêne = tronc 1×1 de 4 à 6 + boule de feuilles r=2, sapin = tronc 5 à 8 + cônes de feuilles étagés, bouleau = birch_log droit 5 à 7 + houppier étroit.
- Micro-relief : varier la hauteur du sol de ±1 à 2 blocs par ondulations larges, jamais de falaises de 1 bloc en damier.

## 10. Anti-patterns (défauts à ne jamais produire)

- Mur plat uniforme de plus de 6×4 sans aucun relief ni variation.
- Toit troué, pignon ouvert, versants de pentes différentes sur un même toit deux pans.
- Débord de toit de plus de 1 bloc, dalle horizontale flottante plus large que l'emprise.
- Bloc ou élément sans aucun voisin face contre face (flottant).
- Porte en un seul bloc, stairs sans orientation cohérente sur un même versant.
- Fenêtres désalignées entre étages, espacement aléatoire des ouvertures.
- Étage sans escalier d'accès, pièce sans porte, escaliers non alignés verticalement.
- Sur-décoration : plus de 20 meubles par pièce, tapis intégral, torches au sol en plein passage.
- Mélange de plus de 2 familles de bois sur un même bâtiment sans logique (structure vs menuiserie).

## 11. Checklist qualité (auto-audit avant livraison)

1. Silhouette : lisible de loin, proportions ≈ description, toit dominant correct.
2. Enveloppe : murs fermés, toit complet, pignons remplis, aucun trou non voulu.
3. Profondeur : au moins 2 techniques de relief par façade visible.
4. Ouvertures : alignées, encadrées, porte principale marquée.
5. Habitabilité : planchers, escaliers alignés, pièces accessibles, éclairage.
6. Cohésion : aucun bloc flottant, tours liées au sol.
7. Palette : 3 à 5 matériaux par façade, tous dans la liste autorisée, nuançage des grandes surfaces.

---

## Sources de référence (pour approfondir)

- Minecraft Wiki, tutoriels : Architectural terms, Roof types, Roof construction guidelines, Walls and buttresses, Color palette, Creating shapes, Furniture, Making nice floors, Adding beauty to constructions, Building a metropolis, Settlement guide (minecraft.wiki/w/Tutorial:...)
- blockpalettes.com : combinaisons de palettes communautaires par ambiance
