import assert from 'node:assert/strict';
import { expandVars, fitToBudget, redactSensitive, isBlockedHost, PRESETS, PROMPT_TEMPLATES, cleanUrl, isPdfUrl, buildExport, cdata, applyLimit, cleanupBlocks, mergeSettings, DEFAULTS, estimateTokens } from '../research-tool/common.js';
assert.equal(cleanUrl('https://a.de/x?utm_source=1&q=2#h'), 'https://a.de/x?q=2');
assert.equal(cleanUrl('https://www.google.com/url?q=https%3A%2F%2Fb.de%2Fp&sa=U'), 'https://b.de/p');
assert.equal(cleanUrl('ftp://x'), null);
assert.ok(isPdfUrl('https://a.de/doc.pdf') && !isPdfUrl('https://a.de/doc'));
assert.equal(cdata('a]]>b'), '<![CDATA[a]]]]><![CDATA[>b]]>');
const blocks = [{ url: 'https://a.de', inhalt: 'Hallo Welt', titel: 'T', meta: { autor: 'X' } }];
assert.ok(buildExport(blocks, false, { root: true, ids: true }).includes('<quellen>') );
assert.ok(buildExport(blocks, false).includes('<autor>') && !buildExport(blocks, false).includes('<quellen>'));
assert.ok(buildExport(blocks, true).includes('**Autor:** X'));
const long = 'wort '.repeat(1000);
for (const m of ['frag', 'vo', 'vu']) assert.ok(applyLimit(long, m, 500).text.length <= 500, m);
const d = [{ url: 'a', inhalt: long }, { url: 'b', inhalt: long }, { url: 'c', inhalt: 'ganz anderer Text hier drin ok' }];
assert.equal(cleanupBlocks(d, 90).removed.length, 1);
assert.equal(mergeSettings({ scrollRounds: 999, xmlRoot: 1 }).scrollRounds, 30);
assert.equal(mergeSettings({ xmlRoot: 1 }).xmlRoot, true);
assert.ok(!('skipPdf' in DEFAULTS));
assert.equal(estimateTokens(3800), 1000);
for (const pr of [...PRESETS, ...PROMPT_TEMPLATES]) {
  const m = mergeSettings(pr.set);
  for (const [k, v] of Object.entries(pr.set)) { assert.ok(k in DEFAULTS, 'unbekannter Schlüssel ' + k); assert.equal(m[k], v, `${pr.id}.${k} wird von mergeSettings verändert`); }
}
assert.ok(PROMPT_TEMPLATES.every((t) => t.set.promptPrefix && t.set.promptSuffix));
{
  const r = redactSensitive('Mail max.muster@example.org, IBAN DE89 3704 0044 0532 0130 00, Karte 4111 1111 1111 1111, Key sk-abcdefghijklmnopqrstuvwx, ID 1234567890123, Datum 2026-11-22, falsch DE00 1234 5678 9012 3456 78, Karte 4111 1111 1111 1112');
  assert.equal(r.count, 4, 'genau vier Treffer');
  for (const ph of ['[E-MAIL]', '[IBAN]', '[KARTENNUMMER]', '[SCHLÜSSEL]']) assert.ok(r.text.includes(ph), ph);
  for (const keep of ['1234567890123', '2026-11-22', 'DE00 1234 5678 9012 3456 78', '4111 1111 1111 1112']) assert.ok(r.text.includes(keep), 'darf nicht maskiert werden: ' + keep);
  assert.ok(!r.text.includes('max.muster@') && !r.text.includes('0532'));
  assert.equal(redactSensitive('Ganz normaler Text.').count, 0);
}
assert.ok(isBlockedHost('https://mail.google.com/x', 'mail.google.com'));
assert.ok(isBlockedHost('https://www.meine-bank.de/', '# Banken\nMeine-Bank.de\n'));
assert.ok(isBlockedHost('https://login.meine-bank.de/', '*.meine-bank.de'));
assert.ok(!isBlockedHost('https://notmeine-bank.de/', 'meine-bank.de'));
assert.ok(!isBlockedHost('https://a.de', ''));
{
  const mk = (n) => ({ url: 'u' + n, inhalt: ('wort ' + n + ' ').repeat(n) });
  const bl = [mk(100), mk(2000), mk(3000)];
  const total = bl.reduce((a, b) => a + b.inhalt.length, 0);
  const target = 4000;
  for (const m of ['vo', 'vu', 'frag']) {
    const r = fitToBudget(bl, target, m);
    assert.ok(r.after <= target + 3, `Budget eingehalten (${m}): ${r.after}`);
    assert.equal(r.blocks[0].inhalt, bl[0].inhalt, 'kurze Quelle bleibt komplett');
    assert.ok(r.changed === 2 && r.before === total);
  }
  assert.equal(fitToBudget(bl, total + 1).changed, 0, 'nichts zu tun');
}
{
  const bl = [{ url: 'https://a.de', titel: 'A', inhalt: 'x'.repeat(380) }, { url: 'https://b.de', inhalt: 'y'.repeat(20) }];
  const out = expandVars('Am {datum} um {uhrzeit}: {anzahl} Quellen, {zeichen} Zeichen, ≈{token} Token.\n{quellenliste}\n{unbekannt}', bl);
  assert.match(out, /^Am \d{4}-\d{2}-\d{2} um \d{2}:\d{2}: 2 Quellen, 400 Zeichen, ≈105 Token\./);
  assert.ok(out.includes('[1] A – https://a.de') && out.includes('[2] https://b.de') && out.includes('{unbekannt}'));
  assert.ok(buildExport(bl, false, { prefix: 'Es folgen {anzahl} Quellen', suffix: '{quellenliste}' }).startsWith('Es folgen 2 Quellen'));
}
console.log('common OK');
