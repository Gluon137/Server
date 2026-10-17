# Automaten-Studio

Browserwerkzeug ohne Backend oder Abhängigkeiten für drei kleine, handbetriebene Holzautomaten: Schubkurbel, gefangene Exzenterkulisse und Viergelenk-Schwinge. Eine eigene Polygonfigur oder Vogel, winkende Figur und Blume lässt sich mit einer dieser Vorlagen verbinden. Die Darstellung verwendet dieselben geschlossenen Konturen wie der SVG-Export.

## Start und Prüfung

Vom Repository-Root einen statischen Webserver starten und `/automaten-studio/` öffnen (der Webserver muss `website` als Dokumentwurzel verwenden). Die Module lassen sich direkt in Node importieren. `node tests/automaten.mjs` prüft unabhängig Schleifenschluss, wiederkehrende Bewegung, Konturen, Zuschnittpackung, Passungsprofile, reale Dübellängen und Exportgrenzen. Die Browserprüfung liegt in `tests/automaten-browser.mjs`.

## Dateien und Schnittstellen

- `project.mjs`: Version-1-JSON, `createProject`, unveränderndes `useMotif`, `validateProject`, `parameterRanges`. Konturen und Anker sind auf 0–100 normiert; Figurenmaße werden in Millimetern angewendet. Import erlaubt höchstens 256 Eckpunkte und verlangt eine einfache, nicht selbstberührende Kontur mit mindestens 6 mm Material um den Anker.
- `geometry.mjs`: `buildProject` und `poseProject`. Millimeter, SVG-Koordinaten mit positiver Y-Richtung nach unten, Winkel in Grad. Jeder Schnittteil besitzt Außenkontur, Innenkonturen, eine Anzeigeebene `layer` und die tatsächliche axiale Vorderkante `z`. Rückwand beginnt bei Z=0; negative Z-Werte liegen dahinter. `poseProject` enthält alle Nicht-Kalibrierteile; die Standfüße erscheinen zur Zuordnung flach, werden tatsächlich rechtwinklig montiert.
- `export.mjs`: deterministische, konservative Rechteckpackung ohne Drehung, SVG-Schnittbogen, CSV-Stückliste, eigenständige druckbare HTML-Bauanleitung. Jeder Export validiert das Quellprojekt erneut. Zu große Einzelteile oder ungültige Geometrie sperren den Schnittbogen. Bögen haben explizite Millimetermaße, geschlossene Konturen und alle Innenkonturen vor den Außenkonturen. Die Bauanleitung enthält Konturminiaturen, Maße, Bogenkoordinaten, tatsächliche Z-Bereiche und die beschriftete Passprobe.

## Konstruktion und Passungen

Zwei Fußzapfen verbinden die senkrechte Rückwand mit zwei waagerechten Standfüßen. Die Rückwand und eine aufgeleimte vordere Lagerwange tragen die rotierende Antriebswelle. Handkurbel und vordere Kurbel bzw. Exzenterscheibe sind fest mit der Welle verleimt; der hintere Stellring und die vordere Kurbel halten sie axial. Kurbelzapfen sind jeweils in einem Teil verleimt und im Gegenstück frei gelagert; separate Gegenringe werden nur mit dem Dübel verklebt. Beim Viergelenk durchläuft ein einziger langer Koppel–Schwingen-Zapfen auch die beiden Figurenauflagen und die Figur; so liegt kein zweiter Dübel im selben Loch.

Geklebte Abstandsklötze bilden tatsächlich erreichbare ganze Plattenlagen. Freie Führungskanäle tragen Schieber oder Kulissenstiel; zwei auf Stützklötzen befestigte Anschlagbrücken liegen je 0,5 mm außerhalb des normalen Hubs. Sie halten den Stiel bei Überhub in den Führungen. Parameter, bei denen Stangen, Anschläge oder andere Teile kollidieren, werden gesperrt.

Die obere Reihe der Passprobe basiert auf dem gespeicherten Lauflochprofil, die untere auf dem Leimlochprofil. Links nach rechts werden jeweils −0,2 / 0 / +0,2 / +0,4 / +0,6 mm hinzugefügt. Die Anleitung ordnet jede Bohrung zu. Zunächst nur diese Probe im Laserprogramm auswählen und schneiden; danach reale Platte und Dübel messen, Profile korrigieren und alles erneut exportieren. Die SVG gibt fertige Sollkonturen aus. Schnittfugenkompensation wird ausschließlich im Laserprogramm angewendet.

Axialspiel benötigt beim Verkleben eine **gemessene, anschließend entfernte Papier- oder Folienlehre**. Diese Montagehilfe ist ausdrücklich in Stückliste und Anleitung genannt. Aus einer 3-mm-Platte lässt sich keine 0,3-mm-Dickenlehre schneiden. Das enthaltene Teil `gap-gauge` besitzt stattdessen eine echte 20-mm-Messöffnung zur Maßstabskontrolle. Sämtliche bleibenden Bauteile sind Sperrholz, Holzdübel und Holzleim. Die Dübellängen folgen dem vollständigen tatsächlichen axialen Lagenaufbau, einschließlich Stellringen und der Figur.

## Was die Prüfung aussagt

Die Schubkurbel wird analytisch auf die reale Pleuellösung geprüft, die Exzenterkulisse auf Scheibensteg und Eingriff, das Viergelenk auf beide strengen Dreiecksgrenzen über einen gesamten Umlauf (mindestens 2 mm Abstand zu Totlagen). Der obere Montagezweig ist fest vorgegeben. Hub bzw. Schwingwinkel werden aus demselben Mechanismus berechnet, der die Vorschau antreibt.

Eine zusätzliche Kollisionsprüfung untersucht **180 Stellungen in 2°-Schritten**. Sie vergleicht tatsächliche Materialkonturen mit Löchern sowie die Dübelzylinder, sofern sich ihre realen Z-Intervalle überschneiden. Beabsichtigte Dübel/Lager-Verbindungen und statisch verleimte Kontaktflächen werden ausgenommen. Die Kulisse und die Scheibe werden als gleitender, gefangener Kontakt konstruiert; die Scheibe bleibt über den Umlauf analytisch im Schlitz.

Eine endliche Stichprobe beweist keinen kollisionsfreien vollständigen Bewegungsraum. Die Kollisionsanzeige bleibt bei erfolgreicher Stichprobe eine Warnung. Fertigungstoleranzen, Durchbiegung, Reibung, Kippstabilität und Haltbarkeit werden nicht simuliert. Es existiert noch kein gebauter und vermessener physischer Prototyp. Vor Gebrauch sind eine vollständige langsame Handumdrehung, ausreichendes Lagerspiel und der reale Stand zu prüfen.
