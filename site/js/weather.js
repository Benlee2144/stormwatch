/* StormWatch — Weather Integration with RainViewer Animated Radar */

const Weather = (() => {
  const SEVERITY_COLORS = {
    Extreme:  { fill: '#dc2626', stroke: '#ef4444', opacity: 0.35, priority: 4 },
    Severe:   { fill: '#f97316', stroke: '#fb923c', opacity: 0.30, priority: 3 },
    Moderate: { fill: '#eab308', stroke: '#facc15', opacity: 0.25, priority: 2 },
    Minor:    { fill: '#3b82f6', stroke: '#60a5fa', opacity: 0.20, priority: 1 },
    Unknown:  { fill: '#6b7280', stroke: '#9ca3af', opacity: 0.15, priority: 0 }
  };

  const EVENT_ICONS = {
    'Tornado Warning': '🌪️', 'Tornado Watch': '🌪️',
    'Severe Thunderstorm Warning': '⛈️', 'Severe Thunderstorm Watch': '⛈️',
    'Flash Flood Warning': '🌊', 'Flood Warning': '🌊', 'Flood Watch': '🌊',
    'Winter Storm Warning': '❄️', 'Winter Storm Watch': '❄️', 'Blizzard Warning': '❄️',
    'Ice Storm Warning': '🧊', 'Wind Advisory': '💨', 'High Wind Warning': '💨',
    'Hurricane Warning': '🌀', 'Hurricane Watch': '🌀', 'Tropical Storm Warning': '🌀',
    'Heat Advisory': '🔥', 'Excessive Heat Warning': '🔥',
    'Fire Weather Watch': '🔥', 'Red Flag Warning': '🔥',
    'Dense Fog Advisory': '🌫️', 'Freeze Warning': '🥶'
  };

  let alertsLayer = null;
  let radarLayers = [];
  let currentRadarFrame = 0;
  let radarAnimInterval = null;
  let radarData = null;
  let alertData = [];
  let alertRefreshTimer = null;
  let radarRefreshTimer = null;
  let map = null;
  let cameras = [];
  let radarVisible = false;

  // ─── NWS ALERTS ───

  async function fetchAlerts() {
    try {
      const res = await fetch('https://api.weather.gov/alerts/active?status=actual', {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!res.ok) throw new Error(`NWS API ${res.status}`);
      const data = await res.json();
      alertData = (data.features || []).filter(f =>
        f.geometry || (f.properties && f.properties.geocode)
      );
      return alertData;
    } catch (err) {
      console.warn('NWS alert fetch failed:', err);
      return alertData;
    }
  }

  function getSeverityStyle(severity) {
    return SEVERITY_COLORS[severity] || SEVERITY_COLORS.Unknown;
  }

  function renderAlerts(leafletMap) {
    map = leafletMap;
    if (alertsLayer) map.removeLayer(alertsLayer);
    alertsLayer = L.layerGroup();

    alertData.forEach(feature => {
      const props = feature.properties;
      const style = getSeverityStyle(props.severity);
      const icon = EVENT_ICONS[props.event] || '⚠️';

      if (feature.geometry && feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0].map(c => [c[1], c[0]]);
        const poly = L.polygon(coords, {
          color: style.stroke, fillColor: style.fill,
          fillOpacity: style.opacity, weight: 2, opacity: 0.8
        });
        poly.bindPopup(alertPopup(props, icon));
        alertsLayer.addLayer(poly);
      } else if (feature.geometry && feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(polyCoords => {
          const coords = polyCoords[0].map(c => [c[1], c[0]]);
          const poly = L.polygon(coords, {
            color: style.stroke, fillColor: style.fill,
            fillOpacity: style.opacity, weight: 2, opacity: 0.8
          });
          poly.bindPopup(alertPopup(props, icon));
          alertsLayer.addLayer(poly);
        });
      }
    });

    alertsLayer.addTo(map);
    updateAlertCount();

    // Update ticker
    updateAlertTicker();
  }

  function alertPopup(props, icon) {
    const expires = props.expires ? new Date(props.expires).toLocaleString() : 'Unknown';
    return `
      <div class="alert-popup">
        <div class="alert-popup-header">
          <span class="alert-icon">${icon}</span>
          <strong>${escHtml(props.event)}</strong>
        </div>
        <div class="alert-severity severity-${(props.severity||'unknown').toLowerCase()}">${props.severity || 'Unknown'}</div>
        <div class="alert-area">${escHtml(props.areaDesc || 'Unknown area')}</div>
        <div class="alert-expires">Expires: ${expires}</div>
        ${props.headline ? `<div class="alert-headline">${escHtml(props.headline)}</div>` : ''}
      </div>
    `;
  }

  function updateAlertCount() {
    const el = document.getElementById('alertCount');
    if (el) {
      const count = alertData.length;
      el.textContent = count;
      el.closest('.alert-counter')?.classList.toggle('has-alerts', count > 0);
    }
  }

  function updateAlertTicker() {
    const ticker = document.getElementById('alertTicker');
    const content = document.getElementById('alertTickerContent');
    if (!ticker || !content) return;

    const severe = alertData.filter(f => {
      const s = f.properties?.severity;
      return s === 'Extreme' || s === 'Severe';
    });

    if (severe.length > 0) {
      content.innerHTML = severe.slice(0, 20).map(f => {
        const p = f.properties;
        const icon = EVENT_ICONS[p.event] || '⚠️';
        return `<span>${icon} <strong>${escHtml(p.event)}</strong> — ${escHtml(p.areaDesc || '').substring(0, 80)}</span>`;
      }).join('');
      ticker.classList.add('active');
    } else {
      ticker.classList.remove('active');
    }
  }

  // ─── CAMERA-ALERT CROSS REFERENCE ───

  function pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function getCamerasInAlerts(cameraList) {
    const affected = [];
    const seen = new Set();
    alertData.forEach(feature => {
      if (!feature.geometry) return;
      const props = feature.properties;
      const style = getSeverityStyle(props.severity);
      const polygons = [];
      if (feature.geometry.type === 'Polygon') {
        polygons.push(feature.geometry.coordinates[0].map(c => [c[1], c[0]]));
      } else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(poly => {
          polygons.push(poly[0].map(c => [c[1], c[0]]));
        });
      }
      polygons.forEach(poly => {
        cameraList.forEach(cam => {
          if (seen.has(cam.i)) return;
          if (pointInPolygon([cam.la, cam.ln], poly)) {
            seen.add(cam.i);
            affected.push({
              camera: cam, alert: props, priority: style.priority,
              icon: EVENT_ICONS[props.event] || '⚠️'
            });
          }
        });
      });
    });
    affected.sort((a, b) => b.priority - a.priority);
    return affected;
  }

  function renderLiveNow(cameraList) {
    cameras = cameraList;
    const grid = document.getElementById('featuredGrid');
    const header = grid?.closest('.section')?.querySelector('.section-header');
    if (!grid) return;
    const affected = getCamerasInAlerts(cameraList);
    if (affected.length > 0) {
      if (header) {
        const titleEl = header.querySelector('.section-title');
        if (titleEl) titleEl.innerHTML = `<span class="dot dot-red"></span> LIVE NOW — Cameras in Active Warnings`;
      }
      grid.innerHTML = affected.slice(0, 12).map(item => alertCameraCard(item)).join('');
    } else {
      if (header) {
        const titleEl = header.querySelector('.section-title');
        if (titleEl) titleEl.innerHTML = `<span class="dot"></span> LIVE NOW — Featured Cameras`;
      }
      const skyline = cameraList.filter(c => c.ca === 'skyline');
      const featured = [...skyline.slice(0, 6)];
      if (featured.length < 6) {
        const traffic = cameraList.filter(c => c.ca === 'traffic').sort(() => 0.5 - Math.random());
        featured.push(...traffic.slice(0, 6 - featured.length));
      }
      grid.innerHTML = featured.map(c => cameraCard(c)).join('');
    }
  }

  function alertCameraCard(item) {
    const c = item.camera;
    const a = item.alert;
    const sevClass = (a.severity || 'unknown').toLowerCase();
    return `
      <a href="camera.html?id=${encodeURIComponent(c.i)}" class="camera-card alert-card alert-card-${sevClass}">
        <div class="camera-card-thumb">
          <span class="placeholder">📷</span>
          <span class="camera-card-alert-badge severity-bg-${sevClass}">
            ${item.icon} ${escHtml(a.event)}
          </span>
        </div>
        <div class="camera-card-body">
          <div class="camera-card-name">${escHtml(c.n.substring(0, 50))}${c.n.length > 50 ? '…' : ''}</div>
          <div class="camera-card-loc">📍 ${escHtml(c.c)}, ${c.s}</div>
          <div class="camera-card-alert-info">
            <span class="severity-pill severity-${sevClass}">${a.severity}</span>
          </div>
        </div>
      </a>
    `;
  }

  // ─── RAINVIEWER ANIMATED RADAR ───

  async function fetchRadarData() {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (!res.ok) throw new Error('RainViewer API error');
      radarData = await res.json();
      return radarData;
    } catch (err) {
      console.warn('RainViewer fetch failed:', err);
      return null;
    }
  }

  async function addRadarLayer(leafletMap) {
    map = leafletMap;
    await fetchRadarData();
    if (!radarData) return;

    // Pre-create tile layers for last 10 frames
    const frames = radarData.radar?.past || [];
    const nowcast = radarData.radar?.nowcast || [];
    const allFrames = [...frames.slice(-10)];

    radarLayers = allFrames.map(frame => {
      const layer = L.tileLayer(
        `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/4/1_1.png`,
        {
          opacity: 0,
          zIndex: 500,
          maxZoom: 18,
          tileSize: 256,
          attribution: 'RainViewer.com'
        }
      );
      layer._radarTime = frame.time;
      return layer;
    });
  }

  function toggleRadar(show) {
    if (!map) return;
    radarVisible = show;

    const legend = document.querySelector('.radar-legend');
    const timestamp = document.querySelector('.radar-timestamp');

    if (show) {
      if (radarLayers.length === 0) {
        // Layers not ready yet, try again
        addRadarLayer(map).then(() => {
          if (radarVisible) startRadarAnimation();
        });
        return;
      }
      startRadarAnimation();
      if (legend) legend.classList.add('active');
      if (timestamp) timestamp.classList.add('active');
    } else {
      stopRadarAnimation();
      radarLayers.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
      if (legend) legend.classList.remove('active');
      if (timestamp) timestamp.classList.remove('active');
    }
  }

  function startRadarAnimation() {
    if (radarLayers.length === 0) return;
    stopRadarAnimation();

    // Add all layers but set opacity to 0
    radarLayers.forEach(l => {
      l.setOpacity(0);
      l.addTo(map);
    });

    currentRadarFrame = 0;
    showRadarFrame(0);

    radarAnimInterval = setInterval(() => {
      currentRadarFrame = (currentRadarFrame + 1) % radarLayers.length;
      showRadarFrame(currentRadarFrame);
    }, 700);
  }

  function showRadarFrame(idx) {
    radarLayers.forEach((l, i) => {
      l.setOpacity(i === idx ? 0.75 : 0);
    });

    // Update timestamp display
    const ts = document.getElementById('radarTime');
    if (ts && radarLayers[idx]?._radarTime) {
      const d = new Date(radarLayers[idx]._radarTime * 1000);
      ts.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  function stopRadarAnimation() {
    if (radarAnimInterval) {
      clearInterval(radarAnimInterval);
      radarAnimInterval = null;
    }
  }

  async function refreshRadar() {
    if (!radarVisible || !map) return;
    stopRadarAnimation();
    radarLayers.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    radarLayers = [];
    await fetchRadarData();
    if (!radarData) return;

    const frames = radarData.radar?.past || [];
    radarLayers = frames.slice(-10).map(frame => {
      const layer = L.tileLayer(
        `https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/4/1_1.png`,
        { opacity: 0, zIndex: 500, maxZoom: 18, tileSize: 256 }
      );
      layer._radarTime = frame.time;
      return layer;
    });

    if (radarVisible) startRadarAnimation();
  }

  // ─── WEATHER CONDITIONS (camera page) ───

  async function fetchConditions(lat, lng) {
    try {
      const pointRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!pointRes.ok) return null;
      const pointData = await pointRes.json();
      const stationsUrl = pointData.properties?.observationStations;
      if (!stationsUrl) return null;
      const stationsRes = await fetch(stationsUrl, {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!stationsRes.ok) return null;
      const stationsData = await stationsRes.json();
      const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
      if (!stationId) return null;
      const obsRes = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!obsRes.ok) return null;
      const obsData = await obsRes.json();
      return obsData.properties;
    } catch (err) {
      console.warn('Weather conditions fetch failed:', err);
      return null;
    }
  }

  function renderConditions(conditions, container) {
    if (!conditions || !container) return;
    const tempC = conditions.temperature?.value;
    const tempF = tempC != null ? Math.round(tempC * 9/5 + 32) : null;
    const humidity = conditions.relativeHumidity?.value;
    const windSpeedKmh = conditions.windSpeed?.value;
    const windSpeedMph = windSpeedKmh != null ? Math.round(windSpeedKmh * 0.621371) : null;
    const windDir = conditions.windDirection?.value;
    const desc = conditions.textDescription || 'Unknown';
    const visibility = conditions.visibility?.value;
    const visMiles = visibility != null ? (visibility / 1609.344).toFixed(1) : null;
    const windDirLabel = windDir != null ? degToCompass(windDir) : '';

    container.innerHTML = `
      <div class="weather-conditions">
        <div class="weather-main">
          <div class="weather-temp">${tempF != null ? tempF + '°F' : '—'}</div>
          <div class="weather-desc">${escHtml(desc)}</div>
        </div>
        <div class="weather-details">
          <div class="weather-detail">
            <span class="weather-detail-label">💧 Humidity</span>
            <span class="weather-detail-value">${humidity != null ? Math.round(humidity) + '%' : '—'}</span>
          </div>
          <div class="weather-detail">
            <span class="weather-detail-label">💨 Wind</span>
            <span class="weather-detail-value">${windSpeedMph != null ? windSpeedMph + ' mph ' + windDirLabel : '—'}</span>
          </div>
          <div class="weather-detail">
            <span class="weather-detail-label">👁️ Visibility</span>
            <span class="weather-detail-value">${visMiles != null ? visMiles + ' mi' : '—'}</span>
          </div>
        </div>
      </div>
    `;
  }

  function degToCompass(deg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  async function fetchAlertsForPoint(lat, lng) {
    try {
      const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`, {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.features || [];
    } catch (err) {
      console.warn('Point alert fetch failed:', err);
      return [];
    }
  }

  function renderPointAlerts(alerts, container) {
    if (!container) return;
    if (!alerts || alerts.length === 0) {
      container.innerHTML = `<div class="no-alerts">✅ No active weather alerts for this area</div>`;
      return;
    }
    container.innerHTML = alerts.map(f => {
      const p = f.properties;
      const icon = EVENT_ICONS[p.event] || '⚠️';
      const expires = p.expires ? new Date(p.expires).toLocaleString() : '';
      return `
        <div class="point-alert severity-border-${(p.severity||'unknown').toLowerCase()}">
          <div class="point-alert-header">
            <span>${icon} <strong>${escHtml(p.event)}</strong></span>
            <span class="severity-pill severity-${(p.severity||'unknown').toLowerCase()}">${p.severity}</span>
          </div>
          ${p.headline ? `<div class="point-alert-headline">${escHtml(p.headline)}</div>` : ''}
          ${expires ? `<div class="point-alert-expires">Expires: ${expires}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // ─── AUTO-REFRESH ───

  function startAutoRefresh(leafletMap, cameraList) {
    map = leafletMap;
    cameras = cameraList;
    alertRefreshTimer = setInterval(async () => {
      await fetchAlerts();
      renderAlerts(map);
      renderLiveNow(cameras);
    }, 60000);
    radarRefreshTimer = setInterval(() => { refreshRadar(); }, 300000);
  }

  function stopAutoRefresh() {
    if (alertRefreshTimer) clearInterval(alertRefreshTimer);
    if (radarRefreshTimer) clearInterval(radarRefreshTimer);
  }

  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  return {
    fetchAlerts, renderAlerts, getCamerasInAlerts, renderLiveNow,
    addRadarLayer, toggleRadar, refreshRadar,
    fetchConditions, renderConditions,
    fetchAlertsForPoint, renderPointAlerts,
    startAutoRefresh, stopAutoRefresh,
    get alertData() { return alertData; },
    get radarLayers() { return radarLayers; }
  };
})();
