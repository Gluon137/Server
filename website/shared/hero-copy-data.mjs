// Original allusions, paired so every randomly selected headline keeps its context.
const triples = lines => lines.trim().split('\n').map(line => {
  const [eyebrow, headline, subline] = line.split('|');
  return {eyebrow, headline, subline};
});
export const heroCopy = {
landing: triples(`
Die nächste Zelda-Quest wartet|Deine nächste Quest beginnt hier.|Wähle ein Studio, gestalte deinen Entwurf und bring deine Idee in die Welt.
Minecraft beginnt mit einer Idee|Auch große Abenteuer fangen klein an.|Ein Motiv, ein Blatt oder ein Block: Hier beginnt dein nächstes Projekt.
Ein Aufbruch wie im Auenland|Raus aus dem Kopf. Rein in die Werkstatt.|Entdecke Werkzeuge zum Gestalten, Ausprobieren und Selbermachen.
Werkstatt für kreative Padawane|Die Idee ist stark in dir.|Unsere Studios helfen dir, aus einem Einfall einen eigenen Entwurf zu machen.
Portal zur nächsten Werkbank|Hier geht’s in deine nächste Dimension.|Gestalte Räume, Karten und bewegliche Dinge direkt im Browser.
Ein Inventar wie in Stardew Valley|Dein wichtigstes Werkzeug ist Neugier.|Such dir ein Studio aus und probiere aus, was aus deiner Idee werden kann.
Deine Werkstatt hat Doctor-Who-Potenzial|Jedes Lieblingsstück hat eine Vorgeschichte.|Schreib deine mit einem Entwurf, der Schritt für Schritt Gestalt annimmt.
Hogwarts für praktische Einfälle|Gib deiner Fantasie eine Form.|Entwirf, prüfe und exportiere dein nächstes Werkstück.
Mission für deine Enterprise-Crew|Aus „Was wäre, wenn?“ wird „Hab ich gebaut“.|Finde das passende Studio für dein kreatives Projekt.
Mit Hobbit-Mut an die Werkbank|Kleine Hände. Große Vorhaben.|Mit unseren Studios werden aus einfachen Formen eigene Werkstücke.
Bereit für einen Star-Wars-Hypersprung|Deine Idee muss nicht am Bildschirm bleiben.|Entwirf im Browser und bereite den nächsten Schritt in der Werkstatt vor.
Minecraft-Welt mit eigener Handschrift|Heute baust du deine eigene Geschichte.|Drehen, stecken, falten oder verbinden: Wähle deinen Anfang.
Ein Schatzpfad durch Hyrule|Der Schatz ist das Selbermachen.|Probiere einen Entwurf aus und finde heraus, was in deiner Idee steckt.
Der Hogwarts-Stundenplan: Werken|Ein guter Einfall kann ziemlich viel.|Die passenden Studios machen deine nächsten Schritte übersichtlich.
Minecraft auf Kreativmodus|Stell die Fantasie auf kreativ.|Gestalte dein eigenes Projekt und probiere seine Möglichkeiten aus.
Ein Startplatz für die Enterprise|Gute Ideen brauchen einen Startplatz.|Hier findest du Studios für Formen, Bewegung und eigene Konstruktionen.
Durchs Stargate zur eigenen Idee|Die nächste Tür öffnest du selbst.|Entdecke Werkzeuge für kreative Projekte und praktische Planung.
Erfindergeist à la R2-D2|Auch ein Einzelstück hat Superkräfte.|Mach aus deiner Idee etwas, das du gestalten und ausprobieren kannst.
Tetris für deine nächsten Einfälle|Jetzt bekommt die Fantasie einen Plan.|Wähle ein Werkzeug und entwickle deinen Entwurf weiter.
Deine Karte von Hyrule|Dein Projekt wartet hinter der nächsten Karte.|Finde dein Studio und beginne mit einer eigenen Form.
Ein neues Level bei Mario|Du hast eine neue Fähigkeit: anfangen.|Unsere Studios begleiten dich von der ersten Form bis zum Export.
Auf der Enterprise-Brücke der Ideen|Setz Kurs auf selbst gemacht.|Entwirf Formen, prüfe Bewegung und bereite dein Werkstück vor.
Werkstattzauber aus Hogwarts|Für diese Magie brauchst du einen Einfall.|Gestalte im Browser und entdecke, was daraus werden kann.
Doctor Who hätte da ein Nebenprojekt|Deine Idee verdient mehr als eine Notiz.|Mach einen Entwurf daraus und bring ihn Schritt für Schritt weiter.
Eine D&D-Gruppe voller Bauideen|Das Abenteuer passt auf deine Werkbank.|Hier findest du kreative Studios und Werkzeuge zum gemeinsamen Planen.
Durch ein Portal ins Selbermachen|Hinter jeder Form steckt eine neue Welt.|Probiere unsere Studios aus und gestalte dein eigenes Projekt.
Dein Minecraft-Spielstand wächst|Speichere keine Ausreden. Sondern Ideen.|Such dir ein Studio und beginne mit deinem nächsten Entwurf.
Star Trek mit Werkbank statt Warp|Ein kleiner Entwurf. Ein großer Aufbruch.|Lass deine Ideen drehen, wachsen, aufklappen oder zusammenfinden.
Vom Hobbit zum Werkstatthelden|Mach etwas, das deine Handschrift trägt.|Gestalte ein eigenes Werkstück mit den passenden Werkzeugen.
Stardew Valley für kreative Pausen|Heute ist ein guter Tag für ein Nebenprojekt.|Entdecke Studios zum Selbermachen und Hilfen zum Auswerten und Planen.
`),
'automaten-studio': triples(`
Eine Werkstatt für R2-D2s Verwandtschaft|Deine Figur bekommt ihren ersten Auftritt.|Wähle eine Mechanik, drehe an der Kurbel und bereite deinen Holzautomaten vor.
Eine Bewegungsquest aus Hyrule|Ein kleiner Dreh weckt große Ideen.|Verbinde Kurbel und Figur, prüfe den Hub und exportiere deine Schnittteile.
Minecraft mit beweglichen Nachbarn|Deine nächste Figur bleibt nicht stehen.|Gestalte ihren Umriss und probiere die Bewegung deines Automaten aus.
Ein Gruß von der Enterprise-Werkbank|Heute bewegt sich deine eigene Mannschaft.|Wähle einen Antrieb und plane Figur, Gestell und Holzverbindungen.
Hogwarts im Mechanikunterricht|Diese Figur lernt ihren eigenen Trick.|Probiere Kurbeln, Exzenter und Hebel in der Bewegungsvorschau aus.
Ein Nebenprojekt für Doctor Who|Deine Geschichte kommt auf die Beine.|Gestalte eine Holzfigur und bereite ihre bewegliche Bühne vor.
Marios Kurbelwerkstatt ist geöffnet|Ein Umlauf. Ein neuer Auftritt.|Wähle deine Mechanik und sieh nach, wie sich deine Figur bewegt.
Eine Blume aus Stardew Valley|Deine Idee wächst mit jeder Kurbelrunde.|Gestalte einen Automaten und exportiere seine maßhaltigen Schnittteile.
Ein bewegter Gruß aus dem Auenland|Kleine Figuren haben viel zu erzählen.|Baue ihre Bewegung mit Kurbel, Schubstange oder Kipphebel auf.
Portal zur beweglichen Werkbank|Hier bekommt dein Einfall einen Antrieb.|Prüfe deine Konstruktion und bereite die Teile für den Lasercutter vor.
Eine neue Nebenquest für Link aus Zelda|Die nächste Bewegung liegt in deiner Hand.|Drehe durch den ganzen Umlauf und prüfe den Entwurf deiner Figur.
Ein Ausflug mit R2-D2|Dein kleiner Begleiter lernt winken.|Wähle Figur und Mechanik und bereite deinen eigenen Holzautomaten vor.
Star Trek mit einer Handkurbel|Setz deinen Entwurf in Bewegung.|Passe Maße und Material an und prüfe die Bewegung in der Seitenansicht.
Eine Werkbank neben der TARDIS|Jede Kurbelrunde erzählt ein Stück weiter.|Gestalte deine Figur und exportiere den Schnittsatz samt Montageansicht.
Ein Tetris-Spiel aus Hebeln|Alle Teile finden ihre Bewegung.|Wähle eine Mechanik und bereite Gestell, Figur und Verbindungen vor.
Eine D&D-Figur mit Eigenleben|Dein nächster Charakter hat einen Antrieb.|Zeichne einen Umriss und verbinde ihn mit dem bewegten Träger.
Ein kleiner Auftritt auf Arrakis|Deine Bühne braucht nur eine Kurbel.|Prüfe den Umlauf und plane die Schnittteile deines Holzautomaten.
Minecraft macht eine Bewegungsprobe|Aus Holz wird ein kleiner Darsteller.|Passe Kurbelradius und Figur an und probiere deinen Entwurf aus.
Ein Stargate für die Fantasie|Einmal drehen öffnet neue Möglichkeiten.|Wähle einen Antrieb und entdecke seine Bewegung in der Vorschau.
Mechanikunterricht in Hogwarts|Dein Zaubertrick hat eine Kurbel.|Entwirf Figur und Mechanik und bereite ihre Holzbauteile vor.
Die Enterprise besucht die Werkstatt|Deine Konstruktion bekommt ihren eigenen Rhythmus.|Prüfe Hub oder Schwenkwinkel und exportiere passende Schnittbögen.
Ein Hobbit winkt aus der Werkbank|Eine kleine Figur sorgt für Bewegung.|Gestalte deinen Holzautomaten und schau dir jeden Kurbelwinkel an.
Zelda findet einen neuen Mechanismus|Die nächste Idee dreht schon ihre Runde.|Wähle Kurbel, Exzenter oder Kipphebel und entwickle deinen Entwurf.
Doctor Who trifft den Exzenter|Deine Figur spielt dieselbe Szene immer neu.|Probiere ihren Bewegungsablauf und bereite den Schnittsatz vor.
Ein Garten für Stardew Valley|Heute blüht die Fantasie mit Handantrieb.|Wähle eine Blume oder zeichne eine eigene Figur für deinen Automaten.
Mario entdeckt den Kipphebel|Dein nächstes Level bewegt sich mit dir.|Passe die Mechanik an und prüfe ihren vollständigen Umlauf.
R2-D2 hat eine neue Bauidee|Deine Werkbank bekommt Gesellschaft.|Baue einen kleinen Automaten mit bewegter Figur und eigenem Gestell.
Ein Tron-Raster für deine Mechanik|Klare Konturen bringen Leben ins Holz.|Gestalte einen Umriss und exportiere seine geschlossenen Schnittlinien.
Die nächste Zelda-Quest ist mechanisch|Deine Figur wartet auf den ersten Dreh.|Wähle Material, prüfe Passungen und plane die Montage deines Automaten.
Ein Star-Wars-Droide aus Sperrholz|Der Antrieb deiner Geschichte ist handgemacht.|Probiere die Bewegung aus und lade Schnittbögen und Rundstabliste herunter.
`),
'baustein-studio': triples(`
Minecraft beginnt mit einem Block|Ein Block ist erst der Anfang.|Verbinde Blöcke, öffne Flächen und entwickle dein eigenes Steckmodell.
Ein Minecraft-Biom für die Werkbank|Dein nächstes Biom steht auf der Werkbank.|Gestalte ein Modell aus Blöcken und exportiere die passenden Schnittplatten.
Baumeister aus dem Auenland|Bau dir ein kleines Stück Mittelerde.|Setze Blöcke zusammen und probiere die Montage deines Steckmodells aus.
Eine Festung für Hyrule|Auch eine Festung beginnt mit einem Block.|Passe Rastermaße an und lass aus Platten dein eigenes Modell entstehen.
Tetris wird zum Steckmodell|Hier wächst kein Zufall. Hier wächst dein Plan.|Verbinde Blöcke und prüfe, wie die Schnittplatten zusammenfinden.
Dein nächster Enterprise-Anbau|Deine Raumstation braucht noch einen Anbau.|Erweitere dein Modell und probiere den Aufbau in der Montagevorschau aus.
Minecraft ohne Würfelglück|Heute bestimmst du die Form der Welt.|Gestalte Rasterabschnitte und öffne Außenflächen nach deinem Entwurf.
Ein Bauplan für die Hobbit-Gefährten|Ein guter Bauplan bringt Teile zusammen.|Entwirf ein Steckmodell und bereite seine Schnittplatten vor.
Ein Turm für deine D&D-Kampagne|Dein Turm. Deine Regeln. Deine Platten.|Lege Maße fest und prüfe die Reihenfolge beim Zusammenbau.
Minecraft mit echtem Material|Mehr Raum für deine Bauideen.|Verbinde Blöcke zu einem eigenen Modell und exportiere die Schnittplatten.
Ein Außenposten auf Arrakis|Dein Außenposten nimmt Gestalt an.|Baue im Raster und passe die einzelnen Abschnitte an.
Tetris jenseits des Bildschirms|Die Welt ist eckig, bis du sie erweiterst.|Füge Blöcke hinzu und entdecke neue Formen für dein Steckmodell.
Die erste Bauquest in Hyrule|Setz den ersten Block deiner Geschichte.|Entwickle dein Modell und kontrolliere seine Montage.
Mario braucht noch einen Turm|Hier kommt nach dem Turm noch eine Idee.|Erweitere dein Steckmodell mit weiteren Blöcken und offenen Flächen.
Ein kleiner Ort aus Stardew Valley|Aus Blöcken wird ein Lieblingsort.|Plane Räume und bereite die passenden Platten für den Lasercutter vor.
Eine Burg für die Zelda-Karte|Aber reichlich Platz für eine Burg.|Gestalte dein Steckmodell und prüfe seinen Aufbau in der Vorschau.
Enterprise-Module auf der Werkbank|Eine Raumstation wächst nicht über Nacht.|Beginne mit einem Block und entwickle deine Konstruktion weiter.
Montage für deine D&D-Gruppe|Jedes Teil bekommt seinen Platz.|Prüfe, wie Platten und Baugruppen bei der Montage zusammenpassen.
Minecraft-Architekten am Werk|Dein nächstes Bauwerk wartet im Raster.|Wähle Maße, verbinde Blöcke und öffne die gewünschten Flächen.
Tetris im Materiallager|Aus dem Block wird dein Bauwerk.|Entwirf eine eigene Konstruktion und exportiere ihre Schnittplatten.
Vom Minecraft-Spawnpunkt zum Modell|Jeder Anbau erzählt weiter.|Erweitere das Modell und sieh dir die Montage Schritt für Schritt an.
Der W20 entscheidet heute keine Maße|Und jetzt wird daraus ein Modell.|Gestalte Rasterabschnitte mit eigenen Maßen und offenen Flächen.
Ein Hangar für R2-D2|Dein Hangar braucht keinen fernen Planeten.|Plane ihn aus Blöcken und prüfe den Aufbau aus Platten.
Der Turm ist größer als eine TARDIS-Skizze|Ein Turm ist eine Idee mit Etagen.|Verbinde Blöcke und passe die Abmessungen deinem Entwurf an.
Das Minecraft-Baumenü steht offen|Mehr Möglichkeiten pro Block.|Öffne Außenflächen und entwickle ein eigenes Steckmodell.
Die Montage-Gilde von Hyrule|Zusammenstecken ist Teil des Abenteuers.|Prüfe die Plattenfolge, bevor du deine Schnittdateien exportierst.
Portal-Testkammer aus Platten|Dein Bauplan bekommt eine dritte Dimension.|Entwirf mit Blöcken und probiere den Aufbau in der Montageansicht aus.
Minecraft-Fantasie im Raster|Selbst ein Würfel hat sechs Chancen.|Erweitere seine Seiten zu einer eigenen Konstruktion.
Ein Außenposten fürs Stargate-Team|Hier findet die Idee Anschluss.|Verbinde Blöcke und bereite maßhaltige Schnittplatten vor.
Ein kleiner Kosmos für die Enterprise|Aus wenig wird ein eigener kleiner Kosmos.|Beginne mit einem Block und entwickle dein Steckmodell weiter.
`),
'drehscheiben-studio': triples(`
Eine Drehquest für Link aus Zelda|Ein Motiv. Viele kleine Wendungen.|Lade dein SVG, verteile Schlitze und probiere die Drehschablone aus.
Drehprobe für kreative Padawane|Lass die Idee um ihre Mitte kreisen.|Gestalte aus deiner SVG-Zeichnung eine nummerierte Drehschablone.
Ein Ring mit Abstand zu Mordor|Nicht jeder Kreis führt nach Mordor.|Probiere deine Drehschablone aus und exportiere sie für den Lasercutter.
Portal auf einer runden Scheibe|Dein Bild nimmt eine andere Wendung.|Verteile Schlitze um die Achse und prüfe deinen Entwurf.
Ein rundes Fundstück aus Stardew Valley|Dieses Abenteuer dreht sich um dein Motiv.|Importiere ein SVG und bereite eine eigene Drehschablone vor.
Marios nächstes Drehlevel|Ein kleiner Dreh verändert die Perspektive.|Probiere die Bewegung aus, bevor du deine Schnittdatei exportierst.
Die Umlaufbahn der Enterprise|Dein Zielbild findet seinen Mittelpunkt.|Lade eine SVG-Zeichnung und gestalte die passende Schlitzverteilung.
Dein Motiv auf einer Star-Wars-Umlaufbahn|Heute dreht sich die Welt nach deiner Zeichnung.|Entwickle aus einem SVG eine nummerierte Schablone.
Ein Orbit für R2-D2|Gib deinem Motiv einen eigenen Orbit.|Prüfe die Drehbewegung und exportiere deinen Entwurf als SVG.
Ein Stargate für dein Linienmotiv|Hier führt jede Wendung zum Bild.|Importiere dein Motiv und passe die Drehschablone an.
Doctor Who auf einer neuen Umlaufbahn|Deine Zeichnung kommt in Bewegung.|Verteile Schlitze und probiere die Drehbewegung direkt im Browser aus.
Ein Dreh ohne Hogwarts-Zeitumkehrer|Für diese Wendung reicht eine Achse.|Gestalte deine Drehschablone und bereite den Laserschnitt vor.
Zeldas Rad der Möglichkeiten|Dein Motiv spielt die Hauptrolle.|Lade dein SVG und entwickle eine nummerierte Drehschablone.
Eine runde Karte von Hyrule|Ein Kreis voller kleiner Abenteuer.|Probiere die Schlitzverteilung deiner Schablone aus.
Star Trek auf Drehkurs|Dein Bild hat noch eine Wendung parat.|Importiere SVG-Linien und prüfe den Entwurf in Bewegung.
Die Hobbit-Geschichte dreht weiter|Aus Linien wird eine runde Geschichte.|Gestalte Schlitze und Beschriftung für deine Drehschablone.
Ein kleiner Mond für die Enterprise|Auch kleine Bilder können große Kreise ziehen.|Lade eine SVG-Zeichnung und bereite deinen Entwurf für den Laser vor.
Eine neue Fähigkeit für Link aus Zelda|Deine Zeichnung lernt einen neuen Trick.|Entwickle eine Schablone und kontrolliere die Drehbewegung.
Ein Wappen für die Ritter von Hyrule|Dein Wappen bekommt Bewegung.|Importiere ein Linienmotiv und gestalte daraus eine Drehschablone.
Doctor Who denkt in Runden|Jede Position zeigt ein Stück der Idee.|Probiere deine nummerierte Schablone vor dem Export aus.
Dein Motiv im Orbit von Arrakis|Das Zentrum gehört deinem Entwurf.|Verteile Schlitze um die Achse und prüfe ihre Geometrie.
Eine Plotwendung für die TARDIS|Deine Idee bleibt nicht auf der Stelle.|Lade dein SVG und entdecke die Bewegung deiner Schablone.
Tron braucht klare Linien|Für dieses Level brauchst du Linien.|Importiere dein SVG-Motiv und bereite den Laserschnitt vor.
Eine Reise durch das Stargate|Setz dein Motiv auf Rundkurs.|Gestalte eine nummerierte Drehschablone mit SVG-Export.
Ein Kreis für die Hobbit-Gefährten|Deine Linien finden ihre Bahn.|Entwickle aus deinem SVG eine Schablone und prüfe die Drehprobe.
Die Drehachse der Enterprise|Hier nimmt die Geschichte Fahrt auf.|Verteile die Schlitze deines Motivs und kontrolliere die Bewegung.
Portal zu einer neuen Perspektive|Neue Perspektiven liegen manchmal im Kreis.|Probiere deine Schablone aus und exportiere den fertigen Entwurf.
Eine runde Nebenquest in Stardew Valley|Dein nächstes Projekt hat einen Mittelpunkt.|Lade dein Motiv und gestalte eine eigene Drehschablone.
Eine Drehprobe für R2-D2|Auch eine Scheibe kann Geschichten erzählen.|Verwandle SVG-Linien in einen Entwurf für den Lasercutter.
Ein Star-Wars-Orbit für die Werkbank|Gib deiner Idee den entscheidenden Dreh.|Gestalte die Schlitze, prüfe die Bewegung und exportiere dein SVG.
`),
'box-studio': triples(`
Ein neues Inventar für Link aus Zelda|Dein Schatz bekommt ein Zuhause.|Gestalte ein Kästchen in 3D und exportiere die passenden Schnittteile.
Eine Schatztruhe aus Hyrule|Diese Truhe braucht kein Verlies.|Entwirf eine Kiste mit eigenen Ausschnitten und passendem Deckel.
Eine Raumkapsel für die Enterprise|Ein kleiner Kosmos mit Deckel.|Gestalte Formen, Flächen und bewegliche Einsätze für dein Kästchen.
Minecraft-Inventar aus eigener Werkstatt|Dein Inventar ist jetzt selbst gebaut.|Entwirf eine Kiste in 3D und bereite den Laserschnitt vor.
Die Schatzmeister von D&D|Hier passt mehr rein als eine Idee.|Wähle Form und Maße und gestalte dein eigenes Kästchen.
Ordnung im Hobbit-Haushalt|Auch Helden brauchen Ordnung.|Bearbeite Flächen und plane passende Zusatzbretter für deinen Entwurf.
Eine Loot-Kiste für deine Minecraft-Welt|Der nächste Schatz ist dein Entwurf.|Gestalte ein Kästchen und probiere bewegliche Teile aus.
Ein Geheimfach für Hogwarts-Post|Deine Idee bekommt vier Wände.|Entwirf eine Kiste mit eigenen Ausschnitten und passenden Verbindungen.
Ein Fundstück aus Stardew Valley|Das schönste Fundstück baust du selbst.|Gestalte dein Kästchen in 3D und exportiere die Schnittteile.
Ein kleiner Hort mit Abstand zu Mordor|Ein kleines Kästchen reicht für den Anfang.|Wähle deine Form und entwickle einen eigenen Entwurf.
Die Inventar-Erweiterung für Link aus Zelda|Gib deinem Inventar eine neue Form.|Entwirf Quader, weiche Ecken oder eine runde Dose.
Eine Schatzkarte aus Hyrule|Deine Werkbank hat eine neue Schatzkarte.|Gestalte die Flächen deiner Kiste und bereite den Laserschnitt vor.
Ein Zuhause für Minecraft-Fundstücke|Dein nächstes Abenteuer hat einen Deckel.|Entwirf dein Kästchen und prüfe bewegliche Einsätze.
Ein Hogwarts-Zauber für die Aufbewahrung|Hier wohnt die Fantasie zur Zwischenmiete.|Passe Maße, Ausschnitte und Zusatzbretter deinem Entwurf an.
Eine Kapsel für R2-D2|Eine Kapsel für deine kleinen Welten.|Gestalte eine Dose oder Kiste mit passendem Deckel.
Eine Truhe aus der Zelda-Welt|Mach Platz für deine eigene Geschichte.|Entwirf ein Kästchen und bearbeite seine Flächen im Studio.
Schatzsuche mit den Hobbit-Gefährten|Den Behälter für den Schatz hast du schon im Kopf.|Gestalte ihn in 3D und exportiere die Schnittteile für den Laser.
Ein Kästchen für Stardew-Valley-Sammler|Dein Lieblingsstück bekommt Nachbarn.|Entwirf eine Kiste mit passenden Zusatzbrettern und eigenen Motiven.
Eine Basisstation fürs Stargate-Team|Hier startet die Mission mit einem Deckel.|Plane Form, Material und bewegliche Teile deines Kästchens.
Mehr Stauraum in Minecraft|Mehr Platz für selbst gemachte Ideen.|Gestalte Quader, runde Ecken oder eine Dose nach deinem Plan.
Ein Gehäuse für ein Star-Wars-Droidenprojekt|Auch ein Raumschiff braucht eine Hülle.|Entwirf dein Kästchen und gestalte die benötigten Ausschnitte.
Eine Truhe für deine D&D-Kampagne|Diese Kiste gibt es nur in deinem Bauplan.|Bearbeite Flächen und exportiere die passenden Schnittteile.
Die nächste Loot-Pause in Hyrule|Das Kästchen ist die eigentliche Belohnung.|Gestalte einen eigenen Entwurf mit Deckel und Zusatzbrettern.
Ein Schieber aus der Aperture-Werkstatt|Ein Schieber kann der Anfang einer Geschichte sein.|Probiere bewegliche Einsätze für deine Konstruktion aus.
Ein kleines Lager auf der Enterprise|Alles an Bord hat seinen Platz.|Gestalte Maße, Flächen und Zusatzbretter für dein Kästchen.
Eine Schatzkarte für Link aus Zelda|Das Ziel liegt auf deiner Werkbank.|Entwirf eine eigene Kiste und bereite ihre Schnittteile vor.
Inventar mit Minecraft-Handschrift|Dein Inventar zeigt jetzt Handschrift.|Zeichne Ausschnitte, setze Motive und gestalte dein eigenes Kästchen.
Eine TARDIS braucht auch eine Tür|Hier hebt sich der Vorhang nach oben.|Entwirf dein Kästchen und prüfe die Bewegung seines Deckels.
Eine Nebenquest aus Stardew Valley|Ein kleines Projekt für große Fundstücke.|Wähle Form und Maße und exportiere deinen Entwurf als Schnittteile.
Eine Werkstatt für kleine Hobbit-Schätze|Bau einen Ort für deine Schätze.|Gestalte Kästchen, Flächen und Einsätze direkt im 3D-Studio.
`),
'klappkarten-studio': triples(`
Ein Portal aus einem Bogen Papier|Eine neue Welt wartet zwischen zwei Seiten.|Zeichne Flächen im Raum und gestalte eine Klappkarte aus einem Bogen.
Papiermagie aus Hogwarts|Dein Blatt hat eine geheime Dimension.|Gestalte räumliche Flächen und prüfe das Aufklappen deiner Karte.
Eine Bühne für Doctor Who|Aus einem Bogen wird eine kleine Bühne.|Entwirf eine Klappkarte und exportiere ihren Schnittbogen als SVG.
Eine kleine Welt aus Hyrule|Dein Abenteuer steht plötzlich im Raum.|Zeichne Flächen und lass daraus eine Karte mit Schnitten und Falzen werden.
Hogwarts-Zauber mit Falzkante|Deine Idee bekommt einen großen Auftritt.|Gestalte Flächen im 3D-Raum und probiere das Aufklappen aus.
Ein Brief ohne Hogwarts-Eule|Diese besondere Post entsteht bei dir.|Entwirf eine Klappkarte aus einem Bogen und bereite den Schnitt vor.
Eine Papierbühne für Mario|Der Vorhang hebt sich beim Aufklappen.|Zeichne deine Motive im Raum und prüfe die Bewegung der Karte.
Ein Papierkosmos für die Enterprise|Hier passt eine Welt zwischen zwei Deckel.|Gestalte deine Klappkarte und exportiere den maßhaltigen Schnittbogen.
Ein Stargate zwischen zwei Seiten|Dein Portal braucht nur einen Bogen.|Entwirf räumliche Flächen mit Papierstegen, Schnitten und Falzen.
Die verborgenen Kräfte eines Hogwarts-Blatts|Ein Blatt zeigt seine verborgenen Kräfte.|Gestalte eine Klappkarte und probiere das Öffnen in der Vorschau aus.
Eine Faltquest für Link aus Zelda|Jede Falte führt ein Stück weiter.|Zeichne Flächen im Raum und entwickle eine Karte aus einem Bogen.
Ein Gruß aus dem Auenland|Deine Karte hat mehr als zwei Seiten.|Gestalte räumliche Motive und exportiere den passenden Schnittbogen.
Ein Auftritt für Papier-R2-D2|Dein nächster Auftritt klappt von selbst auf.|Prüfe das Aufklappen deiner selbst gestalteten Karte in der Vorschau.
Minecraft-Welten auf Papierstegen|Heute steht die Fantasie auf Papierstegen.|Zeichne Flächen im Raum und lass den Schnittbogen berechnen.
Ein neues Kapitel für die Hobbit-Gefährten|Dieses Kapitel lässt sich aufklappen.|Gestalte deine Karte aus einem Bogen mit Schnitten und Falzen.
Durchs Portal in die dritte Dimension|Die dritte Dimension liegt im nächsten Falz.|Entwickle räumliche Motive und kontrolliere das Öffnen deiner Karte.
Ein Papierabenteuer in Stardew Valley|Kleine Schnitte öffnen neue Welten.|Gestalte eine Klappkarte und exportiere ihren SVG-Schnittbogen.
Hogwarts-Werken für Zauberlehrlinge|Gib deinem Blatt einen überraschenden Auftritt.|Zeichne räumliche Flächen und prüfe die entstehende Klappkarte.
Eine Zelda-Fähigkeit aus Papier|Deine Idee steht beim Öffnen auf.|Entwirf aus einem Bogen eine Karte mit Papierstegen und Falzen.
Eine TARDIS-Szene zum Aufklappen|Ein stilles Blatt wird zur kleinen Szene.|Gestalte Flächen im Raum und probiere die Bewegung aus.
Ein Gruß aus Hyrule mit Plotwendung|Diese Karte hat einen räumlichen Auftritt.|Entwirf deine Motive und bereite einen maßhaltigen Schnittbogen vor.
Ein Stargate für Papierabenteuer|Hier klappt eine neue Welt auf.|Gestalte eine Karte aus einem Bogen und prüfe ihre Bewegung.
Ein Falz nach Hogwarts|Deine Zeichnung verlässt die Fläche.|Setze Flächen im Raum und exportiere den Schnittbogen deiner Klappkarte.
Eine Bühne für deine D&D-Kampagne|Papier kann mehr als Kulisse sein.|Gestalte räumliche Motive und kontrolliere Schnitte und Falze.
Eine kleine Minecraft-Szene zwischen Seiten|Aus einem Blatt wird dein Schauplatz.|Entwirf eine Klappkarte und probiere das Aufklappen aus.
Hogwarts-Magie aus Schnitt und Falz|Die Magie steckt in Schnitt und Falz.|Gestalte Flächen im Raum und bereite deinen Schnittbogen vor.
Premiere für einen Papier-Mario|Eine Idee wartet auf ihren ersten Auftritt.|Entwickle eine Klappkarte und prüfe ihre Bewegung in der Vorschau.
Eine Doctor-Who-Geschichte mit Tiefe|Beim Aufklappen beginnt die Geschichte.|Gestalte aus einem Bogen eine räumliche Karte mit eigenen Motiven.
Die nächste Dimension bei Aperture|Die nächste Dimension ist nur einen Falz entfernt.|Zeichne Flächen im Raum und exportiere deinen SVG-Schnittbogen.
Eine Reise ins Auenland per Umschlag|Eine ganze Szene passt in einen Umschlag.|Entwirf deine Klappkarte und prüfe das Öffnen vor dem Export.
`),
'zahnrad-studio': triples(`
Die Hobbit-Gefährten der Mechanik|Zwei Räder. Ein gemeinsames Abenteuer.|Gestalte Zahnradpaare und probiere ihr Zusammenspiel in der Drehprobe aus.
Ein Uhrwerk ohne Hogwarts-Zeitumkehrer|Deine Idee greift Zahn für Zahn.|Wähle Zähne und Speichen und exportiere deinen Entwurf als SVG.
Getriebe auf der Enterprise-Brücke|Setz Kurs auf Bewegung.|Gestalte ein Zahnradpaar und prüfe seinen Eingriff in der Vorschau.
Ein Uhrwerk für die TARDIS|Hier kommt die Fantasie ins Rollen.|Passe Zahnformen und Speichen an und probiere die Bewegung aus.
Ein neues Mechanik-Level für Mario|Dein nächstes Level hat Zähne.|Gestalte Zahnradpaare mit eigenen Profilen für deinen Lasercutter.
Der Maschinenraum der Enterprise|Zwei Räder erzählen dieselbe Geschichte.|Probiere den Eingriff deiner Zahnräder aus und exportiere den Entwurf.
Doctor Who braucht heute zwei Räder|Diese Räder drehen nach deinem Plan.|Gestalte Zähne, Endformen und Speichen direkt im Studio.
Die Zahnrad-Gilde von Hyrule|Gutes Zusammenspiel beginnt am Teilkreis.|Entwirf dein Zahnradpaar und prüfe seine Bewegung.
Steampunk für Hogwarts-Erfinder|Dein Werkstück bekommt einen eigenen Rhythmus.|Gestalte feine oder flache Zähne und passende Speichen.
Eine mechanische Mission für R2-D2|Jeder Zahn bringt die Idee weiter.|Probiere dein Zahnradpaar aus und bereite den SVG-Export vor.
Hogwarts-Magie im Uhrwerk|Zwei Formen finden einen Takt.|Entwirf Zahnräder und kontrolliere ihren Eingriff in der Drehprobe.
Ein Antrieb für die Minecraft-Werkstatt|Der Antrieb deiner Geschichte entsteht hier.|Gestalte Zahnradpaare mit eigenen Zähnen und Speichen.
Ein Star-Wars-Getriebe auf der Werkbank|Eine kleine Drehung setzt viel in Bewegung.|Prüfe dein Zahnradpaar und exportiere den Entwurf für den Laser.
Die nächste Mechanik-Quest für Link aus Zelda|Lass deine Ideen ineinandergreifen.|Wähle Zahnprofile und probiere das Zusammenspiel beider Räder aus.
Tron mit einem eigenen Zahnprofil|Dein Rad darf ruhig Ecken zeigen.|Gestalte flache, spitze, runde oder eigene Zahnenden.
Zwei Räder auf Enterprise-Mission|Ihr gemeinsamer Weg führt im Kreis.|Entwirf Zahnradpaare und kontrolliere ihre Bewegung.
Ein Zahnradpaar für D&D-Gefährten|Ein Zahnrad kommt selten allein.|Gestalte ein passendes Paar und exportiere es als SVG.
Der Maschinenraum von Star Trek|Deine Idee braucht einen Antrieb.|Passe Zähne und Speichen an und probiere die Drehprobe aus.
Eine Geschichte aus der Aperture-Werkstatt|Hier greift ein Einfall in den nächsten.|Gestalte dein Zahnradpaar und prüfe den Eingriff.
Ein Getriebe für deine Minecraft-Welt|Auch ein kleines Getriebe kann Hauptrolle spielen.|Entwirf eigene Zahnformen und bereite deinen Laserschnitt vor.
Ein neues Kapitel für die TARDIS|Zahn für Zahn kommt Bewegung in den Plan.|Probiere beide Räder aus und exportiere deinen Entwurf.
Uhrwerkbauer aus Hogwarts|Dein Rhythmus beginnt mit zwei Rädern.|Gestalte Zahnradpaare mit wählbaren Speichen und Profilen.
Ein Antrieb für R2-D2|Deine Idee findet den richtigen Dreh.|Entwirf ein Zahnradpaar und kontrolliere sein Zusammenspiel.
Ein Mario-Level mit Werkstattzähnen|Diese Zähne sind für deine Werkbank.|Gestalte dein Zahnprofil und exportiere den Entwurf als SVG.
Ein Zahnradabenteuer in Hyrule|Das nächste Abenteuer greift ineinander.|Wähle Zähnezahl, Zahnform und Speichen für dein Paar.
Mechanik auf den Spuren von Metroid|Bewegung hat manchmal ein sehr feines Profil.|Gestalte feine Zähne und prüfe den Eingriff in der Drehprobe.
Ein Getriebe aus der Tron-Werkstatt|Dein Getriebe bekommt eine eigene Handschrift.|Entwirf Zahnenden und Speichen nach deinen Vorstellungen.
Eine Mechanik-Nebenquest in Stardew Valley|Ein kleines Rad kann den Anfang machen.|Ergänze sein Gegenstück und probiere die Bewegung aus.
Zwei Räder aus Hogwarts-Werken|Hier arbeiten zwei Räder an einer Idee.|Gestalte das Paar und bereite seinen SVG-Export vor.
Ein neuer Antrieb für die Enterprise|Gemeinsam drehen die Räder weiter.|Prüfe dein Zahnradpaar und exportiere es für den Lasercutter.
`),
};
