// SPDX-License-Identifier: Apache-2.0

package main

import (
	goruntime "runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Standardmenue: Ablage (Oeffnen ⌘O, Sichern ⌘S, Drucken ⌘P, Schliessen
// ⌘W), Bearbeiten, Fenster, Hilfe. Die Eintraege der Ablage schicken ein
// Ereignis an die Oberflaeche, die es an den Arbeitsplatz weitergibt
// (Speichern fragt dort nach Zielen, Schliessen nach dem Entwurf).
//
// Sprache (Jan, 06.10.2026: „das menue sollte in der systemsprache sein“):
// Die Texte kommen aus den Sprachkatalogen der Oberflaeche
// (openintrapdf.desktop.menue.*). Die Oberflaeche waehlt die Sprache des
// Systems und schickt die fertigen Texte mit MenueSprache; bis dahin gilt
// Deutsch. Die Standardmenues von Wails (App, Bearbeiten, Fenster) schreibt
// Wails fest auf Englisch -- die benennt rollenUebersetzen danach nativ um
// (rollen_darwin.go).

// menueStandard sind die Texte, bis die Oberflaeche ihre schickt. Die
// Schluessel sind die unter openintrapdf.desktop.menue, dazu ueberText fuer
// das Info-Fenster.
var menueStandard = map[string]string{
	"ueber": "Über OpenIntraPDF", "ausblenden": "OpenIntraPDF ausblenden", "andereAusblenden": "Andere ausblenden",
	"alleEinblenden": "Alle einblenden", "beenden": "OpenIntraPDF beenden",
	"ablage": "Ablage", "datei": "Datei", "oeffnen": "Öffnen …", "sichern": "Sichern",
	"kopie": "Kopie sichern unter …", "drucken": "Drucken …", "schliessen": "Schließen",
	"bearbeiten": "Bearbeiten", "widerrufen": "Widerrufen", "wiederholen": "Wiederholen",
	"ausschneiden": "Ausschneiden", "kopieren": "Kopieren", "einsetzen": "Einsetzen",
	"einsetzenStil": "Einsetzen und Stil anpassen", "loeschen": "Löschen", "allesAuswaehlen": "Alles auswählen",
	"sprachausgabe": "Sprachausgabe", "sprechenStarten": "Sprachausgabe starten", "sprechenStoppen": "Sprachausgabe stoppen",
	"fenster": "Fenster", "dock": "Im Dock ablegen", "zoomen": "Zoomen", "vollbild": "Vollbild",
	"hilfe": "Hilfe", "lizenzen": "Lizenzen", "web": "OpenIntraHub im Web",
	"ueberText": ueberStandard,
}

// menueText liefert den Text zu einem Schluessel: von der Oberflaeche, sonst
// der deutsche Standard.
func (a *App) menueText(schluessel string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	if t := a.menueTexte[schluessel]; t != "" {
		return t
	}
	return menueStandard[schluessel]
}

func (a *App) menue() *menu.Menu {
	m := menu.NewMenu()
	m.Append(menu.AppMenu())
	// Datei-Menue: auf dem Mac „Ablage“, sonst „Datei“.
	titel := a.menueText("datei")
	if goruntime.GOOS == "darwin" {
		titel = a.menueText("ablage")
	}
	ablage := m.AddSubmenu(titel)
	ablage.AddText(a.menueText("oeffnen"), keys.CmdOrCtrl("o"), func(*menu.CallbackData) { a.menueBefehl("oeffnen") })
	ablage.AddSeparator()
	ablage.AddText(a.menueText("sichern"), keys.CmdOrCtrl("s"), func(*menu.CallbackData) { a.menueBefehl("sichern") })
	ablage.AddText(a.menueText("kopie"), keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey), func(*menu.CallbackData) { a.menueBefehl("kopie") })
	ablage.AddSeparator()
	ablage.AddText(a.menueText("drucken"), keys.CmdOrCtrl("p"), func(*menu.CallbackData) { a.menueBefehl("drucken") })
	ablage.AddSeparator()
	ablage.AddText(a.menueText("schliessen"), keys.CmdOrCtrl("w"), func(*menu.CallbackData) { a.menueBefehl("schliessen") })
	m.Append(menu.EditMenu())
	m.Append(menu.WindowMenu())
	hilfe := m.AddSubmenu(a.menueText("hilfe"))
	// Ein natives Info-Fenster gibt es nur auf dem Mac (App-Menue); unter
	// Linux und Windows zeigt es die Oberflaeche (UeberDialog).
	if goruntime.GOOS != "darwin" {
		hilfe.AddText(a.menueText("ueber"), nil, func(*menu.CallbackData) { a.menueBefehl("ueber") })
		hilfe.AddSeparator()
	}
	// Lizenzen zeigt die Oberflaeche selbst (LizenzenDialog). Vorher oeffnete
	// der Eintrag LIZENZEN.md als file://-Adresse -- auf dem Mac geschah dabei
	// nichts (Jan, 06.10.2026: „unter Lizenzen kommt nichts“).
	hilfe.AddText(a.menueText("lizenzen"), nil, func(*menu.CallbackData) { a.menueBefehl("lizenzen") })
	hilfe.AddText(a.menueText("web"), nil, func(*menu.CallbackData) { runtime.BrowserOpenURL(a.ctx, "https://openintrahub.org") })
	return m
}

// MenueSprache uebernimmt die Texte der Oberflaeche (Sprache des Systems)
// und baut das Menue damit neu. Unbekannte Schluessel bleiben liegen, leere
// Texte zaehlen nicht.
func (a *App) MenueSprache(texte map[string]string) error {
	a.mu.Lock()
	a.menueTexte = map[string]string{}
	for k, v := range texte {
		if _, bekannt := menueStandard[k]; bekannt && v != "" {
			a.menueTexte[k] = v
		}
	}
	fertig := map[string]string{}
	for k := range menueStandard {
		if t := a.menueTexte[k]; t != "" {
			fertig[k] = t
		} else {
			fertig[k] = menueStandard[k]
		}
	}
	a.mu.Unlock()
	if a.ctx == nil {
		return nil
	}
	runtime.MenuSetApplicationMenu(a.ctx, a.menue())
	runtime.MenuUpdateApplicationMenu(a.ctx)
	rollenUebersetzen(fertig)
	return nil
}

// menueBefehl reicht einen Menuebefehl an die Oberflaeche.
func (a *App) menueBefehl(befehl string) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "menue", befehl)
	}
}
