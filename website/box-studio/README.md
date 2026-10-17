# Kästchen-Studio

Parametrische Lasercut-Kisten mit bearbeitbaren Flächen, passenden Zusatzbrettern und einer räumlichen Bewegungsprüfung. Oberfläche und Bibliotheken folgen den anderen Anwendungen der Digitalen Werkstatt.

## Starten

Im Projektordner `./start-box-studio.sh` ausführen und **http://127.0.0.1:8767/box-studio/** öffnen. Mit `--port 8768` lässt sich ein anderer Port wählen. Voraussetzungen sind Python ≥3.12, Git und beim erstmaligen Installieren Internetzugang. Die bereits vorhandene `.baustein-venv` wird mit demselben festgelegten Abhängigkeitensatz wiederverwendet; andernfalls entsteht eine `.box-venv`. Ein rein statischer Webserver liefert die Oberfläche, kann aber keine Schnittteile berechnen.

Alle Entwürfe bleiben in der Browsersicherung oder in heruntergeladenen JSON-Dateien. Berechnungen laufen im lokalen Python-Dienst beziehungsweise in der veröffentlichten Anwendung auf dem eigenen Server. Der Dienst speichert keine Entwürfe dauerhaft. Projekte zwischen unterschiedlichen Adressen über „Projekt speichern/öffnen“ übertragen.

## Konstruieren

1. **Kiste:** Quader, gerundetes Rechteck oder Zylinder wählen. Innen-/Außenmaß, Materialstärke, Spiel und Schnittfuge einstellen. Bei Zylindern ist die Breite der Durchmesser. Runde Formen besitzen abnehmbare Deckel; Quader zusätzlich Schiebe- und Klappdeckel.
2. **Fläche:** Ein Teil im Raum oder über die Auswahl wählen und „Fläche bearbeiten“ öffnen. Maßlinien zeigen Plattenbreite, Höhe und Materialstärke sowie die Abmessungen des ausgewählten Motivs. X/Y messen zur Motivmitte ab der linken beziehungsweise unteren Plattenkante. Runde Löcher zeigen ihren Durchmesser; Lochreihen zusätzlich Anzahl und Teilung. Formen zeichnen, Maße und Bezug ändern, Ausschnitt oder Gravur wählen. SVG-Motive und Text werden in lokale Konturen umgewandelt. Rot markierte Bereiche zeigen Fertigungsfehler; geschützte Biege- und Verbindungsbereiche müssen erhalten bleiben.
3. **Zusatzteile:** Eine Vorlage oder ein freies Brett hinzufügen. Sein Mittelpunkt wird auf der Bezugsfläche verankert; Abstand und lokale XYZ-Winkel bestimmen die räumliche Lage. Festes Maß oder Mitwachsen mit der Bezugsfläche wählen. Rechtwinklige Zapfen-/Schlitzverbindungen erzeugen beide Gegenstücke gemeinsam. Beliebig geneigte Bretter lassen sich mit selbst bemaßten Bohrungen befestigen.
4. **Bewegung:** Bauteile oder Baugruppen gleiten entlang einer Weltachse oder drehen um einen Weltpunkt. Achse, Drehpunkt, Grenzen und Stellung einstellen. Beim Prüfen eines Gelenks bleiben alle anderen Gelenke in ihrer aktuellen Stellung. Die Explosionsansicht ist eine reine Ansichtshilfe.
5. **Fertigung:** Materialbogen, Rand und Teileabstand einstellen. Jede Platte als millimetergenaues SVG herunterladen; Schnitt, Biegeschnitt und Gravur sind getrennte Gruppen. Stückliste und bearbeitbares Projekt separat sichern.

Kantenbezüge verwenden Millimeterabstände nach innen; die Mitte verwendet einen vorzeichenbehafteten Versatz. Relative Bezüge verwenden einen Anteil zwischen 0 und 1 (0,5 entspricht der Mitte). Die Größe eines Lochs bleibt unabhängig von seiner Verankerung; explizit passende Bretter können mitwachsen. Entfernte Bezugsflächen werden als reparierbare Fehler markiert. Zyklische Abhängigkeiten sind unzulässig.

## Geometrie und Fertigung

Die echte nominale Materialgeometrie bildet die Grundlage von Vorschau und Kollisionsprüfung. Werkzeugpfade mit Schnittfugenkorrektur werden separat erzeugt. `burn` bezeichnet wie bei Boxes.py die halbe Schnittbreite; keine zweite Korrektur in der Lasersoftware aktivieren. Schnitt-SVGs sind keine editierbaren Projektdateien. Außenhöhen schließen den Deckel ein; Innenhöhen beziehen sich auf den freien Raum über dem Boden und unter dem Deckel. Zusatzteile können über die Kistenmaße hinausragen.

Gebogene Wände bestehen aus echten abgewickelten Teilen mit offenen Biegeschnitten. Der Zylinder verwendet einen eigenen Manteladapter mit Boden-/Halteringen und einer passenden Naht. Die Ringe und gegebenenfalls Verstärkungen müssen entsprechend der Stückliste verklebt werden. `flexStretch` kalibriert die flache Länge gegenüber dem gebogenen Umfang; ein geometrisch passender Entwurf beweist keine reale Biegbarkeit oder Dauerfestigkeit. Vor der Fertigung einer ganzen Kiste Material, Passung und Biegeradius mit Reststücken prüfen.

