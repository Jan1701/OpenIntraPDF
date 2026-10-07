#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# Tesseract fuer die Windows-Fassung umpacken (06.10.2026), wie
# einpacken.sh fuer den Mac aus Homebrew:
#
#   - tesseract.exe und genau die DLLs, die es braucht, aus den Paketen von
#     MSYS2 (ucrt64, https://repo.msys2.org). Nur entpacken, nichts
#     ausfuehren; jedes Paket gegen die SHA-256 der Paketdatenbank geprueft.
#     Welche DLLs noetig sind, ergeben die Importe (objdump -p) -- reihum,
#     bis nur noch Windows-eigene DLLs uebrig sind.
#   - Sprachdaten deu, eng, osd und configs/ aus build/tesseract/tessdata
#     (einpacken.sh, tessdata_fast 4.1.0): dieselben Daten wie auf dem Mac,
#     die Erkennung faellt gleich aus.
#   - Lizenztexte je Paket nach lizenzen/<name>-<fassung>.txt; fehlt einer im
#     Paket, der nachgereichte aus tesseract/lizenzen/ (sonst Abbruch).
#
#   tesseract/einpacken-windows.sh      → build/tesseract-windows/
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
ZIEL="$HIER/build/tesseract-windows"
ZWISCHEN="$HIER/build/msys2"
MAC="$HIER/build/tesseract"
[ -f "$MAC/tessdata/deu.traineddata" ] || { echo "✗ $MAC/tessdata fehlt -- zuerst tesseract/einpacken.sh (Mac)"; exit 1; }
command -v zstd >/dev/null || { echo "✗ zstd fehlt"; exit 1; }
rm -rf "$ZIEL"
mkdir -p "$ZIEL/tessdata" "$ZIEL/lizenzen" "$ZWISCHEN"

python3 - "$ZIEL" "$ZWISCHEN" "$HIER/tesseract/lizenzen" <<'PY'
import hashlib, io, os, re, shutil, subprocess, sys, tarfile, urllib.request

ziel, zwischen, repo_lizenzen = sys.argv[1], sys.argv[2], sys.argv[3]
REPO = 'https://repo.msys2.org/mingw/ucrt64/'
VOR = 'mingw-w64-ucrt-x86_64-'

def laden(url, datei):
    if not os.path.exists(datei):
        with urllib.request.urlopen(url) as a, open(datei + '.teil', 'wb') as f:
            shutil.copyfileobj(a, f)
        os.rename(datei + '.teil', datei)
    return datei

def entpacken(datei):
    roh = subprocess.run(['zstd', '-dc', datei], capture_output=True, check=True).stdout
    return tarfile.open(fileobj=io.BytesIO(roh))

def datenbank(name):
    """desc- bzw. files-Eintraege der Paketdatenbank: {Ordner: {FELD: [Werte]}}"""
    tar = entpacken(laden(REPO + name, os.path.join(zwischen, name)))
    eintraege = {}
    for m in tar.getmembers():
        if not m.isfile():
            continue
        ordner, feld = m.name.split('/', 1)
        text = tar.extractfile(m).read().decode('utf-8', 'replace')
        werte, aktuell = {}, None
        for zeile in text.splitlines():
            if re.fullmatch(r'%[A-Z0-9]+%', zeile):
                aktuell = zeile.strip('%'); werte[aktuell] = []
            elif zeile and aktuell:
                werte[aktuell].append(zeile)
        eintraege.setdefault(ordner, {}).update(werte)
    return eintraege

desc = datenbank('ucrt64.db')
files = datenbank('ucrt64.files')
pakete = {e['NAME'][0]: e for e in desc.values()}
dll_paket = {}
for ordner, e in files.items():
    name = desc.get(ordner, {}).get('NAME', [None])[0]
    for f in e.get('FILES', []):
        if re.fullmatch(r'ucrt64/bin/[^/]+\.dll', f, re.I):
            dll_paket[os.path.basename(f).lower()] = name

