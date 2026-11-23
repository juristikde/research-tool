import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const html = `<!doctype html><html lang="de"><head><title>Testseite</title>
<meta name="author" content="Erika Muster"><meta property="article:published_time" content="2026-05-01">
<meta property="og:site_name" content="Beispiel-Magazin"><meta name="description" content="Kurzbeschreibung">
</head><body><nav>Navigation</nav><article><h1>Überschrift</h1>${'<p>Dies ist ein langer Absatz mit Inhalt für den Test. </p>'.repeat(10)}</article>
<h2>Unterkapitel</h2><ul><li>Punkt eins</li></ul><ol><li>Erster</li></ol><table><tr><td>Name</td>	<td>Wert</td></tr></table><p>Kontakt: max.muster@example.org, IBAN DE89 3704 0044 0532 0130 00.</p><input type="password" id="pw"><div id="host"></div><details><summary>Mehr</summary><p>Versteckter Text im Details-Element.</p></details>
<a id="lnk" href="https://other.example/mehr">Mehr anzeigen</a><a id="blank" href="#" target="_blank">Read more</a><form id="f"><button id="fb">Mehr anzeigen</button></form><button id="tg" type="button">Mehr anzeigen</button><div class="cookie-banner">Cookies akzeptieren</div></body></html>`;
const dom = new JSDOM(html, { url: 'https://example.com/artikel?utm_source=x&id=5#frag', runScripts: 'outside-only' });
const host = dom.window.document.getElementById('host');
const sr = host.attachShadow({ mode: 'open' });
sr.innerHTML = '<p>Text im Shadow DOM, der sonst fehlen würde.</p>';
const hits = { lnk: 0, blank: 0, fb: 0, tg: 0 };
for (const id of Object.keys(hits)) dom.window.document.getElementById(id).addEventListener('click', () => { hits[id]++; });
Object.defineProperty(dom.window.document, 'readyState', { value: 'complete' });
dom.window.document.contentType; // jsdom: text/html

const store = {};
const listeners = { msg: null, menu: null, cmd: null };
let copied = null;
globalThis.chrome = {
  storage: { local: {
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
    set: async (o) => { for (const [k, v] of Object.entries(o)) store[k] = structuredClone(v); },
  }, onChanged: { addListener() {} } },
  runtime: { getContexts: async () => [], sendMessage: async (m) => { if (m && m.type === 'copyText') { copied = m.text; return { ok: true }; } return { ok: false }; }, onMessage: { addListener: (f) => { listeners.msg = f; } }, onStartup: { addListener() {} }, onInstalled: { addListener() {} }, getPlatformInfo: (cb) => cb && cb() },
  commands: { onCommand: { addListener: (f) => { listeners.cmd = f; } } },
  offscreen: { createDocument: async () => {} },
  contextMenus: { onClicked: { addListener: (f) => { listeners.menu = f; } }, create() {}, removeAll() {} },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
  tabs: { onCreated: { addListener() {}, removeListener() {} }, remove: async () => {}, goBack: async () => {}, query: async () => [{ id: 1, url: dom.window.location.href }], get: async () => ({ id: 1, url: dom.window.location.href }) },
  scripting: { executeScript: async ({ func, args }) => {
    const fn = new dom.window.Function('return (' + func.toString() + ')')();
    return [{ result: fn.apply(dom.window, args || []) }];
  } },
};
// Browser-Globals für Seitenfunktionen
const styles = [];
const _ap = dom.window.document.documentElement.appendChild.bind(dom.window.document.documentElement);
dom.window.document.documentElement.appendChild = (n) => { if (n.tagName === 'STYLE') styles.push(n.textContent); return _ap(n); };
store.settings = { tokenBudget: 1000, redactMode: 'basic', blockedHosts: '# privat\nblocked.test', structureMode: 'full', tablesAsPipes: true, stripBoilerplate: true, includeLinks: true, promptPrefix: '<aufgabe>Fasse zusammen</aufgabe>', promptSuffix: 'Frage: Was steht drin?', postLoadDelaySec: 0, stableWindowSec: 0.5, scrollRounds: 1, includeTimestamp: false, xmlIds: true, xmlRoot: true };
await import('../research-tool/background.js');
const send = (msg) => new Promise((res) => { const keep = listeners.msg(msg, {}, res); assert.equal(keep, true); });

