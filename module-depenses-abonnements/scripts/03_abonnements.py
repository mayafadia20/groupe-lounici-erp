import csv, re, sys, os, collections

S = sys.argv[1]
rows = list(csv.DictReader(open(os.path.join(S, 'cat.csv'), encoding='utf-8')))
for r in rows:
    r['amt'] = float(r['amount'])
    r['card'] = 'RBC' if 'RBC' in r['source'] else 'Desjardins'

def sel(pat, amounts=None, since=None):
    rx = re.compile(pat)
    out = [r for r in rows if rx.search(r['desc'].upper())]
    if amounts == 'OTHER':
        out = [r for r in out if round(r['amt'], 2) not in {28.73, 28.74, 19.53, 12.64, 13.79, 5.16, 4.59}]
    elif amounts is not None:
        out = [r for r in out if round(r['amt'], 2) in amounts]
    if since:
        out = [r for r in out if r['date'] >= since]
    return sorted(out, key=lambda r: r['date'])

L12 = '2025-09-01'
# (name, group, pattern, amounts, monthly, frequency, status, note)
SUBS = [
    ('Claude (Anthropic)', 'Logiciels & IA', r'CLAUDE\.AI|ANTHROPIC', None, 160.97, 'Mensuel', 'À vérifier', "Pro à 32,19 $ en mars–avril 2026, puis Max à 160,97 $ dès le 26 avril. Dernier débit le 26 juillet : absent du relevé RBC de septembre."),
    ('QuickBooks Online', 'Logiciels & IA', r'INTUIT', None, 80.48, 'Mensuel', 'Actif', "Passé de 37,37 $ (2025) à 74,73 $ puis 80,48 $. Sur la Visa Desjardins depuis nov. 2025 ; relevés Desjardins fournis jusqu'en juin 2026."),
    ('GoDaddy', 'Logiciels & IA', r'GODADDY', None, None, 'Mensuel + renouvellements', 'Actif', "Forfait de 34,48 $ le 2 du mois, plus des renouvellements de domaines (18,38 $ à 151,63 $). Montant mensuel = moyenne des 12 derniers mois."),
    ('Shopify', 'Logiciels & IA', r'SHOPIFY', None, 56.34, 'Mensuel', 'Actif', "Plan à 56,34 $ depuis nov. 2025, plus un débit ponctuel de 612,73 $ le 6 déc. 2025."),
    ('Midjourney', 'Logiciels & IA', r'MIDJOURNEY', None, None, 'Mensuel', 'Actif', "11,50 USD par mois, converti au taux du jour. Montant mensuel = dernier débit."),
    ('HubSpot', 'Logiciels & IA', r'HUBSPOT', None, 14.94, 'Mensuel', 'Actif', "Nouveau depuis juillet 2026."),
    ('Microsoft', 'Logiciels & IA', r'MICROSOFT', None, 0, 'Ponctuel', 'Ponctuel', "Un seul débit, 25 juin 2026. Si c'est un abonnement annuel, il revient en juin 2027."),
    ('use.ai', 'Logiciels & IA', r'USE\.AI', None, 0, 'Ponctuel', 'Ponctuel', "Un seul débit, mars 2026."),
    ('Artlist', 'Logiciels & IA', r'ARTLIST', None, 0, 'Ponctuel', 'Ponctuel', "Un seul débit, mars 2026."),
    ('Kahoot', 'Logiciels & IA', r'KAHOOT', None, 0, 'Ponctuel', 'Ponctuel', "Un seul débit, février 2026."),
    ('Udemy', 'Logiciels & IA', r'UDEMY', None, 0, 'Ponctuel', 'Ponctuel', "Achat de cours, mai 2026."),
    ('myIQ', 'Logiciels & IA', r'MYIQ', None, 0, 'Ponctuel', 'Arrêté', "Avril 2025 seulement."),
    ('Upwork', 'Logiciels & IA', r'UPWORK', None, 0, 'Ponctuel', 'Arrêté', "Fin 2024, en grande partie remboursé."),
    ('Apple · 28,73 $ (vers le 13)', 'Apple (App Store / iCloud)', r'APPLE\.COM', {28.73}, 28.73, 'Mensuel', 'Actif', "Depuis sept. 2024. 24,99 $ + taxes."),
    ('Apple · 28,74 $ (vers le 25)', 'Apple (App Store / iCloud)', r'APPLE\.COM', {28.74}, 28.74, 'Mensuel', 'Actif', "Depuis janv. 2026. Second abonnement à 24,99 $ + taxes."),
    ('Apple · 19,53 $ (le 2)', 'Apple (App Store / iCloud)', r'APPLE\.COM', {19.53}, 19.53, 'Mensuel', 'Actif', "Depuis juil. 2024. 16,99 $ + taxes."),
    ('Apple · 13,79 $ (le 2)', 'Apple (App Store / iCloud)', r'APPLE\.COM', {12.64, 13.79}, 13.79, 'Mensuel', 'Actif', "Depuis août 2024 à 12,64 $, augmenté à 13,79 $ en sept. 2026."),
    ('Apple · 5,16 $ (vers le 14)', 'Apple (App Store / iCloud)', r'APPLE\.COM', {5.16}, 5.16, 'Mensuel', 'Actif', "Depuis juin 2026. 4,49 $ + taxes."),
    ('Apple · 4,59 $ (vers le 20)', 'Apple (App Store / iCloud)', r'APPLE\.COM', {4.59}, 4.59, 'Mensuel', 'Actif', "Depuis juil. 2024. 3,99 $ + taxes, le prix d'iCloud+ 50 Go."),
    ('Apple · autres débits', 'Apple (App Store / iCloud)', r'APPLE\.COM', 'OTHER', 0, 'Ponctuel', 'Ponctuel', "Achats intégrés et anciens abonnements à d'autres montants (11,49 $, 17,81 $, 18,38 $, 20,68 $…)."),
    ('Netflix', 'Streaming & médias', r'NETFLIX', None, 43.66, 'Mensuel', 'Actif', "36,77 $ jusqu'en avril 2026, puis 43,66 $."),
    ('Amazon Channels', 'Streaming & médias', r'AMAZON CHANNELS', None, 25.28, 'Mensuel', 'Actif', "Une chaîne à 25,28 $ reste. Deux autres (12,64–13,79 $ et 8,04 $) arrêtées en fév. 2026."),
    ('Disney+', 'Streaming & médias', r'DISNEY', None, 10.34, 'Mensuel', 'Actif', ""),
    ('Prime Video sans pub', 'Streaming & médias', r'AD FREE FOR PRIMEVIDEO', None, 3.44, 'Mensuel', 'Actif', ""),
    ('Amazon Prime', 'Streaming & médias', r'PRIME MEMBER', None, round(113.83/12, 2), 'Annuel', 'À vérifier', "113,83 $ le 29 sept. 2025. Le renouvellement 2026 tombe après le dernier relevé fourni."),
    ('Kindle', 'Streaming & médias', r'KINDLE', None, 0, 'Mensuel', 'Arrêté', "2024 seulement."),
    ('Uber One', 'Autres abonnements', r'UBERONE|UBER\* ONE|UBERDIRECTCA_PASS', None, 11.49, 'Mensuel', 'Actif', ""),
    ('Oura (membre)', 'Autres abonnements', r'OURARING', None, 9.19, 'Mensuel', 'Actif', "Depuis janv. 2026."),
    ('Security National (assurance)', 'Factures fixes', r'SECURITY NATIONAL', None, 290.75, 'Mensuel', 'Actif', "Deux prélèvements le 13 : 252,33 $ + 38,42 $."),
    ('Fizz (mobile)', 'Factures fixes', r'FIZZ', None, 56.34, 'Mensuel', 'Actif', ""),
    ('Bell Canada (internet / télé)', 'Factures fixes', r'BELL CANADA', None, 118.42, 'Mensuel', 'À vérifier', "Dernier débit sur la carte le 24 juin 2026 : peut-être payé autrement depuis."),
    ('Bell Mobilité', 'Factures fixes', r'BELL MOBILITY', None, 0, 'Mensuel', 'Arrêté', "Dernier débit en déc. 2024 (crédit de 15,56 $ en mai 2025), remplacé par Fizz."),
]

