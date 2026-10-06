// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Jan1701/OpenIntraPDF/kern/dokument"
)

// Die Ablage ist das, was in Drive die Datenbank macht — fuer eine App,
// deren „Fassung“ die geoeffnete Datei auf der Platte ist (Vertrag
// Etappe 6):
//
//   - Jede Datei bekommt eine kurze, zufaellige Kennung. Die Webseite sieht
//     nur Kennungen, nie Pfade; Pfade kommen ausschliesslich aus nativen
//     Dialogen, Drag & Drop oder dem Oeffnen aus dem Finder (Sicherheit,
//     Konzept Kap. 07).
//   - „Speichern“ ueberschreibt atomar: Nebendatei im selben Ordner, fsync,
//     rename. Ein Absturz mittendrin laesst die alte Datei unversehrt.
//   - Konfliktschutz wie CAS: Hat sich die Datei seit dem Laden geaendert
//     (Groesse, Aenderungszeit, dann SHA-256), antwortet die Bindung so, wie
//     die Oberflaeche es von 412 kennt. „Als neue Datei“ baut dann aus den
//     Bytes, die die Person vor sich hatte.
//   - Ziele (Ordner aus dem Sichern-Dialog) bekommen ebenfalls Kennungen.

// Datei ist eine geoeffnete Datei.
type Datei struct {
	ID   string
	Pfad string
	Name string
	// Version zaehlt ab 1 je Oeffnen und steigt mit jedem Speichern — die
	// Oberflaeche schickt sie als expected_version zurueck.
	Version int
	// Stand der geladenen Bytes, wie er auf der Platte lag.
	Groesse   int64
	Geaendert time.Time
	SHA256    string
	// Basis sind die geladenen Bytes: Grundlage jedes Befehls und der
	// Rueckhalt fuer „als neue Datei“ nach einem Konflikt.
	Basis []byte
}

// Ablage haelt die geoeffneten Dateien und die gewaehlten Ziele.
type Ablage struct {
	mu      sync.Mutex
	dateien map[string]*Datei
	ziele   map[string]string
}

func neueAblage() *Ablage {
	return &Ablage{dateien: map[string]*Datei{}, ziele: map[string]string{}}
}

// kennung ist eine zufaellige, nicht erratbare Kennung.
func kennung() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// pruefsumme ist die SHA-256 als Hex.
func pruefsumme(inhalt []byte) string {
	s := sha256.Sum256(inhalt)
	return hex.EncodeToString(s[:])
}

// Oeffnen liest die Datei und registriert sie. Ist derselbe Pfad schon
// offen, wird der Eintrag neu geladen und behaelt seine Kennung — ein
// zweites Fenster gibt es nicht, und zwei Kennungen fuer eine Datei
// koennten sich beim Speichern ueberholen.
func (a *Ablage) Oeffnen(pfad string) (*Datei, error) {
	abs, err := filepath.Abs(pfad)
	if err != nil {
		return nil, err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, fmt.Errorf("%s ist ein Ordner", abs)
	}
	if st.Size() > dokument.HoechstBytes {
		return nil, dokument.ErrZuGross
	}
	inhalt, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	if !bytes.Contains(inhalt[:min(len(inhalt), 1024)], []byte("%PDF-")) {
		return nil, dokument.ErrKeinPDF
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	var d *Datei
	for _, e := range a.dateien {
		if e.Pfad == abs {
			d = e
			break
		}
	}
	if d == nil {
		d = &Datei{ID: kennung(), Pfad: abs, Name: filepath.Base(abs)}
		a.dateien[d.ID] = d
	}
	d.Version = max(d.Version, 0) + 1
	d.standSetzen(st, inhalt)
	return d, nil
}

// standSetzen uebernimmt Bytes und Plattenstand in den Eintrag.
func (d *Datei) standSetzen(st os.FileInfo, inhalt []byte) {
	d.Groesse = st.Size()
	d.Geaendert = st.ModTime()
	d.SHA256 = pruefsumme(inhalt)
	d.Basis = inhalt
}

// Datei liefert den Eintrag zu einer Kennung; unbekannt heisst, es gibt
// ihn nicht — auch fuer einen Pfad, der irgendwo auf der Platte liegt.
func (a *Ablage) Datei(id string) (*Datei, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	d, ok := a.dateien[id]
	if !ok {
		return nil, nichtGefunden()
	}
	return d, nil
}

// Vergessen nimmt eine Datei aus der Ablage (Dokument geschlossen).
func (a *Ablage) Vergessen(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.dateien, id)
}

// ZielAnlegen registriert einen Ordner aus einem Sichern-Dialog.
func (a *Ablage) ZielAnlegen(ordner string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, o := range a.ziele {
		if o == ordner {
			return id
		}
	}
	id := kennung()
	a.ziele[id] = ordner
	return id
}

// Ziel liefert den Ordner zu einer Zielkennung.
func (a *Ablage) Ziel(id string) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	o, ok := a.ziele[id]
	if !ok {
		return "", nichtGefunden()
	}
	return o, nil
}

// errKonflikt: Die Datei auf der Platte ist nicht mehr die geladene.
var errKonflikt = errors.New("ablage: Datei inzwischen geaendert")

// plattenstand prueft, ob die Datei auf der Platte noch die geladene ist:
// erst Groesse und Aenderungszeit (billig), bei Abweichung die Pruefsumme
// (ein blosses touch ist kein Konflikt). Liefert den Stand fuer den Fall,
// dass der Eintrag ihn nachziehen darf.
func (d *Datei) plattenstand() (os.FileInfo, error) {
	st, err := os.Stat(d.Pfad)
	if err != nil {
		return nil, err
	}
	if st.Size() == d.Groesse && st.ModTime().Equal(d.Geaendert) {
		return st, nil
	}
	inhalt, err := os.ReadFile(d.Pfad)
	if err != nil {
		return nil, err
	}
	if pruefsumme(inhalt) != d.SHA256 {
		return nil, errKonflikt
	}
	return st, nil
}

