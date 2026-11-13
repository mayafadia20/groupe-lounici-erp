import csv, re, sys, json, collections

rows = list(csv.DictReader(open(sys.argv[1], encoding='utf-8')))
OUT = sys.argv[2]

# (pattern, category, subscription name or None)
RULES = [
    (r'PAYMENT - THANK|PAIEMENT CAISSE|PAYEZ AVEC VOS POINTS', None, None),
    # Software / AI / business tools
    (r'MIDJOURNEY', 'Logiciels & IA', 'Midjourney'),
    (r'CLAUDE\.AI|ANTHROPIC', 'Logiciels & IA', 'Claude (Anthropic)'),
    (r'GODADDY', 'Logiciels & IA', 'GoDaddy (domaines / M365 / hébergement)'),
    (r'INTUIT|QBOOKS', 'Logiciels & IA', 'QuickBooks Online'),
    (r'SHOPIFY', 'Logiciels & IA', 'Shopify'),
    (r'MICROSOFT', 'Logiciels & IA', 'Microsoft'),
    (r'HUBSPOT', 'Logiciels & IA', 'HubSpot'),
    (r'UPWORK', 'Logiciels & IA', 'Upwork'),
    (r'USE\.AI', 'Logiciels & IA', 'use.ai'),
    (r'ARTLIST', 'Logiciels & IA', 'Artlist'),
    (r'UDEMY', 'Logiciels & IA', 'Udemy'),
    (r'KAHOOT', 'Logiciels & IA', 'Kahoot'),
    (r'MYIQ', 'Logiciels & IA', 'myIQ'),
    (r'APPLE\.COM/BILL', 'Apple (App Store / iCloud)', 'Apple — abonnements App Store / iCloud'),
    # Streaming / media
    (r'NETFLIX', 'Streaming & médias', 'Netflix'),
    (r'DISNEY', 'Streaming & médias', 'Disney+'),
    (r'AMAZON CHANNELS', 'Streaming & médias', 'Amazon Channels (chaînes Prime Video)'),
    (r'AD FREE FOR PRIMEVIDEO', 'Streaming & médias', 'Prime Video sans pub'),
    (r'PRIME MEMBER', 'Streaming & médias', 'Amazon Prime (annuel)'),
    (r'PRIMEVIDEO', 'Streaming & médias', None),
    (r'KINDLE', 'Streaming & médias', 'Kindle'),
    # Other subscriptions / memberships
    (r'OURARING', 'Autres abonnements', 'Oura (membre)'),
    (r'UBERONE|UBER\* ONE|UBERDIRECTCA_PASS', 'Autres abonnements', 'Uber One'),
    # Telecom / insurance
    (r'BELL ', 'Télécom (Bell, Fizz)', None),
    (r'FIZZ', 'Télécom (Bell, Fizz)', None),
    (r'KT ROAMING|WIFIONBOARD', 'Télécom (Bell, Fizz)', None),
    (r'SECURITY NATIONAL', 'Assurances', None),
    # Bank
    (r'INTERETS|FRAIS DE CRÉDIT|FRAIS ANNUELS|ARGENT GAB|AJUSTEMENT SUR DEVISE', 'Frais bancaires & intérêts', None),
    (r'AVANCE DE FONDS', 'Avances de fonds', None),
    # Business (Dermagen etc.)
    (r'MAKINGCOSMETICS|CREATIVE BIOMART|SP DE MONT|MEDTEQ|REQ/|ORDRE DES INGENIEURS|STARTUPFEST|JEUNE CHAMBRE|AIR LIQUIDE|GOSSELIN PHOTO|15098629', 'Entreprise & pro (Dermagen, OIQ…)', None),
    (r'\bESSO\b|ULTRAMAR|PETRO|SHELL|COUCHE-TARD|COUCHETARD|GAS BAR|PETROLES', 'Essence & dépanneur', None),
    (r'STUDIO BODI|PILATES|CLUB ATWATER|\bSKI\b', 'Sport & bien-être', None),
    # Food
    (r'UBER CANADA/UBEREATS|UBER\*? ?EATS|UBER \*EATS', 'Restos & livraison', None),
    (r'\bIGA\b|SUPERMARCH|MAXI|SUPER C|MARCHE|BOUCHERIE|FROMAGERIE|POISSONNERIE|FRUITS & LEGUMES|DISTRIBUTION ALIMENTAI|PRODUITS ALIMENTAIRES|EPICERIE|ADONIS|KIM PHAT|MARJANE|WAL-MART|WALMART|COSTCO', 'Épicerie', None),
    (r'SAQ|SQDC', 'SAQ / SQDC', None),
    (r'TIM HORTONS|STARBUCKS|CAFE|RESTAURANT|SUSHI|BURGER|MCDONALD|PETINOS|BETE A PAIN|JUGO|BOUSTAN|PUB|BISTRO|KEG|GRILL|PIZZ|KEBAB|A&W|SUBWAY|CHATIME|GONG-CHA|BOULANGERIE|THE KEG|JACK ASTOR|MANDYS|BAR |CRABE|FAROS|MIKADO|TIAMO|OMNIVORE|OMINVORE|GATTO|LUCILLES|BEN & FLORENTINE|ALLO MON COCO|ESCONDITE|TAIYO|ZIBO|AVRIL|MANGA|SHAKER|MAIKO|BEROYA|LLOYD|DONATOS|HOUSTON|SAMON|BABEL|RAMEAU|PRETZEL|JOEJUICE|CUP S|PAPY|PARIS CROISSANT|SEGAFREDO|VENIZIA|BARRI|SOGNI|PRESSE CAFE|OLIMPICO|MCDONALDS|TRAITEUR|MERCI LA VIE|CASHEW|DUKE|IMBISS|SH VENDING|LS MANTI|ABU EL|UMAYYA|KABILA|YALLAH|AMIR|HAYAT|KENZA|SUSHIUMA|CHUNGCHUN|B12|DAVINCIA', 'Restos & livraison', None),
    # Transport
    (r'UBER|TAXI|TAKSI|BIXI|AGENCE DE MOBILITE|INDIGO|PARKING|IMPARK|STATIONNEMENT|PARC PUBLIC|CONCESSION A25|E-Z\*PASS|ESCOTA|UHAUL|GARAGE|PNEUS|JAGUAR|CONSTAT D|JUSTICE QUEBEC|GARE |EFFIA|OMIO|PAYCELL|T-MONEY|AEROPORTS|PORT DE MTL|SOCIETE DU PARC|TAXELCO|PAYTAX|RWCO', 'Transport, auto & stationnement', None),
    # Travel
    (r'AIR ?TRANSAT|AIR FRANCE|AIR CAN|WESTJET|TRIP\.COM|TRANSAT TOURS|HOTEL|AIRBNB|DUTY FREE|SHERATON|PARNAS|MOVENPICK|AUBERGE|LAGARDERE|ISTANBUL|SEOUL|MOHAMEDIA|MOHAMMADIA|CASABLANCA|MARRAK|RABAT|HIGUEY|NICE|CANNES|FRANKFU|MUNICH|HOFHEIM|GANGNAM|DEKYU|INCH|SEONGNAM|VILLEFRANCHE|MESNIL|\(JOO\)|JOOSIK|HAENDEUK|PINAEEUWON|BAIONIK|MYBIN|PORT 6|CAICALI|PAYPLE|BIGBTYE|SSIPLLEK|DIQ|TRESORS|GUNER|OZGUR|NOMU PAY|SIPAY|TOPKAPI|HILLTOWN|ELIT WORLD|JONGSEM|AIDIHAE|DAISY|OLIVE YOUNG|STARFIELD|SHINSEGAE', 'Voyages', None),
    # Beauty / health
    (r'ONGLES|NAILS|SPA|SEPHORA|ESTHETIQUE|BEAUTE|INHAIRITANCE|CURL|LOCCITANE|STUDIO B|BX STUDIO|SQ \*SAINTE STUDIO|ARABIAN OUD|DIOR', 'Beauté & soins', None),
    (r'PHARMAPRIX|JEAN COUTU|CLINIQUE|MEDICO|VICTORIUS|CENTRE VETERINAIRE|MONDOU|K9', 'Santé, pharmacie & animaux', None),
    # Shopping
    (r'AMZN|AMAZON|SHEIN|ETSY|PAYPAL', 'Achats en ligne (Amazon, Shein…)', None),
    (r'ZARA|ARITZIA|SIMONS|CLUB MONACO|COS |CHAUSSURES|INTERVALL|SOULIERS|LOUIS VUITTON|DAVID YURMAN|SWAROVSKI|M2BOUTIQUES|OLD NAVY|DYNAMITE|LA SENZA|EVER NEW|FRANK AND OAK|POLO|SUITSUPPLY|STITCH IT|INTIMISSIMI|HOLTRENFREW|PILGRIM|SPORTS EXPERTS|MASSIMO|IPEKYOL|TVIST|OXXO|RUBY LOUISE|DEAR MUSA|LILIANNE|JOSHUA PERETS|BROWNS', 'Vêtements & accessoires', None),
    (r'DOLLARAMA|CANADIAN TIRE|MAGI|BEST BUY|APPLE STORE|IKEA|SLEEP COUNTRY|STOKES|RONA|PARTY EXPERT|FLEUR|LELILI|LILI FLEUR|SHAKER CUISINE|GSB|FEDEX|MNTR RELAY|ALEXANDRE MAITRE', 'Maison, électronique & divers', None),
    (r'CEGEP|SERV REG ADMISSION|EVENTBRITE|TICKETMASTER|PLACE DES ARTS|FEVER|GRANDE ROUE|GRANDS BALLETS|CINEPLEX|FAMOUS PLAYER|MOMA|PLURAL|BILLETERIE|BEIRUTIN|JARDIN NELSON|SOMMETS|CHECK MATES|GOFNDME|HOOGAN', 'Sorties, culture & éducation', None),
]
COMPILED = [(re.compile(p), c, s) for p, c, s in RULES]

out = []
unc = collections.Counter()
for r in rows:
    d = r['desc'].upper()
    cat, sub = 'Autres', None
    skip = False
    for rx, c, s in COMPILED:
        if rx.search(d):
            if c is None: skip = True
            cat, sub = c, s
            break
    if skip: continue
    if cat == 'Autres': unc[d] += float(r['amount'])
    r = dict(r); r['category'] = cat; r['subscription'] = sub or ''
    r['month'] = r['date'][:7]
    out.append(r)

with open(OUT, 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
print('uncategorized:', len(unc), round(sum(unc.values()),2))
for k, v in unc.most_common(40): print(f'  {v:8.2f} {k}')
