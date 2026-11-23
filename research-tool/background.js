/* Recherche-Helfer – Hintergrund-Skript (Service Worker).
 * Assisted-manuell: NUR die aktuelle Seite auslesen (niemals automatisch durch Links/Suchergebnisse gehen).
 * Der gesamte Stand wird laufend in chrome.storage.local gesichert. */
import {
  DEFAULTS, mergeSettings, cleanUrl, isPdfUrl, xmlLength, estimateTokens,
  limitFor, applyLimit, cleanupBlocks, fmtInt, sleep, buildExport, cleanPageText, collapseRepeats, redactSensitive, isBlockedHost, fitToBudget,
} from './common.js';

/* ------------------------------------------------------------------ Zustand */

const newRunB = () => ({ status: 'idle', message: '', sizeNotice: false, ok: false });

const mem = { settings: { ...DEFAULTS }, resB: [], backupB: null, lastB: null, runB: newRunB(), pendingB: null, verB: 0 };
const KEYS = ['settings', 'resB', 'backupB', 'lastB', 'runB', 'pendingB', 'verB'];
/** Sicherung vor jeder zerstörenden Aktion (Clear, Cleanup, Entfernen, Undo) – „↺“ stellt sie wieder her. */
const snapshotB = () => { mem.backupB = mem.resB.slice(); };
/** Nur eingeschaltete Quellen fließen in Export, Statistik und Zwischenablage ein. */
const activeB = () => mem.resB.filter((b) => !b.off);
let loadP = null;

const persist = (...keys) => chrome.storage.local.set(Object.fromEntries(keys.map((k) => [k, mem[k]])));
const bumpB = () => { mem.verB++; };
const saveB = async () => { bumpB(); await persist('runB', 'verB'); };

function ready() {
  if (!loadP) {
    loadP = (async () => {
      const d = await chrome.storage.local.get(KEYS);
      mem.settings = mergeSettings(d.settings);
      if (Array.isArray(d.resB)) mem.resB = d.resB;
      mem.backupB = Array.isArray(d.backupB) ? d.backupB : null;
      mem.lastB = d.lastB || null;
      if (d.runB) mem.runB = { ...newRunB(), ...d.runB };
      mem.pendingB = d.pendingB || null;
      mem.verB = d.verB || 0;
    })();
  }
  return loadP;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) mem.settings = mergeSettings(changes.settings.newValue);
});

/* ------------------------------------------------------------------ Hilfsfunktionen */

const errMsg = (e) => String((e && e.message) || e);

