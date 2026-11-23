/* Recherche-Helfer – gemeinsam genutzte Logik (Hintergrund-Skript, Popup, Tests).
 * Enthält bewusst keinen Browser-Zugriff, damit alles einzeln testbar ist.
 * Assisted-manuell: NUR die aktuelle Seite auslesen (keine Automatisierung). */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ Einstellungen */

export const DEFAULTS = {
  // Darstellung
  theme: 'sunset',
  animations: true,
  pageToasts: true,          // kleine Bestätigung direkt auf der Seite bei Tastenkürzeln
  tokenBudget: 200000,
  // Allgemein
  maxWaitSec: 20,
  postLoadDelaySec: 1.5,
  stableWindowSec: 1.5,
  // Extraktion
  mainContentOnly: false,
  preferSelection: true,
  includeTitle: true,
  stripChrome: true,
  expandCollapsed: true,   // <details>, „Mehr anzeigen“ vor dem Lesen öffnen
  includeSameOriginFrames: true, // Text aus same-origin-iframes anhängen

  dedupeUrls: true,          // gleiche URL: ersetzen statt doppelt
  minContentChars: 80,       // Warnung bei sehr kurzem Text
  autoCopyLast: false,       // nach Auslesen „Zuletzt“ in Zwischenablage
  exportMarkdown: false,     // Kopieren/Download als Markdown statt XML
  includeTimestamp: false,   // <gelesen> ISO-Zeitstempel
  includeMeta: true,         // Autor, Veröffentlichungsdatum, Seitenname, Sprache, Beschreibung (falls auf der Seite vorhanden)
  includeShadowDom: true,    // Text aus Web-Components (Shadow DOM) ergänzen
  redactMode: 'off',          // off | basic – sensible Angaben (E-Mail, IBAN, Kartennummern, API-Schlüssel) maskieren
  blockedHosts: '',           // Sperrliste: eine Domain pro Zeile (inkl. Subdomains)
  warnPasswordPages: true,    // Hinweis, wenn die Seite ein Passwortfeld enthält
  structureMode: 'headings',  // off | headings | full – Überschriften (#) bzw. zusätzlich Listen (-, 1.) im Text markieren
  tablesAsPipes: true,        // Tabellenzellen mit „ | “ statt Tabulator trennen
  stripBoilerplate: false,   // Navigation, Footer, Seitenleisten vor dem Lesen ausblenden
  collapseRepeatedLines: true, // direkt aufeinanderfolgende identische Zeilen zusammenfassen
  includeLinks: false,       // Liste der Links der Seite als <links> anhängen
  maxLinks: 50,
  promptPrefix: '',          // Text vor den Quellen (z. B. Aufgabenstellung)
  promptSuffix: '',          // Text nach den Quellen (z. B. Frage / Ausgabeformat)
  xmlRoot: false,            // XML: alle Quellen in <quellen> … </quellen> einhüllen
  xmlIds: false,             // XML: <quelle id="1"> nummerieren (praktisch zum Zitieren im Prompt)

  // PDF
  pdfWaitSec: 60,
  pdfPageMarkers: false,
  pdfExtra: false,
  pdfCapChars: 50000,
  pdfMethod: 'nocap',
  // Textbegrenzung
  hardCapEnabled: false,
  hardCapChars: 20000,
  hardCapMethod: 'frag',
  // Bot-Erkennung
  captchaDetect: false,
  // Scroll-Verhalten
  scrollRounds: 4,
  scrollReturn: false,
  // Manueller Modus
  askLargeText: false,
  askLargeThreshold: 50000,
  askDefaultChars: 20000,
  askDefaultMethod: 'frag',
  // Speicher
  sizeWarn: true,
  sizeWarnChars: 2000000,
  // Cleanup
  cleanupThreshold: 90,
};

const METHOD_OPTIONS = [
  { v: 'frag', l: 'Fragmentarisch' },
  { v: 'vo', l: 'Hard Cut VO (von oben)' },
  { v: 'vu', l: 'Hard Cut VU (von unten)' },
];

