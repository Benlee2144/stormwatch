/* StormWatch — Main Application JS */

// State name mapping
const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DC:'Washington DC',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',
  ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
};

const CAT_COLORS = {
  traffic: '#3b82f6',
  skyline: '#8b5cf6',
  weather: '#10b981',
  airport: '#f59e0b'
};

const CAT_LABELS = {
  traffic: 'Traffic',
  skyline: 'Skyline',
  weather: 'Weather',
  airport: 'Airport'
};

// ─── MAP INITIALIZATION ───
function initMainMap(cameras, containerId = 'mainMap') {
  const map = L.map(containerId, {
    zoomControl: true,
    attributionControl: false,
    minZoom: 4,
    maxZoom: 18
  }).setView([39.5, -98.35], 5);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
  // Add labels on top (above radar)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    zIndex: 600,
    pane: 'overlayPane'
  }).addTo(map);

  // Use marker clustering for performance with 20K+ cameras
  const markers = L.markerClusterGroup({
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      let size = 'small';
      let px = 36;
      if (count > 100) { size = 'large'; px = 48; }
      else if (count > 20) { size = 'medium'; px = 42; }
      return L.divIcon({
        html: `<div class="cluster-icon cluster-${size}"><span>${count >= 1000 ? (count/1000).toFixed(1)+'K' : count}</span></div>`,
        className: 'custom-cluster',
        iconSize: [px, px]
      });
    }
  });

  cameras.forEach(cam => {
    const color = CAT_COLORS[cam.ca] || CAT_COLORS.traffic;
    const marker = L.circleMarker([cam.la, cam.ln], {
      radius: 4,
      fillColor: color,
      fillOpacity: 0.9,
      stroke: true,
      color: color,
      weight: 2,
      opacity: 0.4,
      className: 'cam-marker-glow'
    });

    marker.bindPopup(`
      <div class="cam-popup">
        <h3>${escHtml(cam.n)}</h3>
        <div class="cam-loc">📍 ${escHtml(cam.c)}, ${cam.s}</div>
        <span class="cam-cat cat-${cam.ca}">${CAT_LABELS[cam.ca] || cam.ca}</span>
        <a href="camera.html?id=${encodeURIComponent(cam.i)}" class="btn-watch">⚡ Watch Live</a>
      </div>
    `, { maxWidth: 280 });

    markers.addLayer(marker);
  });

  map.addLayer(markers);
  return map;
}

