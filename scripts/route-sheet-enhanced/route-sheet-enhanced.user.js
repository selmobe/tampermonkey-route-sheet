// ==UserScript==
// @name         Route Sheet - Enhanced View VSP4 - AUTOPRINT
// @namespace    https://github.com/selmobe/tampermonkey-route-sheet
// @version      8.6
// @author       micaelqg
// @description  Enhances route sheet with package count, cycle info and translated windows
// @match        https://na.ssd-route-sheet-ui.gsf.a2z.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/selmobe/tampermonkey-route-sheet/main/scripts/route-sheet-enhanced/route-sheet-enhanced.meta.js
// @downloadURL  https://raw.githubusercontent.com/selmobe/tampermonkey-route-sheet/main/scripts/route-sheet-enhanced/route-sheet-enhanced.user.js
// ==/UserScript==

// ── Changelog v8.2 ──
// - Adicionado Auto Print: botão toggle que seleciona e imprime rotas não impressas automaticamente (cooldown 10s)
// - Adicionado Print Log Panel: painel lateral com histórico de impressões persistido em localStorage
// - Registra rotas impressas com código, pacotes, timestamp e status (ok/error)
// ── Changelog v8.3 ──
// - Botão Auto Print reposicionado para canto inferior direito
// - Print Log Panel abre acima do botão
// ── Changelog v8.4 ──
// - Adicionado Block Length 1.5HR: identifica rotas com duração real ≤ threshold forçadas para 2HR
// - Variável MAX_1_5HR_MIN configurável em minutos (padrão 90 = 1h30)
// ── Changelog v8.5 ──
// - Notificação in-app ao atualizar: exibe novidades da versão com link para changelog completo