const r = await send({ type: 'readCurrent' });
console.log('readCurrent →', JSON.stringify(r).slice(0, 200));
assert.equal(r.ok, true, 'readCurrent muss erfolgreich sein (kein "textSource is not defined")');
const st = await send({ type: 'getState' });
console.log('Status:', st.B.message);
assert.equal(st.B.resCount, 1);
const xml = (await send({ type: 'getResult', which: 'result' })).text;
console.log(xml.slice(0, 700));
for (const needle of ['<quellen>', '<quelle id="1">', 'https://example.com/artikel?id=5', '<autor><![CDATA[Erika Muster]]>', '<datum>', 'Beispiel-Magazin', 'Shadow DOM', 'Versteckter Text'])
  assert.ok(xml.includes(needle), 'fehlt: ' + needle);
assert.ok(!xml.includes('utm_source'), 'Tracking-Parameter entfernt');
// Doppelstart-Schutz
const [a, b] = await Promise.all([send({ type: 'readCurrent' }), send({ type: 'readCurrent' })]);
assert.ok(a.ok !== b.ok || (a.ok && !b.ok) || (!a.ok && b.ok), 'genau einer läuft');
console.log('Doppelstart:', a.ok, b.ok, b.error || a.error || '');
assert.equal((await send({ type: 'getState' })).B.resCount, 1, 'gleiche URL ersetzt statt doppelt');
const md = (await send({ type: 'getResult', which: 'result', markdown: true })).text;
assert.ok(md.includes('**Autor:** Erika Muster'));
assert.equal(hits.lnk, 0, 'echter Link darf nie geklickt werden');
assert.equal(hits.blank, 0, 'target=_blank nie klicken');
assert.equal(hits.fb, 0, 'Formular-Button nie klicken');
assert.ok(hits.tg >= 1, 'normaler Toggle-Button wird geklickt');
console.log('Klicks:', JSON.stringify(hits));
assert.ok(styles.length >= 1, 'Ausblende-Stylesheet wurde angelegt');
for (const css of styles) { const sel = css.split('{')[0]; assert.ok(!/,\s*,/.test(sel), 'keine leeren Selektoren (,,)'); dom.window.document.querySelectorAll(sel); assert.ok(sel.includes('nav') && sel.includes('.cookie-banner')); }
for (const needle of ['# Überschrift', '## Unterkapitel', '- Punkt eins', '1. Erster', 'Name | Wert']) assert.ok(xml.includes(needle), 'Struktur fehlt: ' + needle);
assert.equal(dom.window.document.querySelector('h1').textContent, 'Überschrift', 'Seite wurde wieder zurückgesetzt (h1)');
assert.equal(dom.window.document.querySelector('li').textContent, 'Punkt eins', 'Seite wurde wieder zurückgesetzt (li)');
assert.ok(xml.includes('[E-MAIL]') && xml.includes('[IBAN]') && !xml.includes('max.muster@'), 'Maskierung');
assert.ok(st.B.message.includes('maskiert'), 'Statusmeldung nennt Maskierung');
assert.ok(st.B.message.includes('Passwortfeld'), 'Warnung bei Passwortfeld');
assert.ok(xml.startsWith('<aufgabe>Fasse zusammen</aufgabe>') && xml.trimEnd().endsWith('Frage: Was steht drin?'), 'Prompt-Rahmen');
assert.ok(xml.includes('<links><link><url><![CDATA[https://other.example/mehr]]>'), 'Linkliste');
// Rechtsklick-Auswahl
await listeners.menu({ menuItemId: 'rh-add-selection', selectionText: 'Ein ausgewählter Textausschnitt A' }, { id: 1, url: 'https://example.com/artikel', title: 'Testseite' });
await listeners.menu({ menuItemId: 'rh-add-selection', selectionText: 'Ein zweiter Ausschnitt B' }, { id: 1, url: 'https://example.com/artikel', title: 'Testseite' });
const st2 = await send({ type: 'getState' });
assert.equal(st2.B.resCount, 3, 'zwei Auswahl-Quellen zusätzlich (append statt ersetzen)');
const xml2 = (await send({ type: 'getResult', which: 'result' })).text;
assert.ok(xml2.includes('Textausschnitt A') && xml2.includes('zweiter Ausschnitt B'));
// Wiederholte Zeilen
import('../research-tool/common.js').then(({ collapseRepeats }) => assert.equal(collapseRepeats('a\nMenü\nMenü\nMenü\nb'), 'a\nMenü\nb'));
// Clear → Restore → erneutes Restore (Tausch)
await send({ type: 'clearB' });
assert.equal((await send({ type: 'getState' })).B.resCount, 0);
assert.equal((await send({ type: 'getState' })).B.backupCount, 3, 'Sicherung vorhanden');
assert.equal((await send({ type: 'restoreB' })).count, 3);
assert.equal((await send({ type: 'getState' })).B.resCount, 3, 'wiederhergestellt');
await send({ type: 'removeAt', index: 0 });
assert.equal((await send({ type: 'getState' })).B.resCount, 2);
assert.equal((await send({ type: 'restoreB' })).count, 3, 'Entfernen rückgängig');
// Alt+Shift+C: Sammlung ohne Popup kopieren
await listeners.cmd('copy-all');
assert.ok(copied && copied.startsWith('<aufgabe>') && copied.includes('<quellen>') && copied.trimEnd().endsWith('Was steht drin?'), 'copy-all kopiert Export inkl. Prompt-Rahmen');
const ca = await send({ type: 'copyAll' }); assert.equal(ca.ok, true);
{
  const hostEl = () => dom.window.document.getElementById('rh-toast-host');
  assert.ok(hostEl() && /kopiert/.test(hostEl().getAttribute('data-msg')), 'Toast nach Alt+Shift+C');
  await listeners.cmd('read-current');
  assert.ok(hostEl() && /Gelesen/.test(hostEl().getAttribute('data-msg')), 'Toast nach Alt+Shift+R');
  await send({ type: 'readCurrent' });
  const again = (await send({ type: 'getResult', which: 'result' })).text;
  assert.ok(!again.includes('Gelesen ·') && !again.includes('kopiert ·'), 'Toast wird nie mit ausgelesen');
}
// Quelle ein-/ausschalten
const stA = (await send({ type: 'getState' })).B;
const tokA = stA.resTokens;
const tg = await send({ type: 'toggleAt', index: 0 });
assert.equal(tg.off, true);
const stB2 = (await send({ type: 'getState' })).B;
assert.equal(stB2.activeCount, stA.resCount - 1, 'eine Quelle weniger aktiv');
assert.ok(stB2.resTokens < tokA, 'Statistik zählt nur aktive Quellen');
const firstUrl = stA.sources[0].url;
const exp = (await send({ type: 'getResult', which: 'result' })).text;
assert.ok(!exp.includes(firstUrl), 'ausgeschaltete Quelle fehlt im Export');
const one = (await send({ type: 'getResult', which: 'at', index: 0 })).text;
assert.ok(one.includes(firstUrl), 'Einzelkopie enthält die Quelle trotzdem');
copied = null; await listeners.cmd('copy-all');
assert.ok(copied && !copied.includes(firstUrl), 'Alt+Shift+C kopiert nur aktive Quellen');
await send({ type: 'toggleAt', index: 0 });
assert.equal((await send({ type: 'getState' })).B.activeCount, stA.resCount, 'wieder eingeschaltet');
// Auf Budget kürzen (1000 Token ≈ 3800 Zeichen)
await listeners.menu({ menuItemId: 'rh-add-selection', selectionText: 'wort '.repeat(3000) }, { id: 1, url: 'https://example.com/lang', title: 'Lang' });
const before = (await send({ type: 'getState' })).B;
assert.ok(before.resTokens > 1000, 'über Budget');
const fit = await send({ type: 'fitBudget' });
assert.ok(fit.ok && fit.changed >= 1, 'gekürzt');
const afterS = (await send({ type: 'getState' })).B;
assert.ok(afterS.resTokens <= 1000, 'Budget eingehalten: ' + afterS.resTokens);
assert.equal(afterS.resCount, before.resCount, 'keine Quelle verloren');
assert.equal((await send({ type: 'fitBudget' })).changed, 0, 'zweiter Lauf ändert nichts');
await send({ type: 'restoreB' });
assert.ok((await send({ type: 'getState' })).B.resTokens > 1000, 'Wiederherstellen stellt Originale zurück');
// Sperrliste
dom.reconfigure({ url: 'https://sub.blocked.test/seite' });
const blocked = await send({ type: 'readCurrent' });
assert.equal(blocked.ok, false); assert.ok(/Sperrliste/.test(blocked.error), 'Sperrliste greift');
console.log('E2E OK');
process.exit(0);
