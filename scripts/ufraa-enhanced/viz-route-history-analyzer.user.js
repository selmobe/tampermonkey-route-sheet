// ==UserScript==
// @name         VIZ Route History Analyzer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Acumula historico de planos do dia, deduplica rotas e exibe painel de analise
// @match        https://viz-na.ufraa.last-mile.amazon.dev/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';
  console.log('[VIZ-H] Script History Analyzer carregado');

  var NODES = {
    VBR9: 'bfb4ae08-317b-49cd-b907-28121f3a5563',
    VSP4: '6291584b-cf67-4438-88dd-20f466e69c64',
    VRJ1: '023068ec-05f3-4e87-9d7f-219aca4a6063'
  };
  var selectedNode = GM_getValue('vizh-selected-node', 'VSP4');
  var selectedDate = todayStr();
  var isLoading = false;
  var autoRefreshTimer = null;
  var HISTORY_PREFIX = 'vizh-history-';

  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function yesterdayStr() { var d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  function storageKey(date) { return HISTORY_PREFIX + date; }
  function fmtDur(s) { if (!s) return '-'; var h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h > 0 ? h+'h '+m+'m' : m+'min'; }
  function getCycle(pt) { var d = new Date(pt), l = d.getHours()*60+d.getMinutes(); if(l<=599)return'C1';if(l<=719)return'C2';if(l<=839)return'C3';if(l<=959)return'C4';if(l<=1079)return'C5';if(l<=1199)return'C6';if(l<=1319)return'C6';return'C7'; }

  function loadHistory(date) {
    try { var raw = GM_getValue(storageKey(date), null); if (!raw) return {plans:{},routes:{},meta:{date:date,node:selectedNode}}; return JSON.parse(raw); }
    catch(_) { return {plans:{},routes:{},meta:{date:date,node:selectedNode}}; }
  }
  function saveHistory(date, h) { try { GM_setValue(storageKey(date), JSON.stringify(h)); } catch(_){} }

  function ingestPlan(data) {
    if (!data || !data.matchEligibleRoutes || !data.planId) return;
    var planDate = data.planCreationTime ? data.planCreationTime.slice(0,10) : todayStr();
    var h = loadHistory(planDate);
    h.meta.node = data.stationCode || selectedNode;
    h.plans[data.planId] = {planId:data.planId, createdAt:data.planCreationTime, capturedAt:new Date().toISOString(), totalRoutes:data.matchEligibleRoutes.length, algorithmType:data.algorithmType};
    data.matchEligibleRoutes.forEach(function(r) {
      var ex = h.routes[r.sortGroupId];
      if (!ex || (data.planCreationTime > (ex._planCreationTime||''))) {
        h.routes[r.sortGroupId] = {
          routeCode:r.routeCode, sortGroupId:r.sortGroupId, sortGroupStatus:r.sortGroupStatus,
          programType:r.programType, closureReason:r.closureReason, packages:r.packages.length,
          routeDuration:r.routeDurationWithoutInboundStem, outboundStem:r.outboundStemDuration,
          inboundStem:r.inboundStemDuration, underTheRoof:r.underTheRoofDuration,
          routePromiseTime:r.routePromiseTime, dispatchWindowStart:r.dispatchWindowStart,
          dispatchWindowEnd:r.dispatchWindowEnd, sectorId:r.sectorId, cycle:getCycle(r.routePromiseTime),
          matchedBlock: r.matchedBlock ? {transporterType:r.matchedBlock.blockGroup.transporterType, duration:r.matchedBlock.blockGroup.duration, startTime:r.matchedBlock.blockGroup.startTime, blockType:r.matchedBlock.blockGroup.blockType, fillPercent:r.matchedBlock.blockFillPercent, matchResult:r.matchedBlock.matchResult} : null,
          ineligibleReasons:(r.consideredBlockMatches||[]).filter(function(b){return b.matchResult==='INELIGIBLE';}).map(function(b){return b.ineligibleMatchReason;}),
          _planId:data.planId, _planCreationTime:data.planCreationTime, _capturedAt:new Date().toISOString()
        };
      }
    });
    saveHistory(planDate, h);
    console.log('[VIZ-H] Plano ingerido:', data.planId, '| rotas:', data.matchEligibleRoutes.length);
    return h;
  }

  var SECTORS = [
    {title:'Setor 1', prefixes:['AE','AF','AG','AH']},
    {title:'Setor 2', prefixes:['AA','AB','AC','AD']},
    {title:'Setor 3', prefixes:['AM','AN','AO','AP']},
    {title:'Setor 4', prefixes:['AI','AJ','AK','AL']}
  ];

  function stBadge(status) {
    var c = {OPEN:'#ef4444',CLOSED:'#f59e0b',COMPLETED:'#22c55e'}[status]||'#64748b';
    return '<span style="background:'+c+'22;color:'+c+';padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">'+status+'</span>';
  }

  function showAnalysisPanel() {
    var ex = document.getElementById('vizh-panel'); if (ex) ex.remove();
    var hist = loadHistory(selectedDate);
    var panel = document.createElement('div');
    panel.id = 'vizh-panel';
    panel.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;background:#0f172a;color:#e2e8f0;border-radius:12px;padding:20px;max-height:90vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,0.6);min-width:640px;max-width:720px;border:1px solid #1e293b;';
    var html = '';
    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<div style="font-size:16px;font-weight:700;color:#38bdf8;">VIZ History Analyzer</div>';
    html += '<div style="display:flex;gap:6px;align-items:center;">';
    html += '<select id="vizh-node" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;">';
    Object.keys(NODES).forEach(function(n){html+='<option value="'+n+'"'+(n===selectedNode?' selected':'')+'>'+n+'</option>';});
    html += '</select>';
    html += '<input type="date" id="vizh-date" value="'+selectedDate+'" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;">';
    html += '<button id="vizh-today" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#38bdf8;font-size:11px;cursor:pointer;">Hoje</button>';
    html += '<button id="vizh-yesterday" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#38bdf8;font-size:11px;cursor:pointer;">Ontem</button>';
    html += '<button id="vizh-refresh" style="padding:4px 8px;border-radius:6px;border:none;background:#0ea5e9;color:#fff;font-size:12px;cursor:pointer;font-weight:600;">Refresh</button>';
    html += '<button id="vizh-close" style="padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;font-size:14px;cursor:pointer;">X</button>';
    html += '</div></div>';
    var routes = Object.values(hist.routes);
    if (routes.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:#64748b;">Sem dados para '+selectedDate+'</div>';
      panel.innerHTML = html; document.body.appendChild(panel); bindPanelEvents(); return;
    }
    // Setores em 4 colunas
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">';
    SECTORS.forEach(function(sec) {
      var sectorRoutes = routes.filter(function(r) {
        var prefix = (r.routeCode||'').substring(0,2).toUpperCase();
        return sec.prefixes.indexOf(prefix) !== -1;
      }).sort(function(a,b){ return (a.routeCode||'').localeCompare(b.routeCode||''); });
      html += '<div style="background:#1e293b;border-radius:8px;padding:10px;">';
      html += '<div style="font-size:12px;font-weight:700;color:#38bdf8;margin-bottom:8px;text-align:center;">'+sec.title+'</div>';
      html += '<div style="font-size:10px;color:#64748b;text-align:center;margin-bottom:8px;">'+sec.prefixes.join(', ')+'</div>';
      if (sectorRoutes.length === 0) {
        html += '<div style="text-align:center;color:#475569;font-size:11px;padding:12px;">—</div>';
      } else {
        html += '<table style="width:100%;border-collapse:collapse;">';
        html += '<tr style="color:#94a3b8;font-size:10px;text-transform:uppercase;"><th style="padding:4px;text-align:left;">Rota</th><th style="padding:4px;text-align:center;">Pkgs</th><th style="padding:4px;text-align:center;">Duração</th><th style="padding:4px;text-align:center;">Status</th></tr>';
        sectorRoutes.forEach(function(r,i) {
          var bg = i%2===0 ? '#1e293b' : '#0f172a';
          html += '<tr style="background:'+bg+';border-top:1px solid #0f172a;">';
          html += '<td style="padding:4px;font-weight:600;color:#e2e8f0;font-size:11px;">'+r.routeCode+'</td>';
          html += '<td style="padding:4px;text-align:center;font-size:11px;">'+r.packages+'</td>';
          html += '<td style="padding:4px;text-align:center;font-size:11px;color:#94a3b8;">'+fmtDur(r.routeDuration)+'</td>';
          html += '<td style="padding:4px;text-align:center;">'+stBadge(r.sortGroupStatus)+'</td>';
          html += '</tr>';
        });
        html += '</table>';
      }
      html += '</div>';
    });
    html += '</div>';
    html += '<div style="text-align:center;color:#475569;font-size:11px;margin-top:10px;">'+hist.meta.node+' | '+selectedDate+' | '+routes.length+' rotas</div>';
    panel.innerHTML = html; document.body.appendChild(panel); bindPanelEvents();
  }

  function bindPanelEvents() {
    var el;
    el=document.getElementById('vizh-close'); if(el) el.onclick=function(){document.getElementById('vizh-panel').remove();};
    el=document.getElementById('vizh-refresh'); if(el) el.onclick=function(){loadLatestPlan();};
    el=document.getElementById('vizh-today'); if(el) el.onclick=function(){selectedDate=todayStr();showAnalysisPanel();};
    el=document.getElementById('vizh-yesterday'); if(el) el.onclick=function(){selectedDate=yesterdayStr();showAnalysisPanel();};
    el=document.getElementById('vizh-date'); if(el) el.onchange=function(e){selectedDate=e.target.value;showAnalysisPanel();};
    el=document.getElementById('vizh-node'); if(el) el.onchange=function(e){selectedNode=e.target.value;GM_setValue('vizh-selected-node',selectedNode);loadLatestPlan();};
  }

  // Intercept fetch
  var origFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    return origFetch.apply(this, args).then(function(resp) {
      var url = typeof args[0]==='string' ? args[0] : (args[0]&&args[0].url)||'';
      if (url.indexOf('artifact-bucket-na-prod.s3.amazonaws.com') !== -1) {
        resp.clone().json().then(function(d){if(d&&d.matchEligibleRoutes)ingestPlan(d);}).catch(function(){});
      }
      return resp;
    });
  };
  // Intercept XHR
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var xhr = this;
    if (url) { xhr.addEventListener('load', function() { try { if(url.indexOf('artifact-bucket-na-prod.s3.amazonaws.com')!==-1){var d=JSON.parse(xhr.responseText);if(d&&d.matchEligibleRoutes)ingestPlan(d);} } catch(_){} }); }
    return origOpen.apply(this, arguments);
  };

  // Iframe fetch
  function fetchViaIframe(url) {
    return new Promise(function(resolve, reject) {
      var iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      iframe.src = url;
      var tm = setTimeout(function(){iframe.remove();reject(new Error('Timeout'));}, 25000);
      iframe.addEventListener('load', function() {
        try {
          var iw = iframe.contentWindow;
          var oIF = iw.fetch;
          iw.fetch = function() {
            var a = arguments;
            return oIF.apply(this, a).then(function(resp) {
              var ru = typeof a[0]==='string' ? a[0] : (a[0]&&a[0].url)||'';
              if (ru.indexOf('artifact-metadata')!==-1 && ru.indexOf('SSD_ROUTE_PLAN')!==-1) {
                resp.clone().json().then(function(d){if(d&&d.artifactMetadataList){clearTimeout(tm);iframe.remove();resolve({type:'metadata',data:d});}}).catch(function(){});
              }
              if (ru.indexOf('artifact-bucket-na-prod.s3.amazonaws.com')!==-1) {
                resp.clone().json().then(function(d){if(d&&d.matchEligibleRoutes){clearTimeout(tm);iframe.remove();resolve({type:'plan',data:d});}}).catch(function(){});
              }
              return resp;
            });
          };
          var oIX = iw.XMLHttpRequest.prototype.open;
          iw.XMLHttpRequest.prototype.open = function(m, u) {
            this.addEventListener('load', function() {
              try {
                if(u.indexOf('artifact-metadata')!==-1&&u.indexOf('SSD_ROUTE_PLAN')!==-1){var d=JSON.parse(this.responseText);if(d&&d.artifactMetadataList){clearTimeout(tm);iframe.remove();resolve({type:'metadata',data:d});}}
                if(u.indexOf('artifact-bucket-na-prod.s3.amazonaws.com')!==-1){var d2=JSON.parse(this.responseText);if(d2&&d2.matchEligibleRoutes){clearTimeout(tm);iframe.remove();resolve({type:'plan',data:d2});}}
              } catch(_){}
            });
            return oIX.apply(this, arguments);
          };
        } catch(e) { clearTimeout(tm); iframe.remove(); reject(e); }
      });
      document.body.appendChild(iframe);
    });
  }

  function loadLatestPlan() {
    if (isLoading) return Promise.resolve();
    isLoading = true;
    var btn = document.getElementById('vizh-btn');
    if (btn) { btn.textContent = '...'; btn.disabled = true; }
    console.log('[VIZ-H] Buscando plano para', selectedNode);
    var saUrl = 'https://viz-na.ufraa.last-mile.amazon.dev/service-areas/' + NODES[selectedNode];
    return fetchViaIframe(saUrl).then(function(metaResult) {
      if (metaResult.type === 'metadata') {
        var sorted = metaResult.data.artifactMetadataList.slice().sort(function(a,b){return new Date(b.creationTime)-new Date(a.creationTime);});
        return fetchViaIframe('https://viz-na.ufraa.last-mile.amazon.dev/ssd-route-page/' + sorted[0].artifactId);
      }
    }).then(function(planResult) {
      if (planResult && planResult.type === 'plan') {
        ingestPlan(planResult.data);
        selectedDate = planResult.data.planCreationTime ? planResult.data.planCreationTime.slice(0,10) : todayStr();
        showAnalysisPanel();
      }
    }).catch(function(e) {
      console.error('[VIZ-H] Erro:', e.message);
    }).then(function() {
      if (btn) { btn.textContent = 'HA'; btn.disabled = false; }
      isLoading = false;
    });
  }

  function startAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(function(){loadLatestPlan();}, 60000);
    console.log('[VIZ-H] Auto-refresh ativo - 60s');
  }

  function createButton() {
    if (document.getElementById('vizh-btn')) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', createButton); return; }
    var btn = document.createElement('button');
    btn.id = 'vizh-btn';
    btn.textContent = 'HA';
    btn.title = 'VIZ History Analyzer';
    btn.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99999;background:#8b5cf6;border:none;color:#fff;border-radius:50%;width:52px;height:52px;font-size:18px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(139,92,246,0.4);transition:transform 0.15s;';
    btn.onmouseenter = function(){btn.style.transform='scale(1.1)';};
    btn.onmouseleave = function(){btn.style.transform='scale(1)';};
    btn.onclick = function(){var p=document.getElementById('vizh-panel');if(p){p.remove();}else{showAnalysisPanel();}};
    document.body.appendChild(btn);
  }

  function init() {
    createButton();
    console.log('[VIZ-H] Inicializado - node:', selectedNode);
    loadLatestPlan().then(startAutoRefresh);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){setTimeout(init, 600);});
  } else {
    setTimeout(init, 600);
  }

})();
