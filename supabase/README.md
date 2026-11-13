# Lens — base en ligne (Supabase)

Projet « Lens Diagnostic », région Canada (Central). Les clés publiques sont dans `../lens-config.js`.

## 1. Schéma

`schema.sql` est réexécutable : SQL Editor → coller → Run. Il crée les tables (entreprises, membres, espaces,
enregistrements, documents), la liste des accès autorisés, les règles RLS et les buckets privés
`enregistrements` (vidéos et images) et `documents`.

## 2. Fonction « analyser » (cartographie automatique par Claude)

Code : `functions/analyser/index.ts`. Elle est appelée par Lens dès qu'un enregistrement d'écran est envoyé.
Lens capture une image toutes les deux secondes pendant l'enregistrement ; la fonction envoie ces images à Claude
et écrit le diagramme EPC dans le processus. La clé API Anthropic ne quitte jamais le serveur.

Déploiement depuis le tableau de bord (sans installer d'outil) :

1. **Edge Functions** → « Deploy a new function » → « Via Editor ».
2. Nom de la fonction : `analyser`. Coller tout le contenu de `functions/analyser/index.ts`. Deploy.
3. **Edge Functions → Secrets** (ou Project Settings → Edge Functions) : ajouter `ANTHROPIC_API_KEY` = ta clé Anthropic.
4. Laisser « Verify JWT » activé : Lens envoie le jeton de la personne connectée, et la fonction vérifie par RLS
   que l'enregistrement lui appartient.

Avec le CLI (`npm i -g supabase`, puis `supabase login`) : `supabase functions deploy analyser --project-ref afcwntgvmpkulngcueaq`
et `supabase secrets set ANTHROPIC_API_KEY=...`.

## 2 bis. Fonction « questionnaire » (entretien après la cartographie)

Code : `functions/questionnaire/index.ts`. Même déploiement que « analyser » (Edge Functions → Deploy a new function → Via Editor,
nom `questionnaire`), même secret `ANTHROPIC_API_KEY`. Lens l'appelle quand la personne ouvre le bouton Questionnaire :
Claude pose une question à la fois sur le processus cartographié, prend en compte les corrections décrites par la personne
et met à jour le diagramme du diagnostic. La conversation est conservée dans l'espace (diagnostic → `chat`).

## 3. Suivi

Table `enregistrements`, colonne `statut` : `televerse` → `analyse` → `cartographie` (ou `erreur`, avec le message dans
`transcription`). Lens interroge ce statut après l'envoi et affiche le diagramme dès qu'il est prêt.

Limites du forfait gratuit : 50 Mo par fichier, 1 Go de stockage, fonctions limitées à 150 s. Une analyse prend
en général 30 à 90 s et coûte quelques cents.
