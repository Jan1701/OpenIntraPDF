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
            if (i.geoeffnet) setOffen(i.geoeffnet);
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

    /** Ein Dokument schließen: die Go-Seite vergisst es, die Liste wird neu gelesen. */
    const schliessen = useCallback(() => {
        const o = offenRef.current;
        setOffen(null);
        if (o) void bruecke.Schliessen(o.id).catch(() => undefined);
        listeNeu();
    }, [bruecke, listeNeu]);

    const oeffnen = useCallback(async (holen: () => Promise<Geoeffnet | null>) => {
        setFehler(null);
        setLaedt(true);
        try {
            const g = await holen();
            if (g) {
                setOffen(g);
                listeNeu();
            }
        } catch (e) {
            fehlerZeigen(e);
        } finally {
            setLaedt(false);
        }
    }, [fehlerZeigen, listeNeu]);

    const dialogOeffnen = useCallback(() => void oeffnen(() => bruecke.OeffnenDialog()), [bruecke, oeffnen]);

    // Ereignisse der Go-Seite.
    useEffect(() => {
        const ab = [
            ereignis('geoeffnet', (g: unknown) => {
                const neu = g as Geoeffnet;
                if (neu?.id) {
                    setFehler(null);
                    setOffen(neu);
                    listeNeu();
                }
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
    }, [ereignis, dialogOeffnen, fehlerZeigen, listeNeu]);

    // Fenstertitel wie der Dateiname.
    useEffect(() => {
        document.title = offen ? `${offen.name} – OpenIntraPDF` : 'OpenIntraPDF';
    }, [offen]);

    const host = useMemo(
        () => (offen ? desktopHost(offen.id, bruecke, { rasterer: pdfjsRasterer, person: info?.person, schnelldruck: info?.schnelldruck }) : null),
        [offen, bruecke, info?.person, info?.schnelldruck],
    );

    return (
        <div className="desktop-wurzel">
            {offen && host ? (
                <PdfArbeitsplatz host={host} name={offen.name} onClose={schliessen} befehle={befehle} />
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
