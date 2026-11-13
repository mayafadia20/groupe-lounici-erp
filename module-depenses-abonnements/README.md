# Module Dépenses & abonnements

Dossier à donner à Claude Code pour ajouter le suivi des dépenses et des abonnements à l'ERP.

- `PROMPT_CLAUDE_CODE.md` : le message à coller dans Claude Code.
- `SPEC.md` : la spécification complète (données, calculs, écran, valeurs de contrôle).
- `scripts/` : le prototype Python qui lit les relevés.

**Pas de données ici.** Ce dépôt est publié sur erp.lounici.ca : tout fichier commité devient public. Les CSV de départ (transactions, abonnements) restent dans le zip de Maya et se chargent dans Supabase. Le `.gitignore` bloque `module-depenses-abonnements/data/` et les PDF.

Lancer le prototype (Python 3, `pdftotext` installé) :

```bash
# 1. Convertir les PDF : un dossier dont le nom contient "RBC" et un dont le nom contient "Desjardin"
find releves/ -name "*.pdf" -exec sh -c 'pdftotext -layout "$1" "${1%.pdf}.txt"' _ {} \;
# 2. Lire les relevés
python3 scripts/01_parse_releves.py releves/ txns.csv
# 3. Catégoriser
python3 scripts/02_categoriser.py txns.csv cat.csv
# 4. Abonnements et totaux (lit ./cat.csv, écrit dans ./out/)
python3 scripts/03_abonnements.py .
```

Les abonnements saisis à la main (`data/abonnements_manuels.csv`) ne passent pas par ces scripts : dans l'ERP, ils viennent du formulaire « Ajouter un abonnement ».
