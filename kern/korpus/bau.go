// SPDX-License-Identifier: Apache-2.0

package korpus

import (
	"bytes"
	"fmt"
	"strings"
)

// bau schreibt ein PDF von Hand: Objekte als Text, Querverweistabelle und
// Abschluss werden gerechnet.
//
// # Warum nicht mit pdfcpu
//
// Der Korpus prueft den pdfcpu-Adapter. Erzeugte ihn dieselbe Bibliothek,
// saehe jeder Test nur, dass pdfcpu seine eigene Ausgabe versteht — und
// jede Eigenheit ihres Schreibers waere im Pruefgut schon eingebaut. Von
// Hand gebaut steht in der Datei genau das, was hier steht: Annotationen,
// Formularfelder, Anhaenge und Lesezeichen so, wie andere Programme sie
// schreiben. Nur das Verschluesseln uebernimmt pdfcpu (verschluesselt.go);
// RC4/AES von Hand waere ein eigenes Projekt.
type bau struct {
	objekte []string // Index = Objektnummer - 1
}

// reservieren vergibt eine Objektnummer, deren Inhalt spaeter kommt —
// noetig fuer Verweise im Kreis (Seite -> Annotation -> Seite).
func (b *bau) reservieren() int {
	b.objekte = append(b.objekte, "")
	return len(b.objekte)
}

// setzen fuellt eine reservierte Nummer.
func (b *bau) setzen(nr int, inhalt string) {
	b.objekte[nr-1] = inhalt
}

// neu legt ein Objekt an und liefert seine Nummer.
func (b *bau) neu(inhalt string) int {
	nr := b.reservieren()
	b.setzen(nr, inhalt)
	return nr
}

// strom legt ein Datenstromobjekt an. dict ist der Inhalt des Woerterbuchs
// ohne << >> und ohne /Length.
func (b *bau) strom(dict string, daten string) int {
	return b.neu(fmt.Sprintf("<< %s /Length %d >>\nstream\n%s\nendstream", dict, len(daten), daten))
}

// ref schreibt einen Verweis.
func ref(nr int) string { return fmt.Sprintf("%d 0 R", nr) }

// refs schreibt eine Verweisliste.
func refs(nrn ...int) string {
	teile := make([]string, len(nrn))
	for i, nr := range nrn {
		teile[i] = ref(nr)
	}
	return "[" + strings.Join(teile, " ") + "]"
}

// fertig setzt Kopf, Objekte, Querverweistabelle und Abschluss zusammen.
// Die Dokumentkennung ist fest: Gleicher Aufruf, gleiche Bytes.
func (b *bau) fertig(katalog, info int, version string) []byte {
	var aus bytes.Buffer
	fmt.Fprintf(&aus, "%%PDF-%s\n%%\xe2\xe3\xcf\xd3\n", version)
	versatz := make([]int, len(b.objekte))
	for i, inhalt := range b.objekte {
		if inhalt == "" {
			panic(fmt.Sprintf("korpus: Objekt %d reserviert, aber nie gefuellt", i+1))
		}
		versatz[i] = aus.Len()
		fmt.Fprintf(&aus, "%d 0 obj\n%s\nendobj\n", i+1, inhalt)
	}
	xref := aus.Len()
	fmt.Fprintf(&aus, "xref\n0 %d\n0000000000 65535 f \n", len(b.objekte)+1)
	for _, v := range versatz {
		fmt.Fprintf(&aus, "%010d 00000 n \n", v)
	}
	kennung := fmt.Sprintf("%032x", len(b.objekte)*7919+katalog)
	fmt.Fprintf(&aus, "trailer\n<< /Size %d /Root %s", len(b.objekte)+1, ref(katalog))
	if info > 0 {
		fmt.Fprintf(&aus, " /Info %s", ref(info))
	}
	fmt.Fprintf(&aus, " /ID [<%s> <%s>] >>\nstartxref\n%d\n%%%%EOF\n", kennung, kennung, xref)
	return aus.Bytes()
}

// pdfText maskiert eine Zeichenkette fuer ein PDF-Stringliteral. Der
// Korpus benutzt nur ASCII — Umlaute in Seiteninhalten braeuchten eine
// Kodierungstabelle, und die ist nicht Gegenstand dieser Proben.
func pdfText(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `(`, `\(`, `)`, `\)`)
	return "(" + r.Replace(s) + ")"
}
