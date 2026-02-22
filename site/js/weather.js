/* StormWatch — Weather Integration (Phase 3)
   NWS Alerts, NEXRAD Radar, Camera-Alert Cross-referencing */

const Weather = (() => {
  // NWS Alert severity → color mapping
  const SEVERITY_COLORS = {
    Extreme:  { fill: '#dc2626', stroke: '#ef4444', opacity: 0.35, priority: 4 },
    Severe:   { fill: '#f97316', stroke: '#fb923c', opacity: 0.30, priority: 3 },
    Moderate: { fill: '#eab308', stroke: '#facc15', opacity: 0.25, priority: 2 },
    Minor:    { fill: '#3b82f6', stroke: '#60a5fa', opacity: 0.20, priority: 1 },
    Unknown:  { fill: '#6b7280', stroke: '#9ca3af', opacity: 0.15, priority: 0 }
  };

  // NWS event type → short label & icon
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
  let radarLayer = null;
  let alertData = [];
  let alertRefreshTimer = null;
  let radarRefreshTimer = null;
  let map = null;
  let cameras = [];

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
      return alertData; // return cached
    }
  }

  function getSeverityStyle(severity) {
    return SEVERITY_COLORS[severity] || SEVERITY_COLORS.Unknown;
  }

  function renderAlerts(leafletMap) {
    map = leafletMap;
    if (alertsLayer) {
      map.removeLayer(alertsLayer);
    }
    alertsLayer = L.layerGroup();

    alertData.forEach(feature => {
      const props = feature.properties;
      const style = getSeverityStyle(props.severity);
      const icon = EVENT_ICONS[props.event] || '⚠️';

      if (feature.geometry && feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0].map(c => [c[1], c[0]]);
        const poly = L.polygon(coords, {
          color: style.stroke,
          fillColor: style.fill,
          fillOpacity: style.opacity,
          weight: 2,
          opacity: 0.8
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

  // ─── CAMERA-ALERT CROSS REFERENCE ───

  function pointInPolygon(point, polygon) {
    // Ray casting algorithm
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
              camera: cam,
              alert: props,
              priority: style.priority,
              icon: EVENT_ICONS[props.event] || '⚠️'
            });
          }
        });
      });
    });

    // Sort by severity (highest first)
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
      // Update header
      if (header) {
        const titleEl = header.querySelector('.section-title');
        if (titleEl) {
          titleEl.innerHTML = `<span class="dot dot-red"></span> LIVE NOW — Cameras in Active Warnings`;
        }
      }

      grid.innerHTML = affected.slice(0, 12).map(item => alertCameraCard(item)).join('');
    } else {
      // Fall back to featured cameras
      if (header) {
        const titleEl = header.querySelector('.section-title');
        if (titleEl) {
          titleEl.innerHTML = `<span class="dot"></span> LIVE NOW — Featured Cameras`;
        }
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

  // ─── NEXRAD RADAR OVERLAY ───

  function addRadarLayer(leafletMap) {
    map = leafletMap;
    radarLayer = L.tileLayer.wms('https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r.cgi', {
      layers: 'nexrad-n0r-900913',
      format: 'image/png',
      transparent: true,
      opacity: 0.6,
      attribution: 'NOAA NEXRAD via Iowa State Mesonet',
      zIndex: 500
    });
    return radarLayer;
  }

  function toggleRadar(show) {
    if (!map || !radarLayer) return;
    if (show) {
      radarLayer.addTo(map);
    } else {
      map.removeLayer(radarLayer);
    }
  }

  function refreshRadar() {
    if (radarLayer && map.hasLayer(radarLayer)) {
      radarLayer.setParams({ _t: Date.now() }, false);
    }
  }

  // ─── WEATHER CONDITIONS (for camera page) ───

  async function fetchConditions(lat, lng) {
    try {
      // Step 1: Get the forecast office/gridpoint
      const pointRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`, {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!pointRes.ok) return null;
      const pointData = await pointRes.json();

      // Step 2: Get the observation stations
      const stationsUrl = pointData.properties?.observationStations;
      if (!stationsUrl) return null;

      const stationsRes = await fetch(stationsUrl, {
        headers: { 'User-Agent': 'StormWatch (stormwatch-app, contact@stormwatch.app)' }
      });
      if (!stationsRes.ok) return null;
      const stationsData = await stationsRes.json();

      // Step 3: Get latest observation from first station
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

  // ─── ALERTS FOR SPECIFIC LOCATION (camera page) ───

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
      const style = getSeverityStyle(p.severity);
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

  // ─── AUTO-REFRESH TIMERS ───

  function startAutoRefresh(leafletMap, cameraList) {
    map = leafletMap;
    cameras = cameraList;

    // Alerts: every 60s
    alertRefreshTimer = setInterval(async () => {
      await fetchAlerts();
      renderAlerts(map);
      renderLiveNow(cameras);
    }, 60000);

    // Radar: every 5min
    radarRefreshTimer = setInterval(() => {
      refreshRadar();
    }, 300000);
  }

  function stopAutoRefresh() {
    if (alertRefreshTimer) clearInterval(alertRefreshTimer);
    if (radarRefreshTimer) clearInterval(radarRefreshTimer);
  }

  // ─── UTILITY ───
  function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ─── PUBLIC API ───
  return {
    fetchAlerts,
    renderAlerts,
    getCamerasInAlerts,
    renderLiveNow,
    addRadarLayer,
    toggleRadar,
    refreshRadar,
    fetchConditions,
    renderConditions,
    fetchAlertsForPoint,
    renderPointAlerts,
    startAutoRefresh,
    stopAutoRefresh,
    get alertData() { return alertData; },
    get radarLayer() { return radarLayer; }
  };
})();
