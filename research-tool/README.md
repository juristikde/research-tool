# Recherche-Helfer → XML-Quellen

**Assisted-manuelles Werkzeug** für Recherche-Prompts: Du liest genau die Seite aus, die du gerade offen hast (Webseite oder PDF), und die Erweiterung bereitet den Volltext als strukturierte Quelle auf:

```xml
<!-- 1 Quelle, 12.345 Zeichen Inhalt -->
<quelle><url><![CDATA[https://example.com/artikel]]></url><titel><![CDATA[Titel der Seite]]></titel><inhalt><![CDATA[ … Volltext … ]]></inhalt></quelle>
```

Keine Automatisierung: Es wird **niemals automatisch** durch Suchergebnisse oder Linklisten gegangen. Jede Quelle entsteht nur durch Deine explizite Aktion (Button oder `Alt+Shift+R`). Alles läuft lokal im Browser, ohne Cloud, ohne Server.

## Installation
`chrome://extensions` → Entwicklermodus aktivieren → „Entpackte Erweiterung laden“ → diesen Ordner (`research-tool`) wählen.

## Bedienung
1. Seite öffnen (optional: Text markieren, um nur die Markierung zu übernehmen)
2. **Alt+Shift+R** oder „Aktuelle Seite auslesen“
3. Weitere Quellen sammeln (gleiche URL wird ersetzt statt doppelt)
4. Format XML oder Markdown wählen → **Kopieren** oder **Download** → in den Prompt einfügen

### Assisted-Workflow (z. B. Google-Recherche)
1. Google-Suche öffnen, Ergebnisse **selbst** anklicken (das Tool geht nie selbst durch Treffer)
2. Auf jeder interessanten Seite: `Alt+Shift+R`
3. Am Ende: „Kopieren“ → alle Quellen liegen als XML-Sammlung in der Zwischenablage

## Auslesen im Detail
- **Standard: gesamter sichtbarer Seitentext** (Body, nicht nur `<article>`)
- Optional nur Hauptinhalt (`article`/`main`/Absatz-Cluster) oder nur die Textmarkierung
- Zugeklappte `<details>` und „Mehr anzeigen“ werden geöffnet (max. 12 Klicks)
- Same-Origin-Iframes werden mitgelesen
- Cookie-Banner/Werbung optional ausblenden (Nav/Footer bleiben erhalten)
- Metadaten (Autor, Datum, Seitenname, Sprache), Struktur (Überschriften/Listen/Tabellen) und Text aus Shadow DOM
- Bis zu 4 Scroll-Durchgänge für Lazy Load / Infinite Scroll (einstellbar)
- Textbereinigung: Leerzeichen, Zero-Width-Zeichen, Bidi-Steuerzeichen, Skip-Links
- Warten auf stabilen Seitentext (DOM-Änderungen werden abgewartet)

## PDF
PDFs werden automatisch erkannt (URL, Content-Type oder `%PDF-`-Magic Bytes via Range-Request) und lokal mit [pdf.js](lib/pdfjs-LICENSE.txt) im Offscreen-Dokument ausgelesen. Der komplette Text aller Seiten wird extrahiert (bis 150 MB). Es gibt bewusst **kein** „PDF überspringen“ mehr: Wird eine PDF angefragt, wird sie auch gelesen.

## Export
- **XML**: `<quelle>`-Blöcke mit `<url>`, optional `<titel>` und `<gelesen>` (CDATA-sicher)
- **Markdown**: nummerierte Quellenabschnitte
- Beides mit kurzer Kopfzeile (Anzahl Quellen / Zeichen), Copy oder Datei-Download

## Verwaltung
- Quellenliste mit Titel, Host, Zeichenzahl, Einzel-Entfernen
- Undo (letzte Quelle entfernen), Cleanup (inhaltliche Dubletten per 3-Wort-Shingles/Jaccard), Clear
- Zeitlich unbegrenzt gespeichert (chrome.storage.local, unbegrenzt), Badge zeigt Quellenanzahl
- Bei sehr großem Text: optionale Abfrage, wie gekürzt werden soll (fragmentarisch wortweise, Hard Cut oben/unten)

## Datennutzung & Privatsphäre
- Es gibt **keinen** Serverkontakt des Tools selbst; Seiten werden nur über den normalen Browser-Traffic geladen.
- Google-Weiterleitungs-URLs (`/url?q=…`) und Tracking-Parameter (utm_*, gclid, fbclid, …) werden beim Speichern der URL entfernt.
- Beim Cleanup werden nur echte inhaltliche Dubletten entfernt, nie unterschiedliche Quellen.
- Optional: Sperrliste für Domains und Maskieren sensibler Angaben (siehe Einstellungen → Datenschutz).

