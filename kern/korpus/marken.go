// SPDX-License-Identifier: Apache-2.0

package korpus

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

var markenMuster = regexp.MustCompile(`SEITE-\d\d`)

// Marken liest die Seitenmarken ("SEITE-NN") eines PDFs in
// Seitenreihenfolge — fuer Tests, die pruefen, welche Quellseite nach dem
// Umsortieren wo steht. Eine Seite ohne Marke liefert "".
func Marken(pdf []byte) ([]string, error) {
	konf := model.NewStatelessConfiguration()
	konf.Offline = true
	c := context.Background()
	ctx, err := api.ReadAndValidate(c, bytes.NewReader(pdf), konf)
	if err != nil {
		return nil, err
	}
	aus := make([]string, 0, ctx.PageCount)
	for i := 1; i <= ctx.PageCount; i++ {
		d, _, _, err := ctx.PageDict(c, i, false)
		if err != nil {
			return nil, fmt.Errorf("Seite %d: %w", i, err)
		}
		inhalt, err := ctx.PageContent(d, i)
		if errors.Is(err, model.ErrNoContent) {
			// Eine leere Seite (Etappe 9) hat keinen Inhalt und keine Marke.
			aus = append(aus, "")
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("Seite %d: %w", i, err)
		}
		aus = append(aus, markenMuster.FindString(string(inhalt)))
	}
	return aus, nil
}
