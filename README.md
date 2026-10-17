# Server und Digitale Werkstatt

Gemeinsames Git-Repository für die Website, die Studios, ihre Tests sowie
Server-Konfigurationen und Deployment-Skripte.

## Aufbau

- `website/`: Startseite, Studios, gemeinsame Browsermodule und mitgelieferte Bibliotheken.
- `tests/`: Prüfungen der Studios, Serverdienste und Deployment-Abläufe.
- `.server-tools/deploy-*.py`: Deployment-Skripte.
- `.server-tools/problem-reports/`: Meldungsdienst mit Apache- und systemd-Konfiguration.
- `ilias-lernmodul/`: Quellcode des ILIAS-Lernmoduls.
- Skripte und `terraria.service` im Hauptverzeichnis: lokale Starts und Server-Einrichtung.

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
Testausgaben, Protokolle, Datenbanken, Terraria-Spielstände und Backups aus.
Mitgelieferte Browserbibliotheken unter `website/**/vendor/` gehören zum Quellbestand;
dazu zählt die von SVG-Edit direkt importierte Bibliothek `browser-fs-access`.
Das SCORM-ZIP wird als erzeugtes Paket ausgeschlossen; der Lernmodul-Quellcode bleibt enthalten.

`credentials.md`, `credentials Kopie.env`, `workshop-zugang.json` und
`.server-tools/askpass.py` bleiben ausschließlich lokal. Das vorhandene
`set-terraria-password.sh` enthält ein festes Passwort und bleibt ebenfalls ausgeschlossen.
Die Dateien werden durch die Git-Einrichtung nicht gelöscht.

Deployment setzt die lokale SSH-Authentifizierung voraus; die vorhandenen Skripte
verwenden dafür unter anderem die ausgeschlossene `askpass.py` und für authentifizierte
Prüfungen `workshop-zugang.json`. Einige ältere Skripte enthalten lokale absolute Pfade.
Ein frischer Checkout veröffentlicht daher nicht ohne zusätzliche lokale Einrichtung.

Git verwaltet den Projektstand. Zugangsdaten, Spielstände und andere Laufzeitdaten
benötigen eine separate Sicherung.
