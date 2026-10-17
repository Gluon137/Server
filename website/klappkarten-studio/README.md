# Klappkarten-Studio

Browserwerkstatt zum Zeichnen von Flächen auf verschiebbaren Ebenen im 3D-Raum und zum Fertigen aus **einem einzigen Kartenrohling**. Die bisherigen Motiv-, Treppen-, Spiral- und Linieneditoren bleiben verfügbar. Motive, senkrechte Motivstege und Dachstege werden aus derselben Karte geschnitten und gefaltet. Es gibt keine separat ausgeschnittenen Motive, Träger oder Klebelaschen. Motivbearbeitung, Schnittgeometrie, Vorschau und SVG-Export laufen im Browser mit lokal mitgelieferten Bibliotheken.

## Lokal starten

Im Hauptverzeichnis des Repositories:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Danach [http://127.0.0.1:8765/klappkarten-studio/](http://127.0.0.1:8765/klappkarten-studio/) öffnen. Ein HTTP-Server ist für ES-Module und die Schriftdatei erforderlich.

## Flächen direkt im Raum gestalten

Der Hauptarbeitsplatz **Im Raum gestalten** zeigt die geöffnete Karte mit Zeichenraster und den zugehörigen Schnittbogen dauerhaft nebeneinander. Das Startbeispiel **Architektur im Raum** enthält zwei Fassaden und eine waagerechte Terrasse. **Leere Raumkarte** beziehungsweise **Neuen Flächenentwurf beginnen** startet einen leeren Flächenentwurf.

1. **Zeichenebene:** Links senkrecht (Fassade) oder waagerecht (Terrasse) wählen. Zahlenfeld und Schieberegler verschieben die Ebene parallel zur Rückwand beziehungsweise zum Boden. Das Raster bestimmt die Schrittweite in echten Millimetern.
2. **Zeichnen:** **Polygon zeichnen**, Eckpunkte auf dem räumlichen Raster anklicken, mit Enter oder **Fertig** übernehmen. **Rechteck** benötigt zwei gegenüberliegende Ecken oder einen Ziehvorgang. Backspace entfernt einen noch offenen Punkt, Escape beziehungsweise **Abbrechen** verwirft den offenen Entwurf. Mit der rechten Maustaste die Ansicht drehen, mit dem Mausrad zoomen.
3. **Bearbeiten:** **Auswählen** aktivieren, eine Fläche im Raum, in der Flächenliste oder im Schnittbogen wählen. Eckpunkte lassen sich direkt auf der Ebene ziehen. Rechts Name, räumlichen Abstand, Papierfarbe und Stegbreite ändern. Eine Flächenauswahl stellt ihre Zeichenebene ein. Änderungen der Zeichenebene links betreffen die nächste Zeichnung; **Abstand/Höhe** rechts verschiebt die ausgewählte Fläche.
4. **Papierkonstruktion:** Zu jeder gezeichneten Fläche entstehen integrale Stützflächen und schmale Materialstege. Sie bleiben sichtbar und werden aus demselben Blatt geschnitten. Die genaue Umrissform bleibt erhalten; nötige Verbindungsstreifen können die Zeichnung erweitern. Löcher aus Projektkonturen bleiben Schnittabfall. Bei Überlagerungen hat die oberste Fläche in der Liste Vorrang. **Vorne/Zurück** ändert diese Reihenfolge. Wenn dadurch ein Papieranschluss verloren geht oder zu schmal wird, ist der Schnittdownload gesperrt.
5. **Aufklappen:** 0° geschlossen, 90° aufgestellt, 180° ursprünglicher flacher Schnittbogen. Zeichnen und Eckpunktbearbeitung sind bei 90° möglich; **90° · Zeichnen** kehrt dorthin zurück. Die Winkel ändern keine Fertigungsdaten. **Schnittbogen** und **Falten** zeigen die größere Vorlage und Arbeitsfolge.

Offene Flächen werden vor Ansichtswechsel, Eigenschaftenänderung oder Projektdownload übernommen. Unvollständige oder fehlgeschlagene Übernahmen behalten ihre Punkte. Rückgängig verwirft zuerst den offenen Entwurf, danach ganze Projektaktionen. JSON-Projekte und lokale Sicherung speichern die ursprünglichen Flächen und ihre Reihenfolge, nicht nur die abgeleiteten Schnittlinien.

Bisherige Projekte behalten ihre Geometrie. Das Öffnen des räumlichen Arbeitsplatzes allein wandelt sie nicht um. Ein Flächenentwurf bleibt neben Motiv-, Kirigami- und freien Linienentwürfen im Projekt erhalten. **Bisherigen Entwurf verwenden** kehrt zu diesen Werkzeugen zurück; im räumlichen Arbeitsplatz stellt **Flächenentwurf weiterbearbeiten** den erhaltenen Flächenentwurf wieder her.

### Geometrie und Grenzen

Senkrechte Flächen haben eine konstante Tiefe D, waagerechte eine konstante Höhe Z. Beide verwenden dieselbe Blattkoordinate t=D−Z und die Bewegung `(x, D+Z·cos(θ), Z·sin(θ))`. Dadurch bleiben Flächen starr; bei 180° stimmen sie exakt mit dem Schnittbogen überein. Geteilte Papierbereiche werden nach Priorität zugeschnitten. Die Konstruktion prüft die Verbindung aller Teilflächen über endliche, ungeschnittene Falzkanten zum Kartenrest sowie das geschlossene Kartenmaß. Jede zusammenhängende Gruppe von Pop-up-Flächen muss an beiden Kartenhälften angeschlossen bleiben; ein nach Prioritätsbereinigung nur einseitig gehaltener Lappen sperrt den Export. Zusammenhängende Falzanschlüsse unter 1 mm sperren die Fertigung.

Unterstützt werden parallele senkrechte und waagerechte Zeichenebenen, bis zu 30 Flächen und insgesamt 1600 Konturpunkte. Beliebig geneigte Ebenen und ein allgemeiner Origami-Löser sind nicht enthalten. Die Animation zeigt einen geometrisch passenden, koordinierten Faltweg. Reales Papier hat Materialstärke und zusätzliche Gelenkfreiheit: alle Falze vorformen und beim ersten Schließen führen. Papierprototypen und konkrete Maschinenimporte wurden für diese Version noch nicht geprüft.

## Bisherige Werkzeuge: Vom Motiv zur Karte

1. **Karte:** Beispiel und Kartenmaße wählen. Die Kartenhälfte misst vom Rücken bis zum äußeren Rand; offen ist die Karte doppelt so hoch. Alle Beispiele verwenden die Einbogen-Stufenfaltung.
2. **Figuren:** Eigene Figuren hinzufügen oder ein Beispiel bearbeiten. Breite, Höhe, Position entlang des Rückens und Tiefe bestimmen den Aufbau. Stegbreite und Stegversatz bestimmen die Verbindung im Motiv. Das Studio ergänzt einen senkrechten Motivsteg und einen Dachsteg; Schnittlinien unterbrechen diese Verbindungen nicht.
3. **Gestalten:** Im vollständigen SVG-Edit zeichnen oder ein eigenes SVG importieren. Formen lassen sich vereinen, voneinander abziehen und schneiden. Schrift wird mit Noto Sans in Pfade umgewandelt. **Motiv übernehmen** prüft die Zeichnung und aktualisiert die tatsächlichen Motivmaße in Millimetern.
4. **Aufklappen:** 0° bedeutet geschlossen, bei 90° stehen die Figuren auf, bei 180° liegt die Karte als Fertigungsbogen flach. Drehen und Zoomen ändern nur die Ansicht. Die flache Fertigungslage ist kein separater V-Faltmodus.
5. **Schnittbogen:** Materialbogengröße, Randabstand und Arbeitsfarben einstellen. Die Vorschau zeigt einen Kartenrohling mit allen Schnitten und Falzen. Die Ansicht **Falten** erklärt die Arbeitsschritte.

Änderungen im Motiveditor werden nach einer kurzen Pause automatisch übernommen. Beim Wechsel von Figur oder Ansicht wird die Zeichnung ebenfalls geprüft und übernommen. **Letzten Stand wiederherstellen** verwirft noch nicht übernommene Motivänderungen. Rückgängig/Wiederholen oberhalb der Arbeitsfläche arbeitet auf dem Gesamtprojekt; die Werkzeuge im eingebetteten Editor arbeiten auf dessen Zeichenschritten.

## Kirigami-Architektur

Die Beispiele **Terrassentreppe**, **Blocklandschaft** und **Stufenwelle** bestehen aus breiten, mehrstufigen Papierbändern. Als Anregung dient die [Ullagami-Bauanleitung](https://ullagami.com/how-to.php); die drei Beispiele sind eigene Entwürfe. Die Vorlagen der verlinkten Seite werden nicht mitgeliefert.

Unter **Kirigami · Stufenbänder** ein Band hinzufügen, auswählen, duplizieren oder löschen. Bandbreite und Position bestimmen seine Lage entlang des Kartenrückens. **Stufen bearbeiten** öffnet das Seitenprofil: Für jede Stufe lassen sich Höhe und Tiefe in Millimetern einstellen. Die Reihenfolge läuft von der Rückwand nach vorne. Weitere Stufen hinzufügen oder entfernen; Gesamtprofil und flaches Band aktualisieren sich gemeinsam. **Aufklappen ansehen** zeigt alle Bänder und Figuren auf der Karte.

Jedes Band bildet eine durchgehende Treppe mit breiten waagerechten und senkrechten Flächen. Zwei seitliche Schnitte lösen es aus dem Blatt; beide Enden und sämtliche inneren Gelenke bleiben verbunden. Berg- und Talfalten wechseln sich ab. Der Modus unterstützt vorwärts absteigende Profile mit geraden, parallelen Falzen, bis zu zwölf Stufen pro Band und zwanzig Bänder mit insgesamt höchstens 240 Flächen. Zwischen Schnittbereichen müssen mindestens 2 mm Material bleiben. Höhe und Tiefe zusammen dürfen die Kartenhälfte nicht überschreiten, damit die geschlossene Treppe im Kartenformat bleibt. Die Spiralformen haben einen eigenen parametrischen Editor, wie im nächsten Abschnitt beschrieben. Beliebige Verzweigungen und die automatische Rekonstruktion fremder Schnittvorlagen sind nicht enthalten.

Die Klappvorschau zeigt eine geometrisch gültige, koordinierte Bewegung. Mehrere Stufengelenke haben zusätzliche Bewegungsfreiheit: Reales Papier muss an jedem markierten Falz vorgeformt und beim ersten Falten geführt werden. Die Vorschau berechnet keine Kräfte und garantiert keine selbsttätige Entfaltung. Bei 0° liegt das gefaltete Modell geschlossen; 180° zeigt den ursprünglichen flachen Bogen. Bandprofile gehören zum Projektformat v2; bestehende v2-Motivprojekte laden weiterhin unverändert mit einer leeren Bandliste.

## Räumliche Spiralformen

Die eigenen Beispiele **Raumspirale** und **Spiralpaar** starten mit einer oder zwei gegenläufigen Archimedischen Spiralbahnen. **＋ Spirale** fügt eine weitere Form hinzu. Links stehen Name, Außendurchmesser, Position und Papierfarbe; rechts unter **Spirale gestalten** werden Windungen, Bandbreite, Innenradius, Drehrichtung, Drehung, Falthöhe und Anzahl der Faltstufen eingestellt. Alle Parameter bleiben in der Projektdatei bearbeitbar. Änderungen, Duplizieren und Löschen sind rückgängig machbar.

**Schnitte & Scharniere ansehen** öffnet das berechnete Schnittnetz im Kirigami-Reiter. Dunkelgrüne Markierungen zeigen die ungeschnittenen Ansätze zur Karte. Das innere und das äußere Bahnende bleiben frei; die Verbindung zur Karte liegt auf zwei Abschnitten der äußeren Spiralwindung. Die Form ist eine zusammenhängende Spiralbahn. Der Kartenrest zwischen ihren Windungen bleibt ebenfalls mit dem Kartenrand verbunden. Es gibt keine angeklebten Teile.

Die gekrümmte Bahn wird durch gerade, parallele Falze in starre Teilflächen geteilt. Bei 90° entstehen räumlich gestaffelte Spiralabschnitte; bei 180° liegt die ursprüngliche Schnittkontur flach. Falthöhe und Stufenzahl bestimmen die Staffelung, während die geometrisch erhaltenen Gelenke die Abschnitte verbinden. **Die Bahn wird nicht elastisch gebogen oder künstlich verdreht.** Dies unterstützt gefaltete Spiralbänder mit parallelen Faltachsen; beliebige Torsionsmodelle oder nicht parallele Faltachsen der Ullagami-Galerie werden damit nicht automatisch erzeugt.

Schnitt- und Bewegungsgeometrie verwenden dieselbe Materialkontur. Der konstante Bahnabstand wird über Normalenversätze berechnet, die Kurven werden mit höchstens 0,05 mm geometrischer Abweichung durch kurze Geraden angenähert. Die Kontur wird auf Selbstüberschneidungen, Windungsabstände, Kartenschließmaß und flächige Verbindungen geprüft. Zwischen Windungen bleiben mindestens 2 mm frei; die beiden äußeren Kartenscharniere müssen mindestens 1 mm breit sein. Ein nur punktförmiger Kontakt zählt nicht als Verbindung. Nachgewiesene Fehler sperren den SVG-Export. Geometrisch ungültige Einstellungen bleiben bearbeitbar und als Projekt speicherbar; ein fehlerhaftes Projektformat ersetzt den letzten gültigen Stand nicht.

Der Modus begrenzt die Berechnung auf sechs Spiralen innerhalb der zwanzig Kirigami-Formen, 0,5–6 Windungen und 1–12 Faltstufen pro Spirale. Je Spirale sind höchstens 1024 Konturpunkte und 400 einzelne Teilflächen möglich, pro Projekt höchstens 1200 Kirigami-Teilflächen. Auch innere Scharniere und Spiralstege unter 1 mm sperren den Fertigungsexport; eine kleine Drehung oder andere Stufenzahl kann zu schmale Scharnierstellen beseitigen. Die Vorschau zeigt eine gültige koordinierte Faltbewegung; bei echten Papierbahnen müssen sämtliche Falze vorgeformt und geführt werden. Sie simuliert weder Papierkräfte noch Reibung oder eine garantiert selbsttätige Entfaltung. Ein physischer Papierprototyp ist weiterhin erforderlich.

## Freie Schnitt- und Falzlinien direkt auf der Karte

**Kartenlinien** zeigt den ganzen Kartenbogen in Millimetern, zusammen mit einer räumlichen Vorschau. **Leere Karte beginnen** startet mit einer editierbaren Rückenfalte. **Schnittbogen in Linien übernehmen** wandelt den aktuellen Figuren-, Stufen- oder Spiralentwurf in einzelne Schnitt- und Falzlinien um. Die ursprünglichen Parameter bleiben im Projekt erhalten. **Parameterentwurf verwenden** wechselt zurück; **Freien Entwurf verwenden** stellt die bearbeitete Zeichnung wieder her. Diese Umschaltungen sind rückgängig machbar. Das bloße Öffnen des Reiters verändert den Entwurf nicht.

### Zeichnen und bearbeiten

- **Linie:** Anfang und Ende anklicken oder mit gedrückter Maustaste zeichnen. Operation Schnitt, Bergfalz, Talfalz oder Gravur wählen. Falze bleiben gerade.
- **Linienzug:** Punkte setzen und mit Enter oder **Fertig** übernehmen. **Kontur schließen** verbindet den letzten mit dem ersten Punkt. Ein vollständig ausgeschnittenes, abgetrenntes Stück wird als Schnittabfall orange dargestellt und aus dem 3D-Material entfernt.
- **Freihand:** Schnitt- oder Gravurlinien mit gedrückter Maustaste zeichnen. Die Punkte werden mit 0,1 mm Toleranz vereinfacht und bleiben bearbeitbar.
- **Auswählen:** Eine Linie anklicken und ihre Knoten ziehen. Rechts Koordinaten in Millimetern, Operation und Zielwinkel einstellen. Punkte einfügen/löschen, Linien duplizieren oder entfernen. Wird ein Linienzug in Falze umgewandelt, entstehen einzelne gerade Falzsegmente.
- **Feste Fläche:** Einen Punkt innerhalb des Kartenteils setzen, der in der Vorschau liegen bleiben soll. Der gelbe Fixpunkt darf nicht auf einer Schnitt- oder Falzkante liegen.
- Raster, Endpunkt- und Kantenfang helfen beim Schließen der Zeichnung. Mausrad und Zoomknöpfe vergrößern die Ansicht; Leertaste und Ziehen verschiebt sie. Escape verwirft eine noch offene Zeichnung. Ein vollständiger Zeichen- oder Ziehvorgang ist eine gemeinsame Projektaktion für Rückgängig/Wiederholen.

Offene Zeichnungen bleiben bei unveränderten Projektdaten erhalten. Beim Ansichtswechsel und Speichern werden sie zuerst übernommen; schlägt das fehl, bleiben ihre Punkte erhalten. Vor dem Fertigungsexport eine offene Linie mit **Fertig** abschließen. Ein Ressourcenfehler verwirft den letzten gültigen Projektstand nicht.

### Freie Faltvorschau

In diesem Modus heißt der Regler **Faltfortschritt**: **0 %** zeigt den flachen Schnittbogen, **100 %** die eingestellten Zielwinkel. Er behauptet keine geschlossene Kartenstellung. Der Regler ändert ausschließlich die Ansicht. Schnittlinien, gerade Falze und Kartenrand teilen das Blatt in echte Flächen. Gemeinsame Falzkanten erhalten ihre Länge; schräge und unterschiedlich ausgerichtete Gelenke drehen starre Flächen, ohne das Papier künstlich zu dehnen.

Für Konstruktionen mit mehreren Verbindungspfaden prüft das Studio sämtliche Gelenke, nicht nur einen ausgewählten Pfad. Widersprüchliche Zielwinkel werden an den betroffenen Linien markiert, sperren den Fertigungsexport und zeigen eine ausdrücklich gekennzeichnete flache Ersatzansicht. Solche Muster können mit anderen Winkeln oder einer anderen, gekoppelten Faltbewegung möglich sein. Die Vorschau löst vorgegebene starre Winkelverläufe; allgemeine nichtlineare Origami-Bewegungen, Kollisionen, Materialstärke, Papierkräfte und vollständige Schließbarkeit sind nicht nachgewiesen.

Ein offener Schnittschlitz trennt allein keine starre Fläche. Eine frei in der Fläche endende Falz kann deshalb nicht als beliebig gebogenes Papier simuliert werden: Sie muss bis zu Schnitt-, anderen Falz- oder Kartenrändern weitergeführt werden. Schnitt/Falz-Überlagerungen und sich widersprechende Falzwinkel bleiben korrigierbare Geometriefehler. Bei der Herstellung werden ausschließlich die gezeichneten Schnitt- und Falzpfade ausgegeben; Scharniere werden nicht automatisch zugeschnitten oder ergänzt.

Der freie Entwurf unterstützt bis zu 1200 Linien, 2400 Linienpunkte, 3000 Teilsegmente nach dem Aufteilen an Kreuzungen, 300 Flächen und 60.000 Materialdreiecke. Unabhängig gerundete Anschlüsse werden innerhalb von 0,00001 mm zusammengeführt. Projekte und SVG-Dateien verwenden dieselben aufgeteilten Segmente. Bisherige Projekte ohne freie Zeichnung behalten ihre bisherige Bedeutung und Bewegung.

## Projekte und ältere Entwürfe

**Projekt speichern** lädt eine bearbeitbare JSON-Datei im Projektformat **Version 2** herunter. Sie enthält Motive, SVG-Quelldaten, Schriftinformationen, Stufenprofile, Spiralparameter, freie Kartenlinien, räumliche Flächen mit Prioritätsreihenfolge und Kartenparameter. **Projekt öffnen** lädt diese Sicherung. Das Studio speichert aktuelle Entwürfe außerdem lokal im Browser unter einem eigenen Version-2-Schlüssel. Die Projektdatei ist die übertragbare Sicherung.

Ältere Projekte der Version 1 beschreiben separate, geklebte Motive und Träger. Ihre Mechanik wird **nicht automatisch** als Einbogen-Karte neu interpretiert. Eine vorhandene lokale Version-1-Sicherung bleibt unverändert erhalten und kann über **Altes Projekt herunterladen** gesichert werden. **Motive in Einbogen-Entwurf übernehmen** übernimmt die Motive ausdrücklich in einen neuen Entwurf mit Einbogen-Mechanik. Die neue Anordnung und Verbindungen müssen geprüft werden; die alte Klebegeometrie lässt sich nicht unverändert übertragen. Das gilt auch beim Öffnen einer alten Projektdatei.

Die editierbaren SVG-Quelldaten und der Fertigungsbogen erfüllen unterschiedliche Aufgaben: Im Editor wird die ursprüngliche Motivzeichnung bearbeitet. Für die Fertigung erzeugt das Studio daraus Schnitte, Verbindungsstege und Falze auf der Karte. Deshalb dürfen die geschlossenen Schnittkonturen des Quellmotivs nicht zusätzlich als separate Teile ausgeschnitten werden. Das Fertigungs-SVG ist kein Projektformat.

## SVG und Fertigung

SVG-Motive sollten aus einfachen geschlossenen Vektorflächen bestehen. Externe Referenzen, eingebettete Bilder, Skripte, Filter, Masken und Beschneidungen werden nicht unterstützt. Solche Inhalte vorher in reine Pfade umwandeln. Für importierten Text Noto Sans im normalen Schriftschnitt verwenden oder die Schrift im Quellprogramm in Pfade umwandeln.

Der Schnittbogen enthält **einen Kartenrohling**. Die offenen Schnittpfade lassen endliche Falzverbindungen stehen; der zentrale Motivsteg und Dachsteg erhalten die Verbindung zur Karte. Gravuren verbinden keine losgelösten Papierinseln. Prüfe insbesondere Buchstaben, Löcher, dünne Stege, überlappende Figuren und die Verbindungen zum Kartenmaterial. Ungültige Geometrie sperrt den Schnittdownload, bleibt aber als Projekt bearbeitbar und speicherbar.

Der Export verwendet Millimeter und getrennte Ebenen für `CUT`, `FOLD_MOUNTAIN`, `FOLD_VALLEY` und `ENGRAVE`. In der Lasersoftware im Maßstab **1:1** importieren und die Abmessungen prüfen. Leistung, Geschwindigkeit und Falzbearbeitung werden dort eingerichtet. Falze müssen das Papier biegbar machen, ohne die verbleibenden Verbindungen vollständig zu trennen. Maschinen-SVGs enthalten keine Beschriftungen aus der Vorschau.

Die Vorschau zeigt eine idealisierte Geometrie. Materialstärke, Faserrichtung, Biegesteifigkeit und reale Reibung werden nicht simuliert. Schmale Verbindungen können in echtem Papier versagen. Zuerst einen Papierprototyp herstellen, die Falze vorsichtig vorformen und das Schließen und Öffnen prüfen. Eine geometrisch gültige Datei ersetzt diese Erprobung nicht.

Zur Einordnung von Einbogen-Pop-ups und rechtwinkligen Faltungen: [Forschung zu Pop-up-Konstruktionen](https://shishenghuang.github.io/index/Papers/Popup/popup_paper.pdf) und [Anleitung zum Entwerfen eigener Pop-up-Karten](https://makepopupcards.com/how-to-design-your-own-pop-up-cards/). Die Verweise dienen als Hintergrund; die konkrete Umsetzung und ihre Grenzen sind oben beschrieben.

## Prüfungen

```sh
node website/klappkarten-studio/tests/klappkarten.mjs
node website/klappkarten-studio/tests/drawing.mjs
```

Die eigenständigen Editorprüfungen laufen im Browser über `await (await import('./tests/editor.browser.mjs')).runEditorTests()`. `tests/card-drawing-browser.mjs` prüft den freien Karteneditor und die gekoppelte 3D-Vorschau; `tests/card-editor.browser.mjs` enthält die eigenständige Editorprüfung. `tests/spiral-browser.mjs` prüft die Spiralgestaltung einschließlich Parameter, Schnittdownload und Projektwiederherstellung; `tests/kirigami-browser.mjs` prüft die Stufenprofile. `tests/klappkarten-browser.mjs` enthält den Playwright-Prüflauf für die App, SVG-Download, Projektwiederherstellung und ungültige Importe. Er verwendet einen frischen Browserkontext und verändert keine bestehenden lokalen Projekte.

## Dateien und Abhängigkeiten

- `index.html`, `style.css`: deutsche, responsive Oberfläche mit beschrifteten Bedienelementen und Tastaturfokus.
- `app.mjs`: Projektzustand, Aktionen, ältere Projekte, Ansichtwechsel und Dateidialoge.
- `project.mjs`: Version-2-Projektformat, Eingabeprüfung und Beispiele.
- `editor.mjs`, `svg.mjs`: SVG-Edit-Anbindung, SVG-Prüfung, Vektoroperationen und Schriftpfade.
- `scene.mjs`: 3D-Klappansicht mit Three.js und OrbitControls.
- `geometry.mjs`, `export.mjs`: zusammenhängende Einbogen-Geometrie, Prüfungen und Fertigungs-SVG.
- `kirigami.mjs`: geprüfte Stufenprofile und starre Flächenbewegung der Architekturbänder.
- `spiral.mjs`: Spiralbahnen, begrenzte Kurvennäherung, echte Scharnierabschnitte und Zusammenhangsprüfung.
- `card-editor.mjs`, `drawing.mjs`: direkte Kartenzeichnung, Flächenanordnung und starre Faltvorschau mit Gelenkprüfung.
- `vendor/`: lokale SVG-Edit-, Paper.js- und OpenType.js-Dateien sowie Noto Sans. Three.js und OrbitControls kommen aus `baustein-studio/vendor/`; diese Nachbardateien beim Bereitstellen mit ausliefern.

Versionen, Herkunft und Lizenzen stehen in [vendor/DEPENDENCIES.md](vendor/DEPENDENCIES.md). Das Studio wird als Teil von `website/` statisch bereitgestellt.