/* Aufbau des Einstellungs-Menüs: Gruppen → Einstellungen (alles auf Deutsch, durchsuchbar). */
export const SETTINGS_SCHEMA = [
  {
    id: 'allgemein', title: 'Allgemein', items: [
      { key: 'maxWaitSec', label: 'Maximale Wartezeit pro Seite', type: 'number', unit: 'Sekunden', min: 3, max: 600, step: 1,
        help: 'Ist die Seite nach dieser Zeit nicht fertig geladen – auch bei Weiterleitungs-Schleifen – wird abgebrochen.', keywords: 'timeout laden warten' },
      { key: 'postLoadDelaySec', label: 'Zusätzliche Wartezeit nach dem Laden', type: 'number', unit: 'Sekunden', min: 0, max: 30, step: 0.5,
        help: 'Viele Seiten laden Inhalte erst nach dem Load-Event per JavaScript nach. Lieber etwas länger warten als unvollständigen Text bekommen.', keywords: 'nachladen verzögerung' },
      { key: 'stableWindowSec', label: 'Stabilitäts-Fenster für den Seitentext', type: 'number', unit: 'Sekunden', min: 0.5, max: 10, step: 0.5,
        help: 'Der Text gilt als fertig, wenn er sich so lange nicht mehr verändert hat.', keywords: 'stabil warten text' },
    ],
  },
  {
    id: 'datenschutz', title: 'Datenschutz', items: [
      { key: 'redactMode', label: 'Sensible Angaben maskieren', type: 'select', options: [{ v: 'off', l: 'Aus' }, { v: 'basic', l: 'Grundschutz' }],
        help: 'Grundschutz ersetzt E-Mail-Adressen, gültige IBANs, Kreditkartennummern (Prüfziffer-geprüft) und typische API-Schlüssel/Tokens durch Platzhalter wie [E-MAIL], bevor der Text in die Sammlung kommt. Telefonnummern und Namen werden bewusst nicht erkannt.', keywords: 'datenschutz maskieren schwärzen email iban kreditkarte token schlüssel redact privacy' },
      { key: 'blockedHosts', label: 'Sperrliste: Domains, die nie ausgelesen werden', type: 'text', maxLen: 4000,
        help: 'Eine Domain pro Zeile, z. B. mail.google.com oder meine-bank.de (gilt inkl. Subdomains). Zeilen mit # sind Kommentare. Für diese Seiten bricht das Auslesen und die Rechtsklick-Funktion sofort ab.', keywords: 'sperrliste blockliste domain verbieten privat bank mail blocklist' },
      { key: 'warnPasswordPages', label: 'Warnen bei Seiten mit Passwortfeld', type: 'bool',
        help: 'Wenn die Seite ein sichtbares Passwortfeld enthält (Login-Seite), erscheint ein Hinweis in der Statusmeldung.', keywords: 'passwort login anmeldung warnung' },
    ],
  },
  {
    id: 'darstellung', title: 'Darstellung', items: [
      { key: 'theme', label: 'Farbschema', type: 'select', options: [{ v: 'sunset', l: 'Sunset (dunkel, Neon)' }, { v: 'day', l: 'Day (hell)' }, { v: 'auto', l: 'Automatisch (System)' }],
        help: 'Sunset: dunkles Neon-Design in Pink/Orange/Violett. Day: helle Variante. Automatisch folgt dem Hell/Dunkel-Modus des Systems (hell = Day, dunkel = Sunset).', keywords: 'theme design farben dunkel hell dark light sunset day' },
      { key: 'animations', label: 'Animationen', type: 'bool',
        help: 'Federnde Übergänge, Zähl-Animationen und Partikel-Effekte. Aus: völlig ruhige Oberfläche.', keywords: 'animation bewegung effekte partikel' },
      { key: 'pageToasts', label: 'Bestätigung auf der Seite bei Tastenkürzeln', type: 'bool',
        help: 'Zeigt nach Alt+Shift+R/C/Z eine kleine Meldung unten rechts auf der Seite (z. B. „✓ Gelesen · 3 Quellen“) – auch ohne offenes Popup. Die Meldung liegt in einem geschlossenen Shadow-DOM und wird nie mit ausgelesen.', keywords: 'toast bestätigung meldung benachrichtigung tastenkürzel' },
      { key: 'tokenBudget', label: 'Token-Budget für die Anzeige', type: 'number', unit: 'Token', min: 1000, max: 10000000, step: 1000,
        help: 'Der Balken unter „Gesammelte Quellen“ zeigt, wie viel dieses Budgets die Sammlung belegt (Schätzung, z. B. Kontextfenster deines Modells).', keywords: 'token budget kontext limit balken' },
    ],
  },
  {
    id: 'extraktion', title: 'Extraktion', items: [
      { key: 'mainContentOnly', label: 'Nur Hauptinhalt (article/main) statt ganzer Seite', type: 'bool',
        help: 'Standard: aus – es wird der gesamte sichtbare Seitentext (Body) gelesen. An: nur der mutmaßliche Artikelbereich (article, main, …). Für Recherche-Prompts meist besser auslassen.', keywords: 'artikel main content lesbarkeit volltext body' },
      { key: 'preferSelection', label: 'Markierten Text bevorzugen', type: 'bool',
        help: 'Wenn auf der Seite Text markiert ist und die Markierung nicht winzig ist, wird nur diese Markierung übernommen – ideal für gezielte Prompt-Ausschnitte.', keywords: 'auswahl selection markierung' },
      { key: 'includeTitle', label: 'Seitentitel in XML aufnehmen', type: 'bool',
        help: 'Fügt in jedem <quelle>-Block ein <titel>-Element hinzu (hilfreich für Zitationen im Prompt).', keywords: 'titel title metadaten' },
      { key: 'stripChrome', label: 'Cookie-Banner und Werbung ausblenden', type: 'bool',
        help: 'Blendet vor dem Auslesen nur Cookie-/Consent-Banner, Werbung und Paywall-Overlays aus – nicht Navigation oder Artikeltext. Die echte Seite bleibt unverändert.', keywords: 'cookie banner werbung ads paywall' },
      { key: 'expandCollapsed', label: 'Zugeklappte Inhalte aufklappen', type: 'bool',
        help: 'Öffnet vor dem Auslesen <details>-Elemente und betätigt typische „Mehr anzeigen“-/„Read more“-Buttons. Sicher: Echte Links, Formular-Buttons und Downloads werden nie angeklickt; neue Tabs und Seitenwechsel werden blockiert bzw. automatisch rückgängig gemacht.', keywords: 'details expand mehr anzeigen read more' },
      { key: 'includeSameOriginFrames', label: 'Same-Origin-Iframes mitlesen', type: 'bool',
        help: 'Hängt sichtbaren Text aus einbetteten iframes derselben Herkunft an (z. B. eingebettete Dokumente). Fremde Origins sind aus Sicherheitsgründen nicht lesbar.', keywords: 'iframe frame einbettung' },
      { key: 'dedupeUrls', label: 'Gleiche URL ersetzen statt doppelt', type: 'bool',
        help: 'Ist dieselbe bereinigte URL schon gesammelt, wird der alte Block durch den neuen ersetzt (kein Doppel-Eintrag). Aus: Jedes Auslesen hängt einen neuen Block an.', keywords: 'duplikat url dedupe ersetzen' },
      { key: 'minContentChars', label: 'Mindestlänge für „Inhalt ok“', type: 'number', unit: 'Zeichen', min: 0, max: 10000, step: 10,
        help: 'Liegt der ausgelesene Text darunter, erscheint ein Hinweis (z. B. Paywall, leere SPA). 0 = nie warnen.', keywords: 'minimum leer kurz' },
      { key: 'autoCopyLast', label: 'Nach Auslesen „Zuletzt“ kopieren', type: 'bool',
        help: 'Kopiert den zuletzt gelesenen <quelle>-Block automatisch in die Zwischenablage – nützlich beim schnellen Sammeln mit Tastenkürzel.', keywords: 'clipboard auto kopieren' },
      { key: 'exportMarkdown', label: 'Export als Markdown (statt XML)', type: 'bool',
        help: 'Kopieren und Download liefern Markdown-Abschnitte statt XML. Intern wird weiter als strukturierte Blöcke gespeichert.', keywords: 'markdown md export format' },
      { key: 'includeMeta', label: 'Metadaten (Autor, Datum, Seitenname, Sprache) aufnehmen', type: 'bool',
        help: 'Liest – falls vorhanden – Autor, Veröffentlichungsdatum, Seitenname, Sprache und Beschreibung aus den Meta-Angaben der Seite und fügt sie als eigene Elemente hinzu. Gut für saubere Zitationen.', keywords: 'meta autor datum author date publisher beschreibung description sprache' },
      { key: 'structureMode', label: 'Struktur im Text beibehalten', type: 'select', options: [{ v: 'headings', l: 'Überschriften (# …)' }, { v: 'full', l: 'Überschriften + Listen' }, { v: 'off', l: 'Aus (reiner Text)' }],
        help: 'Setzt vor Überschriften „#“/„##“ usw. (und bei „+ Listen“ vor Listenpunkte „-“ bzw. „1.“). Das Modell erkennt so die Gliederung der Seite. Die Seite selbst wird dabei nur für einen Augenblick verändert und sofort zurückgesetzt.', keywords: 'struktur überschrift heading markdown liste gliederung' },
      { key: 'tablesAsPipes', label: 'Tabellen mit „|“ trennen', type: 'bool',
        help: 'Zellen einer Tabellenzeile werden mit „ | “ getrennt statt mit unsichtbaren Tabulatoren – so bleibt die Spaltenstruktur erkennbar.', keywords: 'tabelle table spalten pipe tabulator' },
      { key: 'stripBoilerplate', label: 'Navigation, Footer und Seitenleisten weglassen', type: 'bool',
        help: 'Blendet vor dem Auslesen nav, footer, aside und Kopfbereich aus. Spart Token bei Seiten mit viel Menü-Text. Aus: wirklich der gesamte sichtbare Text.', keywords: 'navigation footer menü sidebar boilerplate token sparen' },
      { key: 'collapseRepeatedLines', label: 'Wiederholte Zeilen zusammenfassen', type: 'bool',
        help: 'Direkt aufeinanderfolgende identische Zeilen (z. B. wiederholte Menüeinträge oder Buttons) werden nur einmal übernommen.', keywords: 'duplikate zeilen wiederholung bereinigen' },
      { key: 'includeLinks', label: 'Links der Seite als Liste anhängen', type: 'bool',
        help: 'Fügt ein <links>-Element mit Linktext und Ziel-URL der Seite hinzu (nur http/https, ohne Anker und Tracking). Nützlich, wenn das Modell auf weiterführende Quellen verweisen soll.', keywords: 'links verweise urls hyperlinks' },
      { key: 'maxLinks', label: 'Maximale Anzahl Links pro Seite', type: 'number', unit: 'Links', min: 1, max: 500, step: 5, dependsOn: 'includeLinks',
        help: 'Begrenzt die Linkliste je Quelle.', keywords: 'links limit' },
      { key: 'includeShadowDom', label: 'Web-Components (Shadow DOM) mitlesen', type: 'bool',
        help: 'Manche moderne Seiten kapseln Text in Shadow-DOM-Bereichen, die der normale Seitentext nicht enthält. An: dieser Text wird ergänzt (nur offene Shadow Roots).', keywords: 'shadow dom web component' },
      { key: 'includeTimestamp', label: 'Zeitstempel des Auslesens speichern', type: 'bool',
        help: 'Fügt optional <gelesen> mit ISO-Zeit hinzu (nachvollziehbar, welcher Stand der Seite erfasst wurde).', keywords: 'zeitstempel timestamp gelesen' },
    ],
  },
  {
    id: 'pdf', title: 'PDF', items: [
      { key: 'pdfWaitSec', label: 'Maximale Wartezeit bei PDFs', type: 'number', unit: 'Sekunden', min: 5, max: 900, step: 5,
        help: 'Lange PDFs brauchen länger, bis der Text vollständig vorliegt.', keywords: 'pdf timeout' },
      { key: 'pdfPageMarkers', label: 'Seitenmarker im PDF-Text einfügen', type: 'bool',
        help: 'Fügt vor jeder PDF-Seite eine Zeile wie „[Seite 3]“ ein – so lässt sich im Prompt auf Seiten verweisen.', keywords: 'pdf seite seitenzahl marker zitieren' },
      { key: 'pdfExtra', label: 'Extra Einstellungen für PDF aktivieren', type: 'bool',
        help: 'Aus: PDFs werden bei der Textbegrenzung wie normale Seiten behandelt. An: Es gelten nur die folgenden PDF-eigenen Einstellungen.', keywords: 'pdf begrenzung' },
      { key: 'pdfCapChars', label: 'Eigene Zeichenanzahl für PDFs', type: 'number', unit: 'Zeichen', min: 100, max: 100000000, step: 1000, dependsOn: 'pdfExtra',
        help: 'Maximale Zeichenzahl pro PDF (nur wenn Extra Einstellungen für PDF aktiv sind).', keywords: 'pdf zeichen cap' },
      { key: 'pdfMethod', label: 'Eigene Behandlung für PDFs', type: 'select', dependsOn: 'pdfExtra',
        options: [...METHOD_OPTIONS, { v: 'nocap', l: 'No Cap (keine Begrenzung)' }],
        help: 'No Cap übernimmt den kompletten PDF-Text, egal wie lang.', keywords: 'pdf methode fragmentarisch hard cut no cap' },
    ],
  },
  {
    id: 'textbegrenzung', title: 'Textbegrenzung', items: [
      { key: 'hardCapEnabled', label: 'Hard Cap pro Body-Text aktivieren', type: 'bool',
        help: 'Aus: Der komplette Body-Text wird übernommen. An: Zu lange Texte werden nach der gewählten Methode gekürzt.', keywords: 'cap begrenzung fragmentarisch kürzen' },
      { key: 'hardCapChars', label: 'Hard Cap: maximale Zeichen pro Seite', type: 'number', unit: 'Zeichen', min: 100, max: 100000000, step: 1000, dependsOn: 'hardCapEnabled',
        help: 'Überschreitet ein Text diese Zeichenzahl, wird er nach der gewählten Methode gekürzt.', keywords: 'zeichen limit' },
      { key: 'hardCapMethod', label: 'Hard Cap: Kürzungsmethode', type: 'select', dependsOn: 'hardCapEnabled', options: METHOD_OPTIONS,
        help: 'Fragmentarisch = wortweise gleichmäßig ausdünnen (ersatzlos, ohne Satzerkennung). Hard Cut VO/VU = harter Schnitt von oben bzw. von unten.', keywords: 'methode fragmentarisch hard cut' },
    ],
  },
  {
    id: 'bot', title: 'Bot-Erkennung', items: [
      { key: 'captchaDetect', label: 'Captcha-Erkennung aktivieren', type: 'bool',
        help: 'Heuristik, keine garantierte Erkennung: prüft auf typische Captcha-Texte, -Elemente und Bot-Schutz-Seiten. Aus: Captcha-Seiten werden wie normale Seiten behandelt.', keywords: 'captcha roboter' },
    ],
  },
  {
    id: 'scroll', title: 'Scroll-Verhalten', items: [
      { key: 'scrollRounds', label: 'Scroll-Durchgänge bei Infinite Scroll', type: 'number', unit: 'Durchgänge', min: 0, max: 30, step: 1,
        help: 'Es wird bis zu so oft nach unten gescrollt und geprüft, ob mehr Text nachgeladen wurde (wichtig für Infinite Scroll / Lazy Load). 0 = nicht scrollen. Standard: 4.', keywords: 'scrollen infinite nachladen' },
      { key: 'scrollReturn', label: 'Nach Scrollen wieder zum Anfang?', type: 'bool',
        help: 'Aus: Die Seite bleibt unten stehen. An: Nach dem Auslesen wird wieder zum Seitenanfang gescrollt.', keywords: 'scrollen anfang zurück' },
    ],
  },
  {
    id: 'manuell', title: 'Auslesen', items: [
      { key: 'askLargeText', label: 'Bei großem Body-Text fragen', type: 'bool',
        help: 'Ist der Text größer als der Schwellenwert, wirst du gefragt, ob und wie er im Zeichenumfang begrenzt werden soll.', keywords: 'große texte abfrage' },
      { key: 'askLargeThreshold', label: 'Ab dieser Textgröße fragen', type: 'number', unit: 'Zeichen', min: 100, max: 100000000, step: 1000, dependsOn: 'askLargeText', help: 'Schwellenwert für die Abfrage.', keywords: 'schwelle' },
      { key: 'askDefaultChars', label: 'Vorschlag für die Zeichenbegrenzung in der Abfrage', type: 'number', unit: 'Zeichen', min: 100, max: 100000000, step: 1000, dependsOn: 'askLargeText', help: 'Vorbelegter Wert im Abfrage-Dialog.', keywords: 'vorschlag zeichen' },
      { key: 'askDefaultMethod', label: 'Vorgewählte Methode in der Abfrage', type: 'select', dependsOn: 'askLargeText', options: METHOD_OPTIONS, help: 'Vorbelegte Methode im Abfrage-Dialog.', keywords: 'methode hard cut' },
    ],
  },
  {
    id: 'speicher', title: 'Speicher', items: [
      { key: 'sizeWarn', label: 'Warnung bei großem Ergebnis aktivieren', type: 'bool',
        help: 'Warnt einmal pro Überschreiten, wenn das Gesamtergebnis sehr groß wird. Aus: Das Ergebnis wächst ohne Rückfrage weiter.', keywords: 'speicher warnung groß' },
      { key: 'sizeWarnChars', label: 'Warn-Schwelle', type: 'number', unit: 'Zeichen', min: 10000, max: 1000000000, step: 100000, dependsOn: 'sizeWarn', help: 'Ab dieser Gesamtgröße des Ergebnisses wird gewarnt.', keywords: 'schwelle' },
    ],
  },
  {
    id: 'export', title: 'Export (XML)', items: [
      { key: 'promptPrefix', label: 'Text vor den Quellen (Prompt-Anfang)', type: 'text', maxLen: 4000,
        help: 'Wird beim Kopieren und Download vor die Quellen gesetzt, z. B. die Aufgabenstellung oder <aufgabe>…</aufgabe>. Platzhalter: {datum}, {uhrzeit}, {anzahl}, {zeichen}, {token}, {quellenliste}.', keywords: 'prompt anfang prefix aufgabe anweisung vorlage template' },
      { key: 'promptSuffix', label: 'Text nach den Quellen (Prompt-Ende)', type: 'text', maxLen: 4000,
        help: 'Wird nach die Quellen gesetzt, z. B. die konkrete Frage oder das gewünschte Ausgabeformat.', keywords: 'prompt ende suffix frage ausgabeformat vorlage template' },
      { key: 'xmlRoot', label: 'Quellen in <quellen>-Wurzelelement einhüllen', type: 'bool',
        help: 'Erzeugt ein wohlgeformtes XML-Dokument mit einem Wurzelelement. Aus: lose <quelle>-Blöcke (wie bisher).', keywords: 'xml root wurzel quellen wohlgeformt' },
      { key: 'xmlIds', label: 'Quellen nummerieren (id-Attribut)', type: 'bool',
        help: 'Schreibt <quelle id="1"> usw. – damit das Modell mit „[1]“ zitieren kann.', keywords: 'id nummer zitieren referenz' },
    ],
  },
  {
    id: 'cleanup', title: 'Cleanup', items: [
      { key: 'cleanupThreshold', label: 'Cleanup-Schwelle', type: 'number', unit: 'Prozent', min: 50, max: 100, step: 1,
        help: 'Ab dieser inhaltlichen Übereinstimmung gilt ein späterer Block als Dublette und wird beim Cleanup entfernt.', keywords: 'dubletten doppelte ähnlichkeit' },
    ],
  },
];

