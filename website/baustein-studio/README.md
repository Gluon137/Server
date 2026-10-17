# Baustein-Studio

Lokaler 3D-Baustein-Editor mit Fingerzinken und Lasercut-SVGs. Die Oberfläche folgt dem Zahnrad-Studio; Fertigungsprofile und Schnittfugenkorrektur stammen direkt aus Boxes.py.

## Starten

Im Projektverzeichnis:

```bash
./start-baustein-studio.sh
```

Danach **http://127.0.0.1:8765/baustein-studio/** öffnen. Mit Strg+C beenden. Einen anderen Port wählst du mit `./start-baustein-studio.sh --port 8766`.

Voraussetzungen: Python **3.12 oder neuer** und Git. Beim ersten Start installiert das Skript die festgelegten Abhängigkeiten in `.baustein-venv/`; dafür wird Internet benötigt. Anschließend funktionieren Oberfläche, Berechnung und Export ohne externe Dienste. Der lokale Dienst lauscht ausschließlich auf `127.0.0.1`, akzeptiert keine fremden Browser-Ursprünge und liefert nur Dateien unter `website/` aus. Backend-Quelldateien und andere Projektverzeichnisse werden nicht ausgeliefert.

Ein reiner statischer Webserver genügt nicht für die Berechnung. Beim lokalen Start bleiben sämtliche Berechnungen auf deinem Rechner. In der veröffentlichten Server-Version werden Rastergeometrie und Fertigungsparameter für die Berechnung an deinen Server geschickt. Der Dienst speichert keine Entwurfsdateien auf der Festplatte; die automatische Projektsicherung bleibt im Browser.

## Server-Version

Öffentliche Adresse: **https://v2202606364772466585.supersrv.de/baustein-studio/**.

Apache liefert die Oberfläche aus und reicht ausschließlich `/baustein-studio/api/` an den Python-Dienst auf `127.0.0.1:8766` weiter. Der systemd-Dienst `baustein-studio` läuft unter einem eigenen dynamischen Benutzer mit begrenztem Speicher und CPU. Seine Python-Umgebung liegt unter `/opt/baustein-studio/venv`; die Backend-Dateien werden nicht als Webdateien ausgeliefert. Konfigurationsvorlagen: `backend/baustein-studio.service` und `backend/apache-baustein-studio.conf`. Der exakte erlaubte HTTPS-Ursprung wird über `--public-origin` gesetzt; ohne diese Option bleibt der Dienst im bisherigen lokalen Modus.

Lokale und öffentliche Adresse haben getrennte Browsersicherungen. Zum Übertragen „Projekt speichern“ und auf der anderen Seite „Projekt laden“ verwenden.

## Arbeiten

1. **Modell:** Bausteine an Außenflächen hinzufügen, auswählen oder entfernen. Die Maße einer Rasterspalte, -reihe oder -ebene gelten gemeinsam für alle betroffenen Bausteine. Zusammenhängende bündige Außenflächen verschmelzen zu einer Platte. Eine Fläche öffnen entfernt die gesamte erzeugte Platte.
2. **Verbindungen:** Materialstärke messen und einstellen. Zinkenbreite und Zwischenräume wahlweise in Millimetern oder relativ zur Materialstärke eingeben. Randabstände und Spiel bleiben veränderbar. `burn` ist die **halbe** Schnittbreite in Millimetern; größere Werte erzeugen eine strammere Passung. Bei `burn > 0` keine zweite Schnittfugenkorrektur in der Lasersoftware aktivieren.
3. **Montage:** Die tatsächlichen nominalen Schnittteile mit Materialstärke und der geprüften Montagereihenfolge ansehen. Die Anleitung zeigt einzelne Platten, diagonale Bewegungen sowie die Vormontage und das gemeinsame Einsetzen kleiner Baugruppen. Bei Diagonalbewegungen werden die angezeigten Richtungen gleichzeitig ausgeführt. Später benötigte lose Teile bleiben bis zu ihrem Montageschritt ausgeblendet.
4. **Schnittlayout:** Plattengröße, Rand, Abstand und erlaubte 90°-Drehung einstellen. Je Materialplatte eine SVG in Millimetern herunterladen und im Maßstab 1:1 importieren. Innenkonturen zuerst schneiden. Teilekennungen und Maße bleiben Vorschauhilfen und werden nicht als Schnittlinien exportiert.

