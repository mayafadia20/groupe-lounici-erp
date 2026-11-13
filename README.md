# Groupe Lounici — ERP

Outils clients de Groupe Lounici, publiés sur **https://erp.lounici.ca** (GitHub Pages, branche `main`, racine).

- `index.html` : connexion (comptes Supabase du projet « Lens Diagnostic »)
- `portail.html` : outils (Lens, Laureat)
- `lens.html`, `lens.js`, `lens-cloud.js`, `lens-config.js` : Lens
- `supabase/` : schéma et fonctions Edge (voir `supabase/README.md`)

Le site vitrine reste dans le dépôt `groupe-lounici` (https://lounici.ca).

## Projets (gestion de projet)

`projets.html`, `projets.js`, `projets.css` : projets et tâches par entreprise (tableau à glisser-déposer, liste triable,
échéancier, vue d'ensemble, « Mes tâches »). Tables `pm_projets` et `pm_taches` : exécuter `supabase/projets.sql`
une fois dans le SQL Editor de Supabase. Groupe Lounici (rôle `lounici`) choisit l'entreprise dans la barre latérale ;
« Groupe Lounici (interne) » regroupe les projets internes.

## CRM (suivi des clients et prospects)

`crm.html`, `crm.js`, `crm.css` (+ `projets.css`) : clients, contacts, journal des échanges (appel, courriel, rencontre,
LinkedIn, message, note), relances, pipeline par étape, export CSV. Réservé au rôle `lounici` (RLS, et carte retirée
du portail pour les comptes clients). Tables `crm_comptes`, `crm_contacts`, `crm_activites` : exécuter `supabase/crm.sql`
une fois dans le SQL Editor de Supabase. Raccourci : touche N = logger un contact.
