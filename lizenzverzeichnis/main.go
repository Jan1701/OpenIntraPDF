// SPDX-License-Identifier: Apache-2.0

// Lizenzverzeichnis legt beim Bau die Lizenztexte aller mitgelieferten Teile
// in die App und schreibt dazu verzeichnis.json (06.10.2026).
//
// Anlass: Der Menuepunkt „Lizenzen“ zeigte nichts, und LIZENZEN.md nannte nur
// Tesseract und die Schrift. In der App stecken aber auch rund dreissig
// Go-Module (Wails, pdfcpu …) und die JavaScript-Pakete der Oberflaeche
// (React, pdf.js …), deren Lizenzen (MIT, BSD, Apache) verlangen, dass ihr
// Text beiliegt.
//
// Quellen:
//
//	-ocr      Ordner mit den Texten aus tesseract/einpacken.sh (<name>-<fassung>.txt)
//	-schrift  OFL.txt der eingebetteten Noto Sans
//	-js       build/js-pakete.json aus vite.desktop.config.ts
//	Go        go list -deps im Ordner der App (gebaute Tags), dazu GOROOT/LICENSE
//
//	go run ./lizenzverzeichnis -aus <App>/Contents/Resources/lizenzen -ocr … -schrift … -js …
//
// Fehlt zu einem Teil der Lizenztext, bricht das Werkzeug ab: Eine App ohne
// den Text darf so nicht weitergegeben werden.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// Eintrag ist ein Teil im Verzeichnis; Datei liegt neben verzeichnis.json.
type Eintrag struct {
	Gruppe  string `json:"gruppe"` // ocr, schrift, go, js
	Name    string `json:"name"`
	Fassung string `json:"fassung"`
	Lizenz  string `json:"lizenz"`
	Datei   string `json:"datei"`
}

func main() {
	aus := flag.String("aus", "", "Zielordner (Contents/Resources/lizenzen)")
	ocr := flag.String("ocr", "", "Ordner mit den Tesseract-Lizenztexten")
	schrift := flag.String("schrift", "", "OFL.txt der eingebetteten Schrift")
	js := flag.String("js", "", "js-pakete.json aus dem Vite-Bau")
	tags := flag.String("tags", "desktop,production", "Build-Tags der App fuer go list")
	goos := flag.String("goos", "", "Zielsystem fuer go list (leer: dieses), z. B. linux, windows")
	goarch := flag.String("goarch", "", "Zielarchitektur fuer go list (leer: diese)")
	flag.Parse()
	if *aus == "" {
		fehler("-aus fehlt")
	}
	if err := os.MkdirAll(*aus, 0o755); err != nil {
		fehler(err.Error())
	}

	var liste []Eintrag
	if *ocr != "" {
		liste = append(liste, ocrTeile(*ocr)...)
	}
	if *schrift != "" {
		text := lesen(*schrift)
		liste = append(liste, ablegen(*aus, Eintrag{Gruppe: "schrift", Name: "Noto Sans", Lizenz: "OFL-1.1"}, text))
	}
	liste = append(liste, goTeile(*aus, *tags, *goos, *goarch)...)
	if *js != "" {
		liste = append(liste, jsTeile(*aus, *js)...)
	}

	sort.SliceStable(liste, func(i, j int) bool {
		if liste[i].Gruppe != liste[j].Gruppe {
			return gruppenRang(liste[i].Gruppe) < gruppenRang(liste[j].Gruppe)
		}
		return strings.ToLower(liste[i].Name) < strings.ToLower(liste[j].Name)
	})
	b, _ := json.MarshalIndent(liste, "", " ")
	if err := os.WriteFile(filepath.Join(*aus, "verzeichnis.json"), b, 0o644); err != nil {
		fehler(err.Error())
	}
	zahl := map[string]int{}
	for _, e := range liste {
		zahl[e.Gruppe]++
	}
	fmt.Printf("✓ Lizenzverzeichnis: %d Teile (Texterkennung %d, Schrift %d, Go %d, JavaScript %d)\n",
		len(liste), zahl["ocr"], zahl["schrift"], zahl["go"], zahl["js"])
}

