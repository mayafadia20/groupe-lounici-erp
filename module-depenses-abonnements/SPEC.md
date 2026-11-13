# Module « Dépenses & abonnements » — spécification

Module à intégrer à l'ERP de Maya. Il lit les relevés de cartes de crédit, classe chaque achat, repère les abonnements récurrents et affiche ce qu'ils coûtent par mois. Le prototype existe déjà (tableau de bord claude.ai). Ce document décrit ce qu'il faut reproduire dans l'ERP.

Montants en dollars canadiens (CAD), taxes comprises, sauf mention contraire.

---

## 0. Intégration dans `groupe-lounici-erp`

Ce dépôt est publié tel quel sur **https://erp.lounici.ca** (GitHub Pages, branche `main`, racine) : **tout fichier du dépôt est téléchargeable publiquement**, même si le dépôt devient privé. Donc :

- **Aucune donnée financière dans le dépôt** (relevés, CSV de transactions, montants). Elles vont dans Supabase, protégées par RLS. Le `.gitignore` bloque `module-depenses-abonnements/data/` et les PDF.
- Suivre le modèle du CRM : `depenses.html`, `depenses.js`, `depenses.css` à la racine (en réutilisant `projets.css`), `supabase/depenses.sql` réexécutable à coller dans le SQL Editor, une carte dans `portail.html` réservée à Groupe Lounici, une section dans `README.md`.
- **Accès** : plus strict que le CRM. Les dépenses personnelles ne doivent être visibles que par Maya : RLS `using (public.est_admin())` ou une colonne `proprietaire uuid default auth.uid()` avec `using (proprietaire = auth.uid())`. Ne pas se contenter de `est_lounici()`, qui ouvre l'accès à tout le rôle `lounici`.
- **Import des relevés** : le site est statique. Deux options à proposer à Maya :
  1. Lire les PDF dans le navigateur (pdf.js), appliquer le parseur réécrit en JavaScript, puis insérer dans Supabase ;
  2. Ou garder les scripts Python de `scripts/` en local et importer le CSV produit (bouton « Importer un CSV »).
- **Données de départ** : Maya a les CSV (`transactions.csv`, `abonnements.csv`, `abonnements_manuels.csv`, `mensuel_categories.csv`) dans son zip. Les charger dans Supabase via l'import CSV de la page ou le Table Editor de Supabase, jamais via un commit.

## 1. Ce que l'utilisateur doit pouvoir faire

1. **Importer des relevés PDF** de deux cartes :
   - Visa RBC Récompenses (perso, carte se terminant par 2367)
   - Visa Affaires Desjardins (Dermagen inc., compte subalterne 3005)
2. **Voir chaque transaction** classée dans une catégorie, avec recherche, filtre par catégorie et tri par date ou montant.
3. **Voir ses abonnements** : service, groupe, carte, prix mensuel actuel, statut, dernier débit, total des 12 derniers mois, total payé, note.
4. **Ajouter un abonnement à la main** avant qu'il apparaisse sur un relevé (ex. Supabase Pro), en devise étrangère avec taxes.
5. **Voir les totaux** : coût mensuel des abonnements actifs par groupe, dépense moyenne par mois, moyenne par catégorie, évolution mois par mois.

---

## 2. Modèle de données

Adapter les noms au style de l'ERP (ORM, conventions, multi-entités). Chaque table porte l'entité propriétaire si l'ERP est multi-entités (la carte Desjardins = Dermagen inc. ; la RBC = Maya personnellement).

### `cartes`
| champ | type | exemple |
|---|---|---|
| id | pk | |
| nom | texte | `RBC Visa perso`, `Desjardins Visa Affaires (Dermagen)` |
| emetteur | enum `rbc`, `desjardins` | sert à choisir le parseur |
| derniers_4 | texte(4) | `2367`, `3005` |
| entite_id | fk (si multi-entités) | |

**Ne jamais stocker** le numéro complet de carte ni le code de sécurité.

