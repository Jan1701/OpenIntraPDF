// SPDX-License-Identifier: Apache-2.0

package dokument

import (
	"context"
	"errors"
	"math"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Jan1701/OpenIntraPDF/kern/korpus"
)

// Die Textebene ohne Dienst: Woerter, Zeilen, Bloecke und ihre Lage im
// angezeigten Raum — an den Korpusdateien.

func woerterText(z Textzeile) string {
	teile := make([]string, len(z.Woerter))
	for i, w := range z.Woerter {
		teile[i] = w.Text
	}
	return strings.Join(teile, " ")
}

func TestTextebeneLesenTextseite(t *testing.T) {
	seiten, err := TextebeneLesen(context.Background(), korpus.Textseiten(2), []int{0})
	if err != nil {
		t.Fatal(err)
	}
	if len(seiten) != 1 || seiten[0].Nr != 0 || seiten[0].Breite != 595 || seiten[0].Hoehe != 842 || seiten[0].Bild || seiten[0].Unlesbar {
		t.Fatalf("Seite %+v", seiten)
	}
	s := seiten[0]
	// Zwei Bloecke: „Musterfirma GmbH“ (18 pt) und „Rechnung 00123 -
	// SEITE-01“ (12 pt), 30 pt auseinander.
	if len(s.Bloecke) != 2 || len(s.Bloecke[0]) != 1 || len(s.Bloecke[1]) != 1 {
		t.Fatalf("Bloecke %+v", s.Bloecke)
	}
	if got := woerterText(s.Bloecke[0][0]); got != "Musterfirma GmbH" {
		t.Errorf("Zeile 1 %q", got)
	}
	if got := woerterText(s.Bloecke[1][0]); got != "Rechnung 00123 - SEITE-01" {
		t.Errorf("Zeile 2 %q", got)
	}
	// Lage: Grundlinie bei 760 im Benutzerraum, Schrift 18 -> im
	// angezeigten Raum oben bei 842-760-14,4 = 67,6, unten bei 85,6.
	w := s.Bloecke[0][0].Woerter[0]
	if w.X0 != 72 || math.Abs(w.Y0-67.6) > 0.01 || math.Abs(w.Y1-85.6) > 0.01 || w.X1 < 72+80 || w.X1 > 72+110 {
		t.Errorf("Lage von %q: %v", w.Text, w)
	}
	if s.Woerter() != 6 {
		t.Errorf("%d Woerter, erwartet 6", s.Woerter())
	}
	// Alle Seiten ohne Angabe.
	alle, err := TextebeneLesen(context.Background(), korpus.Textseiten(2), nil)
	if err != nil || len(alle) != 2 || alle[1].Nr != 1 {
		t.Errorf("alle Seiten: %d %v", len(alle), err)
	}
	if _, err := TextebeneLesen(context.Background(), korpus.Textseiten(2), []int{5}); err == nil {
		t.Error("Seite 6 von 2 ohne Fehler")
	}
}

