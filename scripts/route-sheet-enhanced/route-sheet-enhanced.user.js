// ==UserScript==
// @name         Route Sheet - Enhanced View VSP4
// @namespace    https://github.com/selmobe/tampermonkey-route-sheet
// @version      8.0
// @author       micaelqg
// @description  Enhances route sheet with package count, cycle info and translated windows
// @match        https://na.ssd-route-sheet-ui.gsf.a2z.com/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/selmobe/tampermonkey-route-sheet/main/scripts/route-sheet-enhanced/route-sheet-enhanced.meta.js
// @downloadURL  https://raw.githubusercontent.com/selmobe/tampermonkey-route-sheet/main/scripts/route-sheet-enhanced/route-sheet-enhanced.user.js
// ==/UserScript==

(function () {
  'use strict';

  let printingRoutes = [];
  let routeMap = {};

  const MAX_1_5HR_MS = 5400000;
  const PROCESSED_ATTR = 'data-rs-enhanced';

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

  function buildRouteKey(routeCode, dispatchByTime) {
    return routeCode + '|' + (dispatchByTime || '');
  }

  function getBlockOverride(route) {
    if (route.displayBlockLength === '2HR' && route.rawRouteLengthValue <= MAX_1_5HR_MS) return '1.5HR';
    return null;
  }

  function storeRoutes(data) {
    routeMap = {};
    (Array.isArray(data) ? data : []).forEach(r => {
      if (!r.routeCode || !r.mainPromiseTime) return;
      const key = buildRouteKey(r.routeCode, r.dispatchByTime);
      routeMap[key] = {
        mainPromiseTime: r.mainPromiseTime,
        blockOverride: getBlockOverride(r)
      };
    });
  }

  // ── Intercepta fetch ──
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

    if (url.includes('/api/get_recent_routes')) {
      const res = await origFetch.apply(this, args);
      try {
        const data = await res.clone().json();
        storeRoutes(data);
        setTimeout(enhanceTable, 500);
      } catch (e) {}
      return res;
    }

    if (url.includes('/api/print_route_sheets')) {
      try {
        const body = (args[1] || {}).body;
        if (typeof body === 'string') printingRoutes = JSON.parse(body);
      } catch (e) {}
    }

    return origFetch.apply(this, args);
  };

  // ── Intercepta XHR ──
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    this._rsUrl = url;
    this._rsMethod = m;
    return origOpen.apply(this, arguments);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (this._rsMethod === 'POST' && this._rsUrl?.includes('/api/print_route_sheets')) {
      try { if (typeof body === 'string') printingRoutes = JSON.parse(body); } catch (e) {}
    }
    if (this._rsUrl?.includes('/api/get_recent_routes')) {
      this.addEventListener('load', function () {
        try {
          storeRoutes(JSON.parse(this.responseText));
          setTimeout(enhanceTable, 500);
        } catch (e) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // ── Substituição na tabela ──
  function enhanceTable() {
    if (!Object.keys(routeMap).length) return;
    document.querySelectorAll(`table tbody tr:not([${PROCESSED_ATTR}])`).forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 6) return;
      const pwSpan = cells[1]?.querySelector('span');
      const rcSpan = cells[2]?.querySelector('span');
      const dtSpan = cells[5]?.querySelector('span');
      if (!pwSpan || !rcSpan || !dtSpan) return;

      const key = buildRouteKey(rcSpan.textContent.trim(), dtSpan.textContent.trim());
      const entry = routeMap[key];
      if (!entry) return;

      const range = findTimeRange(entry.mainPromiseTime);
      if (range) pwSpan.textContent = range.cycle;

      if (entry.blockOverride) {
        const blSpan = cells[3]?.querySelector('span');
        if (blSpan && blSpan.textContent.trim() === '2HR') blSpan.textContent = entry.blockOverride;
      }

      tr.setAttribute(PROCESSED_ATTR, '1');
    });
  }

  // ── Intercepta window.print ──
  const origPrint = window.print;
  window.print = function () {
    setTimeout(() => {
      injectPrint();
      setTimeout(() => origPrint.call(window), 100);
    }, 150);
  };

  // ── Injeção na folha de impressão ──
  function injectPrint() {
    if (!printingRoutes.length) return;
    document.querySelectorAll('.pkg-row').forEach(el => el.remove());

    document.querySelectorAll('.rs-page').forEach((page, idx) => {
      const route = getRouteForPage(page, idx);
      if (!route) return;

      const range = findTimeRange(route.mainPromiseTime);
      const cycle = range ? range.cycle : '-';
      const windowName = range ? range.window : '-';
      const rcKey = buildRouteKey(route.routeCode, route.dispatchByTime);
      const blockOverride = routeMap[rcKey]?.blockOverride || getBlockOverride(route);

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
      .pkg-row {
        display: flex !important;
        visibility: visible !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;
  document.head.appendChild(style);

  // ── Observer para tabela ──
  function startObservers() {
    let debounceTimer;
    const obs = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(enhanceTable, 300);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  document.body ? startObservers() : document.addEventListener('DOMContentLoaded', startObservers);
})();