## Tastenkürzel
| Kürzel | Aktion |
|---|---|
| `Alt+Shift+R` | Aktuelle Seite auslesen (auch ohne offenes Popup) |
| `Alt+Shift+C` | Gesamte Sammlung in die Zwischenablage kopieren |
| `Alt+Shift+Z` | Letzte Quelle entfernen |
| Rechtsklick auf Markierung | Markierung als Quelle hinzufügen |

## Änderungen in v2.8.0
- **Bestätigung direkt auf der Seite:** Nach `Alt+Shift+R`, `Alt+Shift+C` und `Alt+Shift+Z` erscheint unten rechts eine kleine Meldung (z. B. „✓ Gelesen · 3 Quellen · ≈ 12.687 Token“, bei Fehlern „! …“ mit dem Grund) – auch ohne offenes Popup. Die Meldung liegt in einem geschlossenen Shadow-DOM und wird nie mit ausgelesen (per Test geprüft); abschaltbar unter Darstellung
- **Platzhalter im Prompt-Rahmen:** `{datum}`, `{uhrzeit}`, `{anzahl}`, `{zeichen}`, `{token}` und `{quellenliste}` (nummeriertes Quellenverzeichnis) werden beim Kopieren/Download ersetzt; die Vorlagen „Zusammenfassung“ und „Quellen vergleichen“ nutzen sie
- **Quellen filtern:** Ab mehr als sechs Quellen erscheint ein Suchfeld über der Liste (Titel und URL)
- **Kopfzeile:** Versions-Pille neben dem Titel

## Änderungen in v2.7.0
- **Quellen ein-/ausschalten:** Jede Quelle hat einen Schalter. Ausgeschaltete Quellen bleiben gespeichert, fließen aber nicht in Export, Kopieren, `Alt+Shift+C`, Statistik und Token-Budget ein – ideal zum Ausprobieren, welche Quellen im Prompt landen sollen. Zähler zeigt „n aus“
- **Einzelne Quelle kopieren (⧉)** direkt in der Liste, auch wenn sie ausgeschaltet ist
- **Seiten-Infostreifen über dem Auslesen-Button:** zeigt Domain und Titel des aktuellen Tabs mit Status: *neu*, *PDF · neu*, *in Sammlung · wird ersetzt*, *gesperrt* (Sperrliste) oder *nicht lesbar* (Browser-Seiten) – bei gesperrten/nicht lesbaren Seiten ist der Auslesen-Button deaktiviert
- **Farbige Quellen-Avatare** pro Domain, ausgeschaltete Quellen werden abgedunkelt und durchgestrichen
- **Anleitung im Leerzustand** (3 Schritte) statt leerer Fläche
- Tests: Ein/Aus (Export, Statistik, Einzelkopie, Kopier-Kürzel), Tab-Info und Darstellung im Popup

## Änderungen in v2.6.0
- **Kopieren-Button repariert:** Seit dem Wiederherstellen-Button standen sechs Buttons in einer Zeile und „Kopieren“ wurde gequetscht. Jetzt gibt es einen großen, vollbreiten Kopieren-Button und darunter fünf gleich breite Kacheln mit Symbolen (Download, Undo, Cleanup, Zurück, Leeren)
- **Sammel-Bereich als Karte:** Quellen, Statistik, Liste, Vorschau, Text und Aktionen sind in einem Panel mit farbigem Akzentstreifen zusammengefasst
- **Symbole** an den Hauptbuttons (Lupe, Kopieren, Download usw.) mit kleinen Hover-Animationen
- **Tastenkürzel-Leiste** unten als übersichtliche Chips; **Versionsanzeige** in der Kopfzeile
- Der Button „Leeren“ heißt jetzt so (statt „Clear“); „↺“ heißt „Zurück“

## Änderungen in v2.5.0
- **„Auf Budget kürzen“:** Überschreitet die Sammlung das eingestellte Token-Budget, erscheint unter dem Balken ein Button. Er kürzt nach dem Wasserstandsverfahren: kurze Quellen bleiben komplett, die längsten teilen sich den verbleibenden Platz gleichmäßig (Methode wie unter Textbegrenzung: fragmentarisch, von oben oder von unten). Es geht keine Quelle verloren, vorher wird gesichert – „↺“ stellt die Originale wieder her
- Tests: Algorithmus (alle drei Methoden, Budget eingehalten, kurze Quellen unangetastet), Ende-zu-Ende inkl. Wiederherstellen und Popup-Button

## Änderungen in v2.4.0
- **`Alt+Shift+C`:** kopiert die gesamte Sammlung (im gewählten Format, inkl. Prompt-Rahmen) in die Zwischenablage – ganz ohne Popup. Zusammen mit `Alt+Shift+R` lässt sich so komplett per Tastatur recherchieren: Seiten auslesen, kopieren, im Chat einfügen. Das Badge bestätigt mit „⧉“ (bzw. „!“ bei leerer Sammlung)
- **Große Sammlungen:** Das Textfeld im Popup zeigt ab ca. 120.000 Zeichen nur Anfang und Ende (mit Hinweis), damit das Popup flüssig bleibt; **Kopieren und Download enthalten immer den vollständigen Text**

