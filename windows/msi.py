#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# WiX-Quelle (v3-Schema, fuer wixl aus msitools) fuer das MSI von
# OpenIntraPDF erzeugen (06.10.2026).
#
#   windows/msi.py <Paketordner> <Fassung> <Bau> [<Pfad beim Bauen>] > openintrapdf.wxs
#
# Gelesen wird der Paketordner hier; die Quellen im MSI zeigen auf den Pfad,
# unter dem wixl ihn sieht (im Container /paket).
#
# Der Paketordner ist das, was nach „C:\Program Files\OpenIntraPDF“ kommt:
# OpenIntraPDF.exe, LICENSE, lizenzen\, tesseract\ (tesseract.exe, DLLs,
# tessdata\). Jede Datei bekommt eine eigene Komponente; ihre GUID haengt
# an Pfad UND Fassung (siehe guid()).
#
# Das MSI
#   - installiert fuer alle Benutzer nach Programme\OpenIntraPDF,
#   - legt einen Eintrag im Startmenue an,
#   - traegt .pdf unter „Oeffnen mit“ ein und meldet die App unter
#     „Standard-Apps“ an -- ohne sich selbst zum Standard zu machen,
#   - bricht mit einer Meldung ab, wenn die WebView2-Laufzeit fehlt,
#   - ersetzt eine aeltere Fassung (feste UpgradeCode, NIE aendern).
import os
import sys
import uuid
from xml.sax.saxutils import escape, quoteattr

UPGRADE_CODE = '66DC0AA5-9557-4339-96B6-AB4662317987'   # fest, nie aendern
NS = uuid.UUID('6f1d0f5e-3b8e-4a0f-9a55-0b1d7c3c2e10')
WEBVIEW2 = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'

ordner, fassung, bau = sys.argv[1], sys.argv[2], sys.argv[3]
quelle_wurzel = sys.argv[4] if len(sys.argv) > 4 else ordner
# MSI zaehlt nur die ersten drei Stellen; der Bau steht in der vierten und
# AllowSameVersionUpgrades sorgt dafuer, dass ein neuer Bau ersetzt.
version = f'{fassung}.{bau or 0}'


def pe_fassung(datei):
    """Dateiversion aus VS_FIXEDFILEINFO einer exe/dll, sonst None.

    wixl traegt sie nicht ins MSI ein (06.10.2026, Test-VM). Ohne sie haelt
    Windows Installer unsere exe und DLLs fuer unversioniert -- bei einer
    Aktualisierung „gewinnt“ dann die alte, versionierte Datei auf der
    Platte („same component with higher versioned keyfile exists“), die
    neue wird nicht eingespielt und verschwindet mit der alten Fassung.
    """
    if not datei.lower().endswith(('.exe', '.dll')):
        return None
    roh = open(datei, 'rb').read()
    stelle = roh.find(b'\xbd\x04\xef\xfe')
    if stelle < 0 or stelle + 16 > len(roh):
        return None
    ms = int.from_bytes(roh[stelle + 8:stelle + 12], 'little')
    ls = int.from_bytes(roh[stelle + 12:stelle + 16], 'little')
    return f'{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}'


def kennung(praefix, pfad):
    return praefix + '_' + uuid.uuid5(NS, pfad.lower()).hex[:20]


def guid(pfad):
    # Je Fassung eigene Komponenten-GUIDs (06.10.2026, Test-VM): Mit
    # gleichen GUIDs ueber alle Bauten sah Windows Installer die
    # Komponenten als schon installiert (Action: Null), entfernte danach
    # die alte Fassung -- und die neue legte exe und DLLs nie an. Da die
    # alte Fassung vorher ganz entfernt wird (MajorUpgrade
    # afterInstallInitialize), ist das sauber.
    return str(uuid.uuid5(NS, f'komponente:{version}:' + pfad.lower())).upper()


zeilen = []
komponenten = []


def verzeichnis(rel, tiefe):
    einrueck = '  ' * tiefe
    eintraege = sorted(os.listdir(os.path.join(ordner, rel) if rel else ordner))
    for name in eintraege:
        pfad = os.path.join(rel, name) if rel else name
        voll = os.path.join(ordner, pfad)
        if os.path.isdir(voll):
            zeilen.append(f'{einrueck}<Directory Id="{kennung("D", pfad)}" Name={quoteattr(name)}>')
            verzeichnis(pfad, tiefe + 1)
            zeilen.append(f'{einrueck}</Directory>')
            continue
        kid = kennung('C', pfad)
        fid = 'OpenIntraPDFExe' if pfad == 'OpenIntraPDF.exe' else kennung('F', pfad)
        komponenten.append(kid)
        quelle = quoteattr(quelle_wurzel.rstrip('/') + '/' + pfad.replace(os.sep, '/'))
        fv = pe_fassung(voll)
        fassung_attr = f' DefaultVersion="{fv}"' if fv else ''
        zeilen.append(f'{einrueck}<Component Id="{kid}" Guid="{guid(pfad)}" Win64="yes">')
        if fid == 'OpenIntraPDFExe':
            zeilen.append(f'{einrueck}  <File Id="{fid}" Name="OpenIntraPDF.exe" Source={quelle}{fassung_attr} KeyPath="yes">')
            zeilen.append(f'{einrueck}    <Shortcut Id="StartmenueEintrag" Directory="ProgramMenuFolder" Name="OpenIntraPDF" '
                          f'WorkingDirectory="INSTALLDIR" Icon="Programmsymbol" Advertise="yes"/>')
            zeilen.append(f'{einrueck}  </File>')
            zeilen.extend(f'{einrueck}  {z}' for z in registrierung())
        else:
            zeilen.append(f'{einrueck}  <File Id="{fid}" Name={quoteattr(name)} Source={quelle}{fassung_attr} KeyPath="yes"/>')
        zeilen.append(f'{einrueck}</Component>')