/* Service Worker wach halten, solange ein Auslesevorgang läuft (MV3 beendet ihn sonst nach ~30 s Leerlauf). */
let keepAliveTimer = null, keepAliveUsers = 0;
function keepAlive(on) {
  keepAliveUsers = Math.max(0, keepAliveUsers + (on ? 1 : -1));
  if (keepAliveUsers > 0 && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => {}); } catch (_) { /* egal */ } }, 20000);
  } else if (keepAliveUsers === 0 && keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

/* ------------------------------------------------------------------ Funktionen, die IN der Seite laufen (müssen eigenständig sein) */

function pageSnapshot(captchaOn) {
  try {
    const root = document.body || document.documentElement;
    const txt = (root && (root.innerText || root.textContent)) || '';
    let h = 5381;
    for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
    let captcha = false;
    if (captchaOn) {
      const re = /(captcha|i'?m not a robot|ich bin kein roboter|bist du ein roboter|sind sie ein roboter|verify (that )?you are (a )?human|are you a robot|unusual traffic|ungewöhnlichen datenverkehr|checking your browser|just a moment|sicherheitsüberprüfung|security check|attention required|access denied|zugriff verweigert)/i;
      const el = document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,.cf-turnstile,#cf-challenge-running,#challenge-form,#px-captcha,form[action*="captcha"]');
      const head = ((document.title || '') + ' ' + txt.slice(0, 3000)).toLowerCase();
      captcha = /\/sorry\//.test(location.pathname) || (txt.length < 2500 && (!!el || re.test(head))) || (txt.length < 1500 && /captcha|challenge/i.test(location.pathname + location.search));
    }
    return { rs: document.readyState, url: location.href, len: txt.length, hash: h, ct: document.contentType || '', captcha, title: document.title || '' };
  } catch (e) { return { err: String(e) }; }
}

function pageExpand() {
  /* Sicheres Aufklappen: klickt NIE auf echte Links, Formular-Buttons oder Download-Elemente und
   * blockiert währenddessen Navigation, window.open und Formular-Absenden. */
  const realLink = (el) => {
    const a = el.closest && el.closest('a[href]');
    if (!a) return false;
    const h = (a.getAttribute('href') || '').trim();
    return !(h === '' || h === '#' || /^#/.test(h) || /^javascript:/i.test(h)) || a.hasAttribute('download') || /_blank|_new/i.test(a.getAttribute('target') || '');
  };
  const origOpen = window.open;
  const onClick = (e) => { try { if (realLink(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } } catch (_) {} };
  const onSubmit = (e) => { try { e.preventDefault(); e.stopImmediatePropagation(); } catch (_) {} };
  const onUnload = (e) => { try { e.preventDefault(); e.returnValue = ''; } catch (_) {} };
  let clicks = 0;
  try {
    try { window.open = function () { return null; }; } catch (_) {}
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('beforeunload', onUnload);
    // <details> öffnen
    try { document.querySelectorAll('details:not([open])').forEach((d) => { try { d.open = true; } catch (_) {} }); } catch (_) {}
    // „Mehr anzeigen“-Buttons (behutsam, max. 12 Klicks) – nur echte Buttons/Summary/ARIA-Toggles
    const re = /^(mehr( anzeigen| lesen)?|weiterlesen|show more|read more|see more|view more|expand|vollst[aä]ndig(en text)?( anzeigen)?|alles anzeigen)$/i;
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], summary, [aria-expanded="false"], a:not([href]), a[href="#"], a[href^="javascript:"]'));
    for (const el of candidates) {
      if (clicks >= 12) break;
      try {
        if (realLink(el)) continue;
        if (el.tagName === 'BUTTON' && ((el.getAttribute('type') || '').toLowerCase() === 'submit' || (el.form && !el.hasAttribute('type')))) continue;
        if (el.disabled || el.hasAttribute('download')) continue;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const label = ((el.innerText || el.textContent || el.getAttribute('aria-label') || '') + '').trim();
        if (!label || label.length > 48) continue;
        const expanded = el.getAttribute('aria-expanded');
        if (expanded === 'true') continue;
        if (re.test(label) || (expanded === 'false' && /more|mehr|expand/i.test(label))) { el.click(); clicks++; }
      } catch (_) {}
    }
  } catch (_) { /* egal */ }
  // Kurz warten ist Sache des Aufrufers; Schutz erst nach kurzer Verzögerung entfernen (asynchrone Handler)
  setTimeout(() => {
    try { document.removeEventListener('click', onClick, true); document.removeEventListener('submit', onSubmit, true); window.removeEventListener('beforeunload', onUnload); window.open = origOpen; } catch (_) {}
  }, 1500);
  return clicks;
}

function pageText(opts) {
  opts = opts || {};
  const clean = (s) => (opts.tablesAsPipes ? String(s || '').replace(/ *\t+ */g, ' | ') : String(s || ''))
    .replace(/\uFEFF/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u202F\u2007\u2009]/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(Skip to (main )?content|Zum Inhalt springen|Zur Hauptnavigation|Skip to navigation)\n+/i, '')
    .trim();

  // Markierung bevorzugen (gezielte Prompt-Ausschnitte)
  if (opts.preferSelection) {
    try {
      const sel = (window.getSelection && window.getSelection().toString()) || '';
      if (sel && sel.trim().length >= 40) {
        return { text: clean(sel), fromSelection: true, title: document.title || '' };
      }
    } catch (_) { /* ignore */ }
  }

  // Optional: typische Chrome-Elemente vor dem Lesen ausblenden (ohne die echte Seite zu verändern dauerhaft)
  let styleEl = null;
  if (opts.stripChrome || opts.stripBoilerplate) {
    try {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-rh-tmp', '1');
      // Nur Stör-Overlays – bewusst KEINE nav/header/footer/aside (Volltext hat Vorrang)
      const boiler = opts.stripBoilerplate ? 'nav, footer, aside, [role="navigation"], [role="contentinfo"], [role="complementary"], [role="banner"], body > header,' : '';
      styleEl.textContent = boiler + (opts.stripChrome ? [
        '.cookie, .cookies, #cookie, #cookies, .cookie-banner, .cookie-consent, .cookie-notice,',
        '#onetrust-banner-sdk, #onetrust-consent-sdk, .cc-banner, .cc-window, .osano-cm-window,',
        '.fc-consent-root, #sp_message_container, .sp_veil, [id*="cookie" i][class*="banner" i],',
        '.advertisement, .ads, .ad-container, .ad-slot, [aria-label*="cookie" i],',
        '.newsletter-signup, .paywall, .subscription-wall, .tp-modal, .tp-backdrop,',
        '[class*="cookie-banner" i], [class*="consent-banner" i], [id*="consent-banner" i]'
      ].join(' ') : '.rh-none') + '{visibility:hidden!important;max-height:0!important;overflow:hidden!important;position:static!important;}';
      (document.documentElement || document.head || document.body).appendChild(styleEl);
    } catch (_) { styleEl = null; }
  }

  let root = null;
  let source = 'body';
  if (opts.mainContentOnly) {
    const candidates = [
      'article',
      '[role="main"]',
      'main',
      '.post-content', '.entry-content', '.article-body', '.article-content',
      '.post-body', '.story-body', '#article-body', '.rich-text',
      '#content', '.content', '#main-content', '.main-content',
      '.mw-parser-output', '#bodyContent', '.lesson-content', '.prose'
    ];
    let best = null, bestLen = 0, bestSel = '';
    for (const sel of candidates) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const el of nodes) {
          if (!el) continue;
          // in versteckten Containern überspringen
          const st = window.getComputedStyle(el);
          if (st && (st.visibility === 'hidden' || st.display === 'none')) continue;
          const len = ((el.innerText || el.textContent) || '').trim().length;
          if (len >= 200 && len > bestLen) { best = el; bestLen = len; bestSel = sel; }
        }
      } catch (_) { /* ignore */ }
    }
    // Zusätzlich: größter <p>-Cluster in einem gemeinsamen Vorfahren (falls keine article/main)
    if (!best) {
      try {
        const paras = Array.from(document.querySelectorAll('p')).filter((el) => {
          const n = ((el.innerText || '') || '').trim().length;
          return n >= 80;
        }).slice(0, 80);
        if (paras.length >= 3) {
          // häufigster Parent der Absätze
          const counts = new Map();
          for (const p of paras) {
            const par = p.parentElement;
            if (!par) continue;
            counts.set(par, (counts.get(par) || 0) + 1);
          }
          let top = null, topN = 0;
          for (const [par, n] of counts) if (n > topN) { top = par; topN = n; }
          if (top && topN >= 3) {
            const len = ((top.innerText || top.textContent) || '').trim().length;
            if (len >= 200) { best = top; bestLen = len; bestSel = 'p-cluster'; }
          }
        }
      } catch (_) { /* ignore */ }
    }
    if (best) { root = best; source = bestSel; }
  }
  if (!root) {
    // Volltext: Body bevorzugen; wenn documentElement deutlich mehr sichtbaren Text hat, den nehmen
    const body = document.body;
    const docEl = document.documentElement;
    let bodyText = '';
    let docText = '';
    try { bodyText = (body && (body.innerText || body.textContent)) || ''; } catch (_) {}
    try { docText = (docEl && (docEl.innerText || docEl.textContent)) || ''; } catch (_) {}
    if (docText.trim().length > bodyText.trim().length * 1.15 && docText.trim().length > bodyText.trim().length + 200) {
      root = docEl;
      source = 'documentElement';
    } else {
      root = body || docEl;
      source = 'body';
    }
  }

  // Struktur-Marker (Überschriften/Listen) nur für einen synchronen Augenblick einfügen und sofort wieder entfernen
  const marks = [];
  if (root && (opts.structureMode === 'headings' || opts.structureMode === 'full')) {
    try {
      root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
        const tn = document.createTextNode('#'.repeat(Number(h.tagName.charAt(1)) || 2) + ' ');
        h.insertBefore(tn, h.firstChild); marks.push(tn);
      });
      if (opts.structureMode === 'full') {
        root.querySelectorAll('li').forEach((li) => {
          const par = li.parentElement;
          const pre = par && par.tagName === 'OL' ? `${Array.prototype.indexOf.call(par.children, li) + 1}. ` : '- ';
          li.insertBefore(document.createTextNode(pre), li.firstChild); marks.push(li.firstChild);
        });
      }
    } catch (_) { /* Struktur ist optional */ }
  }
  let t = '';
  try { t = (root && (root.innerText || root.textContent)) || ''; } catch (_) { t = ''; }
  finally { marks.forEach((n) => { try { n.remove(); } catch (_) { /* egal */ } }); }

  // Same-Origin-Iframes (Volltext-Ergänzung)
  let frameExtra = 0;
  if (opts.includeSameOriginFrames) {
    try {
      const frames = Array.from(document.querySelectorAll('iframe')).slice(0, 15);
      const parts = [];
      for (const f of frames) {
        try {
          const doc = f.contentDocument;
          if (!doc) continue;
          const ft = ((doc.body && (doc.body.innerText || doc.body.textContent)) || '').trim();
          if (ft.length >= 40) { parts.push(ft); frameExtra += ft.length; }
        } catch (_) { /* cross-origin */ }
      }
      if (parts.length) t = t + '\n\n' + parts.join('\n\n');
    } catch (_) {}
  }

  // Shadow DOM (nur offene Roots): Text ergänzen, der in innerText fehlt
  let shadowExtra = 0;
  if (opts.includeShadowDom) {
    try {
      const parts = [];
      const walk = (node, depth) => {
        if (depth > 6 || parts.length > 400) return;
        const els = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const el of els) {
          const sr = el.shadowRoot;
          if (!sr) continue;
          let st = '';
          for (const ch of Array.from(sr.children)) {
            if (/^(STYLE|SCRIPT|LINK|TEMPLATE)$/.test(ch.tagName)) continue;
            st += ((ch.innerText || ch.textContent || '') + '\n');
          }
          st = st.trim();
          if (st.length >= 20 && !t.includes(st.slice(0, 60))) { parts.push(st); shadowExtra += st.length; }
          walk(sr, depth + 1);
        }
      };
      walk(document, 0);
      if (parts.length) t = t + '\n\n' + parts.join('\n\n');
    } catch (_) { /* optional */ }
  }

  if (styleEl) { try { styleEl.remove(); } catch (_) { /* ignore */ } }

  t = clean(t);
  return { text: t, fromSelection: false, source, title: document.title || '', frameExtra, shadowExtra };
}