const SCHEMA_FLAT = Object.fromEntries(SETTINGS_SCHEMA.flatMap((g) => g.items.map((i) => [i.key, i])));

export function mergeSettings(stored) {
  const out = { ...DEFAULTS };
  if (stored && typeof stored === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in stored)) continue;
      const v = stored[k], def = DEFAULTS[k], sc = SCHEMA_FLAT[k];
      if (typeof def === 'boolean') out[k] = !!v;
      else if (typeof def === 'number') {
        let n = Number(v);
        if (v === '' || v === null || !Number.isFinite(n)) continue;
        if (sc && sc.min != null) n = Math.max(sc.min, n);
        if (sc && sc.max != null) n = Math.min(sc.max, n);
        out[k] = n;
      } else if (typeof def === 'string') {
        if (sc && sc.type === 'text') out[k] = String(v ?? '').slice(0, sc.maxLen || 4000);
        else if (sc && sc.options && sc.options.some((o) => o.v === v)) out[k] = v;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ URLs */

const TRACKING_EXACT = new Set([
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok', 'vero_id', 'vero_conv', 'oly_enc_id', 'oly_anon_id',
  'wickedid', 's_cid', 'cmpid', 'ocid', 'spm', '_ga', '_gl', 'ref_src', 'ref_url', 'srsltid', 'trk', 'trkcampaign',
  'epik', 'ncid', 'sc_cid', 'soc_src', 'soc_trk', 'fb_source', 'zanpid', 'scid', 'at_medium', 'at_campaign', 'at_source', 'wt_mc',
]);
const TRACKING_PREFIX = ['utm_', 'pk_', 'piwik_', 'mtm_', 'matomo_', 'hsa_', 'itm_', '__hs', '_bta'];

const isTrackingParam = (name) => {
  const n = name.toLowerCase();
  return TRACKING_EXACT.has(n) || TRACKING_PREFIX.some((p) => n.startsWith(p));
};

const isGoogleHost = (h) => /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(h);

/** Bereinigte http(s)-URL oder null. Entfernt Tracking-Parameter und Fragment; löst Google-Weiterleitungen (/url?q=…) auf. */
export function cleanUrl(input) {
  let u;
  try { u = new URL(String(input)); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (isGoogleHost(u.hostname) && u.pathname === '/url') {
    const target = u.searchParams.get('q') || u.searchParams.get('url');
    return target ? cleanUrl(target) : null;
  }
  u.hash = '';
  if (u.search) {
    const kept = u.search.slice(1).split('&').filter((p) => p && !isTrackingParam(decodeURIComponentSafe(p.split('=')[0])));
    u.search = kept.length ? '?' + kept.join('&') : '';
  }
  return u.toString();
}
const decodeURIComponentSafe = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };

export function isPdfUrl(url) {
  try {
    const u = new URL(url);
    if (/\.pdf$/i.test(u.pathname.replace(/\/+$/, ''))) return true;
    if (/(^|[?&])(format|type|output|filetype|ext|mime|contenttype|content-type|export|download)=(application(%2F|\/))?pdf(&|$)/i.test(u.search)) return true;
    if (/\.pdf(&|$)/i.test(u.search)) return true;
    return false;
  } catch (_) { return false; }
}

/* ------------------------------------------------------------------ XML */

/** Nachbearbeitung des ausgelesenen Seitentexts (Volltext, kein Content-Truncation). */
export function cleanPageText(s) {
  let t = String(s ?? '');
  t = t.replace(/\uFEFF/g, '');
  t = t.replace(/\r\n?/g, '\n');
  t = t.replace(/[\u00A0\u202F\u2007\u2009]/g, ' ');
  // Zero-width / bidi controls entfernen
  t = t.replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069]/g, '');
  // Zeilen: trailing spaces, Tabs normalisieren
  t = t.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ');
  // Mehr als 2 Leerzeilen zusammenziehen
  t = t.replace(/\n{3,}/g, '\n\n');
  // Häufige „Skip to content“-Einzeiler am Anfang
  t = t.replace(/^(Skip to (main )?content|Zum Inhalt springen|Zur Hauptnavigation|Skip to navigation)\n+/i, '');
  return t.trim();
}

