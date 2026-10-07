// SPDX-License-Identifier: Apache-2.0
//
// OpenIntraPDF auf dem Schreibtisch: ein Fenster, ein Dokument. Ohne
// Dokument der Startbildschirm, mit Dokument der Arbeitsplatz aus
// OpenIntraHub — mit dem Desktop-Gastgeber (DesktopHost.ts) statt Drive.
//
// Die Go-Seite meldet sich über Ereignisse: `geoeffnet` (Finder, Drag &
// Drop, Kommandozeile), `oeffnenFehler` und `menue` (Ablage-Menü). Die
// Menübefehle Sichern, Drucken, Schließen gehen an den Arbeitsplatz über
// seine `befehle`-Referenz — dieselben Abläufe wie seine Knöpfe, samt
// Rückfrage bei offenem Entwurf.
//
// Ein zweites Dokument (Öffnen-Dialog, Zuletzt, Finder, Drag & Drop)
// ersetzt das offene über denselben Weg wie Schließen: Es wartet, bis der
// Arbeitsplatz schließt — mit offenem Entwurf erst nach der Rückfrage. Bis
// Bau 2342 ersetzte es den Entwurf ohne Rückfrage, und die Go-Seite vergaß das
// alte Dokument nie (Review 07.10.2026).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PdfArbeitsplatz } from '../openintrapdf/PdfArbeitsplatz';
import type { PdfArbeitsplatzBefehle } from '../openintrapdf/PdfArbeitsplatz';
import { desktopHost, hostFehler } from './DesktopHost';
import { pdfjsRasterer } from './rastern';
import { Start } from './Start';
import { LizenzenDialog } from './LizenzenDialog';
import { UeberDialog } from './UeberDialog';
import { menueTexte } from './menue';
import type { Bruecke, Geoeffnet, StartInfo, ZuletztEintrag } from './bruecke';

interface Props {
    bruecke: Bruecke;
    /** Ein Ereignis der Go-Seite abonnieren. */
    ereignis: (name: string, cb: (...daten: unknown[]) => void) => () => void;
}