function pageMeta() {
  const out = {};
  try {
    const q = (sel, attr) => { const e = document.querySelector(sel); const v = e && (attr ? e.getAttribute(attr) : (e.textContent || '')); return v ? String(v).trim() : ''; };
    const first = (...vals) => vals.find((v) => v && v.length) || '';
    const ld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((sc) => {
      try { const j = JSON.parse(sc.textContent || 'null'); (Array.isArray(j) ? j : (j && j['@graph']) || [j]).forEach((x) => { if (x && typeof x === 'object') ld.push(x); }); } catch (_) { /* ungültiges JSON-LD */ }
    });
    const ldVal = (k) => {
      for (const x of ld) {
        let v = x[k];
        if (Array.isArray(v)) v = v[0];
        if (v && typeof v === 'object') v = v.name || v['@id'] || '';
        if (v && typeof v === 'string') return v.trim();
      }
      return '';
    };
    out.autor = first(q('meta[name="author"]', 'content'), q('meta[property="article:author"]', 'content'), q('meta[name="citation_author"]', 'content'), ldVal('author'));
    out.datum = first(q('meta[property="article:published_time"]', 'content'), q('meta[name="date"]', 'content'), q('meta[name="citation_publication_date"]', 'content'), q('meta[itemprop="datePublished"]', 'content'), q('time[datetime]', 'datetime'), ldVal('datePublished'));
    out.seitenname = first(q('meta[property="og:site_name"]', 'content'), q('meta[name="application-name"]', 'content'), ldVal('publisher'));
    out.sprache = first(document.documentElement.getAttribute('lang'), q('meta[property="og:locale"]', 'content'));
    out.beschreibung = first(q('meta[name="description"]', 'content'), q('meta[property="og:description"]', 'content'));
    if (out.beschreibung.length > 500) out.beschreibung = out.beschreibung.slice(0, 497) + '…';
    out.canonical = q('link[rel="canonical"]', 'href');
    out.ogTitle = q('meta[property="og:title"]', 'content');
  } catch (_) { /* Meta ist optional */ }
  return out;
}

/** Kleine Bestätigung auf der Seite (läuft in der Seite; geschlossenes Shadow-DOM, wird nie mit ausgelesen). */
function pageToast(text, kind) {
  try {
    const old = document.getElementById('rh-toast-host');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'rh-toast-host';
    host.setAttribute('data-msg', String(text));
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    const root = host.attachShadow({ mode: 'closed' });
    const box = document.createElement('div');
    box.textContent = String(text);
    const bg = kind === 'err' ? 'linear-gradient(135deg,#d01545,#ff5a7a)' : 'linear-gradient(135deg,#ff2e93,#ff9a3c)';
    box.style.cssText = 'font:600 13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;padding:10px 16px;border-radius:999px;max-width:340px;box-shadow:0 8px 28px rgba(0,0,0,.35);background:' + bg + ';opacity:0;transform:translateY(10px) scale(.96);transition:opacity .25s,transform .35s cubic-bezier(.34,1.56,.64,1)';
    root.appendChild(box);
    (document.body || document.documentElement).appendChild(host);
    (window.requestAnimationFrame || window.setTimeout)(() => { box.style.opacity = '1'; box.style.transform = 'none'; });
    setTimeout(() => { box.style.opacity = '0'; box.style.transform = 'translateY(6px)'; setTimeout(() => host.remove(), 400); }, 2600);
  } catch (_) { /* optional */ }
}

function pageHasPassword() {
  try {
    return Array.from(document.querySelectorAll('input[type="password"]')).some((el) => {
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden';
    });
  } catch (_) { return false; }
}