Entwürfe werden im Browser automatisch gesichert. Zusätzlich kannst du sie als JSON-Projektdatei speichern und wieder öffnen. Bei einem anderen Port oder Browser ist die automatische Sicherung getrennt; die Projektdatei bleibt übertragbar. Ungültige Dateiformate ersetzen den vorhandenen Entwurf nicht.

## Unterstützte Fertigung

Version 1 unterstützt geschlossene oder gezielt geöffnete Quader sowie einfache Stufenformen mit rechteckigen Fingerzinken. Verbindungen werden pro gemeinsamer Kante abgestimmt. Einfache Dreifachecken verwenden die Priorität **Z vor Y vor X**. Tunnel, eingeschlossene Hohlräume, unzulässige Punkt-/Kantenkontakte, problematische Ecktypen, zu enge Materialbereiche und kollidierende oder nicht nachweisbar montierbare Platten sperren den SVG-Export mit einer Fehlermeldung.

Die Montageprüfung verwendet starre Platten und gerade Verschiebungen in 26 Richtungen: entlang der Achsen sowie diagonale Bewegungen über zwei oder drei Achsen. Zunächst werden einzelne Platten, danach zusammenhängende Baugruppen mit zwei oder drei Platten untersucht. Jede Baugruppe benötigt einen eigenen Vormontagenachweis; das bloße Verschieben einer fertigen Gruppe genügt nicht. Die Kollisionsprüfung umfasst die gesamte Bewegungsstrecke und die Vormontage außerhalb des bereits aufgebauten Modells, nicht nur einzelne Animationsbilder.

Ein gescheiterter Nachweis bedeutet, dass die Form mit diesen Richtungen und Gruppengrößen nicht freigegeben wird. Drehungen und gekrümmte Bewegungen werden weiterhin nicht untersucht. Erreicht die Suche ihr Zeit- oder Arbeitsbudget, meldet sie ausdrücklich eine Suchgrenze statt einer unmöglichen Montage. Der bestandene Nachweis ist kein Festigkeitsnachweis. Materialschwankungen und reale Passung erfordern einen Probeschnitt.

Die konservative minimale Zinken-/Stegbreite beträgt `max(0,5 mm, Materialstärke / 4)`. Sie wird an den tatsächlich erzeugten Zinken und den verbleibenden Zwischenräumen nach Spielkorrektur geprüft. Belegte Rasterabschnitte benötigen mindestens zwei Materialstärken plus diesen Steg. Kurze Kanten können deshalb einen größeren Rasterabschnitt oder weniger Spiel erfordern.

## Technik und API

- Statisches HTML/CSS und ES-Module, lokal ausgeliefertes Three.js **0.180.0** mit OrbitControls.
- Python-Standardbibliothek für HTTP, getrennte Berechnungsprozesse mit Zeitlimit und maximal zwei gleichzeitigen Berechnungen.
- Eigener Adapter für Rastertopologie, Plattenzuordnung und Montageprüfung; Boxes.py für Zinken und kompensierte Werkzeugpfade; Shapely für Polygonoperationen und rectpack für das Schnittlayout.
- `GET /baustein-studio/api/health`, `GET /baustein-studio/api/defaults` und `POST /baustein-studio/api/build` mit JSON. Lokal bleiben auch die bisherigen `/api/`-Pfade unterstützt. Fehlerhafte Projekte erhalten HTTP 422; geometrisch unzulässige Modelle erhalten ein Ergebnis mit `valid: false` und gesperrten Schnittdateien.

Projektformat Version 1:

```json
{
  "version": 1,
  "axes": {"x": [100], "y": [100], "z": [100]},
  "cells": [[0, 0, 0]],
  "openFaces": [],
  "joint": {
    "thickness": 4, "finger": 2, "space": 2,
    "relative": true, "surroundingspaces": 2,
    "play": 0, "burn": 0
  },
  "layout": {
    "width": 600, "height": 400,
    "margin": 5, "spacing": 5, "rotate": true
  }
}
```

`openFaces` speichert die zugrunde liegenden Rasterflächen als `i,j,k:axis:sign`, beispielsweise `0,0,0:z:1`. Die Antwort enthält Plattenkonturen in globalen UV-Koordinaten, die Dickenausdehnung `slab`, Fehler, Montagereihenfolge und die SVG-Materialplatten. Nominale Geometrie wird getrennt von kompensierten Werkzeugpfaden berechnet. Maximal 512 Bausteine, 32 Abschnitte je Achse und 3000 mm Gesamtmaß je Achse.

