# Eingebettete Schrift: Noto Sans Regular und Bold

Die beiden TrueType-Dateien werden per `go:embed` in `oihd` eingebunden
(`schrift.go`). Sie zeichnen Textfeld, Post-it und Stempel, sobald ein Text
Zeichen enthält, die WinAnsi (Helvetica) nicht kennt — Polnisch, Tschechisch,
Griechisch, Bulgarisch, Ukrainisch usw. Ins PDF kommt nur eine Teilmenge der
benutzten Glyphen (Type0, Identity-H, ToUnicode).

## Herkunft

- Projekt: Noto Latin, Greek, Cyrillic — https://github.com/notofonts/latin-greek-cyrillic
- Fassung: **NotoSans v2.015** (Release-Tag `NotoSans-v2.015`, 20.11.2024)
- Archiv: https://github.com/notofonts/latin-greek-cyrillic/releases/download/NotoSans-v2.015/NotoSans-v2.015.zip
- Dateien daraus, unverändert übernommen:
  - `NotoSans/unhinted/ttf/NotoSans-Regular.ttf` → `NotoSans-Regular.ttf`
  - `NotoSans/unhinted/ttf/NotoSans-Bold.ttf` → `NotoSans-Bold.ttf`
  - `OFL.txt` → `OFL.txt`

Die ungehinteten Schnitte sind gewählt, weil ein PDF-Programm keine
TrueType-Hints braucht und die Dateien ein Drittel kleiner sind.

## SHA-256 (Stand 30.09.2026)

```
f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8  NotoSans-Regular.ttf
87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9  NotoSans-Bold.ttf
cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a  OFL.txt
```

Prüfen: `shasum -a 256 *.ttf OFL.txt`

## Lizenz

Copyright 2022 The Noto Project Authors
(https://github.com/notofonts/latin-greek-cyrillic).
SIL Open Font License 1.1, Volltext in `OFL.txt`. Es ist kein Reserved Font
Name erklärt. Die Dateien liegen hier unverändert; verschlankt (ohne
GPOS/GSUB/GDEF und ohne Glyphnamen in `post`) werden sie erst zur Laufzeit
im Speicher, bevor pdfcpu sie liest — siehe `sfntVerschlanken` in
`schrift.go`. Eintrag in der Drittlizenzliste: `NOTICE` im Repo-Wurzelordner.