function pageLinks(max) {
  const out = [], seen = new Set();
  try {
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      if (out.length >= max) break;
      let u;
      try { u = new URL(a.href, location.href); } catch (_) { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      const bare = u.href.replace(/#.*$/, '');
      if (bare === location.href.replace(/#.*$/, '') || seen.has(bare)) continue;
      const st = getComputedStyle(a);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const text = ((a.innerText || a.textContent || a.getAttribute('aria-label') || a.title || '') + '').replace(/\s+/g, ' ').trim().slice(0, 120);
      seen.add(bare);
      out.push({ url: u.href, text });
    }
  } catch (_) { /* optional */ }
  return out;
}

function pageScrollBottom() {
  const se = document.scrollingElement || document.documentElement;
  const h = Math.max(se.scrollHeight, (document.body && document.body.scrollHeight) || 0, document.documentElement.scrollHeight || 0);
  window.scrollTo(0, h);
  // Zwischenschritte helfen manchen Lazy-Loadern
  try { window.scrollBy(0, -120); window.scrollBy(0, 120); } catch (_) {}
  let n = 0;
  const els = Array.from(document.querySelectorAll('div,main,section,ul,ol,article,aside,[role="main"],[role="feed"]')).slice(0, 5000);
  for (const el of els) {
    if (n >= 6) break;
    try {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight * 1.25 && el.clientHeight > 180) {
        el.scrollTop = el.scrollHeight;
        n++;
      }
    } catch (_) {}
  }
  return true;
}

function pageScrollTop() {
  window.scrollTo(0, 0);
  return true;
}

/* ------------------------------------------------------------------ Tab-Zugriff */

async function runInTab(tabId, func, args = [], world) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args, ...(world ? { world } : {}) });
  return r ? r.result : undefined;
}
async function snap(tabId, captchaOn) {
  try { return (await runInTab(tabId, pageSnapshot, [!!captchaOn])) || { err: 'keine Antwort' }; } catch (e) { return { err: errMsg(e) }; }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

/* Seitentext auslesen: Warten auf „complete“, Nachlade-Wartezeit, stabiler Text, ggf. Scrollen, erneut stabil. */
async function waitStable(tabId, capMs, captchaOn) {
  const stableMs = mem.settings.stableWindowSec * 1000;
  const end = Date.now() + capMs;
  let last = null, since = Date.now(), sn = null;
  for (;;) {
    sn = await snap(tabId, captchaOn);
    if (sn && !sn.err) {
      const key = `${sn.rs}|${sn.len}|${sn.hash}|${sn.url}`;
      if (key !== last) { last = key; since = Date.now(); }
      if (sn.rs === 'complete' && Date.now() - since >= stableMs) return { sn, stable: true };
    }
    if (Date.now() > end) return { sn, stable: false };
    await sleep(300);
  }
}

async function extractPage(tabId, { loadDeadline, noExpand = false, carryNotes = [] }) {
  const s = mem.settings;
  const captchaOn = s.captchaDetect;
  const notes = [...carryNotes];
  let sn = null, errs = 0;
  for (;;) { // Phase 1: Dokument geladen (readyState complete)
    sn = await snap(tabId, captchaOn);
    if (sn && !sn.err && sn.rs === 'complete') break;
    if (sn && sn.err) {
      errs++;
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (t && /^chrome-error:/.test(t.url || '')) return { kind: 'fail', reason: 'Seite nicht erreichbar oder blockiert (Fehlerseite des Browsers)' };
    } else errs = 0;
    if (Date.now() > loadDeadline) {
      return errs > 2
        ? { kind: 'fail', reason: 'Seite nicht lesbar (Skript konnte nicht ausgeführt werden, evtl. geschützte Seite)' }
        : { kind: 'timeout', reason: `Zeitüberschreitung: Seite war nach ${s.maxWaitSec} s nicht fertig geladen (evtl. Weiterleitungsschleife oder blockiertes Laden)` };
    }
    await sleep(300);
  }
  if (/pdf/i.test(sn.ct || '')) return { kind: 'pdf', finalUrl: sn.url };
  await sleep(s.postLoadDelaySec * 1000);                      // Phase 2: Nachlade-Wartezeit
  const settleCap = Math.min(s.maxWaitSec, 10) * 1000;
  let st = await waitStable(tabId, settleCap, captchaOn);        // Phase 3: Text stabil
  sn = st.sn || sn;
  let stable = st.stable;
  if (captchaOn && sn && sn.captcha) return { kind: 'captcha', finalUrl: sn.url };
  let gain = 0, rounds = 0;
  for (let r = 0; r < s.scrollRounds; r++) {                                  // Phase 4: Infinite Scroll
    const before = sn.len;
    try { await runInTab(tabId, pageScrollBottom); } catch (_) { break; }
    await sleep(900);
    st = await waitStable(tabId, settleCap, captchaOn);
    if (st.sn && !st.sn.err) sn = st.sn;
    stable = st.stable;
    rounds++;
    if (sn.len > before) gain += sn.len - before; else break;
  }
  if (rounds && gain > 0) notes.push({ t: 'scroll', text: `${rounds} Scroll-Durchgang/-Durchgänge, dadurch ca. ${fmtInt(gain)} Zeichen mehr Text nachgeladen` });
  if (!stable) notes.push({ t: 'info', text: 'Der Seitentext war beim Auslesen noch in Bewegung (Zeitlimit erreicht); es wurde der Stand zu diesem Zeitpunkt übernommen.' });
  let text = '', title = (sn && sn.title) || '', fromSelection = false, textSource = 'body', meta = null;
  try {
    if (s.expandCollapsed && !noExpand) {
      const urlBefore = (sn && sn.url) || '';
      let guardOn = true;
      const opened = [];
      const onCreated = (t) => {
        if (guardOn && t && t.openerTabId === tabId) { opened.push(t.id); chrome.tabs.remove(t.id).catch(() => {}); }
      };
      chrome.tabs.onCreated.addListener(onCreated);
      try {
        // MAIN-Welt: window.open der Seite selbst wird blockiert
        const nClick = await runInTab(tabId, pageExpand, [], 'MAIN');
        await sleep(600);
        if (nClick) notes.push({ t: 'info', text: `${nClick} zugeklappte(r) Bereich(e) geöffnet.` });
      } catch (_) { /* egal */ }
      await sleep(900);
      guardOn = false;
      chrome.tabs.onCreated.removeListener(onCreated);
      if (opened.length) notes.push({ t: 'info', text: `${opened.length} dabei ungewollt geöffnete(r) Tab(s) automatisch geschlossen.` });
      // Navigation der Seite selbst erkennen und rückgängig machen
      const after = await snap(tabId, false);
      const strip = (u) => String(u || '').replace(/#.*$/, '');
      if (after && !after.err && strip(after.url) !== strip(urlBefore)) {
        try { await chrome.tabs.goBack(tabId); } catch (_) { /* egal */ }
        if (!noExpand) return extractPage(tabId, { loadDeadline: Date.now() + s.maxWaitSec * 1000, noExpand: true, carryNotes: [...notes, { t: 'info', text: 'Aufklappen hat die Seite verlassen – automatisch zurückgekehrt und ohne Aufklappen gelesen.' }] });
      }
    }
    const pt = await runInTab(tabId, pageText, [{
      preferSelection: !!s.preferSelection,
      mainContentOnly: !!s.mainContentOnly,
      stripChrome: !!s.stripChrome,
      stripBoilerplate: !!s.stripBoilerplate,
      structureMode: s.structureMode,
      tablesAsPipes: !!s.tablesAsPipes,
      includeSameOriginFrames: !!s.includeSameOriginFrames,
      includeShadowDom: !!s.includeShadowDom,
    }]);
    if (pt && typeof pt === 'object') {
      text = cleanPageText(pt.text || '');
      fromSelection = !!pt.fromSelection;
      textSource = pt.source || 'body';
      if (pt.title) title = pt.title;
      if (pt.shadowExtra) notes.push({ t: 'info', text: `Shadow-DOM-Text ergänzt (+${fmtInt(pt.shadowExtra)} Zeichen).` });
      if (pt.frameExtra) notes.push({ t: 'info', text: `Iframe-Text ergänzt (+${fmtInt(pt.frameExtra)} Zeichen).` });
    } else {
      text = cleanPageText((typeof pt === 'string' ? pt : '') || '');
    }
  } catch (e) { return { kind: 'fail', reason: `Text konnte nicht gelesen werden: ${errMsg(e)}` }; }
  if (s.includeMeta) { try { meta = await runInTab(tabId, pageMeta); } catch (_) { meta = null; } }
  if (s.warnPasswordPages) {
    try { if (await runInTab(tabId, pageHasPassword)) notes.push({ t: 'warn', text: 'Achtung: Die Seite enthält ein Passwortfeld (Login-Seite?) – Inhalt vor dem Teilen prüfen' }); } catch (_) { /* egal */ }
  }
  let links = null;
  if (s.includeLinks) {
    try {
      const raw = (await runInTab(tabId, pageLinks, [s.maxLinks * 3])) || [];
      const seenL = new Set(); links = [];
      for (const l of raw) { const cu = cleanUrl(l.url); if (!cu || seenL.has(cu)) continue; seenL.add(cu); links.push({ url: cu, text: l.text }); if (links.length >= s.maxLinks) break; }
      if (links.length) notes.push({ t: 'info', text: `${links.length} Links erfasst.` });
    } catch (_) { links = null; }
  }
  if (fromSelection) notes.push({ t: 'info', text: 'Markierter Text wurde übernommen (Einstellung „Markierten Text bevorzugen“).' });
  else if (s.mainContentOnly && textSource !== 'body' && textSource !== 'documentElement') {
    notes.push({ t: 'info', text: `Hauptinhalt aus „${textSource}“ gelesen.` });
  }
  if (s.scrollReturn && rounds) { try { await runInTab(tabId, pageScrollTop); } catch (_) { /* egal */ } }
  return { kind: 'ok', text, finalUrl: (sn && sn.url) || '', notes, title, fromSelection, source: textSource, meta, links };
}

/* ------------------------------------------------------------------ PDF */

async function headCheck(url) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal, credentials: 'include' });
    clearTimeout(timer);
    const ct = r.headers.get('content-type') || '';
    const disp = r.headers.get('content-disposition') || '';
    if (/application\/(x-)?pdf/i.test(ct) || /\.pdf["']?\s*(;|$)/i.test(disp)) return { isPdf: true, ct, finalUrl: r.url || url };
    if (r.status === 405 || r.status === 501) return await headCheckViaGet(url);
    return { isPdf: false, ct, finalUrl: r.url || url };
  } catch (_) { return headCheckViaGet(url); }
}

