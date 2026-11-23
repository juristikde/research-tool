import { DEFAULTS, SETTINGS_SCHEMA, PRESETS, PROMPT_TEMPLATES, mergeSettings, fmtInt, cleanUrl, isBlockedHost } from './common.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));

let settings = { ...DEFAULTS };
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const anim = () => settings.animations !== false && !reduced();
function applyTheme() {
  const h = document.documentElement;
  h.dataset.theme = settings.theme || 'sunset';
  h.dataset.anim = settings.animations === false ? 'off' : 'on';
}

/* Rollende Zahlen (wie die Zähler bei X): zählt weich vom alten zum neuen Wert */
function tween(el, to) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = String(to);
  cancelAnimationFrame(el._raf);
  if (!anim() || from === to) { el.textContent = fmtInt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
    el.textContent = fmtInt(Math.round(from + (to - from) * e));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

/* Partikel-Burst (wie der Herz-Effekt beim Liken) */
function burst(el, n = 12) {
  if (!anim() || !el) return;
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'burst';
  box.style.left = `${r.left + r.width / 2}px`;
  box.style.top = `${r.top + r.height / 2}px`;
  const ring = document.createElement('b'); box.appendChild(ring);
  const cols = ['#ff2e93', '#ff9a3c', '#ffe26a', '#19e3d1', '#c77dff'];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.4, d = 38 + Math.random() * 30;
    const p = document.createElement('i');
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`); p.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    p.style.setProperty('--c', cols[i % cols.length]);
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 900);
}
const last = { B: null, resB: '' };
let fullB = '';            // vollständiger Export (Kopieren/Download nutzen immer diesen Text)
const SHOW_MAX = 120000;   // Anzeige im Textfeld wird bei sehr großen Sammlungen gekürzt

/* ------------------------------------------------------------------ Einstellungen */

async function loadSettings() {
  const d = await chrome.storage.local.get(['settings']);
  settings = mergeSettings(d.settings);
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ settings }), 150);
}
function setSetting(key, value) {
  settings = mergeSettings({ ...settings, [key]: value });
  saveSettings();
  syncQuick();
  applyDeps();
}

function applySettings(partial) {
  settings = mergeSettings({ ...settings, ...partial });
  saveSettings();
  buildSettings(); syncQuick(); filterSettings();
}

function syncQuick() {
  applyTheme();
  const on = !!settings.hardCapEnabled;
  $('qCapOn').checked = on;
  $('qCapChars').value = settings.hardCapChars;
  $('qCapMethod').value = settings.hardCapMethod || 'frag';
  $('quickCap').classList.toggle('dim', !on);
  $('qCapChars').disabled = !on;
  $('qCapMethod').disabled = !on;
  if ($('qFmt')) $('qFmt').value = settings.exportMarkdown ? 'md' : 'xml';
  // Einstellungs-Tab-Zeilen mitsynchronisieren, falls schon gebaut
  const rowOn = document.querySelector('[data-key="hardCapEnabled"] input');
  if (rowOn) rowOn.checked = on;
  const rowCh = document.querySelector('[data-key="hardCapChars"] input');
  if (rowCh) { rowCh.value = settings.hardCapChars; rowCh.disabled = !on; }
  const rowMe = document.querySelector('[data-key="hardCapMethod"] select');
  if (rowMe) { rowMe.value = settings.hardCapMethod || 'frag'; rowMe.disabled = !on; }
  const rowMd = document.querySelector('[data-key="exportMarkdown"] input');
  if (rowMd) rowMd.checked = !!settings.exportMarkdown;
}
$('qCapOn').addEventListener('change', (e) => setSetting('hardCapEnabled', e.target.checked));
$('qCapChars').addEventListener('change', () => {
  setSetting('hardCapChars', $('qCapChars').value);
  $('qCapChars').value = settings.hardCapChars;
});
$('qCapMethod').addEventListener('change', (e) => setSetting('hardCapMethod', e.target.value));
$('qFmt').addEventListener('change', (e) => {
  setSetting('exportMarkdown', e.target.value === 'md');
  last.resB = ''; // Textarea neu laden im gewählten Format
  tick();
});

function buildSettings() {
  const list = $('setList');
  list.textContent = '';
  const pg = document.createElement('details');
  pg.className = 'grp'; pg.dataset.group = 'presets'; pg.open = true;
  const psum = document.createElement('summary'); psum.textContent = 'Profile & Prompt-Vorlagen'; pg.appendChild(psum);
  const prow = document.createElement('div');
  prow.className = 'srow'; prow.style.display = 'block'; prow.style.padding = '0';
  prow.dataset.search = 'profile profil vorlage vorlagen prompt preset schnell token sparen maximal ausgewogen template'; prow.dataset.key = '_presets';
  const box = document.createElement('div'); box.className = 'presets';
  const l1 = document.createElement('div'); l1.className = 'pl'; l1.textContent = 'Profil – setzt mehrere Einstellungen auf einmal:'; box.appendChild(l1);
  PRESETS.forEach((pr) => {
    const bt = document.createElement('button');
    bt.type = 'button'; bt.className = 'b mini'; bt.textContent = pr.label; bt.title = pr.help;
    if (Object.entries(pr.set).every(([k, v]) => settings[k] === v)) bt.classList.add('on');
    bt.addEventListener('click', () => { applySettings(pr.set); flash($('msgB'), `Profil „${pr.label}“ angewendet.`); });
    box.appendChild(bt);
  });
  const l2 = document.createElement('div'); l2.className = 'pl'; l2.style.marginTop = '4px'; l2.textContent = 'Prompt-Vorlage – füllt Text vor/nach den Quellen:'; box.appendChild(l2);
  const sel = document.createElement('select');
  const o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Vorlage wählen …'; sel.appendChild(o0);
  PROMPT_TEMPLATES.forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; sel.appendChild(o); });
  const go = document.createElement('button'); go.type = 'button'; go.className = 'b mini primary'; go.textContent = 'Anwenden';
  go.addEventListener('click', () => {
    const t = PROMPT_TEMPLATES.find((x) => x.id === sel.value);
    if (!t) return flash($('msgB'), 'Bitte zuerst eine Vorlage wählen.', true);
    applySettings(t.set);
    flash($('msgB'), `Vorlage „${t.label}“ übernommen (Einstellungen → Export).`);
  });
  box.append(sel, go);
  prow.appendChild(box); pg.appendChild(prow); list.appendChild(pg);
  SETTINGS_SCHEMA.forEach((g, gi) => {
    const det = document.createElement('details');
    det.className = 'grp';
    det.dataset.group = g.id;
    det.open = false;
    const sum = document.createElement('summary');
    sum.textContent = g.title;
    det.appendChild(sum);
    g.items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'srow';
      row.dataset.key = it.key;
      if (it.dependsOn) row.dataset.dep = it.dependsOn;
      row.dataset.search = `${g.title} ${it.label} ${it.help || ''} ${it.keywords || ''}`.toLowerCase();
      const l = document.createElement('div');
      l.className = 'l';
      const b = document.createElement('b'); b.textContent = it.label;
      const sm = document.createElement('small'); sm.textContent = it.help || '';
      l.append(b, sm);
      const c = document.createElement('div');
      c.className = 'c';
      let input;
      if (it.type === 'bool') {
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!settings[it.key];
        input.addEventListener('change', () => setSetting(it.key, input.checked));
      } else if (it.type === 'number') {
        input = document.createElement('input'); input.type = 'number'; input.value = settings[it.key];
        if (it.min != null) input.min = it.min; if (it.max != null) input.max = it.max; if (it.step != null) input.step = it.step;
        input.addEventListener('change', () => { setSetting(it.key, input.value); input.value = settings[it.key]; });
        const u = document.createElement('span'); u.className = 'u'; u.textContent = it.unit || '';
        c.append(input, u);
      } else if (it.type === 'text') {
        input = document.createElement('textarea'); input.className = 'stext'; input.rows = 3; input.maxLength = it.maxLen || 4000;
        input.value = settings[it.key] || '';
        input.addEventListener('change', () => setSetting(it.key, input.value));
      } else {
        input = document.createElement('select');
        it.options.forEach((o) => { const op = document.createElement('option'); op.value = o.v; op.textContent = o.l; input.appendChild(op); });
        input.value = settings[it.key];
        input.addEventListener('change', () => setSetting(it.key, input.value));
      }
      if (it.type === 'text') { row.style.flexDirection = 'column'; c.style.width = '100%'; }
      if (!c.contains(input)) c.appendChild(input);
      row.append(l, c);
      det.appendChild(row);
    });
    list.appendChild(det);
  });
  applyDeps();
}

function applyDeps() {
  document.querySelectorAll('.srow[data-dep]').forEach((row) => {
    const off = !settings[row.dataset.dep];
    row.classList.toggle('dim', off);
    row.querySelectorAll('input,select').forEach((i) => { i.disabled = off; });
  });
}

function filterSettings() {
  const q = $('setSearch').value.trim().toLowerCase();
  let any = false;
  document.querySelectorAll('#setList details.grp').forEach((det, gi) => {
    let vis = 0;
    det.querySelectorAll('.srow').forEach((row) => {
      const show = !q || row.dataset.search.includes(q);
      row.hidden = !show;
      if (show) vis++;
    });
    det.hidden = vis === 0;
    if (vis) any = true;
    if (q) det.open = vis > 0; else det.open = gi === 0;
  });
  $('setEmpty').hidden = any;
}
$('setSearch').addEventListener('input', filterSettings);

function openSettings(open) {
  const tgt = open ? $('settings') : $('main'); tgt.style.animation = 'none'; void tgt.offsetWidth; tgt.style.animation = '';
  $('settings').hidden = !open;
  $('main').hidden = open;
  document.querySelector('header').hidden = open;
  if (open) { $('setSearch').value = ''; filterSettings(); setTimeout(() => $('setSearch').focus(), 30); }
}
$('btnSettings').addEventListener('click', () => openSettings(true));
$('btnBack').addEventListener('click', () => openSettings(false));
$('btnReset').addEventListener('click', async () => {
  if (!confirm('Wirklich ALLE Einstellungen auf die Standardwerte zurücksetzen?')) return;
  settings = { ...DEFAULTS };
  await chrome.storage.local.set({ settings });
  buildSettings(); syncQuick(); filterSettings();
});

$('btnExpSet').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'recherche-helfer', version: 1, settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'recherche-helfer-einstellungen.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  flash($('msgB'), 'Einstellungen werden heruntergeladen …');
});
$('btnImpSet').addEventListener('click', () => $('impFile').click());
$('impFile').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    const src = obj && typeof obj === 'object' && obj.settings && typeof obj.settings === 'object' ? obj.settings : obj;
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('kein Einstellungsobjekt');
    const known = Object.keys(src).filter((k) => k in DEFAULTS);
    if (!known.length) throw new Error('keine bekannten Einstellungen gefunden');
    applySettings(Object.fromEntries(known.map((k) => [k, src[k]])));
    flash($('msgB'), `${known.length} Einstellungen importiert.`);
  } catch (err) {
    flash($('msgB'), `Import fehlgeschlagen: ${err.message}`, true);
  }
});

/* ------------------------------------------------------------------ Hilfen */

const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
function flash(el, text, isErr) {
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 6000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (__) { return false; }
  }
}
function wireCopy(btnId, markId, getText) {
  $(btnId).addEventListener('click', async () => {
    const ok = await copyText(getText());
    const m = $(markId);
    m.textContent = ok ? '✓' : '✗';
    if (ok) burst($(btnId));
    m.style.color = ok ? '#9be9a8' : '#ffb1ab';
    clearTimeout(m._t);
    m._t = setTimeout(() => { m.textContent = ''; }, 2000);
  });
}
const statusClass = (box, cls) => { box.className = 'statusBox' + (cls ? ' ' + cls : ''); };

/* ------------------------------------------------------------------ Quellenliste */

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}
const knownSrc = new Set();
let curSources = [];
const hueOf = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
let srcSig = '';
function renderSources(list) {
  const box = $('srcList');
  if (!box) return;
  $('emptyHint').hidden = list.length > 0;
  curSources = list;
  const sig = list.map((s) => `${s.url}|${s.chars}|${s.titel}|${s.off ? 1 : 0}`).join('\n');
  if (sig === srcSig) return; // nichts geändert: kein Neuaufbau (keine Animation, Scrollposition bleibt)
  srcSig = sig;
  refreshTab();
  if (previewIdx >= 0) { previewIdx = -1; $('preview').hidden = true; }
  const prevScroll = box.scrollTop;
  box.textContent = '';
  if (!list.length) { knownSrc.clear(); box.hidden = true; return; }
  box.hidden = false;
  list.forEach((s) => {
    const row = document.createElement('div');
    const rk = `${s.url}|${s.chars}`;
    row.className = 'srcRow' + (knownSrc.has(rk) ? '' : ' new') + (s.off ? ' off' : '');
    knownSrc.add(rk);
    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = String(s.i + 1);
    const hue = hueOf(hostOf(s.url));
    idx.style.background = `linear-gradient(135deg,hsl(${hue} 85% 58%),hsl(${(hue + 45) % 360} 90% 60%))`;
    const tg = document.createElement('input');
    tg.type = 'checkbox'; tg.className = 'tg'; tg.checked = !s.off;
    tg.title = s.off ? 'Quelle einschalten' : 'Quelle ausschalten (bleibt gespeichert, wird aber nicht exportiert)';
    tg.addEventListener('change', async () => {
      const r = await send({ type: 'toggleAt', index: s.i });
      if (!r.ok) return flash($('msgB'), r.error || 'Umschalten fehlgeschlagen', true);
      last.resB = ''; tick();
    });
    const cp = document.createElement('button');
    cp.type = 'button'; cp.className = 'mv'; cp.textContent = '⧉'; cp.title = 'Nur diese Quelle kopieren';
    cp.addEventListener('click', async () => {
      const r = await send({ type: 'getResult', which: 'at', index: s.i });
      const ok = r.ok && await copyText(r.text);
      if (ok) burst(cp, 7);
      flash($('msgB'), ok ? `Quelle ${s.i + 1} kopiert.` : 'Kopieren fehlgeschlagen.', !ok);
    });
    const u = document.createElement('div');
    u.className = 'u';
    const title = s.titel ? s.titel : hostOf(s.url);
    const main = document.createElement('span');
    main.textContent = title;
    main.title = s.url;
    const sm = document.createElement('small');
    sm.textContent = ' · ' + hostOf(s.url) + (s.isPdf ? ' · PDF' : '') + (s.datum ? ' · ' + String(s.datum).slice(0, 10) : '');
    u.append(main, sm);
    u.title = 'Klicken für Vorschau';
    u.addEventListener('click', () => togglePreview(s.i));
    const ch = document.createElement('span');
    ch.className = 'ch';
    ch.textContent = fmtInt(s.chars);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = 'Diese Quelle entfernen';
    btn.addEventListener('click', async () => {
      if (anim()) { row.classList.add('out'); await new Promise((res) => setTimeout(res, 220)); }
      const r = await send({ type: 'removeAt', index: s.i });
      if (!r.ok) return flash($('msgB'), r.error || 'Entfernen fehlgeschlagen', true);
      flash($('msgB'), 'Quelle entfernt.');
      last.resB = '';
      tick();
    });
    const mk = (label, dir, title, off) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title; b.disabled = off; b.className = 'mv';
      b.addEventListener('click', async () => {
        const r = await send({ type: 'moveAt', index: s.i, dir });
        if (!r.ok) return flash($('msgB'), r.error || 'Verschieben fehlgeschlagen', true);
        last.resB = ''; tick();
      });
      return b;
    };
    row.dataset.search = `${s.titel} ${s.url}`.toLowerCase();
    row.append(tg, idx, u, ch, cp, mk('↑', -1, 'Nach oben', s.i === 0), mk('↓', 1, 'Nach unten', s.i === list.length - 1), btn);
    box.appendChild(row);
  });
  box.scrollTop = prevScroll;
  $('srcFilter').hidden = list.length <= 6;
  if (list.length <= 6) $('srcFilter').value = '';
  applyFilter();
}
function applyFilter() {
  const q = $('srcFilter').value.trim().toLowerCase();
  document.querySelectorAll('#srcList .srcRow').forEach((r) => { r.hidden = !!q && !r.dataset.search.includes(q); });
}
$('srcFilter').addEventListener('input', applyFilter);

let tabBlocked = false;
async function refreshTab() {
  const box = $('tabInfo');
  let tab = null;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (_) { tab = null; }
  if (!tab || !tab.url) { box.hidden = true; tabBlocked = false; return; }
  const web = /^(https?|file):/i.test(tab.url);
  const url = cleanUrl(tab.url) || tab.url;
  const blocked = web && isBlockedHost(tab.url, settings.blockedHosts);
  const inColl = web && curSources.some((x) => x.url === url);
  tabBlocked = !web || blocked;
  let cls = 'new', txt = /\.pdf($|[?#])/i.test(tab.url) ? 'PDF · neu' : 'neu';
  if (!web) { cls = 'err'; txt = 'nicht lesbar'; }
  else if (blocked) { cls = 'err'; txt = 'gesperrt'; }
  else if (inColl) { cls = 'ok'; txt = 'in Sammlung · wird ersetzt'; }
  $('tiHost').textContent = web ? hostOf(tab.url) : 'Browser-Seite';
  $('tiTitle').textContent = tab.title || '';
  const bd = $('tiBadge'); bd.textContent = txt; bd.className = 'badge ' + cls;
  box.hidden = false;
  if (tabBlocked) $('btnRead').disabled = true;
}

let budgetWarned = false;
function renderStats(b) {
  const box = $('stats');
  box.hidden = !b.resCount;
  if (!b.resCount) { ['sQ', 'sC', 'sT'].forEach((id) => { $(id).dataset.v = '0'; $(id).textContent = '0'; }); return; }
  const act = b.activeCount ?? b.resCount;
  tween($('sQ'), act); tween($('sC'), b.resChars);
  $('chipOff').hidden = !(b.resCount - act > 0); tween($('sOff'), Math.max(0, b.resCount - act)); tween($('sT'), b.resTokens || 0);
  const budget = Math.max(1000, Number(settings.tokenBudget) || 200000);
  const pct = (b.resTokens || 0) / budget;
  $('meterFill').style.width = `${Math.min(100, Math.max(2, pct * 100))}%`;
  $('meter').className = 'meter' + (pct > 1 ? ' hi' : pct > 0.7 ? ' mid' : '');
  $('btnFit').hidden = !(pct > 1);
  if (pct > 1 && !budgetWarned) { budgetWarned = true; flash($('msgB'), `Token-Budget überschritten (${fmtInt(b.resTokens || 0)} von ${fmtInt(budget)}).`, true); }
  if (pct <= 1) budgetWarned = false;
  setText($('meterTxt'), `${fmtInt(b.resTokens || 0)} / ${fmtInt(budget)} (${Math.round(pct * 100)} %)`);
}

$('btnFit').addEventListener('click', async () => {
  const r = await send({ type: 'fitBudget' });
  if (!r.ok) return flash($('msgB'), r.error || 'Kürzen fehlgeschlagen', true);
  burst($('btnFit'), 12);
  flash($('msgB'), r.changed ? `${r.changed} Quelle(n) gekürzt: ${fmtInt(r.before)} → ${fmtInt(r.after)} Token (↺ macht es rückgängig).` : 'Passt bereits ins Budget.');
  last.resB = ''; tick();
});

/* Quellen-Vorschau: Klick auf den Titel */
let previewIdx = -1;
async function togglePreview(i) {
  if (previewIdx === i) { previewIdx = -1; $('preview').hidden = true; return; }
  const r = await send({ type: 'getSource', index: i });
  if (!r.ok) return flash($('msgB'), r.error || 'Vorschau nicht möglich', true);
  previewIdx = i;
  $('pvTitle').textContent = `${i + 1} · ${r.titel || r.url}`;
  $('pvText').textContent = r.text + (r.total > r.text.length ? `\n\n… (${fmtInt(r.total - r.text.length)} weitere Zeichen)` : '');
  $('preview').hidden = false;
}
$('pvClose').addEventListener('click', () => { previewIdx = -1; $('preview').hidden = true; });

/* ------------------------------------------------------------------ Hauptansicht (ehemals Modus B) */

function renderB(b) {
  const prev = last.B;
  last.B = b;
  const busy = b.status === 'liest';
  if (prev && prev.status === 'liest' && !busy && b.ok) burst($('btnRead'), 16);
  document.body.classList.toggle('busy', busy);
  const box = $('statusB');
  setText($('textB'), b.message || 'Bereit – öffne eine Seite und klicke auf „Aktuelle Seite auslesen“.');
  let cls = '';
  if (busy) cls = 'busy';
  else if (b.status === 'wartet_grossertext') cls = 'wait';
  else if (b.message) {
    if (b.ok || /ausgelesen|ersetzt|Markierung/i.test(b.message)) cls = 'ok';
    else if (/abgebrochen|Bereit/i.test(b.message)) cls = '';
    else cls = 'err';
  }
  statusClass(box, cls);
  $('btnRead').disabled = busy || b.status === 'wartet_grossertext' || tabBlocked;
  $('btnCopyB').disabled = b.resCount === 0;
  $('btnDownloadB').disabled = b.resCount === 0;
  $('btnUndoB').disabled = b.resCount === 0;
  $('btnCleanupB').disabled = b.resCount === 0;
  $('btnClearB').disabled = b.resCount === 0;
  $('btnRestoreB').disabled = !b.backupCount;
  $('btnCopyLast').disabled = !b.hasLast;
  renderStats(b);
  renderSources(b.sources || []);

  const showLarge = b.status === 'wartet_grossertext' && b.pending;
  $('panelLarge').hidden = !showLarge;
  if (showLarge && (!prev || prev.status !== 'wartet_grossertext')) {
    setText($('largeTxt'), `${b.pending.url} – ${fmtInt(b.pending.len)} Zeichen.`);
    $('largeChars').value = b.pending.defaultChars;
    document.querySelectorAll('input[name=lm]').forEach((r) => { r.checked = r.value === b.pending.defaultMethod; });
  }
  $('noticeB').hidden = !b.sizeNotice;
  if (b.sizeNotice) setText($('noticeBTxt'), `Das Sammel-Ergebnis ist jetzt über ${fmtInt(b.sizeWarnChars)} Zeichen groß. Du kannst weiterarbeiten oder mit „Clear“ leeren.`);

  const key = `${b.ver}|${b.resCount}|${b.resChars}`;
  if (key !== last.resB) {
    last.resB = key;
    Promise.all([send({ type: 'getResult', which: 'result' }), send({ type: 'getResult', which: 'last' })]).then(([r1, r2]) => {
      if (r1.ok) {
        fullB = r1.text;
        const ta = $('outB');
        ta.value = fullB.length > SHOW_MAX
          ? `${fullB.slice(0, SHOW_MAX / 2)}\n\n… [Anzeige gekürzt: ${fmtInt(fullB.length - SHOW_MAX)} Zeichen ausgeblendet – Kopieren und Download enthalten alles] …\n\n${fullB.slice(-SHOW_MAX / 2)}`
          : fullB;
        ta.scrollTop = ta.scrollHeight;
      }
      if (r2.ok) $('lastB').value = r2.text;
    });
  }
}

$('btnRead').addEventListener('click', async () => {
  $('btnRead').disabled = true;
  setText($('textB'), 'Warte auf vollständig geladene Seite und lese aus …'); statusClass($('statusB'), 'busy');
  const r = await send({ type: 'readCurrent' });
  if (!r.ok && r.error) { setText($('textB'), r.error); statusClass($('statusB'), 'err'); }
  await tick();
  if (r && r.ok && settings.autoCopyLast) {
    const lastRes = await send({ type: 'getResult', which: 'last' });
    if (lastRes.ok && lastRes.text) {
      const ok = await copyText(lastRes.text);
      flash($('msgB'), ok ? 'Zuletzt gelesene Quelle in die Zwischenablage kopiert.' : 'Kopieren fehlgeschlagen.', !ok);
    }
  }
});
$('btnLargeLimit').addEventListener('click', async () => {
  const method = (document.querySelector('input[name=lm]:checked') || {}).value || 'frag';
  const chars = Math.max(1, Number($('largeChars').value) || settings.askDefaultChars);
  await send({ type: 'answerLarge', method, chars }); tick();
});
$('btnLargeFull').addEventListener('click', async () => { await send({ type: 'answerLarge', complete: true }); tick(); });
$('btnLargeCancel').addEventListener('click', async () => { await send({ type: 'cancelLarge' }); tick(); });
$('btnNoticeB').addEventListener('click', async () => { await send({ type: 'dismissSizeB' }); tick(); });
$('btnClearB').addEventListener('click', async () => {
  // Keine Rückfrage nötig: „↺“ stellt die Sammlung sofort wieder her.
  await send({ type: 'clearB' }); last.resB = ''; $('outB').value = ''; fullB = '';
  flash($('msgB'), 'Sammlung geleert – mit ↺ wiederherstellbar.'); tick();
});
$('btnRestoreB').addEventListener('click', async () => {
  const r = await send({ type: 'restoreB' });
  if (!r.ok) return flash($('msgB'), r.error || 'Wiederherstellen fehlgeschlagen', true);
  burst($('btnRestoreB'), 8);
  flash($('msgB'), `${r.count} ${r.count === 1 ? 'Quelle' : 'Quellen'} wiederhergestellt.`);
  last.resB = ''; tick();
});
$('btnUndoB').addEventListener('click', async () => {
  const r = await send({ type: 'undoLast' });
  if (!r.ok) return flash($('msgB'), r.error || 'Undo fehlgeschlagen', true);
  flash($('msgB'), r.removedUrl ? `Letzte Quelle entfernt: ${r.removedUrl}` : 'Letzte Quelle entfernt.');
  last.resB = '';
  tick();
});
$('btnDownloadB').addEventListener('click', () => {
  const text = fullB;
  if (!text) return;
  const md = !!settings.exportMarkdown;
  const blob = new Blob([text], { type: md ? 'text/markdown;charset=utf-8' : 'application/xml;charset=utf-8' });
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = URL.createObjectURL(blob);
  a.download = `quellen-${ts}.${md ? 'md' : 'xml'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  flash($('msgB'), `${md ? 'Markdown' : 'XML'}-Datei wird heruntergeladen …`);
});
wireCopy('btnCopyB', 'markCopyB', () => fullB);
wireCopy('btnCopyLast', 'markCopyLast', () => $('lastB').value);

async function doCleanup(msgEl) {
  const r = await send({ type: 'cleanup' });
  if (!r.ok) return flash(msgEl, r.error, true);
  flash(msgEl, r.removed ? `${r.removed} doppelte ${r.removed === 1 ? 'Quelle' : 'Quellen'} entfernt (Schwelle ${settings.cleanupThreshold} %).` : 'Keine doppelten Inhalte gefunden.');
  last.resB = '';
  tick();
}
$('btnCleanupB').addEventListener('click', () => doCleanup($('msgB')));

/* ------------------------------------------------------------------ Aktualisierung */

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const r = await send({ type: 'getState' });
    if (r && r.ok) { renderB(r.B); }
  } finally { ticking = false; }
}

(async function init() {
  await loadSettings();
  applyTheme();
  buildSettings();
  syncQuick();
  await tick();
  refreshTab();
  setInterval(tick, 600);
})();

/* Kleine Klick-Welle auf Buttons (reine Optik; respektiert „Bewegung reduzieren“) */
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button.b');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
    const el = document.createElement('span');
    el.className = 'rip';
    el.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(el);
    setTimeout(() => el.remove(), 650);
  });
}

try { $('verPill').textContent = 'v' + chrome.runtime.getManifest().version; } catch (_) { /* optional */ }

/* Komfort: Enter liest die aktuelle Seite aus (wenn kein Eingabefeld fokussiert ist) */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if ($('main').hidden || $('btnRead').disabled) return;
  if (e.target.closest && e.target.closest('textarea,input,select,button,summary,a')) return;
  e.preventDefault();
  $('btnRead').click();
});