`assembly` enthält jede physische Bauteilkennung einmal. `assemblySteps` enthält den rekursiven Montagenachweis: `panelIds`, den Entnahmevektor `translation` und bei Baugruppen ihre Vormontage unter `steps`. `assemblyOperations` bildet daraus die zeitlich geordnete Anleitung mit `kind` (`panel`, `preassembly`, `group`) und optionaler `groupId`. Der Vektor beschreibt die Ausgangsposition zum Entnehmen; beim Einsetzen wird in Gegenrichtung gefahren. Bei einer Baugruppe werden zuerst ihre inneren Schritte ausgeführt und danach alle Mitglieder gemeinsam eingesetzt. Einfache Bewegungen behalten zusätzlich die bisherigen Felder `panelId`, `axis`, `sign` und `distance`.

## Prüfen

```bash
.baustein-venv/bin/python tests/bausteine.py
.baustein-venv/bin/python tests/baustein-topology.py
.baustein-venv/bin/python tests/baustein-complex.py
.baustein-venv/bin/python tests/baustein-assembly.py
.baustein-venv/bin/python tests/baustein-server.py
node tests/zahnrader.mjs
node tests/drehscheiben-labels.mjs
node tests/bausteine-ui.mjs
node tests/baustein-montage.mjs
```

Die Topologieprüfung vergleicht 2816 Varianten aus 1121 Aufbauten mit einer unabhängigen Prüfung elementarer Bausteinflächen, Kanten und Eckpunkte. Dazu gehören sämtliche nichtleeren 2×2×2-Kombinationen, zufällige Körper mit festem Startwert, Höhenfelder, getrennte Türme, Treppen, Tunnel und Hohlräume sowie Spiegelungen, Achsentausch und Dezimalmaße. Die frühere falsche Kante im leeren Abstand zwischen zwei Türmen ist als Regression dauerhaft enthalten.

Die komplexen Fertigungstests prüfen zusätzlich 45 vollständige Berechnungen mit echten Boxes.py-Profilen: unter anderem drei getrennte Türme, U-/C-/T-Formen, Treppen und Terrassen, veränderte Materialstärken, offene Platten, Spiel und Schnittfugenkorrektur. Kollisionen, vollständige Montagebewegungen und Schnittlayouts werden unabhängig geprüft. Echte Grenzen wie Montageblockaden, nicht unterstützte Ecken, Tunnel und Hohlräume müssen weiterhin den Export sperren und die passende Ursache melden.

Die erweiterten Montagetests sichern vier Ecktürme, Kreuzformen und einen Aufbau ab, der eine vormontierte Zweiergruppe benötigt. Eine unabhängige Zerlegung und eine Gegenprüfung über lineare Optimierung prüfen auch Kollisionen mitten in einer Diagonalbewegung, sehr kurze Kollisionsintervalle, reine Berührungen, unvollständige Vormontagenachweise und den gesamten Ablauf der außerhalb vorbereiteten Baugruppen.

Der vollständige Browsertest in `tests/baustein-browser.mjs` lässt sich mit Playwright ausführen: Das Modul exportiert eine Funktion, die ein `page`-Objekt erhält. Die Playwright-CLI kann denselben Funktionsquelltext nach Entfernen von `export default` über `run-code` ausführen. Er prüft echte Datei-Downloads, Montage, mobile Breiten, überholte Antworten und simulierte HTTP-429/422-Fälle; Screenshots und Beispielausgaben landen unter `output/playwright/`. Der Test verwendet eine eigene Browser-Sitzung und setzt deren lokale Entwürfe zurück.

`tests/baustein-assembly-browser.mjs` prüft zusätzlich vier Ecktürme mit diagonalem Montageschritt, eine notwendige Zweierbaugruppe, Montageanweisungen, Kamerarahmen während der Bewegung und SVG-/Projekt-Downloads.

## Quellen und Lizenzen

Boxes.py: https://github.com/florianfesti/boxes, getesteter Commit `b82a6c9f84ab4b9ee91f5621b95d80b1b4fadf8d`, GPL-3.0-or-later. Unveränderte Lizenz unter `backend/BOXES-LICENSE.txt`; die eigenen Python-Adapter werden ebenfalls unter GPL-3.0-or-later bereitgestellt. Die vollständigen Python-Abhängigkeiten sind in `backend/requirements.txt` festgelegt.

Three.js: https://github.com/mrdoob/three.js/tree/r180, MIT; Lizenz und Prüfsummen unter `vendor/`.

Boxes.py-Dokumentation zu Materialstärke, Spiel und `burn`: https://florianfesti.github.io/boxes/html/usermanual.html.
