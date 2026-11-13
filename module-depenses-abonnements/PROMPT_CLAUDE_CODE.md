# Prompt à coller dans Claude Code

Ouvre une session Claude Code sur le dépôt `mayafadia20/groupe-lounici-erp` et colle ceci :

---

Ajoute à l'ERP un module « Dépenses & abonnements ». Toute la spécification est dans `module-depenses-abonnements/SPEC.md` : lis-la en entier avant de commencer, en particulier la section 0 (intégration dans ce dépôt).

Contexte :
- Le site est publié tel quel sur erp.lounici.ca (GitHub Pages) : aucune donnée financière ne doit être commitée. Les données vont dans Supabase, avec une RLS qui ne laisse voir les dépenses qu'à moi (pas à tout le rôle `lounici`).
- Suis le modèle du CRM : `crm.html`, `crm.js`, `crm.css`, `supabase/crm.sql`, la carte dans `portail.html` et la section du `README.md`.
- `module-depenses-abonnements/scripts/` contient le prototype Python qui marche déjà : `01_parse_releves.py` (lecture des PDF RBC et Desjardins après `pdftotext -layout`), `02_categoriser.py` (règles de catégorisation, dans l'ordre), `03_abonnements.py` (abonnements, statuts, totaux). Reprends leur logique et leurs expressions régulières.

Ce que j'attends :
1. Propose-moi d'abord un plan court : tables Supabase et RLS, fichiers à créer, façon d'importer les relevés (PDF lus dans le navigateur ou CSV produit par les scripts), librairie de graphiques.
2. Crée `supabase/depenses.sql` (réexécutable), `depenses.html`, `depenses.js`, `depenses.css`, la carte du portail et la section du README.
3. Ajoute un bouton « Importer un CSV » pour que je charge moi-même mes données de départ (`transactions.csv`, `abonnements.csv`, `abonnements_manuels.csv`).
4. Vérifie avec mes données les valeurs de contrôle de la section 6 de la spec (totaux des abonnements, moyenne mensuelle).
5. Ne stocke jamais de numéro de carte complet ni de code de sécurité.

Si un point de la spec ne colle pas avec l'architecture, demande-moi plutôt que de deviner.