export function App({ bruecke, ereignis }: Props) {
    const { t } = useTranslation();
    const [info, setInfo] = useState<StartInfo | null>(null);
    const [zuletzt, setZuletzt] = useState<ZuletztEintrag[]>([]);
    const [offen, setOffen] = useState<Geoeffnet | null>(null);
    const [laedt, setLaedt] = useState(false);
    const [fehler, setFehler] = useState<string | null>(null);
    const [lizenzenOffen, setLizenzenOffen] = useState(false);
    const [ueberOffen, setUeberOffen] = useState(false);
    const befehle = useRef<PdfArbeitsplatzBefehle>(null);
    const offenRef = useRef(offen);
    offenRef.current = offen;
    /** Das Dokument, das nach dem Schließen des offenen kommt. */
    const wartend = useRef<Geoeffnet | null>(null);

    const fehlerZeigen = useCallback((e: unknown) => {
        const f = hostFehler(e);
        setFehler(f.meldung || t('openintrapdf.desktop.fehler.oeffnen'));
    }, [t]);

    // Beim Start: Person, Erkennung, Liste — und eine Datei, die das System
    // schon übergeben hat.
    useEffect(() => {
        let aus = false;
        bruecke.Start().then(i => {
            if (aus) return;
            setInfo(i);
            setZuletzt(i.zuletzt);
            if (i.geoeffnet && !offenRef.current) {
                offenRef.current = i.geoeffnet;
                setOffen(i.geoeffnet);
            }
        }, e => { if (!aus) fehlerZeigen(e); });
        return () => { aus = true; };
    }, [bruecke, fehlerZeigen]);

    // Menü in der Sprache der App (menue.ts). Erst nach Start(): Das
    // Info-Fenster nennt Fassung und Bau, die die Go-Seite dort liefert.
    useEffect(() => {
        if (!info) return;
        void bruecke.MenueSprache(menueTexte(t, info)).catch(() => undefined);
    }, [bruecke, info, t]);

    const listeNeu = useCallback(() => {
        bruecke.Zuletzt().then(setZuletzt, () => undefined);
    }, [bruecke]);

    /**
     * Ein Dokument schließen: die Go-Seite vergisst es, die Liste wird neu
     * gelesen. Wartet ein zweites, kommt es jetzt.
     */
    const schliessen = useCallback(() => {
        const o = offenRef.current;
        const naechstes = wartend.current;
        wartend.current = null;
        offenRef.current = naechstes;
        setOffen(naechstes);
        if (o) void bruecke.Schliessen(o.id).catch(() => undefined);
        listeNeu();
    }, [bruecke, listeNeu]);

    /** Die Rückfrage endete ohne Schließen: Das wartende Dokument entfällt. */
    const schliessenAbgebrochen = useCallback(() => {
        wartend.current = null;
    }, []);

    /**
     * Ein geöffnetes Dokument zeigen. Ist schon eines offen, schließt der
     * Arbeitsplatz es zuerst (samt Rückfrage bei offenem Entwurf); dieselbe
     * Datei noch einmal ändert nichts. Die Go-Seite vergisst ein wartendes
     * Dokument nicht: Es kann zugleich Quelle des offenen Entwurfs sein.
     */
    const zeigen = useCallback((neu: Geoeffnet) => {
        setFehler(null);
        const alt = offenRef.current;
        if (alt?.id === neu.id) return;
        if (!alt) {
            offenRef.current = neu;
            setOffen(neu);
            listeNeu();
            return;
        }
        wartend.current = neu;
        if (befehle.current) befehle.current.schliessen();
        else schliessen();
    }, [listeNeu, schliessen]);

    const oeffnen = useCallback(async (holen: () => Promise<Geoeffnet | null>) => {
        setFehler(null);
        setLaedt(true);
        try {
            const g = await holen();
            if (g) zeigen(g);
        } catch (e) {
            fehlerZeigen(e);
        } finally {
            setLaedt(false);
        }
    }, [fehlerZeigen, zeigen]);

    const dialogOeffnen = useCallback(() => void oeffnen(() => bruecke.OeffnenDialog()), [bruecke, oeffnen]);

    // Ereignisse der Go-Seite.
    useEffect(() => {
        const ab = [
            ereignis('geoeffnet', (g: unknown) => {
                const neu = g as Geoeffnet;
                if (neu?.id) zeigen(neu);
            }),
            ereignis('oeffnenFehler', (e: unknown) => fehlerZeigen(e)),
            ereignis('menue', (befehl: unknown) => {
                switch (befehl) {
                    case 'oeffnen':
                        dialogOeffnen();
                        break;
                    case 'sichern':
                        befehle.current?.speichern();
                        break;
                    case 'kopie':
                        // Ohne Knopf im Arbeitsplatz (kein herunterladen am
                        // Gastgeber): direkt der native Sichern-Dialog.
                        if (offenRef.current) bruecke.KopieSichern(offenRef.current.id).catch(fehlerZeigen);
                        break;
                    case 'drucken':
                        befehle.current?.drucken();
                        break;
                    case 'schliessen':
                        if (offenRef.current) befehle.current?.schliessen();
                        break;
                    case 'lizenzen':
                        setUeberOffen(false);
                        setLizenzenOffen(true);
                        break;
                    case 'ueber':
                        setUeberOffen(true);
                        break;
                }
            }),
        ];
        return () => ab.forEach(f => f());
    }, [ereignis, dialogOeffnen, fehlerZeigen, zeigen]);

    // Fenstertitel wie der Dateiname.
    useEffect(() => {
        document.title = offen ? `${offen.name} – OpenIntraPDF` : 'OpenIntraPDF';
    }, [offen]);

    const host = useMemo(
        () => (offen ? desktopHost(offen.id, bruecke, {
            rasterer: pdfjsRasterer, person: info?.person, schnelldruck: info?.schnelldruck, browserDruck: info?.system === 'windows',
        }) : null),
        [offen, bruecke, info?.person, info?.schnelldruck, info?.system],
    );

    return (
        <div className="desktop-wurzel">
            {offen && host ? (
                <PdfArbeitsplatz key={offen.id} host={host} name={offen.name} onClose={schliessen}
                    onSchliessenAbgebrochen={schliessenAbgebrochen} befehle={befehle} />
            ) : (
                <Start info={info} zuletzt={zuletzt} laedt={laedt} fehler={fehler} onOeffnen={dialogOeffnen}
                    onZuletzt={s => void oeffnen(() => bruecke.ZuletztOeffnen(s))} />
            )}
            {ueberOffen && info && (
                <UeberDialog fassung={info} onSchliessen={() => setUeberOffen(false)}
                    onLizenzen={() => { setUeberOffen(false); setLizenzenOffen(true); }} />
            )}
            {lizenzenOffen && <LizenzenDialog bruecke={bruecke} onSchliessen={() => setLizenzenOffen(false)} />}
        </div>
    );
}
