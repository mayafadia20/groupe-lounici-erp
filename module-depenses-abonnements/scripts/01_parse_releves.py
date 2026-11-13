import re, sys, os, glob, csv

ROOT = sys.argv[1]
OUT = sys.argv[2]
MON = {'JAN':1,'FÉV':2,'FEV':2,'MAR':3,'AVR':4,'MAI':5,'JUN':6,'JUI':7,'JUL':7,'AOÛ':8,'AOU':8,'SEP':9,'OCT':10,'NOV':11,'DÉC':12,'DEC':12}

def amt(s):
    s = s.replace(' ', '').replace('$', '').replace(',', '.')
    return float(s)

rows = []
# RBC
rbc_re = re.compile(r'^\s*(\d{2}) ([A-ZÉÛ]{3})\s+(\d{2}) ([A-ZÉÛ]{3})\s+(.+?)\s{2,}(\(?[\d ]+,\d{2} \$\)?)')
rbc_re2 = re.compile(r'^\s*(\d{2}) ([A-ZÉÛ]{3})\s+(\d{2}) ([A-ZÉÛ]{3})\s?(.+?)\s{2,}(\(?[\d ]+,\d{2} \$\)?)')
for f in sorted(glob.glob(os.path.join(ROOT, '*RBC*', '*.txt'))):
    stmt = re.search(r'(\d{4})-(\d{2})-(\d{2})', os.path.basename(f))
    sy, sm = int(stmt.group(1)), int(stmt.group(2))
    lines = open(f, encoding='utf-8').read().splitlines()
    for i, l in enumerate(lines):
        m = rbc_re2.match(l)
        if not m:
            # wrapped entry: date(s) alone on a line, description+amount a few lines below
            w = re.match(r'^\s*(\d{2}) ([A-ZÉÛ]{3})(\s+\d{2} [A-ZÉÛ]{3})?\s*$', l)
            if not w:
                continue
            found = None
            for j in range(i+1, min(i+5, len(lines))):
                mm = re.match(r'^\s+(?:\d{2} [A-ZÉÛ]{3}\s)?([A-Z].+?)\s{2,}(\(?[\d ]+,\d{2} \$\)?)', lines[j])
                if mm:
                    found = (mm.group(1), mm.group(2)); break
            if not found:
                print('UNRESOLVED', f, l); continue
            d, mo = w.group(1), w.group(2)
            desc, a = found
        else:
            d, mo, _, _, desc, a = m.groups()
        mo_n = MON[mo]
        y = sy - 1 if mo_n > sm else sy
        neg = a.strip().startswith('(')
        v = amt(a.strip('()'))
        if neg: v = -v
        fx = ''
        for j in range(i+1, min(i+3, len(lines))):
            if 'Devise' in lines[j]:
                fx = re.sub(r'\s+', ' ', lines[j].strip()); break
        rows.append(dict(source='RBC Visa perso', stmt=os.path.basename(f), date=f'{y}-{mo_n:02d}-{int(d):02d}', desc=re.sub(r'\s+',' ',desc.strip()), amount=round(v,2), fx=fx))

# Desjardins
dj_re = re.compile(r'^\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{3})\s+(.+?)\s+([\d ]*\d,\d{2})(CR)?\s*$')
for f in sorted(glob.glob(os.path.join(ROOT, '*Desjardin*', '*', '*.txt'))):
    txt = open(f, encoding='utf-8').read()
    m = re.search(r'Jour\s+(\d{2})\s+Mois\s+(\d{2})\s+Année\s+(\d{4})', txt)
    sm, sy = int(m.group(2)), int(m.group(3))
    for l in txt.splitlines():
        m = dj_re.match(l)
        if not m: continue
        d, mo, _, _, _, desc, a, cr = m.groups()
        desc = re.sub(r'\s{2,}', ' | ', desc.strip())
        if desc.startswith('FADIA MAYA LOUNICI'):
            continue  # account-level summary line
        mo_n = int(mo)
        y = sy - 1 if mo_n > sm else sy
        v = amt(a)
        if cr: v = -v
        rows.append(dict(source='Desjardins Visa Affaires (Dermagen)', stmt=os.path.basename(f), date=f'{y}-{mo_n:02d}-{int(d):02d}', desc=desc, amount=round(v,2), fx=''))

with open(OUT, 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=['source','stmt','date','desc','amount','fx'])
    w.writeheader(); w.writerows(rows)
print(len(rows))
