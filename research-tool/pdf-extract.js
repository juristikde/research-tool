/* PDF-Text auslesen (pdf.js). Wird im Offscreen-Dokument genutzt und ist in Node testbar. */

const MAX_BYTES = 150 * 1024 * 1024; // 150 MB

/** Liest den Text aller Seiten. `source` = { data: Uint8Array } oder { url }. */
export async function extractPdfText(pdfjsLib, source, timeoutMs = 60000, opts = {}) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let task = null;
  const expired = () => ctl.signal.aborted;
  try {
    let data = source.data;
    let finalUrl = source.url || '';
    if (!data) {
      const resp = await fetch(source.url, { signal: ctl.signal, credentials: 'include', redirect: 'follow' });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status} beim Laden der PDF` };
      finalUrl = resp.url || source.url;
      const len = Number(resp.headers.get('content-length') || 0);
      if (len > MAX_BYTES) return { ok: false, error: 'PDF ist zu groß (über 150 MB)' };
      data = new Uint8Array(await resp.arrayBuffer());
    }
    if (data.length > MAX_BYTES) return { ok: false, error: 'PDF ist zu groß (über 150 MB)' };
    const head = String.fromCharCode(...data.slice(0, 1024)); // PDF-Kopf („%PDF-“) darf in den ersten 1024 Bytes stehen
    if (!head.includes('%PDF-')) return { ok: false, error: 'Die Adresse liefert keine PDF-Datei' };

    task = pdfjsLib.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
    const pdf = await Promise.race([task.promise, new Promise((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('Zeitüberschreitung'))))]);
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      if (expired()) return { ok: false, error: `Zeitüberschreitung nach ${Math.round((Date.now() - t0) / 1000)} s (Seite ${p} von ${pdf.numPages})` };
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let s = '';
      for (const it of content.items) { if (typeof it.str === 'string') s += it.str + (it.hasEOL ? '\n' : ''); }
      const pt = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      pages.push(opts.pageMarkers ? `[Seite ${p}]\n${pt}` : pt);
      page.cleanup();
    }
    const text = pages.join('\n\n').trim();
    let title = '', author = '', date = '';
    try {
      const md = await pdf.getMetadata();
      const info = (md && md.info) || {};
      title = String(info.Title || '').trim(); author = String(info.Author || '').trim();
      const m = /^D:(\d{4})(\d{2})?(\d{2})?/.exec(String(info.CreationDate || ''));
      if (m) date = [m[1], m[2], m[3]].filter(Boolean).join('-');
    } catch (_) { /* Metadaten optional */ }
    return { ok: true, text, pages: pdf.numPages, finalUrl, title, author, date };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, error: /abort|Zeitüberschreitung/i.test(msg) ? `Zeitüberschreitung nach ${Math.round((Date.now() - t0) / 1000)} s` : `PDF nicht lesbar: ${msg}` };
  } finally {
    clearTimeout(timer);
    try { if (task) await task.destroy(); } catch (_) { /* egal */ }
  }
}