## Änderungen in v2.3.0
- **Datenschutz (Einstellungen → Datenschutz):**
  - **Sensible Angaben maskieren (Grundschutz):** E-Mail-Adressen, gültige IBANs (Prüfziffer), Kreditkartennummern (Luhn-Prüfung) sowie typische API-Schlüssel und Tokens (z. B. `sk-…`, `AKIA…`, `ghp_…`, JWT, Bearer) werden vor dem Speichern durch Platzhalter wie `[E-MAIL]` ersetzt; die Statusmeldung nennt die Anzahl. Telefonnummern und Namen werden bewusst nicht erkannt
  - **Sperrliste:** Domains (inkl. Subdomains), die nie ausgelesen werden – gilt auch für den Rechtsklick
  - **Warnung bei Passwortfeldern** (Login-Seiten)
- Kein Maskieren ist eine Garantie: Vor dem Einfügen in einen Prompt den Inhalt weiterhin kurz prüfen

## Änderungen in v2.2.0
- **Struktur im Text:** Überschriften werden als `#`/`##` … markiert (Standard), optional auch Listenpunkte (`-`, `1.`). Das Modell erkennt so die Gliederung der Seite. Die Marker werden nur für einen synchronen Augenblick in die Seite eingefügt und sofort wieder entfernt (per Test geprüft)
- **Tabellen:** Zellen einer Zeile werden mit ` | ` getrennt statt mit unsichtbaren Tabulatoren
- **Lokale Dateien (`file://`):** HTML und PDF auf dem eigenen Rechner können ausgelesen werden, sobald in `chrome://extensions` für die Erweiterung „Zugriff auf Datei-URLs zulassen“ aktiviert ist; ohne Freigabe erscheint ein klarer Hinweis
- **Einstellungen exportieren/importieren** (JSON) – praktisch zum Sichern oder Übertragen auf einen anderen Rechner; unbekannte Schlüssel werden ignoriert, Werte werden geprüft
- **Token-Budget-Hinweis:** Beim Überschreiten des Budgets erscheint einmalig eine Meldung

## Änderungen in v2.1.0
- **Wiederherstellen (↺):** Vor jedem Clear, Cleanup, Entfernen und Undo wird die Sammlung gesichert; „↺“ holt sie zurück (ein zweiter Klick macht es wieder rückgängig). Dafür entfällt die Rückfrage beim Clear
- **Profile:** „Ausgewogen“, „Token sparen“ und „Maximal vollständig“ setzen mehrere Einstellungen mit einem Klick (Einstellungen → Profile & Prompt-Vorlagen); das aktive Profil wird markiert
- **Prompt-Vorlagen:** Zusammenfassung mit Quellenangaben, Faktencheck, Quellenvergleich, Daten extrahieren – füllen Text vor/nach den Quellen und aktivieren Nummerierung und Wurzelelement; danach frei editierbar
- **Komfort:** `Enter` im Popup liest die aktuelle Seite aus; Statusmeldungen sind für Screenreader als Live-Region markiert
- **Tests:** Backup/Restore, Profile und Vorlagen werden automatisch geprüft (Profile/Vorlagen nur mit gültigen Einstellungsschlüsseln und -werten)

## Änderungen in v2.0.0
- **Neues Design „Sunset“:** Neon-Sonnenuntergang mit Sonne, Palmen und animiertem Retro-Raster in der Kopfzeile, kräftige Großbuchstaben-Typografie, Pink/Orange/Violett-Verläufe. Dazu die helle Variante „Day“ und „Automatisch“ (Einstellungen → Darstellung)
- **Animationen im Social-App-Stil:** federnde Pill-Buttons, rollende Zähler für Quellen/Zeichen/Token, Partikel-Burst beim Kopieren und nach erfolgreichem Auslesen, Toast-Meldungen, seitliches Hereingleiten der Einstellungen, Quellen gleiten ein bzw. aus, Ping-Puls im Status; abschaltbar („Animationen“) und „Bewegung reduzieren“ wird respektiert
- **Token-Budget-Balken:** zeigt, wie viel deines Budgets (einstellbar, Standard 200.000) die Sammlung belegt; Farbe wechselt von Türkis über Orange zu Pink
- **Quellen-Vorschau:** Klick auf den Titel einer Quelle zeigt die ersten ca. 2.500 Zeichen
- Hinweis: Das Design lehnt sich nur an eine Stimmung an; es werden keine Logos oder Markenzeichen verwendet