/** Fallback für Server, die HEAD ablehnen: kleinen Range-Request laden und %PDF- prüfen. */
async function headCheckViaGet(url) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-511' }, redirect: 'follow', signal: ctl.signal, credentials: 'include' });
    clearTimeout(timer);
    const ct = r.headers.get('content-type') || '';
    const buf = new Uint8Array(await r.arrayBuffer());
    let head = '';
    const n = Math.min(1024, buf.length);
    for (let i = 0; i < n; i++) head += String.fromCharCode(buf[i]);
    return { isPdf: /application\/(x-)?pdf/i.test(ct) || head.includes('%PDF-'), ct, finalUrl: r.url || url };
  } catch (_) { return { isPdf: false }; }
}

/** Gesamte Sammlung (im gewählten Format, mit Prompt-Rahmen) in die Zwischenablage – ohne Popup. */
async function copyAllToClipboard() {
  await ready();
  if (!activeB().length) return { ok: false, error: 'Keine eingeschaltete Quelle vorhanden.' };
  const text = buildExport(activeB(), !!mem.settings.exportMarkdown, xmlOpts(true));
  await ensureOffscreen();
  let r;
  try { r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'copyText', text }); } catch (e) { return { ok: false, error: errMsg(e) }; }
  return r && r.ok ? { ok: true, chars: text.length } : { ok: false, error: (r && r.error) || 'Kopieren fehlgeschlagen.' };
}

async function ensureOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctx && ctx.length) return;
  try {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS', 'CLIPBOARD'], justification: 'PDF-Text mit pdf.js auslesen; Zwischenablage für das Tastenkürzel Alt+Shift+C' });
  } catch (e) { if (!/single offscreen|already/i.test(errMsg(e))) throw e; }
}

/** Liest eine PDF (ohne Seitenbesuch). Rückgabe: { kind: 'ok', text, finalUrl } | { kind: 'fail', reason } */
async function readPdf(url, timeoutMs) {
  await ensureOffscreen();
  const call = (async () => {
    for (let i = 0; i < 4; i++) {
      try { return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'extractPdf', url, timeoutMs, pageMarkers: !!mem.settings.pdfPageMarkers }); } catch (e) { if (i === 3) throw e; await sleep(250); }
    }
  })();
  const end = Date.now() + timeoutMs + 5000;
  let res;
  const guard = (async () => {
    for (;;) {
      if (Date.now() > end) return { timeout: true };
      await sleep(250);
    }
  })();
  res = await Promise.race([call.then((r) => ({ r })), guard]);
  if (res.timeout) return { kind: 'fail', reason: `PDF: Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s` };
  const r = res.r;
  if (!r || !r.ok) return { kind: 'fail', reason: `PDF: ${(r && r.error) || 'nicht lesbar'}` };
  return { kind: 'ok', text: r.text || '', finalUrl: cleanUrl(r.finalUrl || url) || url, title: r.title || '', author: r.author || '', date: r.date || '', pages: r.pages || 0 };
}

/* ------------------------------------------------------------------ Manuell: aktuelle Seite */