### `releves`
| champ | type |
|---|---|
| id | pk |
| carte_id | fk |
| date_releve | date |
| solde_precedent, solde_total | décimal |
| fichier_hash | texte (sha256, pour refuser un doublon d'import) |
| reconcilie | booléen (voir §3.4) |

### `transactions`
| champ | type | note |
|---|---|---|
| id | pk | |
| releve_id | fk | |
| date | date | date de l'opération |
| description | texte | libellé brut du relevé |
| montant | décimal | positif = achat, négatif = crédit / remboursement |
| devise_origine, montant_origine, taux_change | nullable | lus sur la ligne « Devise étrangère » des relevés RBC |
| categorie_id | fk | |
| abonnement_id | fk nullable | |
| categorie_forcee | booléen | vrai si l'utilisateur a corrigé la catégorie à la main : une nouvelle catégorisation ne l'écrase pas |

Les **paiements de carte** (`PAYMENT - THANK YOU`, `PAIEMENT CAISSE`, `PAYEZ AVEC VOS POINTS`) ne sont pas des dépenses : ne pas les stocker comme transactions (ou les marquer `type = paiement` et les exclure partout).

### `categories` et `regles_categorie`
Une règle = un motif regex (insensible à la casse) sur la description → catégorie, et optionnellement → abonnement. Les règles sont **évaluées dans l'ordre** (champ `priorite`) et la première qui correspond gagne. La liste de départ est dans `scripts/02_categoriser.py` (variable `RULES`), dans le bon ordre. Les rendre éditables dans l'ERP.

Catégories de départ : Logiciels & IA · Apple (App Store / iCloud) · Streaming & médias · Autres abonnements · Télécom (Bell, Fizz) · Assurances · Frais bancaires & intérêts · Avances de fonds · Entreprise & pro (Dermagen, OIQ…) · Restos & livraison · Épicerie · SAQ / SQDC · Essence & dépanneur · Transport, auto & stationnement · Voyages · Beauté & soins · Santé, pharmacie & animaux · Sport & bien-être · Achats en ligne (Amazon, Shein…) · Vêtements & accessoires · Maison, électronique & divers · Sorties, culture & éducation · Autres.

### `abonnements`
| champ | type | note |
|---|---|---|
| id | pk | |
| service | texte | `Claude (Anthropic)` |
| groupe | enum | `Logiciels & IA`, `Apple (App Store / iCloud)`, `Streaming & médias`, `Autres abonnements`, `Factures fixes` |
| carte_id | fk | |
| motif | regex | pour rattacher les transactions |
| montants_cibles | liste de décimaux, nullable | pour séparer plusieurs abonnements au même libellé (Apple) |
| frequence | enum `mensuel`, `annuel`, `ponctuel`, `mensuel_plus_renouvellements` | |
| prix_devise | décimal nullable | saisie manuelle : prix avant taxes dans la devise du fournisseur |
| devise | texte | `CAD`, `USD`… |
| taux_taxes | décimal nullable | ex. 0.1496 |
| mensuel_cad | décimal | voir §3.6 |
| statut | enum `actif`, `a_verifier`, `ponctuel`, `arrete` | calculé, modifiable à la main |
| source | enum `releve`, `manuel` | |
| note | texte | |

---

## 3. Règles de calcul

### 3.1 Lecture des relevés RBC (`scripts/01_parse_releves.py`)
- Extraire le texte avec `pdftotext -layout`.
- Ligne de transaction : `JJ MOI   JJ MOI   DESCRIPTION   montant $` (mois en français abrégé : JAN, FÉV, MAR, AVR, MAI, JUN, JUL, AOÛ, SEP, OCT, NOV, DÉC). Un montant entre parenthèses `(500,00 $)` est un crédit.
- **Lignes coupées** : parfois la date est seule sur sa ligne et la description + le montant sont 1 à 4 lignes plus bas (après un numéro de référence). Le script gère ce cas.
- Ligne suivante `Devise étrangère - USD 11,50 Taux de change - 1,406956` : la rattacher à la transaction précédente.
- **Année** : prise du nom du fichier / de la date du relevé ; si le mois de la transaction est après le mois du relevé, c'est l'année précédente (relevé de janvier contenant des achats de décembre).
- Montants au format français : espace pour les milliers, virgule décimale.

### 3.2 Lecture des relevés Desjardins
- Date du relevé : `Jour JJ Mois MM Année AAAA`.
- Ligne : `JJ MM JJ MM NNN DESCRIPTION montant` ; suffixe `CR` = crédit.
- **Ignorer** les lignes dont la description est le nom du titulaire (`FADIA MAYA LOUNICI`) : ce sont les totaux du compte principal, pas des achats.
- `FRAIS DE CRÉDIT` et `FRAIS ANNUELS` sont des transactions (catégorie Frais bancaires).

### 3.3 Catégorisation
Appliquer les règles dans l'ordre (§2). Les transactions non reconnues vont dans « Autres ». Une catégorie corrigée à la main (`categorie_forcee`) n'est jamais écrasée.

### 3.4 Contrôle à l'import (obligatoire)
- RBC : `solde précédent + somme(toutes les lignes, paiements compris) = solde de compte total` à 0,02 $ près.
- Desjardins : somme des achats du compte subalterne = la ligne `Total` du relevé.
- Un relevé qui ne balance pas est importé avec `reconcilie = false` et un avertissement visible. Sur les 47 relevés de référence, les 47 balancent.

### 3.5 Rattachement aux abonnements
- Une transaction est rattachée à l'abonnement dont le `motif` correspond (et dont `montants_cibles` contient le montant, s'il y en a).
- Apple : un seul libellé (`APPLE.COM/BILL`) pour plusieurs abonnements. On les sépare par montant récurrent (28,73 ; 28,74 ; 19,53 ; 12,64 → 13,79 ; 5,16 ; 4,59). Les autres montants Apple vont dans « Apple · autres débits » (ponctuel).
- **Amélioration souhaitée** (pas dans le prototype) : proposer automatiquement un nouvel abonnement quand un même marchand revient au moins 3 fois avec un montant à ±5 % et un intervalle de 28 à 35 jours (ou ~365 jours pour l'annuel). L'utilisateur confirme ou refuse.

### 3.6 Montant mensuel (`mensuel_cad`)
- Mensuel : dernier montant débité (prix actuel).
- Annuel : montant annuel ÷ 12.
- Mensuel + renouvellements (GoDaddy) : total des 12 derniers mois ÷ 12.
- Ponctuel ou arrêté : 0.
- **Saisie manuelle en devise étrangère** : `prix_devise × (1 + taux_taxes) × taux_de_change`. Taux de change par défaut = celui du dernier débit dans cette devise (ex. Midjourney : 16,37 CAD / 11,50 USD ≈ 1,4235). Dès que le premier débit réel apparaît sur un relevé, on remplace l'estimation par le montant réel et `source` reste `manuel` pour l'historique.

### 3.7 Statut
- `actif` : un débit dans le dernier cycle attendu (≤ 35 jours avant la date du dernier relevé importé de cette carte pour un mensuel ; ≤ 370 jours pour un annuel).
- `a_verifier` : actif avant, mais aucun débit dans le dernier cycle attendu (peut avoir été annulé ou changé de carte).
- `arrete` : aucun débit depuis plus de 2 cycles.
- `ponctuel` : un seul débit, pas de récurrence.
- L'utilisateur peut forcer le statut.

### 3.8 Totaux affichés
- Coût mensuel par groupe = somme de `mensuel_cad` des abonnements `actif` + `a_verifier`.
- Total = somme des groupes (factures fixes comprises).
- Dépense moyenne par mois = somme des transactions des 12 derniers mois complets ÷ 12.
- Moyenne par catégorie = même calcul, par catégorie.

---

## 4. Écran

1. **En-tête** : une phrase avec le total mensuel des abonnements actifs, la part Logiciels & IA, le coût de Claude, et la dépense moyenne par mois des 12 derniers mois.
2. **5 tuiles** : Logiciels & IA, Apple, Streaming & médias, Autres abonnements, Factures fixes (montant par mois).
3. **Tableau des abonnements** : Service, Groupe, Carte, Par mois, Statut (pastille verte = actif, orange = à vérifier, grise = ponctuel/arrêté), Dernier débit, 12 derniers mois, Total payé, Note. Tri par groupe, puis statut, puis montant. Bouton « Ajouter un abonnement » (formulaire : service, groupe, carte, prix, devise, taxes, fréquence, date de début, note).
4. **Graphique** : barres empilées par mois des 4 groupes d'abonnements numériques, avec infobulle.
5. **Graphique** : barres horizontales, moyenne mensuelle par catégorie (12 derniers mois).
6. **Transactions** : recherche, filtre par catégorie, tri date / montant, compteur « N transactions · total », correction de catégorie en ligne.
7. **Import** : glisser-déposer de PDF (ou d'un zip), résumé après import (relevés lus, transactions ajoutées, doublons ignorés, relevés qui ne balancent pas).

---

## 5. Données de départ (dans le zip de Maya, jamais dans ce dépôt)

| fichier | contenu |
|---|---|
| `transactions.csv` | 1 652 transactions catégorisées, déc. 2023 à sept. 2026. Colonnes : id, date, carte, description, categorie, abonnement, montant |
| `abonnements.csv` | 33 abonnements avec statut et totaux, état au 13 nov. 2026 |
| `abonnements_manuels.csv` | abonnement saisi à la main (Supabase Pro), dans le format de saisie (prix en devise + taxes) |
| `mensuel_categories.csv` | total par mois et par catégorie, janv. 2024 à août 2026 |

Les relevés PDF non plus : les réimporter dans l'ERP pour tester le parseur.

## 6. Valeurs de contrôle (critères d'acceptation)

Avec les données de départ, l'ERP doit afficher :
- Abonnements actifs, total : **1 105,50 $ / mois**
- Logiciels & IA : **426,56 $** (dont Claude 160,97 $, QuickBooks 80,48 $, GoDaddy 56,55 $, Shopify 56,34 $, Supabase Pro ~40,91 $, Midjourney 16,37 $, HubSpot 14,94 $)
- Apple : **100,54 $** · Streaming & médias : **92,21 $** · Autres abonnements : **20,68 $** · Factures fixes : **465,51 $**
- Dépense moyenne sept. 2025 – août 2026 : **≈ 5 554 $ / mois**
- Import des 47 relevés : 47 relevés réconciliés, 0 écart.

## 7. Limites connues
- Relevés Desjardins fournis jusqu'en juin 2026 seulement : QuickBooks, Shopify et GoDaddy sont « actifs » d'après ce dernier relevé.
- Apple ne nomme pas les apps sur le relevé : le nom réel se trouve dans Réglages › Identifiant Apple › Abonnements ; prévoir un champ pour renommer chaque ligne Apple.
- Quelques classements sont approximatifs (achats faits en voyage rangés dans Voyages, par ex.) : d'où la correction manuelle.