geholt = {}
def paket(name):
    """Paket laden, Pruefsumme pruefen, entpackten tar zurueck."""
    if name not in geholt:
        e = pakete[name]
        datei = laden(REPO + e['FILENAME'][0], os.path.join(zwischen, e['FILENAME'][0]))
        sha = hashlib.sha256(open(datei, 'rb').read()).hexdigest()
        if sha != e['SHA256SUM'][0]:
            sys.exit(f'✗ Pruefsumme falsch: {name}')
        geholt[name] = entpacken(datei)
    return geholt[name]

def herausholen(name, pfad, nach):
    tar = paket(name)
    m = tar.getmember(pfad)
    with tar.extractfile(m) as q, open(nach, 'wb') as z:
        shutil.copyfileobj(q, z)

def importe(datei):
    aus = subprocess.run(['objdump', '-p', datei], capture_output=True, text=True, check=True).stdout
    return [d.lower() for d in re.findall(r'DLL Name: (\S+)', aus)]

# tesseract.exe und die DLL-Kette
herausholen(VOR + 'tesseract-ocr', 'ucrt64/bin/tesseract.exe', os.path.join(ziel, 'tesseract.exe'))
benutzt = {VOR + 'tesseract-ocr'}
offen, gesehen, windows = [os.path.join(ziel, 'tesseract.exe')], set(), set()
while offen:
    for dll in importe(offen.pop()):
        if dll in gesehen:
            continue
        gesehen.add(dll)
        name = dll_paket.get(dll)
        if not name:
            windows.add(dll)        # kommt mit Windows (KERNEL32, api-ms-win-crt-*, ucrtbase …)
            continue
        echt = next(f for f in files[[o for o, e in desc.items() if e['NAME'][0] == name][0]]['FILES']
                    if f.lower() == 'ucrt64/bin/' + dll)
        nach = os.path.join(ziel, os.path.basename(echt))
        herausholen(name, echt, nach)
        benutzt.add(name)
        offen.append(nach)

# Lizenztexte je Paket (share/licenses/<pkgbase>/)
fehlt = []
for name in sorted(benutzt):
    e = pakete[name]
    kurz = name[len(VOR):]
    tar = paket(name)
    texte = [m for m in tar.getmembers() if m.isfile() and m.name.startswith('ucrt64/share/licenses/')]
    nach = os.path.join(ziel, 'lizenzen', f"{kurz}-{e['VERSION'][0]}.txt")
    if not texte:
        # Manche Pakete legen keinen Text bei (giflib, lz4, libidn2): dann
        # der im Repo nachgereichte fuer genau diese Fassung (wie Leptonica
        # beim Mac), sonst Abbruch.
        upstream = e['VERSION'][0].rsplit('-', 1)[0]
        ersatz = os.path.join(repo_lizenzen, f'{kurz}-{upstream}.txt')
        if not os.path.exists(ersatz):
            fehlt.append(f'{kurz} {upstream}'); continue
        shutil.copy(ersatz, nach)
        continue
    with open(nach, 'wb') as z:
        for i, m in enumerate(texte):
            if i:
                z.write(f'\n\n---- {os.path.basename(m.name)} ----\n\n'.encode())
            z.write(tar.extractfile(m).read())

dlls = sorted(f for f in os.listdir(ziel) if f.lower().endswith('.dll'))
print(f'✓ tesseract.exe + {len(dlls)} DLLs aus {len(benutzt)} MSYS2-Paketen')
print('  Windows-eigene DLLs:', ', '.join(sorted(windows)))
if fehlt:
    sys.exit('✗ ohne Lizenztext: ' + ', '.join(fehlt))
PY

# Sprachdaten und Konfigurationen wie auf dem Mac
cp "$MAC"/tessdata/{deu,eng,osd}.traineddata "$ZIEL/tessdata/"
cp -R "$MAC/tessdata/configs" "$ZIEL/tessdata/"
cp "$MAC/lizenzen/tessdata_fast-4.1.0.txt" "$ZIEL/lizenzen/"
[ -f "$ZIEL/tessdata/configs/tsv" ] || { echo "✗ tessdata/configs/tsv fehlt"; exit 1; }
echo "✓ $ZIEL ($(du -sh "$ZIEL" | cut -f1))"