function pdfTitleMeta(r, finalUrl) {
  let title = r.title || '';
  if (!title) {
    try { title = decodeURIComponent((finalUrl.split('/').pop() || '').replace(/[?#].*$/, '')).replace(/\.pdf$/i, '') || 'PDF'; } catch (_) { title = 'PDF'; }
  }
  const meta = { autor: r.author || '', datum: r.date || '' };
  return { title, meta };
}


function updateBadge() {
  const n = mem.resB.length;
  try {
    chrome.action.setBadgeText({ text: n ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#0b3694' });
  } catch (_) { /* ignore */ }
}

const meta0 = (m) => m && Object.values(m).some((v) => v);

async function finalizeB(url, text, isPdf, choice, info = {}) {
  const s = mem.settings;
  let out = cleanPageText(text);
  if (s.redactMode === 'basic') {
    const r = redactSensitive(out);
    out = r.text;
    if (r.count) info = { ...info, notes: [...(info.notes || []), { t: 'info', text: `${r.count} sensible Angabe(n) maskiert` }] };
  }
  if (s.collapseRepeatedLines) out = collapseRepeats(out);
  if (choice && choice.complete) { /* Nutzer will den kompletten Text */ }
  else if (choice && choice.method) {
    const r = applyLimit(out, choice.method, Math.max(1, Number(choice.chars) || s.askDefaultChars));
    out = r.text;
  } else {
    const lim = limitFor(isPdf, s);
    if (lim && out.length > lim.cap) out = applyLimit(out, lim.method, lim.cap).text;
  }
  const title = s.includeTitle ? (info.title || '') : '';
  const gelesen = s.includeTimestamp ? new Date().toISOString() : undefined;
  let meta;
  if (s.includeMeta && meta0(info.meta)) {
    const m = info.meta;
    meta = { autor: m.autor, datum: m.datum, seitenname: m.seitenname, sprache: m.sprache, beschreibung: m.beschreibung };
  }
  const block = { url, inhalt: out, isPdf: !!isPdf, titel: title || undefined, meta, links: (info.links && info.links.length) ? info.links : undefined, gelesen };

  let replaced = false;
  if (s.dedupeUrls && !info.append) {
    const idx = mem.resB.findIndex((b) => b.url === url);
    if (idx >= 0) {
      mem.resB[idx] = block;
      replaced = true;
    } else {
      mem.resB.push(block);
    }
  } else {
    mem.resB.push(block);
  }
  mem.lastB = block;

  mem.pendingB = null;
  const rb = mem.runB;
  rb.status = 'idle';
  const parts = [];
  if (replaced) parts.push(`Quelle ersetzt: ${fmtInt(out.length)} Zeichen`);
  else parts.push(`Seite ausgelesen: ${fmtInt(out.length)} Zeichen`);
  if (!out.trim()) parts.push('(leerer Inhalt)');
  else if (s.minContentChars > 0 && out.trim().length < s.minContentChars) {
    parts.push(`kurz (< ${s.minContentChars} Zeichen – evtl. Paywall/SPA)`);
  }
  if (out.length < text.length) parts.push(`gekürzt von ${fmtInt(text.length)}`);
  if (info.fromSelection) parts.push('Markierung');
  if (info.textSource && info.textSource !== 'body' && !info.fromSelection) parts.push(info.textSource);
  if (Array.isArray(info.notes)) for (const n of info.notes) if (n && n.text) parts.push(n.text);
  rb.message = parts.filter(Boolean).map((p) => String(p).replace(/\.\s*$/, '')).join(' · ') + '.';
  rb.ok = true;
  if (s.sizeWarn && !rb.sizeNotice && xmlLength(activeB()) > s.sizeWarnChars) rb.sizeNotice = true;
  await persist('resB', 'lastB', 'pendingB');
  await saveB();
  updateBadge();
}

async function readCurrent() {
  await ready();
  const rb = mem.runB;
  if (rb.status === 'liest' || rb.status === 'wartet_grossertext') return { ok: false, error: 'Es läuft bereits ein Auslesevorgang.' };
  rb.status = 'liest'; rb.message = 'Warte auf vollständig geladene Seite …'; rb.ok = false; // sofort setzen (verhindert Doppelstart)
  const s = mem.settings;
  await saveB();
  keepAlive(true);
  const fail = async (msg) => { rb.status = 'idle'; rb.message = msg; rb.ok = false; await saveB(); return { ok: false, error: msg }; };
  try {
    const tab = await activeTab();
    if (!tab) return await fail('Kein aktiver Tab gefunden.');
    const url = tab.url || '';
    if (/^file:/i.test(url)) {
      let allowed = false;
      try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch (_) { allowed = false; }
      if (!allowed) return await fail('Lokale Dateien: In chrome://extensions bei dieser Erweiterung „Zugriff auf Datei-URLs zulassen“ aktivieren und erneut versuchen.');
    } else if (!/^https?:/i.test(url)) return await fail('Diese Seite kann nicht ausgelesen werden (nur http-, https- und – mit Freigabe – file-Seiten).');
    if (isBlockedHost(url, s.blockedHosts)) return await fail('Diese Domain steht auf deiner Sperrliste (Einstellungen → Datenschutz).');
    let isPdf = isPdfUrl(url);
    let text = '', finalUrl = cleanUrl(url) || url, notes = [], title = '', fromSelection = false, textSource = '', meta = null, links = null;
    if (!isPdf) {
      const sn = await snap(tab.id, false);
      if (sn && !sn.err && /pdf/i.test(sn.ct || '')) isPdf = true;
      else if (sn && sn.err) isPdf = (await headCheck(url)).isPdf;
    }
    if (isPdf) {
      rb.message = 'Lese PDF aus …'; await saveB();
      const r = await readPdf(url, s.pdfWaitSec * 1000);
      if (r.kind !== 'ok') return await fail(r.reason || 'PDF konnte nicht gelesen werden.');
      text = r.text; finalUrl = r.finalUrl;
      ({ title, meta } = pdfTitleMeta(r, finalUrl));
      if (r.pages) notes.push({ t: 'info', text: `${r.pages} PDF-Seiten.` });
    } else {
      const ex = await extractPage(tab.id, { loadDeadline: Date.now() + s.maxWaitSec * 1000 });
      if (ex.kind === 'captcha') return await fail('Captcha / Bot-Schutz erkannt. Bitte das Captcha lösen und die Seite danach erneut auslesen.');
      if (ex.kind === 'pdf') {
        const r = await readPdf(url, s.pdfWaitSec * 1000);
        if (r.kind !== 'ok') return await fail(r.reason || 'PDF konnte nicht gelesen werden.');
        isPdf = true; text = r.text; finalUrl = r.finalUrl;
        ({ title, meta } = pdfTitleMeta(r, finalUrl));
        if (r.pages) notes.push({ t: 'info', text: `${r.pages} PDF-Seiten.` });
      } else if (ex.kind !== 'ok') return await fail(ex.reason || 'Die Seite konnte nicht ausgelesen werden.');
      else {
        text = ex.text;
        finalUrl = cleanUrl(ex.finalUrl) || ex.finalUrl || finalUrl;
        notes = ex.notes || [];
        title = ex.title || '';
        fromSelection = !!ex.fromSelection;
        textSource = ex.source || '';
        meta = ex.meta || null;
        links = ex.links || null;
      }
    }
    const needAsk = s.askLargeText && text.length > s.askLargeThreshold && !(isPdf && s.pdfExtra);
    if (needAsk) {
      mem.pendingB = { url: finalUrl, text, isPdf, len: text.length, defaultChars: s.askDefaultChars, defaultMethod: s.askDefaultMethod, title, fromSelection, textSource, notes, meta, links };
      rb.status = 'wartet_grossertext';
      rb.message = `Der Text ist groß (${fmtInt(text.length)} Zeichen). Soll er im Zeichenumfang begrenzt werden?`;
      await persist('pendingB');
      await saveB();
      return { ok: true, waiting: true };
    }
    await finalizeB(finalUrl, text, isPdf, null, { title, fromSelection, textSource, notes, meta, links });
    return { ok: true, notes };
  } catch (e) {
    return await fail(`Fehler beim Auslesen: ${errMsg(e)}`);
  } finally { keepAlive(false); }
}

/* ------------------------------------------------------------------ Cleanup */

async function cleanup() {
  await ready();
  const blocks = mem.resB;
  const { kept, removed } = cleanupBlocks(blocks, mem.settings.cleanupThreshold);
  if (removed.length) snapshotB();
  mem.resB = kept;
  await persist('resB', 'backupB');
  await saveB();
  updateBadge();
  return { ok: true, removed: removed.length, details: removed };
}

/* ------------------------------------------------------------------ Nachrichten vom Popup */

const xmlOpts = (full) => ({ root: !!mem.settings.xmlRoot, ids: !!mem.settings.xmlIds, ...(full ? { prefix: mem.settings.promptPrefix, suffix: mem.settings.promptSuffix } : {}) });

function viewB() {
  const p = mem.pendingB;
  const sources = mem.resB.map((b, i) => ({
    i,
    url: b.url,
    titel: b.titel || '',
    chars: (b.inhalt || '').length,
    isPdf: !!b.isPdf,
    autor: (b.meta && b.meta.autor) || '',
    datum: (b.meta && b.meta.datum) || '',
    off: !!b.off,
  }));
  return {
    status: mem.runB.status,
    message: mem.runB.message,
    ok: !!mem.runB.ok,
    sizeNotice: mem.runB.sizeNotice,
    resCount: mem.resB.length,
    activeCount: activeB().length,
    resChars: xmlLength(activeB()),
    resTokens: estimateTokens(activeB().reduce((n, b) => n + (b.inhalt || '').length, 0)),
    pending: p ? { url: p.url, len: p.len, defaultChars: p.defaultChars, defaultMethod: p.defaultMethod, isPdf: p.isPdf } : null,
    hasLast: !!mem.lastB,
    backupCount: mem.backupB ? mem.backupB.length : 0,
    sizeWarnChars: mem.settings.sizeWarnChars,
    ver: mem.verB,
    sources,
    exportMarkdown: !!mem.settings.exportMarkdown,
    autoCopyLast: !!mem.settings.autoCopyLast,
  };
}

async function handle(msg) {
  await ready();
  switch (msg.type) {
    case 'getState': return { ok: true, B: viewB() };
    case 'getResult': {
      const md = !!(msg.markdown ?? mem.settings.exportMarkdown);
      if (msg.which === 'last') {
        return { ok: true, text: mem.lastB ? buildExport([mem.lastB], md, xmlOpts()) : '', markdown: md };
      }
      if (msg.which === 'at') {
        const b = mem.resB[Number(msg.index)];
        return b ? { ok: true, text: buildExport([b], md, xmlOpts()), markdown: md } : { ok: false, error: 'Quelle nicht gefunden.' };
      }
      return { ok: true, text: buildExport(activeB(), md, xmlOpts(true)), markdown: md };
    }
    case 'removeAt': {
      const i = Number(msg.index);
      if (!Number.isInteger(i) || i < 0 || i >= mem.resB.length) return { ok: false, error: 'Ungültiger Index.' };
      snapshotB();
      const removed = mem.resB.splice(i, 1)[0];
      if (mem.lastB && removed && mem.lastB.url === removed.url && mem.lastB.inhalt === removed.inhalt) {
        mem.lastB = mem.resB.length ? mem.resB[mem.resB.length - 1] : null;
      }
      bumpB();
      await persist('resB', 'backupB', 'lastB', 'verB');
      updateBadge();
      return { ok: true, removedUrl: removed.url };
    }
    case 'copyAll': return copyAllToClipboard();
    case 'toggleAt': {
      const i = Number(msg.index);
      if (!Number.isInteger(i) || i < 0 || i >= mem.resB.length) return { ok: false, error: 'Ungültiger Index.' };
      mem.resB[i] = { ...mem.resB[i], off: !mem.resB[i].off };
      bumpB();
      await persist('resB', 'verB');
      return { ok: true, off: !!mem.resB[i].off };
    }
    case 'fitBudget': {
      const target = Math.floor(Math.max(1000, Number(mem.settings.tokenBudget) || 200000) * 3.8);
      const method = ['frag', 'vo', 'vu'].includes(mem.settings.hardCapMethod) ? mem.settings.hardCapMethod : 'vo';
      const r = fitToBudget(mem.resB, target, method);
      if (!r.changed) return { ok: true, changed: 0, before: estimateTokens(r.before), after: estimateTokens(r.after) };
      snapshotB();
      mem.resB = r.blocks;
      mem.lastB = mem.resB.length ? mem.resB[mem.resB.length - 1] : null;
      bumpB();
      await persist('resB', 'backupB', 'lastB', 'verB');
      return { ok: true, changed: r.changed, before: estimateTokens(r.before), after: estimateTokens(r.after) };
    }
    case 'getSource': {
      const b = mem.resB[Number(msg.index)];
      if (!b) return { ok: false, error: 'Quelle nicht gefunden.' };
      const t = b.inhalt || '';
      return { ok: true, url: b.url, titel: b.titel || '', total: t.length, text: t.slice(0, 2500) };
    }
    case 'moveAt': {
      const i = Number(msg.index), j = i + (msg.dir < 0 ? -1 : 1);
      if (!Number.isInteger(i) || i < 0 || i >= mem.resB.length || j < 0 || j >= mem.resB.length) return { ok: false, error: 'Verschieben nicht möglich.' };
      [mem.resB[i], mem.resB[j]] = [mem.resB[j], mem.resB[i]];
      bumpB();
      await persist('resB', 'verB');
      return { ok: true };
    }
    case 'readCurrent': return readCurrent();
    case 'answerLarge': {
      const p = mem.pendingB;
      if (!p) return { ok: false, error: 'Keine offene Abfrage.' };
      await finalizeB(p.url, p.text, p.isPdf, msg.complete ? { complete: true } : { method: msg.method, chars: msg.chars }, { title: p.title || '', fromSelection: !!p.fromSelection, textSource: p.textSource || '', notes: p.notes || [], meta: p.meta || null, links: p.links || null });
      return { ok: true };
    }
    case 'cancelLarge': {
      mem.pendingB = null; mem.runB.status = 'idle'; mem.runB.message = 'Abfrage abgebrochen – es wurde nichts hinzugefügt.';
      await persist('pendingB'); await saveB();
      return { ok: true };
    }
    case 'clearB': if (mem.resB.length) snapshotB(); mem.resB = []; mem.runB.sizeNotice = false; bumpB(); await persist('resB', 'backupB', 'runB', 'verB'); updateBadge(); return { ok: true };
    case 'restoreB': {
      if (!mem.backupB || !mem.backupB.length) return { ok: false, error: 'Keine Sicherung vorhanden.' };
      const cur = mem.resB.slice();
      mem.resB = mem.backupB; mem.backupB = cur; // Tausch: ein zweiter Klick macht das Wiederherstellen rückgängig
      mem.lastB = mem.resB.length ? mem.resB[mem.resB.length - 1] : null;
      bumpB();
      await persist('resB', 'backupB', 'lastB', 'verB');
      updateBadge();
      return { ok: true, count: mem.resB.length };
    }
    case 'undoLast': {
      if (!mem.resB.length) return { ok: false, error: 'Nichts zum Rückgängigmachen.' };
      snapshotB();
      const removed = mem.resB.pop();
      // lastB nur leeren, wenn es dieselbe URL/Inhalt war
      if (mem.lastB && removed && mem.lastB.url === removed.url && mem.lastB.inhalt === removed.inhalt) {
        mem.lastB = mem.resB.length ? mem.resB[mem.resB.length - 1] : null;
      }
      bumpB();
      await persist('resB', 'backupB', 'lastB', 'verB');
      updateBadge();
      return { ok: true, removedUrl: removed.url };
    }
    case 'dismissSizeB': mem.runB.sizeNotice = false; await saveB(); return { ok: true };
    case 'cleanup': return cleanup();
    default: return { ok: false, error: 'Unbekannte Anfrage.' };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen' || !msg.type) return;
  handle(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: errMsg(e) }));
  return true;
});

/* ------------------------------------------------------------------ Wiederaufnahme (Service Worker wurde beendet/neu gestartet) */

async function resumeIfNeeded() {
  await ready();
  if (mem.runB.status === 'liest') { mem.runB.status = 'idle'; mem.runB.message = 'Das Auslesen wurde unterbrochen (Erweiterung neu gestartet). Bitte erneut starten.'; await saveB(); }
  updateBadge();
}
chrome.runtime.onStartup.addListener(resumeIfNeeded);
chrome.runtime.onInstalled.addListener(resumeIfNeeded);
resumeIfNeeded();

/* Rechtsklick: markierten Text als eigene Quelle hinzufügen (manuell, mehrere Ausschnitte je Seite möglich) */
const MENU_ID = 'rh-add-selection';
function createMenu() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_ID, title: 'Markierung als Quelle hinzufügen', contexts: ['selection'] }, () => void chrome.runtime.lastError);
    });
  } catch (_) { /* optional */ }
}
chrome.runtime.onInstalled.addListener(createMenu);