func gruppenRang(g string) int {
	return map[string]int{"ocr": 0, "schrift": 1, "go": 2, "js": 3}[g]
}

// ocrTeile: Die Texte aus einpacken.sh liegen schon im Zielordner der App
// (bauen.sh kopiert sie), Name und Fassung stehen im Dateinamen.
func ocrTeile(ordner string) []Eintrag {
	dateien, err := filepath.Glob(filepath.Join(ordner, "*.txt"))
	if err != nil {
		fehler(err.Error())
	}
	muster := regexp.MustCompile(`^(.+?)-(\d[\w.]*)\.txt$`)
	var liste []Eintrag
	for _, d := range dateien {
		basis := filepath.Base(d)
		name, fassung := strings.TrimSuffix(basis, ".txt"), ""
		if m := muster.FindStringSubmatch(basis); m != nil {
			name, fassung = m[1], m[2]
		}
		lizenz := ocrLizenz[name]
		if lizenz == "" {
			lizenz = lizenzErkennen(lesen(d))
		}
		liste = append(liste, Eintrag{Gruppe: "ocr", Name: name, Fassung: fassung, Lizenz: lizenz, Datei: basis})
	}
	return liste
}

// ocrLizenz: Bei diesen Paketen ist der Text eine Uebersicht ueber mehrere
// Lizenzen; mitgeliefert ist jeweils nur die Bibliothek (Tabelle in
// LIZENZEN.md).
var ocrLizenz = map[string]string{
	"lz4": "BSD-2-Clause", // nur lib/ (liblz4); programs/ waere GPL-2.0, ist nicht dabei
	"xz":  "0BSD",         // nur liblzma
}

// goTeile: alle Module, die in die App gelinkt werden, ohne die eigenen
// (openintrahub.org/…), dazu die Standardbibliothek.
//
// Fuer ein anderes Zielsystem (der Linux-Bau laeuft im Container, die
// Lizenzen entstehen hier, weil nur hier node_modules liegt) zaehlt go list
// mit GOOS/GOARCH und CGO_ENABLED=1 -- Wails braucht cgo, ohne fehlten die
// Module des Linux-Teils.
func goTeile(aus, tags, goos, goarch string) []Eintrag {
	befehl := exec.Command("go", "list", "-deps", "-tags", tags, "-f", "{{with .Module}}{{.Path}}|{{.Version}}|{{.Dir}}{{end}}", ".")
	befehl.Stderr = os.Stderr
	befehl.Env = os.Environ()
	if goos != "" {
		befehl.Env = append(befehl.Env, "GOOS="+goos, "CGO_ENABLED=1")
	}
	if goarch != "" {
		befehl.Env = append(befehl.Env, "GOARCH="+goarch)
	}
	roh, err := befehl.Output()
	if err != nil {
		fehler("go list: " + err.Error())
	}
	gesehen := map[string]bool{}
	var liste []Eintrag
	s := bufio.NewScanner(bytes.NewReader(roh))
	for s.Scan() {
		teile := strings.SplitN(s.Text(), "|", 3)
		if len(teile) != 3 || gesehen[teile[0]] || strings.HasPrefix(teile[0], "openintrahub.org/") {
			continue
		}
		gesehen[teile[0]] = true
		text := lizenztextIn(teile[2])
		if text == "" {
			fehler("kein Lizenztext fuer Go-Modul " + teile[0] + " in " + teile[2])
		}
		liste = append(liste, ablegen(aus, Eintrag{Gruppe: "go", Name: teile[0], Fassung: teile[1], Lizenz: lizenzErkennen(text)}, text))
	}
	std := lesen(filepath.Join(runtime.GOROOT(), "LICENSE"))
	liste = append(liste, ablegen(aus, Eintrag{Gruppe: "go", Name: "Go (Standardbibliothek)", Fassung: strings.TrimPrefix(runtime.Version(), "go"), Lizenz: lizenzErkennen(std)}, std))
	return liste
}