// Die Rechnung des Korpus: Tabelle mit rechtsbuendigen Betraegen, Bloecke
// nach Abstand und Schriftgroesse.
func TestTextebeneLesenRechnung(t *testing.T) {
	seiten, err := TextebeneLesen(context.Background(), korpus.Rechnung(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(seiten) != 3 {
		t.Fatalf("%d Seiten", len(seiten))
	}
	s := seiten[0]
	// Bloecke von oben: Kopfzeile, Ueberschrift, Anschrift, Absatz,
	// Tabelle, Fusszeile.
	if len(s.Bloecke) != 6 {
		for i, b := range s.Bloecke {
			t.Logf("Block %d: %d Zeilen, erste %q", i, len(b), woerterText(b[0]))
		}
		t.Fatalf("%d Bloecke, erwartet 6", len(s.Bloecke))
	}
	tab := s.Bloecke[4]
	if len(tab) != 4 || woerterText(tab[0]) != "Pos Artikel Menge Betrag" || woerterText(tab[2]) != "2 Schreibtisch 1 1.249,50" {
		t.Errorf("Tabelle %+v", tab)
	}
	// Rechte Kante der Betraege bei 520, der Mengen bei 400 (±1 pt).
	for _, z := range tab {
		n := len(z.Woerter)
		if math.Abs(z.Woerter[n-1].X1-520) > 1 || math.Abs(z.Woerter[n-2].X1-400) > 1 {
			t.Errorf("rechte Kanten in %q: %v %v", woerterText(z), z.Woerter[n-2].X1, z.Woerter[n-1].X1)
		}
	}
	if woerterText(s.Bloecke[5][0]) != "Seite 1 von 3 - SEITE-01" || s.Bloecke[5][0].Woerter[0].Y0 < 790 {
		t.Errorf("Fusszeile %+v", s.Bloecke[5])
	}
	if got := woerterText(seiten[2].Bloecke[2][0]); got != "Die Zahlung erfolgt innerhalb von 14 Tagen nach Rech-" {
		t.Errorf("Seite 3 Absatz %q", got)
	}
}

// Scan: keine Woerter, aber ein Bild. Gedreht mit CropBox: Masse
// getauscht, Woerter innerhalb der angezeigten Flaeche.
func TestTextebeneLesenScanUndGedreht(t *testing.T) {
	scan, err := TextebeneLesen(context.Background(), korpus.Scan(korpus.A4), nil)
	if err != nil || len(scan) != 1 || !scan[0].Bild || scan[0].Woerter() != 0 {
		t.Errorf("Scan: %v %+v", err, scan)
	}
	gedreht, err := TextebeneLesen(context.Background(), korpus.GedrehtMitCropBox(), []int{0})
	if err != nil {
		t.Fatal(err)
	}
	g := gedreht[0]
	if g.Breite != 746 || g.Hoehe != 523 {
		t.Errorf("Masse %g x %g, erwartet 746 x 523", g.Breite, g.Hoehe)
	}
	if g.Woerter() == 0 {
		t.Fatal("keine Woerter auf der gedrehten Seite")
	}
	for _, b := range g.Bloecke {
		for _, z := range b {
			for _, w := range z.Woerter {
				if w.X0 < 0 || w.Y0 < 0 || w.X1 > g.Breite || w.Y1 > g.Hoehe {
					t.Errorf("%q liegt ausserhalb: %v", w.Text, w)
				}
			}
		}
	}
}

// Die praeparierte Datei aus #243: 21 KB, ein Flate-Strom aus 20 x
// (1 MiB "A") Tj. Ohne Grenzen kostete HatTextebene 74 Sekunden und 7 GB
// (TotalAlloc 14 GB); jetzt endet es in unter einer Sekunde mit false,
// und die Spitze bleibt unter 100 MiB. Dazu die Grenzen je Seite
// (Glyphen), je Dokument und die Zeit.
func TestHatTextebeneTextbombe(t *testing.T) {
	ctx := context.Background()
	messung := func(name string, datei []byte, f func() (bool, error)) {
		t.Helper()
		runtime.GC()
		var vorher runtime.MemStats
		runtime.ReadMemStats(&vorher)
		spitze := vorher.HeapAlloc
		stop, fertig := make(chan struct{}), make(chan struct{})
		go func() {
			defer close(fertig)
			takt := time.NewTicker(2 * time.Millisecond)
			defer takt.Stop()
			for {
				select {
				case <-stop:
					return
				case <-takt.C:
					var m runtime.MemStats
					runtime.ReadMemStats(&m)
					spitze = max(spitze, m.HeapAlloc)
				}
			}
		}()
		start := time.Now()
		hat, err := f()
		dauer := time.Since(start)
		close(stop)
		<-fertig
		var nachher runtime.MemStats
		runtime.ReadMemStats(&nachher)
		spitze = max(spitze, nachher.HeapAlloc)
		t.Logf("%s: Datei %d Byte, Dauer %v, hat=%v err=%v, Spitze HeapAlloc +%d MiB, TotalAlloc +%d MiB",
			name, len(datei), dauer.Round(time.Millisecond), hat, err, (spitze-vorher.HeapAlloc)>>20, (nachher.TotalAlloc-vorher.TotalAlloc)>>20)
		if hat {
			t.Errorf("%s: Textebene erkannt", name)
		}
		if dauer > time.Second {
			t.Errorf("%s: %v, erlaubt sind unter einer Sekunde", name, dauer)
		}
		if spitze-vorher.HeapAlloc > 100<<20 {
			t.Errorf("%s: Spitze %d MiB ueber dem Ausgangswert, erlaubt sind 100", name, (spitze-vorher.HeapAlloc)>>20)
		}
		if nachher.TotalAlloc-vorher.TotalAlloc > 100<<20 {
			t.Errorf("%s: %d MiB angefordert, erlaubt sind 100", name, (nachher.TotalAlloc-vorher.TotalAlloc)>>20)
		}
	}
	// n=20 (der Befund): 20 MiB entpackt — die Stromgrenze greift, bevor etwas ausgewertet wird.
	bombe := korpus.Textbombe(1, 20, 1<<20)
	if len(bombe) > 64<<10 {
		t.Fatalf("die Bombe ist %d Byte gross — sie soll klein sein", len(bombe))
	}
	messung("n=20, Stromgrenze", bombe, func() (bool, error) { return HatTextebene(ctx, bombe, []int{0}) })
	// n=2: 2 MiB entpackt, unter der Stromgrenze — hier greift die Glyphengrenze je Seite.
	klein := korpus.Textbombe(1, 2, 1<<20)
	messung("n=2, Glyphengrenze je Seite", klein, func() (bool, error) { return HatTextebene(ctx, klein, nil) })
	// TextebeneLesen nennt so eine Seite unlesbar — ohne Fehler, wie bei einem Absturz der Bibliothek.
	texte, err := TextebeneLesen(ctx, klein, nil)
	if err != nil || len(texte) != 1 || !texte[0].Unlesbar || texte[0].Woerter() != 0 {
		t.Errorf("TextebeneLesen der Bombe: %v %+v", err, texte)
	}
	// Dokumentgrenze: elf Seiten mit je 190.000 Glyphen (unter der Seitengrenze) sind zusammen zu viel.
	viele := korpus.Textbombe(11, 1, 190_000)
	start := time.Now()
	if _, err := TextebeneLesen(ctx, viele, nil); !errors.Is(err, ErrTextebeneZuGross) || !errors.Is(err, ErrZuGross) {
		t.Errorf("Dokumentgrenze: %v", err)
	}
	t.Logf("Dokumentgrenze (11 x 190.000 Glyphen): %v", time.Since(start).Round(time.Millisecond))
	// Zehn Seiten davon gehen durch: die Grenze je Seite ist nicht gerissen.
	if texte, err := TextebeneLesen(ctx, viele, []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}); err != nil || len(texte) != 10 || texte[9].Unlesbar || texte[9].Woerter() != 1 {
		t.Errorf("zehn Seiten unter der Grenze: %v", err)
	}
	// Zeitgrenze: Ein abgelaufener Kontext endet mit seinem Fehler, nicht mit false.
	abgelaufen, abbrechen := context.WithDeadline(ctx, time.Now().Add(-time.Second))
	defer abbrechen()
	if _, err := HatTextebene(abgelaufen, korpus.Textseiten(1), nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("abgelaufener Kontext: %v", err)
	}
	// Normale Dateien bleiben lesbar.
	if hat, err := HatTextebene(ctx, korpus.Rechnung(), nil); err != nil || !hat {
		t.Errorf("Rechnung: %v %v", hat, err)
	}
	if hat, err := HatTextebene(ctx, korpus.Scan(korpus.A4), nil); err != nil || hat {
		t.Errorf("Scan: %v %v", hat, err)
	}
}