async function addSelection(tab, text) {
  await ready();
  const rb = mem.runB;
  if (rb.status === 'liest' || rb.status === 'wartet_grossertext') return { ok: false, error: 'Es läuft bereits ein Auslesevorgang.' };
  const url = tab && tab.url ? (cleanUrl(tab.url) || tab.url) : '';
  if (!/^https?:/i.test(url)) return { ok: false, error: 'Nur http- und https-Seiten.' };
  if (isBlockedHost(url, mem.settings.blockedHosts)) return { ok: false, error: 'Domain steht auf der Sperrliste.' };
  const t = cleanPageText(text || '');
  if (!t) return { ok: false, error: 'Leere Markierung.' };
  let meta = null;
  if (mem.settings.includeMeta) { try { meta = await runInTab(tab.id, pageMeta); } catch (_) { meta = null; } }
  await finalizeB(url, t, false, null, { title: tab.title || '', fromSelection: true, textSource: '', notes: [], meta, append: true });
  return { ok: true };
}
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== MENU_ID || !tab) return;
    const r = await addSelection(tab, info.selectionText || '');
    try {
      chrome.action.setBadgeText({ text: r.ok ? '✓' : '!' });
      setTimeout(() => updateBadge(), 1500);
    } catch (_) { /* ignore */ }
  });
}