(function () {
  'use strict';

  // ── Configuração ──
  // Tempo máximo (minutos) para considerar rota como 1.5HR (padrão: 90 = 1h30)
  const MAX_1_5HR_MIN = 90;

  const SCRIPT_VERSION = '8.6';
  const VERSION_KEY = 'rs_script_version';
  const CHANGELOG_URL = 'https://github.com/selmobe/tampermonkey-route-sheet/blob/main/CHANGELOG.md';
  const RELEASE_NOTES = [
    'Auto Print persiste estado após recarregar a página',
  ];

  let printingRoutes = [];
  const routeTimeMap = {};
  let isPrinting = false;
  let lastPrintTime = 0;
  let autoEnabled = localStorage.getItem('rs_auto_enabled') === 'true';
  const PRINT_COOLDOWN = 10000;
  const LOG_KEY = 'rs_print_log';

  const TIME_RANGES = [
    { min: '00:00:00', max: '08:59:59', cycle: 'C1', window: 'SUBSAME_DAY_1' },
    { min: '09:00:00', max: '10:59:59', cycle: 'C2', window: 'SUBSAME_DAY_2' },
    { min: '10:30:00', max: '12:29:59', cycle: 'C3', window: 'SUBSAME_DAY_3' },
    { min: '12:00:00', max: '13:59:59', cycle: 'C4', window: 'SUBSAME_DAY_4' },
    { min: '13:30:00', max: '15:29:59', cycle: 'C5', window: 'SUBSAME_DAY_5' },
    { min: '15:00:00', max: '16:59:59', cycle: 'C6', window: 'SUBSAME_DAY_6' },
    { min: '16:30:00', max: '18:29:59', cycle: 'C7', window: 'SUBSAME_DAY_7' },
    { min: '18:00:00', max: '19:59:59', cycle: 'C8', window: 'SUBSAME_DAY_8' },
    { min: '19:30:00', max: '21:29:59', cycle: 'C9', window: 'SUBSAME_DAY_9' },
    { min: '21:00:00', max: '22:30:59', cycle: 'C10', window: 'SUBSAME_DAY_10' }
  ];

  function extractTime(val) {
    if (!val) return null;
    const m = String(val).match(/(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : null;
  }

  function findTimeRange(raw) {
    const time = extractTime(raw);
    if (!time) return null;
    return TIME_RANGES.find(r => time >= r.min && time <= r.max) || null;
  }

  function getBlockOverride(route) {
    if (route.displayBlockLength === '2HR' && route.rawRouteLengthValue <= MAX_1_5HR_MIN * 60000) return '1.5HR';
    return null;
  }

  function storeRoutes(data) {
    Object.keys(routeTimeMap).forEach(k => delete routeTimeMap[k]);
    (Array.isArray(data) ? data : []).forEach(r => {
      if (r.routeCode && r.mainPromiseTime) {
        const key = r.routeCode + '|' + (r.dispatchByTime || '');
        routeTimeMap[key] = { mainPromiseTime: r.mainPromiseTime, blockOverride: getBlockOverride(r) };
      }
    });
  }

  // ── Intercepta fetch ──
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('/api/get_recent_routes')) {
      const isNotPrinted = url.includes('printed=false');
      const res = await origFetch.apply(this, args);
      try {
        const data = await res.clone().json();
        storeRoutes(data);
        setTimeout(replaceTableWindows, 500);
        if (isNotPrinted && data.length) setTimeout(autoPrint, 2000);
      } catch (e) {}
      return res;
    }

    if (url.includes('/api/print_route_sheets')) {
      try {
        const body = (args[1] || {}).body;
        if (typeof body === 'string') {
          printingRoutes = JSON.parse(body);
        }
      } catch (e) {}
    }

    return origFetch.apply(this, args);
  };

  // ── Intercepta XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    this._pkgUrl = url;
    this._pkgMethod = m;
    return origOpen.apply(this, arguments);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this._pkgMethod === 'POST' && this._pkgUrl && this._pkgUrl.includes('/api/print_route_sheets')) {
      try {
        if (typeof body === 'string') printingRoutes = JSON.parse(body);
      } catch (e) {}
    }
    // intercepta XHR GET para get_recent_routes (fallback se site usar XHR)
    if (this._pkgUrl && this._pkgUrl.includes('/api/get_recent_routes')) {
      const isNotPrinted = this._pkgUrl.includes('printed=false');
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText);
          storeRoutes(data);
          setTimeout(replaceTableWindows, 500);
          if (isNotPrinted && data.length) setTimeout(autoPrint, 2000);
        } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // ── Substituição na tabela ──
  function replaceTableWindows() {
    if (!Object.keys(routeTimeMap).length) return;
    document.querySelectorAll('table tbody tr').forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 6) return;
      const pwSpan = cells[1].querySelector('span');
      const rcSpan = cells[2].querySelector('span');
      const dtSpan = cells[5].querySelector('span');
      if (!pwSpan || !rcSpan || !dtSpan) return;
      const rc = rcSpan.textContent.trim();
      const dt = dtSpan.textContent.trim();
      const key = rc + '|' + dt;
      const entry = routeTimeMap[key];
      if (!entry) return;
      const range = findTimeRange(entry.mainPromiseTime);
      if (range) pwSpan.textContent = range.cycle;
      if (entry.blockOverride) {
        const blSpan = cells[3]?.querySelector('span');
        if (blSpan && blSpan.textContent.trim() === '2HR') blSpan.textContent = entry.blockOverride;
      }
    });
  }

  // ── Intercepta window.print ──
  const origPrint = window.print;
  window.print = function () {
    setTimeout(() => {
      injectPrint();
      logRoutes(printingRoutes, 'ok');
      setTimeout(() => origPrint.call(window), 100);
    }, 150);
  };

  // ── Injeção na folha de impressão ──
  function injectPrint() {
    if (!printingRoutes.length) return;
    document.querySelectorAll('.pkg-row').forEach(el => el.remove());
    const pages = document.querySelectorAll('.rs-page');

    pages.forEach((page, idx) => {
      const route = getRouteForPage(page, idx);
      if (!route) return;

      const range = findTimeRange(route.mainPromiseTime);
      const cycle = range ? range.cycle : '-';
      const windowName = range ? range.window : '-';
      const rcKey = route.routeCode + '|' + (route.dispatchByTime || '');
      const blockOverride = routeTimeMap[rcKey]?.blockOverride || getBlockOverride(route);

      page.querySelectorAll('.rs-row').forEach(row => {
        const title = row.querySelector('.rs-small-title');
        const data = row.querySelector('.rs-large-data');
        if (!title || !data) return;
        const label = title.textContent.trim().toLowerCase();
        if (label.includes('window')) data.textContent = windowName;
        if (blockOverride && (label.includes('block') || label.includes('route length')) && data.textContent.trim() === '2HR') {
          data.textContent = blockOverride;
        }
      });

      const row = document.createElement('div');
      row.className = 'rs-row pkg-row';
      row.innerHTML = `
        <div class="rs-column">
          <div class="rs-small-title">Packages</div>
          <div class="rs-large-data">${route.packageCount}</div>
        </div>
        <div class="rs-column">
          <div class="rs-small-title">Cycle</div>
          <div class="rs-large-data">${cycle}</div>
        </div>
      `;
      page.appendChild(row);
    });
  }

  function getRouteForPage(page, idx) {
    if (printingRoutes.length === 1) return printingRoutes[0];
    let rc = null;
    page.querySelectorAll('.rs-small-data').forEach(el => {
      const txt = el.textContent.trim();
      if (/^[A-Z]{2}\d{1,2}$/.test(txt)) rc = txt;
    });
    if (rc) {
      const r = printingRoutes.find(r => r.routeCode === rc);
      if (r) return r;
    }
    return printingRoutes[idx] || null;
  }

  // ── CSS ──
  const style = document.createElement('style');
  style.textContent = `
    @media print {
      .pkg-row { display: flex !important; visibility: visible !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      #rs-log-panel, #rs-auto-btn { display: none !important; }
    }
    #rs-auto-btn { position: fixed; bottom: 14px; right: 14px; width: 48px; height: 48px; border-radius: 50%; border: 2px solid #444; background: #1a1a2e; color: #e0e0e0; font-size: 22px; cursor: pointer; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; transition: all .2s; }
    #rs-auto-btn:hover { transform: scale(1.1); }
    #rs-auto-btn.active { background: #0e6b0e; border-color: #50fa7b; box-shadow: 0 0 12px rgba(80,250,123,.4); }
    #rs-log-panel { position: fixed; bottom: 70px; right: 14px; width: 280px; max-height: 350px; background: #1a1a2e; color: #e0e0e0; border: 1px solid #333; border-radius: 8px; font-family: monospace; font-size: 11px; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,.5); display: none; }
    #rs-log-panel.visible { display: block; }
    #rs-log-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #16213e; border-radius: 8px 8px 0 0; font-weight: bold; font-size: 12px; }
    #rs-log-header button { background: none; border: none; color: #e0e0e0; cursor: pointer; font-size: 13px; padding: 0 4px; }
    #rs-log-body { max-height: 290px; overflow-y: auto; padding: 4px 0; }
    .rs-log-stats { padding: 4px 10px; color: #8be9fd; border-bottom: 1px solid #333; margin-bottom: 2px; }
    .rs-log-row { display: flex; justify-content: space-between; padding: 3px 10px; border-bottom: 1px solid #222; }
    .rs-log-row:hover { background: #222; }
    .rs-log-err { background: #2d1117; }
    .rs-log-code { color: #50fa7b; font-weight: bold; min-width: 35px; }
    .rs-log-pkgs { color: #bd93f9; min-width: 40px; }
    .rs-log-ts { color: #888; flex: 1; text-align: right; margin: 0 6px; }
    .rs-log-st { min-width: 16px; }
    .rs-log-empty { padding: 12px; text-align: center; color: #666; }
    #rs-update-toast { position: fixed; top: 20px; right: 20px; width: 300px; background: #1a1a2e; color: #e0e0e0; border: 1px solid #50fa7b; border-radius: 8px; font-family: monospace; font-size: 12px; z-index: 100000; box-shadow: 0 4px 16px rgba(0,0,0,.6); animation: rs-slide-in .3s ease; }
    #rs-toast-header { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #16213e; border-radius: 8px 8px 0 0; font-weight: bold; }
    #rs-toast-header button { background: none; border: none; color: #e0e0e0; cursor: pointer; font-size: 14px; }
    #rs-update-toast ul { margin: 8px 12px; padding-left: 16px; }
    #rs-update-toast li { margin: 4px 0; color: #8be9fd; }
    #rs-update-toast a { display: block; padding: 8px 12px; color: #50fa7b; text-align: center; border-top: 1px solid #333; }
    @keyframes rs-slide-in { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
    @media print { #rs-update-toast { display: none !important; } }
  `;
  document.head.appendChild(style);

  // ── Print Log (localStorage) ──
  function getLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
  }
  function saveLog(log) { localStorage.setItem(LOG_KEY, JSON.stringify(log)); }

  function logRoutes(routes, status) {
    const log = getLog();
    const ts = new Date().toLocaleString('pt-BR');
    routes.forEach(r => {
      log.unshift({ code: r.routeCode, pkgs: r.packageCount, time: ts, status });
    });
    if (log.length > 500) log.length = 500;
    saveLog(log);
    renderLogPanel();
  }

  // ── Log Panel UI ──
  function createLogPanel() {
    const panel = document.createElement('div');
    panel.id = 'rs-log-panel';
    panel.innerHTML = `
      <div id="rs-log-header">
        <span>🖨️ Print Log</span>
        <div>
          <button id="rs-log-clear" title="Clear log">🗑️</button>
          <button id="rs-log-toggle" title="Minimize">_</button>
        </div>
      </div>
      <div id="rs-log-body"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('rs-log-clear').onclick = () => { saveLog([]); renderLogPanel(); };
    document.getElementById('rs-log-toggle').onclick = () => {
      const body = document.getElementById('rs-log-body');
      const btn = document.getElementById('rs-log-toggle');
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      btn.textContent = collapsed ? '_' : '▢';
    };
    renderLogPanel();
  }

  function renderLogPanel() {
    const body = document.getElementById('rs-log-body');
    if (!body) return;
    const log = getLog();
    if (!log.length) { body.innerHTML = '<div class="rs-log-empty">No prints yet</div>'; return; }
    const today = new Date().toLocaleDateString('pt-BR');
    const todayLogs = log.filter(e => e.time.startsWith(today));
    body.innerHTML = `<div class="rs-log-stats">Today: ${todayLogs.length} routes | Total: ${log.length}</div>` +
      log.slice(0, 100).map(e =>
        `<div class="rs-log-row ${e.status === 'error' ? 'rs-log-err' : ''}">
          <span class="rs-log-code">${e.code}</span>
          <span class="rs-log-pkgs">${e.pkgs}pkg</span>
          <span class="rs-log-ts">${e.time}</span>
          <span class="rs-log-st">${e.status === 'ok' ? '✅' : '❌'}</span>
        </div>`
      ).join('');
  }

  // ── Toggle Button ──
  function createToggleBtn() {
    const btn = document.createElement('button');
    btn.id = 'rs-auto-btn';
    btn.title = `Auto Print: ${autoEnabled ? 'ON' : 'OFF'}`;
    btn.textContent = '🖨️';
    btn.classList.toggle('active', autoEnabled);
    btn.onclick = () => {
      autoEnabled = !autoEnabled;
      localStorage.setItem('rs_auto_enabled', autoEnabled);
      btn.classList.toggle('active', autoEnabled);
      btn.title = `Auto Print: ${autoEnabled ? 'ON' : 'OFF'}`;
      document.getElementById('rs-log-panel')?.classList.toggle('visible', autoEnabled);
    };
    document.body.appendChild(btn);
  }

  // ── Auto Print ──
  function autoPrint() {
    if (!autoEnabled || isPrinting || Date.now() - lastPrintTime < PRINT_COOLDOWN) return;
    const labels = document.querySelectorAll('table tbody tr td[mrdn-cell-selectable] label');
    if (!labels.length) return;
    isPrinting = true;
    labels.forEach(l => l.click());
    setTimeout(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Print Selected');
      if (btn) {
        btn.click();
        lastPrintTime = Date.now();
      }
      isPrinting = false;
    }, 500);
  }

  // ── Observer para tabela ──
  function startObservers() {
    const tableObs = new MutationObserver(() => {
      clearTimeout(tableObs._t);
      tableObs._t = setTimeout(replaceTableWindows, 300);
    });
    tableObs.observe(document.body, { childList: true, subtree: true });
  }

  // ── Update Toast ──
  function checkUpdate() {
    const prev = localStorage.getItem(VERSION_KEY);
    localStorage.setItem(VERSION_KEY, SCRIPT_VERSION);
    if (prev && prev !== SCRIPT_VERSION) showUpdateToast(prev);
  }

  function showUpdateToast(prev) {
    const toast = document.createElement('div');
    toast.id = 'rs-update-toast';
    toast.innerHTML = `
      <div id="rs-toast-header">
        <span>🚀 Atualizado v${prev} → v${SCRIPT_VERSION}</span>
        <button id="rs-toast-close">✕</button>
      </div>
      <ul>${RELEASE_NOTES.map(n => `<li>${n}</li>`).join('')}</ul>
      <a href="${CHANGELOG_URL}" target="_blank">Ver changelog completo</a>
    `;
    document.body.appendChild(toast);
    document.getElementById('rs-toast-close').onclick = () => toast.remove();
    setTimeout(() => toast.remove(), 15000);
  }

  function init() {
    startObservers(); createToggleBtn(); createLogPanel(); checkUpdate();
    if (autoEnabled) document.getElementById('rs-log-panel')?.classList.add('visible');
  }
  document.body ? init() : document.addEventListener('DOMContentLoaded', init);
})();