type jsPaket struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	License string `json:"license"`
	Dir     string `json:"dir"`
}

func jsTeile(aus, datei string) []Eintrag {
	var pakete []jsPaket
	if err := json.Unmarshal([]byte(lesen(datei)), &pakete); err != nil {
		fehler(datei + ": " + err.Error())
	}
	var liste []Eintrag
	for _, p := range pakete {
		text := lizenztextIn(p.Dir)
		if text == "" {
			fehler("kein Lizenztext fuer npm-Paket " + p.Name + " in " + p.Dir)
		}
		lizenz := p.License
		if lizenz == "" {
			lizenz = lizenzErkennen(text)
		}
		liste = append(liste, ablegen(aus, Eintrag{Gruppe: "js", Name: p.Name, Fassung: p.Version, Lizenz: lizenz}, text))
	}
	return liste
}

// lizenztextIn sucht LICENSE/LICENCE/COPYING (mit und ohne Endung) im Ordner
// und haengt eine NOTICE an, wenn es eine gibt (Apache-2.0 verlangt das).
func lizenztextIn(ordner string) string {
	eintraege, err := os.ReadDir(ordner)
	if err != nil {
		return ""
	}
	var lizenz, hinweis string
	for _, e := range eintraege {
		if e.IsDir() {
			continue
		}
		n := strings.ToUpper(e.Name())
		basis := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(n, ".MD"), ".TXT"), ".RST")
		switch {
		case lizenz == "" && (basis == "LICENSE" || basis == "LICENCE" || basis == "COPYING" || basis == "LICENSE-MIT"):
			lizenz = lesen(filepath.Join(ordner, e.Name()))
		case hinweis == "" && basis == "NOTICE":
			hinweis = lesen(filepath.Join(ordner, e.Name()))
		}
	}
	if lizenz != "" && hinweis != "" {
		return lizenz + "\n\n---- NOTICE ----\n\n" + hinweis
	}
	return lizenz
}

// lizenzErkennen nennt die Lizenz nach dem Wortlaut -- nur als Beschriftung;
// massgeblich ist der Text daneben.
func lizenzErkennen(text string) string {
	t := strings.ToLower(text)
	switch {
	case strings.Contains(t, "apache license") && strings.Contains(t, "version 2.0"):
		return "Apache-2.0"
	case strings.Contains(t, "png reference library license version 2"):
		return "libpng-2.0"
	case strings.Contains(t, "sil open font license"):
		return "OFL-1.1"
	case strings.Contains(t, "mozilla public license"):
		return "MPL-2.0"
	case strings.Contains(t, "isc license") || strings.Contains(t, "permission to use, copy, modify, and/or distribute"):
		return "ISC"
	case strings.Contains(t, "permission is hereby granted, free of charge"):
		return "MIT"
	case strings.Contains(t, "redistribution and use in source and binary forms"):
		if strings.Contains(t, "neither the name") || strings.Contains(t, "names of its contributors") {
			return "BSD-3-Clause"
		}
		return "BSD-2-Clause"
	case strings.Contains(t, "creative commons") && strings.Contains(t, "cc0"):
		return "CC0-1.0"
	}
	return ""
}

var unerlaubt = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// ablegen schreibt den Text als <gruppe>-<name>.txt und liefert den Eintrag.
func ablegen(aus string, e Eintrag, text string) Eintrag {
	e.Datei = e.Gruppe + "-" + strings.Trim(unerlaubt.ReplaceAllString(e.Name, "_"), "_") + ".txt"
	if err := os.WriteFile(filepath.Join(aus, e.Datei), []byte(text), 0o644); err != nil {
		fehler(err.Error())
	}
	return e
}

func lesen(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		fehler(err.Error())
	}
	return string(b)
}

func fehler(text string) {
	fmt.Fprintln(os.Stderr, "✗ lizenzverzeichnis:", text)
	os.Exit(1)
}