// Ueberschreiben ersetzt die Datei atomar durch inhalt — nur, wenn die
// Oberflaeche die geladene Fassung meint UND die Platte sie noch traegt.
// Danach ist inhalt die neue Basis, Version + 1.
func (a *Ablage) Ueberschreiben(d *Datei, inhalt []byte, erwarteteVersion int, erwarteteSHA string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if erwarteteVersion != d.Version || (erwarteteSHA != "" && !strings.EqualFold(erwarteteSHA, d.SHA256)) {
		return konflikt(d.Version)
	}
	if _, err := d.plattenstand(); err != nil {
		if errors.Is(err, errKonflikt) {
			return konflikt(d.Version)
		}
		return intern(err)
	}
	if err := atomarSchreiben(d.Pfad, inhalt); err != nil {
		return intern(err)
	}
	st, err := os.Stat(d.Pfad)
	if err != nil {
		return intern(err)
	}
	d.Version++
	d.standSetzen(st, inhalt)
	return nil
}

// BasisFuer liefert die Bytes, aus denen ein Befehl baut. Fuer eine neue
// Fassung muss die Platte noch die geladene Fassung tragen; fuer eine neue
// Datei genuegt die geladene Basis — genau das bietet die Oberflaeche nach
// einem Konflikt an („Als neue Datei speichern“).
func (a *Ablage) BasisFuer(d *Datei, erwarteteVersion int, erwarteteSHA string, neueFassung bool) ([]byte, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if erwarteteVersion != d.Version || (erwarteteSHA != "" && !strings.EqualFold(erwarteteSHA, d.SHA256)) {
		return nil, konflikt(d.Version)
	}
	if neueFassung {
		if _, err := d.plattenstand(); err != nil {
			if errors.Is(err, errKonflikt) {
				return nil, konflikt(d.Version)
			}
			return nil, intern(err)
		}
	}
	return d.Basis, nil
}

// atomarSchreiben schreibt inhalt in eine Nebendatei im selben Ordner,
// fsync, und benennt sie ueber die Zieldatei — kein halber Stand, falls
// mittendrin der Strom weg ist.
func atomarSchreiben(pfad string, inhalt []byte) error {
	ordner := filepath.Dir(pfad)
	neben, err := os.CreateTemp(ordner, "."+filepath.Base(pfad)+".*.tmp")
	if err != nil {
		return err
	}
	name := neben.Name()
	aufraeumen := func() { os.Remove(name) }
	if _, err := neben.Write(inhalt); err != nil {
		neben.Close()
		aufraeumen()
		return err
	}
	if err := neben.Sync(); err != nil {
		neben.Close()
		aufraeumen()
		return err
	}
	if err := neben.Close(); err != nil {
		aufraeumen()
		return err
	}
	// Rechte der alten Datei behalten (CreateTemp legt 0600 an).
	if st, err := os.Stat(pfad); err == nil {
		_ = os.Chmod(name, st.Mode().Perm())
	} else {
		_ = os.Chmod(name, 0o644)
	}
	if err := os.Rename(name, pfad); err != nil {
		aufraeumen()
		return err
	}
	return nil
}

// neueDateiSchreiben legt inhalt unter ordner/name ab. Ist der Name
// belegt, weicht es aus (" (2)" …) — wie Drive beim Anlegen.
func neueDateiSchreiben(ordner, name string, inhalt []byte) (string, error) {
	stamm := strings.TrimSuffix(name, filepath.Ext(name))
	endung := filepath.Ext(name)
	pfad := filepath.Join(ordner, name)
	for i := 2; ; i++ {
		f, err := os.OpenFile(pfad, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if errors.Is(err, os.ErrExist) {
			pfad = filepath.Join(ordner, fmt.Sprintf("%s (%d)%s", stamm, i, endung))
			if i > 999 {
				return "", fmt.Errorf("kein freier Name fuer %s", name)
			}
			continue
		}
		if err != nil {
			return "", err
		}
		if _, err := f.Write(inhalt); err != nil {
			f.Close()
			os.Remove(pfad)
			return "", err
		}
		if err := f.Sync(); err != nil {
			f.Close()
			os.Remove(pfad)
			return "", err
		}
		if err := f.Close(); err != nil {
			os.Remove(pfad)
			return "", err
		}
		return pfad, nil
	}
}

// dateinameMitEndung macht aus einer Angabe der Maske einen Dateinamen
// mit der Endung (mit Punkt): ohne Pfad, hoechstens 200 Zeichen — wie
// drive.dateinameMitEndung.
func dateinameMitEndung(angabe, ersatz, endung string) string {
	name := strings.TrimSpace(filepath.Base(strings.ReplaceAll(angabe, "\\", "/")))
	if name == "" || name == "." || name == "/" {
		name = ersatz
	}
	if !strings.EqualFold(filepath.Ext(name), endung) {
		name += endung
	}
	if r := []rune(name); len(r) > 200 {
		name = string(r[:200-len([]rune(endung))]) + endung
	}
	return name
}

// stamm ist der Dateiname ohne .pdf.
func stamm(name string) string {
	if strings.EqualFold(filepath.Ext(name), ".pdf") {
		return name[:len(name)-4]
	}
	return name
}
