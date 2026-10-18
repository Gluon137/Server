# Server und Digitale Werkstatt

Gemeinsames Git-Repository für die Website, die Studios, ihre Tests sowie
Server-Konfigurationen und Deployment-Skripte.

## Aufbau

- `website/`: Startseite, Studios, gemeinsame Browsermodule und mitgelieferte Bibliotheken.
- `tests/`: Prüfungen der Studios, Serverdienste und Deployment-Abläufe.
- `.server-tools/deploy-*.py`: Deployment-Skripte.
- `.server-tools/problem-reports/`: Meldungsdienst mit Apache- und systemd-Konfiguration.
- Startskripte im Hauptverzeichnis: lokale Server für Baustein- und Kästchen-Studio.

## Gestaltung

Startseite, Studios und Berichtsübersicht teilen sich eine Gestaltungsgrundlage unter
`website/shared/`:

- `werkstatt.css`: Farb-, Schrift- und Abstandsvariablen (`--ws-*`), Kopfleiste, Studio-Umschalter,
  Schaltflächen und Fußzeile. Jedes Studio setzt über `data-app` eine eigene Akzentfarbe.
  Studio-Stylesheets laden danach und verwenden diese Variablen.
- `icons.svg`: gemeinsame Linien-Icons, eingebunden über `<use href="…/shared/icons.svg#i-…">`.
- `studios.mjs` und `werkstatt.mjs`: eine Studioliste für den Umschalter in der Kopfleiste
  und für den Hinweis „Entwurf gespeichert“ auf der Startseite.

Auf breiten Bildschirmen füllt die Werkbank eines Studios das Fenster; die Einstellungen
scrollen getrennt von der Vorschau. Sichtbarer Text ist mindestens 12 px groß.
`node tests/werkstatt-shell.mjs` prüft, dass alle Studios dieselbe Grundlage einbinden.

Beim Veröffentlichen zuerst `.server-tools/deploy-workshop-updates.py` ausführen: Nur dieses
Skript liefert `website/shared/` aus. Die Skripte für Automaten-, Baustein- und Kästchen-Studio
brechen ab, solange die gemeinsamen Gestaltungsdateien auf dem Server nicht aktuell sind.

## Lokal starten

Für die statischen Anwendungen im Hauptverzeichnis ausführen:

```sh
python3 -m http.server 8765 --directory website --bind 127.0.0.1
```

Danach `http://127.0.0.1:8765/` öffnen. Baustein- und Kästchen-Studio benötigen
für ihre Berechnungen die Startskripte `./start-baustein-studio.sh` beziehungsweise
`./start-box-studio.sh`. Weitere Start- und Prüfhinweise stehen in den README-Dateien
der Studios.

## Zugangsdaten und lokale Dateien

`.gitignore` schließt Zugangsdaten, lokale Python-/Node-Abhängigkeiten, Caches,
Testausgaben, Protokolle, Datenbanken und Backups aus.
Mitgelieferte Browserbibliotheken unter `website/**/vendor/` gehören zum Quellbestand;
dazu zählt die von SVG-Edit direkt importierte Bibliothek `browser-fs-access`.

`credentials.md`, `credentials Kopie.env`, `workshop-zugang.json` und
`.server-tools/askpass.py` bleiben ausschließlich lokal. Die Ausschlussregel für
das frühere `set-terraria-password.sh` verhindert die versehentliche Aufnahme einer
wiederhergestellten Kopie mit festem Passwort.
Die Dateien werden durch die Git-Einrichtung nicht gelöscht.

Deployment setzt die lokale SSH-Authentifizierung voraus; die vorhandenen Skripte
verwenden dafür unter anderem die ausgeschlossene `askpass.py` und für authentifizierte
Prüfungen `workshop-zugang.json`. Einige ältere Skripte enthalten lokale absolute Pfade.
Ein frischer Checkout veröffentlicht daher nicht ohne zusätzliche lokale Einrichtung.

Git verwaltet den Projektstand. Zugangsdaten und andere Laufzeitdaten
benötigen eine separate Sicherung.

## Stillgelegte Anwendungen

Terraria, ILIAS und Haustier-Arena werden nicht mehr betrieben. Die zugehörigen
Einrichtungsdateien und ILIAS-Lernmaterialien wurden am 17. Oktober 2026 aus dem
aktuellen Projektstand entfernt; der bisherige Quellbestand bleibt in der Git-Historie.
Lokale Restdateien liegen ausschließlich in der ausgeschlossenen Sicherung
`backups/retired-apps-20261017/`. Die geschützte Serversicherung liegt unter
`/var/backups/retired-apps-20261017-165656/`; bestehende Arena-Backups bleiben erhalten.