def registrierung():
    """.pdf unter „Oeffnen mit“ und „Standard-Apps“ (nicht als Standard setzen)."""
    befehl = escape('"[INSTALLDIR]OpenIntraPDF.exe" "%1"', {'"': '&quot;'})
    symbol = escape('[INSTALLDIR]OpenIntraPDF.exe,0')
    return [
        '<RegistryKey Root="HKLM" Key="Software\\Classes\\OpenIntraPDF.PDF">',
        '  <RegistryValue Type="string" Value="PDF-Dokument (OpenIntraPDF)"/>',
        f'  <RegistryValue Key="DefaultIcon" Type="string" Value="{symbol}"/>',
        f'  <RegistryValue Key="shell\\open\\command" Type="string" Value="{befehl}"/>',
        '</RegistryKey>',
        '<RegistryValue Root="HKLM" Key="Software\\Classes\\.pdf\\OpenWithProgids" Name="OpenIntraPDF.PDF" Type="string" Value=""/>',
        '<RegistryValue Root="HKLM" Key="Software\\Classes\\Applications\\OpenIntraPDF.exe\\SupportedTypes" Name=".pdf" Type="string" Value=""/>',
        '<RegistryKey Root="HKLM" Key="Software\\OpenIntraPDF\\Capabilities">',
        '  <RegistryValue Name="ApplicationName" Type="string" Value="OpenIntraPDF"/>',
        '  <RegistryValue Name="ApplicationDescription" Type="string" Value="PDF lesen, ordnen, kommentieren, Text erkennen"/>',
        '  <RegistryValue Key="FileAssociations" Name=".pdf" Type="string" Value="OpenIntraPDF.PDF"/>',
        '</RegistryKey>',
        '<RegistryValue Root="HKLM" Key="Software\\RegisteredApplications" Name="OpenIntraPDF" Type="string" Value="Software\\OpenIntraPDF\\Capabilities"/>',
    ]


verzeichnis('', 6)
symboldatei = quoteattr(os.environ.get('OIPDF_SYMBOL', 'icon.ico'))
print(f'''<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="OpenIntraPDF" Language="1031" Codepage="1252" Version="{version}"
           Manufacturer="Jan Günther" UpgradeCode="{UPGRADE_CODE}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine"
             Description="OpenIntraPDF {escape(fassung)} (Bau {escape(bau)})" Manufacturer="Jan Günther" Languages="1031"/>
    <Media Id="1" Cabinet="openintrapdf.cab" EmbedCab="yes"/>
    <!-- Die alte Fassung ZUERST ganz entfernen, dann die neue einspielen
         (06.10.2026 in der Test-VM): Spaet entfernt (Standard) ueberging
         Windows Installer die gleich benannten, gleich versionierten Dateien
         der neuen Fassung und loeschte sie dann mit der alten; danach
         fehlten OpenIntraPDF.exe, zehn DLLs und die .pdf-Zuordnung. -->
    <!-- Dazu REINSTALLMODE mit e: Windows Installer entscheidet VOR dem
         Entfernen, welche Dateien es kopiert; gleich versionierte (exe und
         versionierte DLLs) galten als vorhanden und fehlten danach. e kopiert
         auch bei gleicher Fassung. Betrifft nur unseren Ordner. -->
    <Property Id="REINSTALLMODE" Value="emus"/>
    <MajorUpgrade AllowSameVersionUpgrades="yes" Schedule="afterInstallInitialize"
                  DowngradeErrorMessage="Eine neuere Fassung von OpenIntraPDF ist bereits installiert."/>

    <Property Id="WEBVIEW2_MASCHINE">
      <RegistrySearch Id="SucheWebView2Maschine" Root="HKLM" Key="SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2}" Name="pv" Type="raw" Win64="yes"/>
    </Property>
    <Property Id="WEBVIEW2_BENUTZER">
      <RegistrySearch Id="SucheWebView2Benutzer" Root="HKCU" Key="Software\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2}" Name="pv" Type="raw"/>
    </Property>
    <Condition Message="OpenIntraPDF braucht die Microsoft-Edge-WebView2-Laufzeit. Sie gehört zu Windows 11 und den meisten Windows-10-Rechnern; sonst bitte von https://go.microsoft.com/fwlink/p/?LinkId=2124703 installieren.">
      Installed OR WEBVIEW2_MASCHINE OR WEBVIEW2_BENUTZER
    </Condition>

    <Icon Id="Programmsymbol" SourceFile={symboldatei}/>
    <Property Id="ARPPRODUCTICON" Value="Programmsymbol"/>
    <Property Id="ARPURLINFOABOUT" Value="https://github.com/Jan1701/OpenIntraPDF"/>
    <Property Id="ARPHELPLINK" Value="https://github.com/Jan1701/OpenIntraPDF/issues"/>
    <Property Id="ARPCONTACT" Value="Jan Günther"/>

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramMenuFolder"/>
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="OpenIntraPDF">
{chr(10).join(zeilen)}
        </Directory>
      </Directory>
    </Directory>

    <Feature Id="Programm" Title="OpenIntraPDF" Level="1">
{chr(10).join(f'      <ComponentRef Id="{k}"/>' for k in komponenten)}
    </Feature>
  </Product>
</Wix>''')