/** Fasst direkt aufeinanderfolgende identische Zeilen zusammen (Menüs, wiederholte Buttons). */
export function collapseRepeats(text) {
  const out = []; let prev = null;
  for (const line of String(text ?? '').split('\n')) {
    const k = line.trim();
    if (k && k === prev) continue;
    out.push(line);
    if (k) prev = k;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export const sanitizeXml = (s) => String(s ?? '').replace(XML_BAD, '');
/** CDATA mit sicherer Behandlung von „]]>“ im Text (Aufsplitten des Blocks). */
export const cdata = (s) => '<![CDATA[' + sanitizeXml(s).replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>';
const META_TAGS = [['autor', 'autor'], ['datum', 'datum'], ['seitenname', 'seitenname'], ['sprache', 'sprache'], ['beschreibung', 'beschreibung']];
export const buildQuelle = (url, text, title, gelesen, meta, id, links) => {
  const parts = [`<url>${cdata(url)}</url>`];
  if (title && String(title).trim()) parts.push(`<titel>${cdata(String(title).trim())}</titel>`);
  if (meta) for (const [k, tag] of META_TAGS) if (meta[k] && String(meta[k]).trim()) parts.push(`<${tag}>${cdata(String(meta[k]).trim())}</${tag}>`);
  if (gelesen) parts.push(`<gelesen>${cdata(String(gelesen))}</gelesen>`);
  parts.push(`<inhalt>${cdata(text)}</inhalt>`);
  if (links && links.length) parts.push(`<links>${links.map((l) => `<link><url>${cdata(l.url)}</url>${l.text ? `<text>${cdata(l.text)}</text>` : ''}</link>`).join('')}</links>`);
  return `<quelle${id ? ` id="${id}"` : ''}>${parts.join('')}</quelle>`;
};
export const buildXml = (blocks, opts = {}) => {
  const body = blocks.map((b, i) => buildQuelle(b.url, b.inhalt, b.titel, b.gelesen, b.meta, opts.ids ? i + 1 : 0, b.links)).join('\n');
  return opts.root ? `<quellen>\n${body}\n</quellen>` : body;
};
export const buildMarkdown = (blocks) => blocks.map((b, i) => {
  const lines = [`### Quelle ${i + 1}`];
  if (b.titel) lines.push(`**Titel:** ${b.titel}`);
  lines.push(`**URL:** ${b.url}`);
  const m = b.meta || {};
  if (m.autor) lines.push(`**Autor:** ${m.autor}`);
  if (m.datum) lines.push(`**Datum:** ${m.datum}`);
  if (m.seitenname) lines.push(`**Seite:** ${m.seitenname}`);
  if (m.sprache) lines.push(`**Sprache:** ${m.sprache}`);
  if (m.beschreibung) lines.push(`**Beschreibung:** ${m.beschreibung}`);
  if (b.gelesen) lines.push(`**Gelesen:** ${b.gelesen}`);
  lines.push('', b.inhalt || '', '');
  if (b.links && b.links.length) { lines.push('**Links:**'); b.links.forEach((l) => lines.push(`- ${l.text ? l.text + ': ' : ''}${l.url}`)); lines.push(''); }
  return lines.join('\n');
}).join('\n---\n\n');
/** Grobe Token-Schätzung (≈ 1 Token je 4 Zeichen; für deutschen Text eher 3,5). */
export const estimateTokens = (chars) => Math.round(Number(chars || 0) / 3.8);
/** Ersetzt Platzhalter in Prompt-Rahmen: {datum} {uhrzeit} {anzahl} {zeichen} {token} {quellenliste}. */
export function expandVars(text, blocks) {
  const now = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const chars = blocks.reduce((a, b) => a + (b.inhalt || '').length, 0);
  const map = {
    datum: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`,
    uhrzeit: `${p2(now.getHours())}:${p2(now.getMinutes())}`,
    anzahl: String(blocks.length),
    zeichen: String(chars),
    token: String(estimateTokens(chars)),
    quellenliste: blocks.map((b, i) => `[${i + 1}] ${b.titel ? b.titel + ' – ' : ''}${b.url}`).join('\n'),
  };
  return String(text || '').replace(/\{(datum|uhrzeit|anzahl|zeichen|token|quellenliste)\}/g, (m, k) => map[k]);
}

export function buildExport(blocks, asMarkdown, opts = {}) {
  if (!blocks.length) return '';
  const body = asMarkdown ? buildMarkdown(blocks) : buildXml(blocks, opts);
  const n = blocks.length;
  const chars = blocks.reduce((s, b) => s + (b.inhalt || '').length, 0);
  const info = `${n} Quelle${n === 1 ? '' : 'n'}, ${chars.toLocaleString('de-DE')} Zeichen Inhalt, ca. ${estimateTokens(chars).toLocaleString('de-DE')} Token`;
  const core = asMarkdown ? `<!-- ${info} -->\n\n${body}` : `<!-- ${info} -->\n${body}`;
  const pre = opts.prefix && String(opts.prefix).trim() ? expandVars(String(opts.prefix).trim(), blocks) + '\n\n' : '';
  const suf = opts.suffix && String(opts.suffix).trim() ? '\n\n' + expandVars(String(opts.suffix).trim(), blocks) : '';
  return pre + core + suf;
}
export const xmlLength = (blocks) => blocks.reduce((n, b) => n + b.url.length + (b.titel ? b.titel.length : 0) + (b.gelesen ? b.gelesen.length : 0) + (b.links ? b.links.reduce((a, l) => a + l.url.length + (l.text || '').length + 40, 0) : 0) + (b.meta ? Object.values(b.meta).reduce((a, v) => a + String(v || '').length + 24, 0) : 0) + b.inhalt.length + 120, 0);

/* ------------------------------------------------------------------ Textbegrenzung */

const WORD_RE = /[\p{L}\p{N}_]+/gu;

const fixCut = (s, side) => {
  if (!s) return s;
  if (side === 'end' && /[\uD800-\uDBFF]$/.test(s)) return s.slice(0, -1);
  if (side === 'start' && /^[\uDC00-\uDFFF]/.test(s)) return s.slice(1);
  return s;
};
export const hardCutVO = (text, x) => fixCut(text.slice(0, x), 'end');
export const hardCutVU = (text, x) => fixCut(text.slice(Math.max(0, text.length - x)), 'start');

/** Fragmentarisch: wortweise, gleichmäßig verteilt, ersatzlos, ohne Satzerkennung. */
export function fragmentarisch(text, cap) {
  const before = text.length;
  if (before <= cap) return { text, changed: false, before, after: before };
  const parts = [];
  let last = 0, m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text))) { parts.push({ sep: text.slice(last, m.index), word: m[0] }); last = m.index + m[0].length; }
  const tail = text.slice(last);
  if (!parts.length) { const t = hardCutVO(text, cap); return { text: t, changed: true, before, after: t.length, wordsBefore: 0, wordsAfter: 0, removedFraction: 1 }; }

  const build = (ratio) => {
    let out = '', kept = 0;
    for (let i = 0; i < parts.length; i++) {
      const keep = Math.floor((i + 1) * ratio) > Math.floor(i * ratio);
      if (keep) { out += parts[i].sep + parts[i].word; kept++; }
      else if (parts[i].sep.includes('\n')) out += parts[i].sep;
    }
    return { out: out + tail, kept };
  };

  let ratio = Math.min(0.999, cap / before), res = build(ratio);
  for (let i = 0; i < 40 && res.out.length > cap; i++) {
    ratio *= Math.min(0.995, (cap / res.out.length) * 0.995);
    res = build(ratio);
  }
  let outText = res.out, kept = res.kept;
  if (outText.length > cap) { outText = hardCutVO(outText, cap); }
  return { text: outText, changed: true, before, after: outText.length, wordsBefore: parts.length, wordsAfter: kept, removedFraction: 1 - kept / parts.length };
}

const fmtNum = (n) => (Math.round(n * 10) / 10).toLocaleString('de-DE');
export const fmtInt = (n) => Number(n).toLocaleString('de-DE');

export function describeFrag(info) {
  const f = info.removedFraction;
  if (!(f > 0)) return 'keine Wörter entfernt';
  const faktor = f <= 0.5 ? `ca. jedes ${fmtNum(1 / f)}. Wort entfernt` : `nur ca. jedes ${fmtNum(1 / (1 - f))}. Wort behalten`;
  return `${Math.round(f * 100)} % der Wörter entfernt, ${faktor}`;
}

export const METHOD_LABEL = { frag: 'fragmentarisch', vo: 'per Hard Cut VO (von oben)', vu: 'per Hard Cut VU (von unten)' };

/** Welche Begrenzung gilt (allgemeine Einstellungen oder PDF-eigene)? null = keine. */
export function limitFor(isPdf, s) {
  if (isPdf && s.pdfExtra) return s.pdfMethod === 'nocap' ? null : { method: s.pdfMethod, cap: s.pdfCapChars };
  if (s.hardCapEnabled) return { method: s.hardCapMethod || 'frag', cap: s.hardCapChars };
  return null;
}

export function applyLimit(text, method, cap) {
  if (text.length <= cap) return { text, changed: false, before: text.length, after: text.length, method };
  if (method === 'vo') { const t = hardCutVO(text, cap); return { text: t, changed: true, before: text.length, after: t.length, method }; }
  if (method === 'vu') { const t = hardCutVU(text, cap); return { text: t, changed: true, before: text.length, after: t.length, method }; }
  const r = fragmentarisch(text, cap);
  return { ...r, method: 'frag' };
}

export function describeLimit(info, isPdf, url) {
  const was = `${isPdf ? 'PDF' : 'Seite'} war ${fmtInt(info.before)} Zeichen, wurde auf ${fmtInt(info.after)} Zeichen ${METHOD_LABEL[info.method] || info.method} reduziert`;
  const frag = info.method === 'frag' && info.wordsBefore != null ? ` (${describeFrag(info)})` : '';
  return `${url}: ${was}${frag}${isPdf ? ', nach den für PDF geltenden Einstellungen' : ''}.`;
}

/* ------------------------------------------------------------------ Cleanup (inhaltliche Dubletten) */

const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

function shingles(text, k = 3) {
  const words = (String(text).toLowerCase().match(WORD_RE) || []);
  const set = new Set();
  if (!words.length) return set;
  if (words.length < k) { set.add(fnv(words.join(' '))); return set; }
  for (let i = 0; i + k <= words.length; i++) set.add(fnv(words.slice(i, i + k).join(' ')));
  return set;
}

/** Prozentuale Inhalts-Übereinstimmung (Jaccard über 3-Wort-Shingles), 0–100. */
export function similarity(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  const [small, big] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return (inter / (setA.size + setB.size - inter)) * 100;
}

/** Entfernt spätere Blöcke, die einem früheren zu ≥ threshold Prozent entsprechen. Der erste bleibt erhalten. */
export function cleanupBlocks(blocks, thresholdPct) {
  const sets = blocks.map((b) => shingles(b.inhalt));
  const kept = [], keptSets = [], removed = [];
  blocks.forEach((b, i) => {
    let dupOf = -1, pct = 0;
    for (let j = 0; j < kept.length && dupOf < 0; j++) {
      if (!sets[i].size) break;
      const p = similarity(sets[i], keptSets[j]);
      if (p >= thresholdPct) { dupOf = j; pct = p; }
    }
    if (dupOf >= 0) removed.push({ url: b.url, ofUrl: kept[dupOf].url, pct: Math.round(pct) });
    else { kept.push(b); keptSets.push(sets[i]); }
  });
  return { kept, removed };
}

/** Profile: überschreiben nur die genannten Einstellungen (alle übrigen bleiben). */
export const PRESETS = [
  { id: 'standard', label: 'Ausgewogen', help: 'Gesamter sichtbarer Text, Aufklappen, Metadaten – ohne Kürzung.',
    set: { mainContentOnly: false, stripChrome: true, stripBoilerplate: false, collapseRepeatedLines: true, expandCollapsed: true, includeMeta: true, includeLinks: false, scrollRounds: 4, hardCapEnabled: false, pdfPageMarkers: false } },
  { id: 'sparen', label: 'Token sparen', help: 'Ohne Navigation/Footer, wiederholte Zeilen weg, Zeichenlimit 20.000 (fragmentarisch).',
    set: { stripChrome: true, stripBoilerplate: true, collapseRepeatedLines: true, includeLinks: false, includeMeta: true, scrollRounds: 2, hardCapEnabled: true, hardCapChars: 20000, hardCapMethod: 'frag' } },
  { id: 'maximal', label: 'Maximal vollständig', help: 'Alles mitnehmen: Links, Shadow DOM, Iframes, Seitenmarker bei PDFs, mehr Scroll-Durchgänge, kein Limit.',
    set: { stripBoilerplate: false, collapseRepeatedLines: false, includeLinks: true, includeMeta: true, includeShadowDom: true, includeSameOriginFrames: true, expandCollapsed: true, scrollRounds: 8, hardCapEnabled: false, pdfPageMarkers: true } },
];

/** Prompt-Vorlagen: setzen Text vor/nach den Quellen und – wo nötig – Nummerierung/Wurzelelement. */
export const PROMPT_TEMPLATES = [
  { id: 'summary', label: 'Zusammenfassung mit Quellenangaben',
    set: { xmlRoot: true, xmlIds: true,
      promptPrefix: '<aufgabe>Fasse die folgenden Quellen sachlich zusammen. Belege jede wichtige Aussage mit der Quellen-ID in eckigen Klammern, z. B. [2].</aufgabe>\n<hinweis>Stand: {datum}. Es folgen {anzahl} Quellen in <quelle>-Elementen (Attribut id). Nutze ausschließlich deren Inhalt.</hinweis>',
      promptSuffix: '<ausgabe>Gliederung mit Zwischenüberschriften; am Ende ein Abschnitt „Widersprüche und Lücken“.</ausgabe>' } },
  { id: 'factcheck', label: 'Faktencheck einer Behauptung',
    set: { xmlRoot: true, xmlIds: true,
      promptPrefix: '<aufgabe>Prüfe die Behauptung unten ausschließlich anhand der Quellen. Bewerte sie als bestätigt, teilweise bestätigt, widerlegt oder nicht belegt und zitiere mit [id].</aufgabe>',
      promptSuffix: '<behauptung>HIER BEHAUPTUNG EINFÜGEN</behauptung>\n<ausgabe>Urteil in einem Satz, danach Belege je Quelle, danach Unsicherheiten.</ausgabe>' } },
  { id: 'compare', label: 'Quellen vergleichen',
    set: { xmlRoot: true, xmlIds: true,
      promptPrefix: '<aufgabe>Vergleiche die Quellen: Wo stimmen sie überein, wo widersprechen sie sich, und welche Quelle ist für welche Frage am verlässlichsten? Zitiere mit [id].</aufgabe>',
      promptSuffix: '<ausgabe>Tabelle (Thema | Quelle | Aussage), darunter eine kurze Einordnung.</ausgabe>' } },
  { id: 'extract', label: 'Daten und Zahlen extrahieren',
    set: { xmlRoot: true, xmlIds: true,
      promptPrefix: '<aufgabe>Extrahiere alle Zahlen, Daten, Namen und Definitionen aus den Quellen. Erfinde nichts; wenn etwas fehlt, schreibe „nicht angegeben“.</aufgabe>',
      promptSuffix: '<ausgabe>Eine Tabelle mit den Spalten: Fakt | Wert | Quelle-ID | Fundstelle (Zitat unter 15 Wörtern).</ausgabe>' } },
];

/* ------------------------------------------------------------------ Datenschutz */

const luhnOk = (digits) => {
  let sum = 0, dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d; dbl = !dbl;
  }
  return sum % 10 === 0;
};
const ibanOk = (raw) => {
  const v = raw.replace(/\s+/g, '').toUpperCase();
  if (v.length < 15 || v.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return false;
  const r = v.slice(4) + v.slice(0, 4);
  let rem = 0;
  for (const ch of r) {
    const n = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const dg of n) rem = (rem * 10 + (dg.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
};

/** Maskiert E-Mail-Adressen, gültige IBANs, Kartennummern (Luhn) und typische Schlüssel. */
export function redactSensitive(text) {
  let count = 0;
  const hit = (ph) => { count++; return ph; };
  let t = String(text ?? '');
  t = t.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, () => hit('[TOKEN]'));
  t = t.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g, () => hit('[SCHLÜSSEL]'));
  t = t.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/g, () => hit('Bearer [TOKEN]'));
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, () => hit('[E-MAIL]'));
  t = t.replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) => (ibanOk(m) ? hit('[IBAN]') : m));
  t = t.replace(/\b[3-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{3,4}\b/g, (m) => {
    const d = m.replace(/[ -]/g, '');
    return (d.length === 16 || (d.length === 15 && /^3[47]/.test(d))) && luhnOk(d) ? hit('[KARTENNUMMER]') : m;
  });
  return { text: t, count };
}

/** Prüft, ob die Domain der URL (oder eine Oberdomain) auf der Sperrliste steht. */
export function isBlockedHost(url, listText) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return false; }
  for (const raw of String(listText || '').split(/\r?\n/)) {
    const e = raw.replace(/#.*/, '').trim().toLowerCase().replace(/^\*\./, '').replace(/^www\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (e && (host === e || host.endsWith('.' + e))) return true;
  }
  return false;
}

/**
 * Kürzt Quellen so, dass ihre Inhalte zusammen höchstens `targetChars` Zeichen haben.
 * „Wasserstandsverfahren“: kurze Quellen bleiben komplett, die längsten teilen sich den Rest gleichmäßig.
 */
export function fitToBudget(blocks, targetChars, method = 'vo', minCap = 200) {
  const lens = blocks.map((b) => (b.off ? 0 : (b.inhalt || '').length));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!blocks.length || total <= targetChars) return { blocks, changed: 0, before: total, after: total };
  const order = lens.map((l, i) => i).filter((i) => !blocks[i].off).sort((a, b) => lens[a] - lens[b]);
  const caps = new Array(blocks.length).fill(Infinity);
  let remaining = Math.max(0, targetChars), left = order.length;
  for (const i of order) {
    caps[i] = Math.max(minCap, Math.min(lens[i], Math.floor(remaining / left)));
    remaining = Math.max(0, remaining - caps[i]);
    left--;
  }
  let changed = 0;
  const out = blocks.map((b, i) => {
    if (b.off || caps[i] >= lens[i]) return b;
    changed++;
    return { ...b, inhalt: applyLimit(b.inhalt, method, caps[i]).text };
  });
  return { blocks: out, changed, before: total, after: out.reduce((a, b) => a + (b.off ? 0 : (b.inhalt || '').length), 0) };
}