function initStateMap(cameras, containerId = 'stateMap') {
  if (!cameras.length) return;
  const map = L.map(containerId, { zoomControl: true, attributionControl: false }).setView([cameras[0].la, cameras[0].ln], 7);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' }).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', zIndex: 600, pane: 'overlayPane' }).addTo(map);

  const markers = L.markerClusterGroup({
    maxClusterRadius: 40,
    iconCreateFunction: function(cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="cluster-icon cluster-small"><span>${count}</span></div>`,
        className: 'custom-cluster', iconSize: [36, 36]
      });
    }
  });

  cameras.forEach(cam => {
    const color = CAT_COLORS[cam.ca] || CAT_COLORS.traffic;
    const marker = L.circleMarker([cam.la, cam.ln], {
      radius: 5, fillColor: color, fillOpacity: 0.85,
      stroke: true, color: color, weight: 1, opacity: 0.5
    });
    marker.bindPopup(`
      <div class="cam-popup">
        <h3>${escHtml(cam.n)}</h3>
        <div class="cam-loc">📍 ${escHtml(cam.c)}, ${cam.s}</div>
        <a href="camera.html?id=${encodeURIComponent(cam.i)}" class="btn-watch">⚡ Watch Live</a>
      </div>
    `);
    markers.addLayer(marker);
  });

  map.addLayer(markers);
  const bounds = L.latLngBounds(cameras.map(c => [c.la, c.ln]));
  map.fitBounds(bounds, { padding: [30, 30] });
  return map;
}

// ─── SEARCH ───
function initSearch(cameras) {
  const overlay = document.getElementById('searchOverlay');
  const input = document.getElementById('searchInput');
  const navSearch = document.getElementById('navSearch');
  const results = document.getElementById('searchResults');
  if (!overlay || !input) return;

  function openSearch() {
    overlay.classList.add('active');
    setTimeout(() => input.focus(), 100);
  }
  function closeSearch() {
    overlay.classList.remove('active');
    input.value = '';
    results.innerHTML = '';
  }

  if (navSearch) navSearch.addEventListener('focus', (e) => { e.target.blur(); openSearch(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSearch(); }
  });

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { results.innerHTML = ''; return; }

      const matches = cameras.filter(c =>
        c.c.toLowerCase().includes(q) ||
        c.s.toLowerCase() === q ||
        c.n.toLowerCase().includes(q) ||
        (STATE_NAMES[c.s] || '').toLowerCase().includes(q)
      ).slice(0, 30);

      results.innerHTML = matches.length === 0
        ? '<div style="padding:2rem;text-align:center;color:var(--text-muted)">No cameras found</div>'
        : matches.map(c => `
          <a href="camera.html?id=${encodeURIComponent(c.i)}" class="search-result-item">
            <div>
              <div style="font-weight:600">${escHtml(c.n)}</div>
              <div style="font-size:0.8rem;color:var(--text-secondary)">📍 ${escHtml(c.c)}, ${c.s}</div>
            </div>
            <span class="cam-cat cat-${c.ca}" style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:999px">${CAT_LABELS[c.ca] || c.ca}</span>
          </a>
        `).join('');
    }, 200);
  });
}

// ─── CAMERA VIEW ───
function initCameraView(cameras) {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) return;

  const cam = cameras.find(c => c.i === id);
  if (!cam) {
    document.getElementById('cameraContent').innerHTML = '<div class="text-center mt-4"><h2>Camera not found</h2></div>';
    return;
  }

  document.title = `${cam.n} — StormWatch`;

  // Player
  const player = document.getElementById('cameraPlayer');
  if (cam.t === 'image') {
    player.innerHTML = `<img src="${escHtml(cam.u)}" alt="${escHtml(cam.n)}" onerror="this.parentElement.innerHTML='<div class=no-preview><div class=icon>📷</div><div>Stream unavailable</div></div>'" />`;
  } else if (cam.t === 'stream' || cam.t === 'hls') {
    player.innerHTML = `<div class="no-preview"><div class="icon">🎥</div><div>Live Stream</div><a href="${escHtml(cam.u)}" target="_blank" style="margin-top:0.5rem;display:inline-block;color:var(--accent-cyan)">Open Stream ↗</a></div>`;
  } else {
    player.innerHTML = `<div class="no-preview"><div class="icon">📷</div><div>${escHtml(cam.n)}</div><a href="${escHtml(cam.u)}" target="_blank" style="margin-top:0.5rem;display:inline-block;color:var(--accent-cyan)">View Source ↗</a></div>`;
  }

  // Info
  document.getElementById('camName').textContent = cam.n;
  document.getElementById('camLocation').textContent = `${cam.c}, ${cam.s}`;
  document.getElementById('camCategory').textContent = CAT_LABELS[cam.ca] || cam.ca;
  document.getElementById('camCategory').className = `cam-cat cat-${cam.ca}`;

  // Mini map
  const miniMap = L.map('camMiniMap', { zoomControl: false, attributionControl: false, dragging: false }).setView([cam.la, cam.ln], 11);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd' }).addTo(miniMap);
  const color = CAT_COLORS[cam.ca] || CAT_COLORS.traffic;
  L.circleMarker([cam.la, cam.ln], { radius: 8, fillColor: color, fillOpacity: 1, stroke: true, color: '#fff', weight: 2 }).addTo(miniMap);

  // Nearby cameras
  const nearby = cameras
    .filter(c => c.i !== cam.i && c.s === cam.s)
    .map(c => ({ ...c, dist: Math.sqrt((c.la - cam.la) ** 2 + (c.ln - cam.ln) ** 2) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8);

  document.getElementById('nearbyCams').innerHTML = nearby.length === 0
    ? '<div style="color:var(--text-muted)">No nearby cameras</div>'
    : nearby.map(c => `
      <a href="camera.html?id=${encodeURIComponent(c.i)}" class="nearby-item">
        <span>${escHtml(c.n.substring(0, 40))}${c.n.length > 40 ? '…' : ''}</span>
        <span style="color:var(--text-muted)">${c.c}</span>
      </a>
    `).join('');

  // Breadcrumb
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.innerHTML = `<a href="index.html">Home</a> → <a href="states/${cam.s}.html">${STATE_NAMES[cam.s] || cam.s}</a> → ${escHtml(cam.c)}`;
}

// ─── STATE PAGE ───
function initStatePage(cameras, stateCode) {
  const stateCams = cameras.filter(c => c.s === stateCode);
  const stateName = STATE_NAMES[stateCode] || stateCode;

  document.title = `${stateName} Cameras — StormWatch`;
  document.getElementById('stateTitle').textContent = stateName;

  const cities = {};
  stateCams.forEach(c => {
    if (!cities[c.c]) cities[c.c] = [];
    cities[c.c].push(c);
  });

  document.getElementById('stateStats').textContent =
    `${stateCams.length.toLocaleString()} cameras across ${Object.keys(cities).length} cities`;

  // Map
  if (stateCams.length > 0) initStateMap(stateCams);

  // Camera list by city
  const container = document.getElementById('stateCameras');
  const sortedCities = Object.keys(cities).sort();
  container.innerHTML = sortedCities.map(city => `
    <div class="city-section">
      <h2>📍 ${escHtml(city)} <span style="color:var(--text-muted);font-weight:400;font-size:0.85rem">(${cities[city].length})</span></h2>
      <div class="camera-grid">
        ${cities[city].slice(0, 12).map(c => cameraCard(c)).join('')}
        ${cities[city].length > 12 ? `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem">+ ${cities[city].length - 12} more cameras</div>` : ''}
      </div>
    </div>
  `).join('');
}

function cameraCard(c) {
  const isImage = c.t === 'image' && c.u;
  const thumbHtml = isImage
    ? `<img src="${escHtml(c.u)}" alt="${escHtml(c.n)}" loading="lazy" onerror="this.remove()">`
    : `<span class="placeholder">📷</span>`;
  return `
    <a href="camera.html?id=${encodeURIComponent(c.i)}" class="camera-card">
      <div class="camera-card-thumb cat-bg-${c.ca}">
        ${thumbHtml}
        <span class="camera-card-live">LIVE</span>
      </div>
      <div class="camera-card-body">
        <div class="camera-card-name">${escHtml(c.n.substring(0, 50))}${c.n.length > 50 ? '…' : ''}</div>
        <div class="camera-card-loc">📍 ${escHtml(c.c)}, ${c.s}</div>
        <span class="camera-card-cat cat-${c.ca}">${CAT_LABELS[c.ca] || c.ca}</span>
      </div>
    </a>
  `;
}

// ─── UTILITY ───
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── CLUSTER STYLES (inject) ───
(function() {
  const style = document.createElement('style');
  style.textContent = `
    .custom-cluster { background: transparent !important; border: none !important; }
    .cluster-icon {
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%; font-family: 'JetBrains Mono', monospace;
      font-weight: 700; color: #fff; text-align: center;
    }
    .cluster-small { width: 36px; height: 36px; font-size: 0.7rem; background: rgba(59,130,246,0.7); border: 2px solid rgba(59,130,246,0.9); }
    .cluster-medium { width: 42px; height: 42px; font-size: 0.75rem; background: rgba(6,182,212,0.7); border: 2px solid rgba(6,182,212,0.9); }
    .cluster-large { width: 48px; height: 48px; font-size: 0.8rem; background: rgba(139,92,246,0.7); border: 2px solid rgba(139,92,246,0.9); }
  `;
  document.head.appendChild(style);
})();
