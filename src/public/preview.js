(() => {
  'use strict';
  // Locally served Lucide 1.61.0 SVG sprite; ISC license in icons/LICENSE.lucide.
  const lucide = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="/assets/icons/lucide.svg#${name}"></use></svg>`;
  const icons = {
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 3v9M6.3 5.8a8 8 0 1 0 11.4 0"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="3" width="8" height="6"/><path d="M12 9v5M4 18v-4h16v4"/><path d="M1 18h6v4H1zM9 18h6v4H9zM17 18h6v4h-6z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></svg>',
  };
  const sample = () => [
    { id: 1, name: 'Studio PC', ip: '192.168.1.10', mac: 'A8:5E:45:91:2B:0C', state: 'reachable' },
    { id: 2, name: 'Gaming rig', ip: '192.168.1.12', mac: 'D4:3B:04:6A:8F:21', state: 'unreachable' },
    { id: 3, name: 'Media server', ip: '192.168.1.15', mac: 'B8:27:EB:42:3D:19', state: 'reachable' },
    { id: 4, name: 'Office PC', ip: '192.168.1.20', mac: '70:85:C2:11:9A:F4', state: 'unreachable' },
    { id: 5, name: 'NAS', ip: '192.168.1.25', mac: '00:11:32:8F:6E:02', state: 'reachable' },
  ];
  let pcs = sample();
  let filter = 'all';
  let query = '';
  let selected = new Set();
  let timers = new Map();
  let activity = [];
  let pendingDeleteId = null;
  const themeKey = 'wake-my-pc-preview-theme';
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try {
    const stored = localStorage.getItem(themeKey);
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (_) { /* Storage is optional. */ }
  const themeButton = () => `<button class="ghost-button theme-toggle" data-simple-theme-toggle aria-label="Use ${theme === 'dark' ? 'light' : 'dark'} mode" title="Use ${theme === 'dark' ? 'light' : 'dark'} mode">${lucide(theme === 'dark' ? 'sun' : 'moon')}</button>`;
  const names = { simple: 'Simple', index: 'Index', switchboard: 'Switchboard', console: 'Console' };
  let variant = new URLSearchParams(location.search).get('variant');
  if (!Object.hasOwn(names, variant)) variant = 'simple';
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const count = state => pcs.filter(pc => pc.state === state).length;
  const label = state => ({ reachable: 'Reachable', unreachable: 'Unreachable', waking: 'Waking…' })[state];
  const stateMark = state => `<span class="state state-${state}"><i></i>${label(state)}</span>`;
  const search = () => `<label class="search">${icons.search}<input id="search" type="search" aria-label="Search computers" placeholder="Search computers" value="${escape(query)}"><kbd>/</kbd></label>`;
  const add = () => `<button class="primary" data-add>${icons.plus}<span>Add computer</span></button>`;
  const filters = () => `<div class="filters" aria-label="Filter by status">${[['all', 'All', pcs.length], ['reachable', 'Reachable', count('reachable')], ['unreachable', 'Unreachable', count('unreachable')]].map(([value, title, amount]) => `<button data-filter="${value}" aria-pressed="${filter === value}">${title}<span>${amount}</span></button>`).join('')}</div>`;
  const footer = () => `<footer class="app-footer"><span>${icons.network} Wake-on-LAN <span class="footer-divider">/</span> IPv4</span><button class="reset" data-reset>${icons.reset}Reset demo</button></footer>`;
  const powerButton = pc => `<button class="wake ${pc.state === 'reachable' ? 'is-reachable' : ''}" data-wake="${pc.id}" aria-label="${pc.state === 'reachable' ? 'Reachable' : 'Wake'} ${escape(pc.name)}" ${pc.state !== 'unreachable' ? 'disabled' : ''}>${icons.power}<span>${pc.state === 'reachable' ? 'Awake' : pc.state === 'waking' ? 'Waking…' : 'Wake'}</span></button>`;
  const remove = pc => `<button class="remove" data-remove="${pc.id}" aria-label="Remove ${escape(pc.name)}" title="Remove ${escape(pc.name)}">×</button>`;

  function frame() {
    document.body.dataset.design = variant;
    document.body.dataset.simpleTheme = theme;
    document.title = `${names[variant]} — Wake My PC preview`;
    document.querySelectorAll('[data-variant]').forEach(link => {
      if (link.dataset.variant === variant) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const app = document.getElementById('app');
    if (variant === 'simple') {
      filter = 'all';
      app.innerHTML = `<div class="simple-shell"><main id="main"><div class="simple-title"><h1>Computers</h1><div class="simple-title-actions"><button class="primary" data-add>${lucide('plus')}Add computer</button>${themeButton()}</div></div><label class="simple-search"><span class="sr-only">Search computers</span><input id="search" type="search" aria-label="Search computers" placeholder="Search computers" value="${escape(query)}"></label><div id="devices" aria-label="Computers"></div></main><footer class="simple-footer"><button data-reset>Reset demo</button></footer></div>`;
    } else if (variant === 'index') {
      app.innerHTML = `<div class="index-shell"><header class="index-header"><a class="wordmark" href="?variant=index">${icons.power}Wake My PC</a><span class="header-meta">LOCAL NETWORK</span></header><main id="main"><div class="index-title"><h1>Computers<span class="title-count">${String(pcs.length).padStart(2, '0')}</span></h1>${add()}</div><div class="index-tools">${filters()}${search()}</div><div class="device-head"><span>No.</span><span>Computer</span><span>IP / MAC address</span><span>Status</span><span></span></div><div id="devices"></div></main>${footer()}</div>`;
    } else if (variant === 'switchboard') {
      app.innerHTML = `<header class="switch-header"><a class="wordmark" href="?variant=switchboard">${icons.power}Wake My PC</a><span class="header-meta">WAKE-ON-LAN</span>${add()}</header><div class="switch-layout"><aside class="switch-rail"><span class="rail-label">COMPUTERS</span><strong id="rail-total">${String(pcs.length).padStart(2, '0')}</strong><div class="rail-status"><i></i><span id="rail-reachable">${count('reachable')} REACHABLE</span></div><span class="rail-bottom">IPv4 / LAN</span></aside><main id="main" class="switch-main"><div class="switch-title"><h1>Switchboard<span class="heading-dot">.</span></h1><span class="switch-counter">${icons.network} LOCAL NETWORK</span></div><div class="switch-tools">${filters()}${search()}</div><div class="device-head"><span>CH.</span><span>Computer / address</span><span>Status</span><span>Wake</span></div><div id="devices"></div>${footer()}</main></div>`;
    } else {
      app.innerHTML = `<div class="console-layout"><aside class="console-sidebar"><a class="wordmark" href="?variant=console">${icons.power}<span>Wake My PC</span></a><div class="sidebar-label">NETWORK</div><button class="sidebar-active" data-filter="all">${icons.network}<span>Computers</span><span class="side-count">${pcs.length}</span></button><div class="sidebar-status"><span>Reachable</span><span id="sidebar-reachable">${count('reachable')}</span><span>Unreachable</span><span id="sidebar-unreachable">${count('unreachable')}</span></div><div class="sidebar-bottom"><i></i> Local connection<br><span>Wake-on-LAN / IPv4</span></div></aside><div class="console-main"><header class="console-header"><span>Network <span>/</span> <strong>Computers</strong></span><span class="header-meta">SAMPLE DATA</span></header><main id="main"><div class="console-title"><div><h1>Computers <span>${pcs.length}</span></h1></div>${add()}</div><div class="console-tools">${filters()}${search()}</div><div class="selection-toolbar"><label><input type="checkbox" id="select-all" aria-label="Select all visible computers"><span id="selection-count">0 selected</span></label><button id="wake-selected" class="text-button" disabled>${icons.power}Wake selected</button></div><div class="device-head"><span></span><span>Name</span><span>IP address</span><span>MAC address</span><span>Status</span><span></span></div><div id="devices"></div><section class="activity" aria-labelledby="activity-title"><div class="activity-heading"><h2 id="activity-title">Activity</h2><span>DEMO SESSION</span></div><div id="activity-log"><p class="activity-empty">No requests sent</p></div></section></main>${footer()}</div></div>`;
    }
    renderRows();
  }

  function visiblePCs() {
    return pcs.filter(pc => (filter === 'all' || pc.state === filter) && `${pc.name} ${pc.ip} ${pc.mac}`.toLowerCase().includes(query.toLowerCase()));
  }

  function renderRows() {
    const visible = visiblePCs();
    document.getElementById('devices').innerHTML = visible.length ? visible.map(pc => {
      const number = String(pcs.indexOf(pc) + 1).padStart(2, '0');
      const identity = `<div class="device-name">${escape(pc.name)}</div>`;
      const ip = `<span class="ip">${escape(pc.ip)}</span>`;
      const mac = `<span class="mac">${escape(pc.mac)}</span>`;
      const action = `<div class="row-actions">${powerButton(pc)}${remove(pc)}</div>`;
      if (variant === 'simple') return `<article class="simple-row"><div class="simple-device"><div class="simple-identity"><span class="simple-name">${escape(pc.name)}</span><span class="mac" aria-label="MAC address ${escape(pc.mac)}">${escape(pc.mac)}</span></div>${ip}</div>${stateMark(pc.state)}<div class="simple-row-actions"><button class="simple-wake" data-wake="${pc.id}" aria-label="Wake ${escape(pc.name)}" ${pc.state !== 'unreachable' ? 'disabled' : ''}>${lucide('power')}<span>${pc.state === 'waking' ? 'Waking…' : 'Wake'}</span></button><button class="ghost-button trash-button" data-remove="${pc.id}" aria-label="Remove ${escape(pc.name)}" title="Remove ${escape(pc.name)}">${lucide('trash-2')}</button></div></article>`;
      if (variant === 'index') return `<article class="device-row"><span class="row-number">${number}</span>${identity}<div class="addresses">${ip}${mac}</div>${stateMark(pc.state)}${action}</article>`;
      if (variant === 'switchboard') return `<article class="device-row"><span class="row-number">${number}</span><div class="device-info">${identity}<div class="addresses">${ip}<span class="address-divider">/</span>${mac}</div></div>${stateMark(pc.state)}${action}</article>`;
      return `<article class="device-row ${selected.has(pc.id) ? 'selected' : ''}"><input class="row-select" type="checkbox" data-select="${pc.id}" aria-label="Select ${escape(pc.name)}" ${selected.has(pc.id) ? 'checked' : ''}>${identity}${ip}${mac}${stateMark(pc.state)}${action}</article>`;
    }).join('') : '<p class="no-results">No computers found</p>';
    document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(filter === button.dataset.filter)));
    document.querySelectorAll('.filters [data-filter]').forEach(button => {
      button.querySelector('span').textContent = button.dataset.filter === 'all' ? pcs.length : count(button.dataset.filter);
    });
    const total = document.querySelector('.title-count');
    if (total) total.textContent = String(pcs.length).padStart(2, '0');
    const railTotal = document.getElementById('rail-total');
    if (railTotal) railTotal.textContent = String(pcs.length).padStart(2, '0');
    const railReachable = document.getElementById('rail-reachable');
    if (railReachable) railReachable.textContent = `${count('reachable')} REACHABLE`;
    const consoleCount = document.querySelector('.console-title h1 span');
    if (consoleCount) consoleCount.textContent = pcs.length;
    const sideCount = document.querySelector('.side-count');
    if (sideCount) sideCount.textContent = pcs.length;
    for (const state of ['reachable', 'unreachable']) {
      const counter = document.getElementById(`sidebar-${state}`);
      if (counter) counter.textContent = count(state);
    }
    syncSelection();
    const log = document.getElementById('activity-log');
    if (log) log.innerHTML = activity.length ? activity.map(item => `<div class="log-line"><time>${escape(item.time)}</time><span>${escape(item.name)}</span><span>${escape(item.message)}</span></div>`).join('') : '<p class="activity-empty">No requests sent</p>';
  }

  function syncSelection() {
    const amount = document.getElementById('selection-count');
    if (!amount) return;
    amount.textContent = `${selected.size} selected`;
    document.getElementById('wake-selected').disabled = !pcs.some(pc => selected.has(pc.id) && pc.state === 'unreachable');
    const all = document.getElementById('select-all');
    const visible = visiblePCs();
    all.checked = visible.length > 0 && visible.every(pc => selected.has(pc.id));
    all.indeterminate = visible.some(pc => selected.has(pc.id)) && !all.checked;
  }

  function announce(message) { document.getElementById('announcement').textContent = message; }
  function log(pc, message) {
    activity.unshift({ time: new Date().toLocaleTimeString([], { hour12: false }), name: pc.name, message });
    activity = activity.slice(0, 6);
  }
  function wake(id) {
    const pc = pcs.find(item => item.id === id);
    if (!pc || pc.state !== 'unreachable') return;
    pc.state = 'waking';
    log(pc, 'Wake request simulated');
    announce(`${pc.name}: wake request simulated`);
    renderRows();
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      if (!pcs.includes(pc)) return;
      pc.state = 'reachable';
      log(pc, 'Reachable');
      announce(`${pc.name} is reachable`);
      renderRows();
    }, 2400));
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button, [data-variant]');
    if (!button) return;
    if (button.hasAttribute('data-variant')) {
      event.preventDefault();
      variant = button.dataset.variant;
      history.replaceState(null, '', `?variant=${variant}`);
      frame();
    } else if (button.hasAttribute('data-filter')) {
      filter = button.dataset.filter;
      renderRows();
    } else if (button.hasAttribute('data-wake')) wake(Number(button.dataset.wake));
    else if (button.id === 'wake-selected') [...selected].forEach(wake);
    else if (button.hasAttribute('data-remove')) {
      const pc = pcs.find(item => item.id === Number(button.dataset.remove));
      if (!pc) return;
      pendingDeleteId = pc.id;
      document.getElementById('remove-name').textContent = pc.name;
      document.getElementById('remove-dialog').showModal();
    } else if (button.hasAttribute('data-cancel-remove')) {
      document.getElementById('remove-dialog').close();
    } else if (button.hasAttribute('data-confirm-remove')) {
      const id = pendingDeleteId;
      const pc = pcs.find(item => item.id === id);
      if (!pc) return;
      clearTimeout(timers.get(id));
      timers.delete(id);
      pcs = pcs.filter(item => item.id !== id);
      selected.delete(id);
      announce(`${pc.name} removed from preview`);
      renderRows();
      document.getElementById('remove-dialog').close();
      document.getElementById('search').focus();
    } else if (button.hasAttribute('data-simple-theme-toggle')) {
      theme = theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.simpleTheme = theme;
      button.outerHTML = themeButton();
      document.querySelector('[data-simple-theme-toggle]').focus();
      try { localStorage.setItem(themeKey, theme); } catch (_) { /* Storage is optional. */ }
    } else if (button.hasAttribute('data-add')) document.getElementById('add-dialog').showModal();
    else if (button.classList.contains('close-dialog')) document.getElementById('add-dialog').close();
    else if (button.hasAttribute('data-reset')) {
      timers.forEach(clearTimeout);
      timers.clear();
      pcs = sample(); filter = 'all'; query = ''; selected.clear(); activity = [];
      frame(); announce('Demo reset');
    }
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'search') { query = event.target.value; renderRows(); }
  });
  document.addEventListener('change', event => {
    const input = event.target;
    if (input.hasAttribute('data-select')) {
      const id = Number(input.dataset.select);
      if (input.checked) selected.add(id); else selected.delete(id);
      input.closest('.device-row').classList.toggle('selected', input.checked);
      syncSelection();
    }
    if (input.id === 'select-all') {
      visiblePCs().forEach(pc => input.checked ? selected.add(pc.id) : selected.delete(pc.id));
      renderRows();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.matches('input, textarea') && !document.querySelector('dialog[open]')) {
      event.preventDefault(); document.getElementById('search').focus();
    }
  });
  document.getElementById('remove-dialog').addEventListener('close', () => { pendingDeleteId = null; });
  document.getElementById('add-dialog').addEventListener('close', () => {
    document.getElementById('add-form').reset();
    document.getElementById('form-error').textContent = '';
  });
  document.getElementById('add-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = form.get('name').trim();
    const ip = form.get('ip').trim();
    const mac = form.get('mac').trim().toUpperCase().replace(/-/g, ':');
    const error = document.getElementById('form-error');
    if (!name) { error.textContent = 'Enter a computer name.'; return; }
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(part => Number(part) > 255)) { error.textContent = 'Enter a valid IPv4 address.'; return; }
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) { error.textContent = 'Enter a valid MAC address.'; return; }
    if (pcs.some(pc => pc.ip === ip || pc.mac === mac)) { error.textContent = 'This IP or MAC address is already saved.'; return; }
    pcs.push({ id: Date.now(), name, ip, mac, state: 'unreachable' });
    filter = 'all'; query = '';
    frame();
    document.getElementById('add-dialog').close();
    announce(`${name} added to preview`);
  });
  frame();
})();