out = []
for name, grp, pat, amts, monthly, freq, status, note in SUBS:
    rs = sel(pat, amts)
    assert rs, name
    tot = round(sum(r['amt'] for r in rs), 2)
    t12 = round(sum(r['amt'] for r in rs if r['date'] >= L12), 2)
    if monthly is None:
        monthly = round(t12 / 12, 2) if name == 'GoDaddy' else rs[-1]['amt']
    cards = []
    for r in rs:
        if r['card'] not in cards: cards.append(r['card'])
    out.append(dict(service=name, groupe=grp, carte=' → '.join(cards), mensuel=f'{monthly:.2f}',
                    frequence=freq, statut=status, premier_debit=rs[0]['date'], dernier_debit=rs[-1]['date'],
                    nb_debits=len(rs), total_12_mois=f'{t12:.2f}', total_paye=f'{tot:.2f}', note=note))

# Apple coverage check
apple_all = round(sum(r['amt'] for r in rows if 'APPLE.COM' in r['desc']), 2)
apple_lines = round(sum(float(o['total_paye']) for o in out if o['groupe'].startswith('Apple')), 2)
print('apple all', apple_all, 'in lines', apple_lines)

os.makedirs(os.path.join(S, 'out'), exist_ok=True)
with open(os.path.join(S, 'out', 'abonnements.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)

# monthly by category, complete months only
months = sorted({r['month'] for r in rows if '2024-01' <= r['month'] <= '2026-08'})
agg = collections.defaultdict(float)
for r in rows:
    if r['month'] in months: agg[(r['month'], r['category'])] += r['amt']
with open(os.path.join(S, 'out', 'mensuel_categories.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['mois', 'categorie', 'montant'])
    for (m, c), v in sorted(agg.items()): w.writerow([m, c, f'{v:.2f}'])

with open(os.path.join(S, 'out', 'transactions.csv'), 'w', newline='', encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['id', 'date', 'carte', 'description', 'categorie', 'abonnement', 'montant'])
    for i, r in enumerate(sorted(rows, key=lambda r: r['date'])):
        w.writerow([i + 1, r['date'], r['card'], r['desc'], r['category'], r['subscription'], f"{r['amt']:.2f}"])

for o in out: print(o['service'], o['mensuel'], o['statut'], o['dernier_debit'], o['total_12_mois'], o['total_paye'])
act = [o for o in out if o['statut'] in ('Actif', 'À vérifier')]
g = collections.defaultdict(float)
for o in act: g[o['groupe']] += float(o['mensuel'])
print({k: round(v, 2) for k, v in g.items()}, round(sum(g.values()), 2))