## Änderungen in v1.9.0
- **Neues Design:** modernes Layout in Hell/Dunkel, Schalter statt Checkboxen, Farbverlauf-Kopfzeile mit neuem Logo, Fokus-Rahmen für Tastaturbedienung
- **Animationen (dezent):** Fortschrittsbalken und Glanz auf dem Button während des Auslesens, Klick-Welle auf Buttons, weiches Einblenden von Statusmeldungen, neuen Quellen und Einstellungen, animierter Haken beim Kopieren, drehendes Zahnrad; respektiert die System-Einstellung „Bewegung reduzieren“
- **Quellenliste:** nummeriert, wird nur noch bei echten Änderungen neu aufgebaut (kein Flackern, Scrollposition bleibt), Leerzustand mit Hinweis
- **Kompaktere Leiste** mit Anzahl, Zeichen und Token-Schätzung in einer Zeile
- **Test:** `test/popup.mjs` prüft die Oberfläche (Rendering, Einstellungen, kein Neuaufbau je Tick)

## Änderungen in v1.8.0
- **Prompt-Rahmen:** eigener Text vor und nach den Quellen (Einstellungen → Export), z. B. Aufgabe und Frage – wird beim Kopieren/Download mit ausgegeben
- **Rechtsklick → „Markierung als Quelle hinzufügen“:** mehrere Textausschnitte derselben Seite möglich (werden angehängt, nicht ersetzt)
- **Linkliste** je Quelle (`<links>`), optional und begrenzbar
- **Navigation/Footer/Seitenleisten weglassen** (optional) spart Token
- **Wiederholte Zeilen zusammenfassen** (z. B. Menüeinträge)
- **Neues Tastenkürzel** `Alt+Shift+Z`: letzte Quelle entfernen (ohne Popup)
- **Fehler behoben:** Das CSS zum Ausblenden von Cookie-Bannern/Werbung enthielt leere Selektoren (`,,`), wodurch der Browser die ganze Regel verwarf – jetzt gültig und per Test abgesichert

## Änderungen in v1.7.1
- **Sicheres Aufklappen (kein ungewolltes Öffnen weiterer Seiten):**
  - Echte Links (`<a href=…>`), `target=_blank`, Downloads und Formular-/Submit-Buttons werden **nie** angeklickt; geklickt wird nur auf echte Buttons, `<summary>` und ARIA-Toggles
  - Während des Aufklappens werden Seitenwechsel, `window.open` und Formular-Absenden blockiert
  - Trotzdem geöffnete Tabs werden automatisch geschlossen; verlässt die Seite sich selbst, kehrt das Tool zurück und liest ohne Aufklappen weiter
  - Test deckt Link, `_blank`-Link, Formular-Button und normalen Toggle ab

## Änderungen in v1.7.0
- **Stabilität:** Doppelstart-Schutz (zweimal `Alt+Shift+R` startet nicht zwei Läufe); Service Worker wird während des Auslesens wachgehalten, damit lange PDFs nicht mittendrin abbrechen
- **Metadaten:** Autor, Veröffentlichungsdatum, Seitenname, Sprache, Beschreibung (aus Meta-Tags und JSON-LD) als eigene Elemente – ideal zum Zitieren
- **PDF:** Titel/Autor/Datum aus den PDF-Metadaten, optionale Seitenmarker `[Seite 3]`, Seitenzahl in der Statusmeldung
- **Shadow DOM:** Text aus Web-Components (offene Shadow Roots) wird ergänzt
- **Export:** optional `<quellen>`-Wurzelelement und `id`-Nummerierung (`<quelle id="1">`); Kopfzeile mit Token-Schätzung
- **Quellenliste:** Reihenfolge per ↑/↓ ändern, Datum je Quelle, Token-Schätzung der Sammlung
- **Tests:** `test/` enthält Unit-, PDF- und End-to-End-Tests (gemocktes Chrome + jsdom); statische Analyse ohne undeklarierte Variablen

## Änderungen in v1.6.0
- **Behoben:** `textSource is not defined` beim Auslesen normaler Seiten (Referenz auf undeklarierte Variable im Service Worker)
- **Entfernt:** Einstellung „PDF-Seiten überspringen“ komplett (auch aus der Logik)
- **Entfernt:** Berechtigung `webRequest` (nur beobachtende Netzwerk-Listener, nicht mehr nötig)
- **Robuster:** PDF-Erkennung jetzt mit GET/Range-Fallback und `%PDF-`-Magic-Byte-Check (auch wenn ein Server HEAD ablehnt)
- **Besser:** Hinweise aus dem Auslesen (Scroll-Runden, geöffnete Bereiche, Iframe-Text) erscheinen jetzt in der Statusmeldung statt verloren zu gehen
- Manifest und Beschreibung klar auf assisted-manuellen Zweck eingestellt