Geometrie-, Fertigungs- und Bewegungsstatus werden getrennt behandelt. Bekannte Kollisionen und fehlerhafte Schnittgeometrie sperren den Schnittdownload. **Ungeprüft** bedeutet, dass kein Nachweis vorliegt; Animation allein ist kein Nachweis. Die Prüfung verwendet die Materialstärke und berücksichtigt Löcher durch eine Zerlegung in konvexe Körper. Für starre Schiebe-/Drehbewegungen müssen ganze Bewegungsintervalle geometrisch freigegeben werden. Erreichte Zeit-/Arbeitsgrenzen werden ausdrücklich als ungeprüft zurückgegeben. Rundungen erhalten konservative Hüllkörper mit einer Toleranz für die Kurvenannäherung; knappe Berührungen können deshalb ungeprüft bleiben. Es gibt keinen Elastizitäts-, Kraft- oder Festigkeitslöser. „Zusammenbau“ bleibt ungeprüft, weil eine kollisionsfreie fertige Stellung keinen vollständigen Montagenachweis liefert.

## Dateien, Grenzen und API

Eigenes Projektformat Version 1; bestehende Baustein-/Klappkartenprojekte werden nicht umgedeutet. Die JSON-Datei enthält Ausgangsparameter, stabile Teilkennungen, Bearbeitungen, Bezüge, Gruppen und Bewegungen. Automatische Browserablage unter `box-studio-project-v1`. Fehlerhafte Dateiformate ersetzen den laufenden Entwurf nicht. Grenzen: 128 Zusatzteile, 512 Bearbeitungen, 64 Baugruppen, 128 manuelle Materialpositionen und insgesamt 12000 Konturpunkte; HTTP-Projekte bis 4 MiB. Zusätzliche Geometrie- und Bewegungsbudgets verhindern unbegrenzte Berechnungen.

- `GET /box-studio/api/health`: Dienststatus.
- `GET /box-studio/api/defaults`: Startprojekt.
- `POST /box-studio/api/build`: Ausgangsprojekt als JSON; Antwort mit Teilen, nominalen Konturen, Werkzeugpfaden, Gelenken, Prüfergebnissen, Stückliste und SVG-Platten.

Ungültiges Format erhält HTTP 422. Geometrisch fehlerhafte Entwürfe erhalten eine reguläre Antwort mit `valid:false` und verständlichen Fehlern. Laufende Berechnungen sind begrenzt; bei Auslastung HTTP 429, bei Überschreitung des Berechnungsbudgets ein Fehler statt einer Freigabe. Antworten älterer Entwürfe dürfen neuere Änderungen nicht ersetzen.

Der Dienst lauscht nur auf Loopback und erlaubt ausschließlich den eigenen Browserursprung. Apache reicht öffentlich nur `/box-studio/api/` weiter. Backend-Dateien werden nicht als Webinhalte ausgeliefert. Die Vorlagen liegen in `backend/box-studio.service` und `backend/apache-box-studio.conf`; das Veröffentlichungsskript `.server-tools/deploy-box-studio.py` sichert Bestand und Konfiguration und stellt sie bei Fehlern wieder her. Öffentlich verwendete Three.js- und SVG-/Schriftbibliotheken liegen weiterhin in den bestehenden Studioverzeichnissen.

## Prüfen

```sh
node tests/box-project.mjs
.baustein-venv/bin/python tests/box-geometry.py
.baustein-venv/bin/python tests/box-motion.py
.baustein-venv/bin/python tests/box-server.py
```

Browserprüfungen verwenden eine isolierte Playwright-Sitzung. Ergebnisse und Screenshots liegen unter `output/playwright/`. Die Tests umfassen Maße, Konturen/Bohrungen, Deckelfamilien, Bezüge, Bewegungen, Projektdateien, Download-SVGs und schmale Ansichten. Physische Probeschnitte sind nicht automatisiert.

Zusätzliche unabhängige Prüfungen: `.baustein-venv/bin/python tests/box-integration.py` und `node website/box-studio/tests/test_surface.mjs`. Die Browserfunktion `runBoxBrowserTests(page, baseURL)` liegt in `tests/box-browser.mjs` innerhalb des Studioverzeichnisses und akzeptiert eine vorhandene Playwright-Seite.

## Quellen und Lizenzen

[Boxes.py](https://github.com/florianfesti/boxes), festgelegter Commit `b82a6c9f84ab4b9ee91f5621b95d80b1b4fadf8d`, GPL-3.0-or-later; Lizenz unter `backend/BOXES-LICENSE.txt`. Eigene Python-Geometrieadapter verwenden dieselbe Lizenz. Three.js r180 ist MIT-lizenziert; Paper.js und OpenType.js sowie Noto Sans stammen aus den vorhandenen lokalen Bibliotheken. Ihre Lizenzdateien verbleiben jeweils im zugehörigen `vendor`-Verzeichnis.
