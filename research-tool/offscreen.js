/* Offscreen-Dokument: liest PDF-Text mit pdf.js (Service Worker können keine Web Worker starten). */
import * as pdfjsLib from './lib/pdf.min.mjs';
import { extractPdfText } from './pdf-extract.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'copyText') {
    // Zwischenablage für das Tastenkürzel (ohne offenes Popup)
    try {
      const ta = document.createElement('textarea');
      ta.value = String(msg.text || '');
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      sendResponse({ ok, error: ok ? undefined : 'Kopieren wurde vom Browser abgelehnt.' });
    } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    return;
  }
  if (msg.type !== 'extractPdf') return;
  extractPdfText(pdfjsLib, { url: msg.url }, msg.timeoutMs || 60000, { pageMarkers: !!msg.pageMarkers })
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // asynchrone Antwort
});