/* Tastenkürzel: aktuelle Seite auslesen, ohne Popup öffnen zu müssen */
async function showToast(text, kind) {
  await ready();
  if (!mem.settings.pageToasts) return;
  try {
    const tab = await activeTab();
    if (tab && /^(https?|file):/i.test(tab.url || '')) await runInTab(tab.id, pageToast, [String(text).slice(0, 160), kind || 'ok']);
  } catch (_) { /* Seite erlaubt keine Einblendung */ }
}
const tokensNow = () => estimateTokens(activeB().reduce((n, b) => n + (b.inhalt || '').length, 0));

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === 'copy-all') {
    const r = await copyAllToClipboard();
    try { chrome.action.setBadgeText({ text: r.ok ? '⧉' : '!' }); setTimeout(() => updateBadge(), 1500); } catch (_) { /* ignore */ }
    await showToast(r.ok ? `⧉ ${activeB().length} Quellen kopiert · ≈ ${fmtInt(tokensNow())} Token` : `! ${r.error}`, r.ok ? 'ok' : 'err');
    return;
  }
  if (cmd === 'undo-last') {
    const r = await handle({ type: 'undoLast' });
    try { chrome.action.setBadgeText({ text: r && r.ok ? '↩' : '!' }); setTimeout(() => updateBadge(), 1500); } catch (_) { /* ignore */ }
    await showToast(r && r.ok ? '↩ Letzte Quelle entfernt (↺ im Popup stellt sie wieder her)' : `! ${(r && r.error) || 'Nichts zu entfernen'}`, r && r.ok ? 'ok' : 'err');
    return;
  }
  if (cmd !== 'read-current') return;
  await ready();
  const r = await readCurrent();
  if (r && r.ok) {
    try {
      chrome.action.setBadgeText({ text: '✓' });
      setTimeout(() => updateBadge(), 1500);
    } catch (_) { /* ignore */ }
    await showToast(`✓ Gelesen · ${activeB().length} Quellen · ≈ ${fmtInt(tokensNow())} Token`, 'ok');
  } else if (r && r.error) {
    try {
      chrome.action.setBadgeText({ text: '!' });
      setTimeout(() => updateBadge(), 2000);
    } catch (_) { /* ignore */ }
    await showToast(`! ${r.error}`, 'err');
  }
});
