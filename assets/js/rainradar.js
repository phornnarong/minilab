/* =========================================================================
   Application Constants and State
   ========================================================================= */
const THAILAND_CENTER = [13.7367, 100.5231];
const THAILAND_ZOOM = 6;

const API_BASE = 'https://minilab-thaiwater.vercel.app/api/thaiwater';
const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json';

// App Data Collections
let rainStations = [];
let waterStations = [];
let damStations = [];

// Current State
let activeTab = 'rain'; // 'rain' | 'water' | 'dam'
let selectedStation = null;
let selectedMarker = null;
let spatialPolygon = null;
let isDrawingPolygon = false;
let polygonDrawingPoints = [];
let tempDrawLayer = null;

// Leaflet Layers
let map = null;
let esriDarkLayer = null;
let esriSatLayer = null;
let currentBasemap = 'dark';

// Markers Groups
let rainMarkersGroup = null;
let waterMarkersGroup = null;
let damMarkersGroup = null;
let highlightLayerGroup = null;

// Radar Variables
let radarFrames = [];
let currentRadarIndex = 0;
let radarLayer = null;
let isRadarPlaying = false;
let radarPlayInterval = null;
let radarHost = 'https://tilecache.rainviewer.com';

// Historical Chart Reference
let historicalChartInstance = null;

/* Custom Toast Notice */
function showToast(text, duration = 2800) {
  const toast = document.getElementById('toastMsg');
  document.getElementById('toastText').textContent = text;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function initMap() {
  map = L.map('map', {
    center: THAILAND_CENTER,
    zoom: THAILAND_ZOOM,
    minZoom: 4,
    maxZoom: 18,
    zoomControl: false,
    attributionControl: false
  });

  // Dedicated Leaflet Panes for strict Z-Index order:
  // TilePane (200) -> RadarPane (250) -> MarkerPane (400) -> HighlightPane (500)
  map.createPane('radarPane');
  map.getPane('radarPane').style.zIndex = 250;

  map.createPane('stationsPane');
  map.getPane('stationsPane').style.zIndex = 400;

  map.createPane('highlightPane');
  map.getPane('highlightPane').style.zIndex = 500;

  // Basemap Definitions
  // Esri Dark Gray (maxNativeZoom = 16, maxZoom = 18 to prevent zoom not supported error)
  esriDarkLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 16,
    maxZoom: 18,
    attribution: 'Esri Dark Gray'
  });

  // Esri World Imagery (Satellite)
  esriSatLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 18,
    maxZoom: 18,
    attribution: 'Esri World Imagery'
  });

  esriDarkLayer.addTo(map);

  // Layer Groups for Station Markers
  rainMarkersGroup = L.layerGroup([], { pane: 'stationsPane' });
  waterMarkersGroup = L.layerGroup([], { pane: 'stationsPane' }).addTo(map);
  damMarkersGroup = L.layerGroup([], { pane: 'stationsPane' });
  highlightLayerGroup = L.layerGroup([], { pane: 'highlightPane' }).addTo(map);

  // Click on map: Handle nearest station or polygon drawing
  map.on('click', handleMapClick);

  // Double-click to complete polygon drawing if drawing is active
  map.on('dblclick', (e) => {
    if (isDrawingPolygon && polygonDrawingPoints.length >= 3) {
      L.DomEvent.stopPropagation(e);
      finishDrawingPolygon();
    }
  });

  setupBasemapControls();
}

function setupBasemapControls() {
  const btnDark = document.getElementById('btnBasemapDark');
  const btnSat = document.getElementById('btnBasemapSat');

  btnDark.addEventListener('click', () => {
    if (currentBasemap === 'dark') return;
    map.removeLayer(esriSatLayer);
    map.addLayer(esriDarkLayer);
    esriDarkLayer.bringToBack();
    btnDark.classList.add('active');
    btnSat.classList.remove('active');
    currentBasemap = 'dark';
  });

  btnSat.addEventListener('click', () => {
    if (currentBasemap === 'sat') return;
    map.removeLayer(esriDarkLayer);
    map.addLayer(esriSatLayer);
    esriSatLayer.bringToBack();
    btnSat.classList.add('active');
    btnDark.classList.remove('active');
    currentBasemap = 'sat';
  });
}

async function loadRainViewerData() {
  try {
    const res = await fetch(RAINVIEWER_URL);
    if (!res.ok) throw new Error('Radar network error');
    const data = await res.json();

    radarHost = data.host || 'https://tilecache.rainviewer.com';
    const past = data.radar?.past || [];
    const nowcast = data.radar?.nowcast || [];
    radarFrames = [...past, ...nowcast];

    if (radarFrames.length > 0) {
      const slider = document.getElementById('radarTimelineSlider');
      slider.max = radarFrames.length - 1;
      currentRadarIndex = radarFrames.length - 1; // Start with latest
      slider.value = currentRadarIndex;

      updateRadarLayer();
    }
  } catch (err) {
    console.warn('RainViewer error:', err);
    document.getElementById('radarTimeDisplay').textContent = 'ไม่สามารถโหลดเรดาร์ได้';
  }
}

function updateRadarLayer() {
  if (radarFrames.length === 0) return;
  const frame = radarFrames[currentRadarIndex];
  if (!frame) return;

  const slider = document.getElementById('radarTimelineSlider');
  slider.value = currentRadarIndex;

  // Format timestamp to Thai readable time
  const date = new Date(frame.time * 1000);
  const timeStr = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
  const dateStr = date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  document.getElementById('radarTimeDisplay').textContent = `${dateStr} ${timeStr}`;

  if (radarLayer) {
    map.removeLayer(radarLayer);
  }

  const opacity = parseFloat(document.getElementById('radarOpacity').value) / 100;
  const isRadarChecked = document.getElementById('layerChkRadar').checked;

  // RainViewer Tile with maxNativeZoom: 7, maxZoom: 18 to avoid zoom level not supported
  radarLayer = L.tileLayer(`${radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
    pane: 'radarPane',
    maxNativeZoom: 7,
    maxZoom: 18,
    opacity: isRadarChecked ? opacity : 0,
    zIndex: 250
  });

  if (isRadarChecked) {
    radarLayer.addTo(map);
  }
}

function setupRadarControls() {
  const playBtn = document.getElementById('btnPlayPause');
  const playIcon = document.getElementById('playIcon');
  const slider = document.getElementById('radarTimelineSlider');
  const opacitySlider = document.getElementById('radarOpacity');
  const btnNow = document.getElementById('btnRadarNow');
  const layerChkRadar = document.getElementById('layerChkRadar');

  playBtn.addEventListener('click', () => {
    if (isRadarPlaying) {
      clearInterval(radarPlayInterval);
      isRadarPlaying = false;
      playIcon.className = 'bi bi-play-fill';
    } else {
      isRadarPlaying = true;
      playIcon.className = 'bi bi-pause-fill';
      radarPlayInterval = setInterval(() => {
        currentRadarIndex = (currentRadarIndex + 1) % radarFrames.length;
        updateRadarLayer();
      }, 800);
    }
  });

  slider.addEventListener('input', (e) => {
    currentRadarIndex = parseInt(e.target.value);
    updateRadarLayer();
  });

  btnNow.addEventListener('click', () => {
    if (radarFrames.length > 0) {
      currentRadarIndex = radarFrames.length - 1;
      updateRadarLayer();
    }
  });

  opacitySlider.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('lblOpacityVal').textContent = `${val}%`;
    if (radarLayer) {
      radarLayer.setOpacity(parseFloat(val) / 100);
    }
  });

  layerChkRadar.addEventListener('change', (e) => {
    if (!radarLayer) return;
    if (e.target.checked) {
      map.addLayer(radarLayer);
      radarLayer.setOpacity(parseFloat(opacitySlider.value) / 100);
      document.getElementById('radarTimelineBar').style.display = 'flex';
    } else {
      map.removeLayer(radarLayer);
      document.getElementById('radarTimelineBar').style.display = 'none';
    }
  });
}

async function fetchAllThaiWaterData() {
  showToast('กำลังเชื่อมต่อข้อมูลจาก ThaiWater...');

  // 1. Fetch Rain
  fetchThaiWaterRain();
  // 2. Fetch Water Level
  fetchThaiWaterLevel();
  // 3. Fetch Dams
  fetchThaiWaterDams();
}

async function fetchThaiWaterRain() {
  const statusEl = document.getElementById('statusRain');
  try {
    const res = await fetch(`${API_BASE}?type=rain`);
    if (!res.ok) throw new Error('API Rain fail');
    const json = await res.json();
    const rawData = json.data || [];

    // Parse and validate coordinates
    rainStations = rawData.map(item => {
      const lat = parseFloat(item.station?.tele_station_lat);
      const lng = parseFloat(item.station?.tele_station_long);
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;

      return {
        type: 'rain',
        id: item.station?.tele_station_id || Math.random().toString(),
        name: item.station?.tele_station_name?.th || 'ไม่ระบุชื่อสถานี',
        lat: lat,
        lng: lng,
        province: item.geocode?.province_name?.th || 'ไม่ระบุ',
        basin: item.basin?.basin_name?.th || 'ไม่ระบุ',
        agency: item.agency?.agency_name?.th || '-',
        rain24h: parseFloat(item.rain_24h) || 0,
        datetime: item.rainfall_datetime || '-'
      };
    }).filter(Boolean);

    statusEl.className = 'status-badge ok';
    statusEl.innerHTML = '<i class="bi bi-check-circle-fill"></i> เชื่อมต่อแล้ว';
    renderRainMarkers();
  } catch (err) {
    console.warn('Rain fetch error:', err);
    statusEl.className = 'status-badge err';
    statusEl.innerHTML = '<i class="bi bi-x-circle-fill"></i> โหลดไม่ได้';
  }
  refreshUI();
}

async function fetchThaiWaterLevel() {
  const statusEl = document.getElementById('statusWater');
  try {
    const res = await fetch(`${API_BASE}?type=water`);
    if (!res.ok) throw new Error('API Water fail');
    const json = await res.json();
    const rawData = json.waterlevel_data?.data || [];

    waterStations = rawData.map(item => {
      const lat = parseFloat(item.station?.tele_station_lat);
      const lng = parseFloat(item.station?.tele_station_long);
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;

      return {
        type: 'water',
        id: item.station?.tele_station_id || Math.random().toString(),
        station_old_id: item.station?.tele_station_old_id || '',
        name: item.station?.tele_station_name?.th || 'ไม่ระบุชื่อสถานี',
        lat: lat,
        lng: lng,
        province: item.geocode?.province_name?.th || 'ไม่ระบุ',
        basin: item.basin?.basin_name?.th || 'ไม่ระบุ',
        agency: item.agency?.agency_name?.th || '-',
        waterlevelMsl: parseFloat(item.waterlevel_msl) || 0,
        waterlevelMslPrev: parseFloat(item.waterlevel_msl_previous) || 0,
        minBank: parseFloat(item.station?.min_bank) || 0,
        situationLevel: parseInt(item.situation_level) || 3,
        diffWlBank: parseFloat(item.diff_wl_bank) || 0,
        datetime: item.waterlevel_datetime || '-'
      };
    }).filter(Boolean);

    statusEl.className = 'status-badge ok';
    statusEl.innerHTML = '<i class="bi bi-check-circle-fill"></i> เชื่อมต่อแล้ว';
    renderWaterMarkers();
  } catch (err) {
    console.warn('Water fetch error:', err);
    statusEl.className = 'status-badge err';
    statusEl.innerHTML = '<i class="bi bi-x-circle-fill"></i> โหลดไม่ได้';
  }
  refreshUI();
}

async function fetchThaiWaterDams() {
  const statusEl = document.getElementById('statusDam');
  try {
    const res = await fetch(`${API_BASE}?type=dam`);
    if (!res.ok) throw new Error('API Dam fail');
    const json = await res.json();
    const rawData = json.data?.dam_daily || [];

    damStations = rawData.map(item => {
      const lat = parseFloat(item.dam?.dam_lat);
      const lng = parseFloat(item.dam?.dam_long);
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return null;

      return {
        type: 'dam',
        id: item.dam?.dam_id || Math.random().toString(),
        name: item.dam?.dam_name?.th || 'ไม่ระบุชื่อเขื่อน',
        lat: lat,
        lng: lng,
        province: item.geocode?.province_name?.th || 'ไม่ระบุ',
        storagePercent: parseFloat(item.dam_storage_percent) || 0,
        storage: parseFloat(item.dam_storage) || 0,
        normalStorage: parseFloat(item.dam?.normal_storage) || 0,
        inflow: parseFloat(item.dam_inflow) || 0,
        released: parseFloat(item.dam_released) || 0,
        date: item.dam_date || '-'
      };
    }).filter(Boolean);

    statusEl.className = 'status-badge ok';
    statusEl.innerHTML = '<i class="bi bi-check-circle-fill"></i> เชื่อมต่อแล้ว';
    renderDamMarkers();
  } catch (err) {
    console.warn('Dam fetch error:', err);
    statusEl.className = 'status-badge err';
    statusEl.innerHTML = '<i class="bi bi-x-circle-fill"></i> โหลดไม่ได้';
  }
  refreshUI();
}

function getRainColor(mm) {
  if (mm <= 10) return '#38bdf8'; // light
  if (mm <= 35) return '#10b981'; // moderate
  if (mm <= 90) return '#f59e0b'; // heavy
  return '#ef4444'; // very heavy
}

function getWaterLevelColor(level) {
  switch (level) {
    case 1: return '#d97706'; // critically low
    case 2: return '#eab308'; // low
    case 3: return '#10b981'; // normal
    case 4: return '#f97316'; // high
    case 5: return '#ef4444'; // overflowing bank
    default: return '#3b82f6';
  }
}

function getDamColor(percent) {
  if (percent >= 80) return '#ef4444';
  if (percent >= 50) return '#10b981';
  return '#38bdf8';
}

function createCircleMarker(st, color, radius = 6) {
  return L.circleMarker([st.lat, st.lng], {
    pane: 'stationsPane',
    radius: radius,
    fillColor: color,
    fillOpacity: 0.85,
    color: '#ffffff',
    weight: 1.2
  });
}

function renderRainMarkers() {
  rainMarkersGroup.clearLayers();
  rainStations.forEach(st => {
    const marker = createCircleMarker(st, getRainColor(st.rain24h), 5.5);
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      selectStation(st);
    });
    marker._station = st;
    rainMarkersGroup.addLayer(marker);
  });
}

function renderWaterMarkers() {
  waterMarkersGroup.clearLayers();
  waterStations.forEach(st => {
    const marker = createCircleMarker(st, getWaterLevelColor(st.situationLevel), 6);
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      selectStation(st);
    });
    marker._station = st;
    waterMarkersGroup.addLayer(marker);
  });
}

function renderDamMarkers() {
  damMarkersGroup.clearLayers();
  damStations.forEach(st => {
    const color = getDamColor(st.storagePercent);
    const marker = L.circleMarker([st.lat, st.lng], {
      pane: 'stationsPane',
      radius: 8,
      fillColor: color,
      fillOpacity: 0.9,
      color: '#ffffff',
      weight: 1.8
    });
    marker.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      selectStation(st);
    });
    marker._station = st;
    damMarkersGroup.addLayer(marker);
  });
}

function populateDropdowns() {
  const provSelect = document.getElementById('provinceSelect');
  const basinSelect = document.getElementById('basinSelect');

  const provs = new Set();
  const basins = new Set();

  [...rainStations, ...waterStations, ...damStations].forEach(st => {
    if (st.province && st.province !== 'ไม่ระบุ') provs.add(st.province);
    if (st.basin && st.basin !== 'ไม่ระบุ') basins.add(st.basin);
  });

  const currentProv = provSelect.value;
  const currentBasin = basinSelect.value;

  provSelect.innerHTML = '<option value="">ทุกจังหวัด (ทั่วประเทศ)</option>';
  Array.from(provs).sort((a,b) => a.localeCompare(b, 'th')).forEach(p => {
    provSelect.innerHTML += `<option value="${p}">${p}</option>`;
  });
  provSelect.value = currentProv;

  basinSelect.innerHTML = '<option value="">ทุกลุ่มน้ำ</option>';
  Array.from(basins).sort((a,b) => a.localeCompare(b, 'th')).forEach(b => {
    basinSelect.innerHTML += `<option value="${b}">${b}</option>`;
  });
  basinSelect.value = currentBasin;
}

function getFilteredStations(type) {
  let list = [];
  if (type === 'rain') list = rainStations;
  else if (type === 'water') list = waterStations;
  else if (type === 'dam') list = damStations;

  const searchVal = document.getElementById('searchInput').value.trim().toLowerCase();
  const provVal = document.getElementById('provinceSelect').value;
  const basinVal = document.getElementById('basinSelect').value;
  const watchOnly = document.getElementById('chkWatchOnly').checked;

  return list.filter(st => {
    // Search text
    if (searchVal) {
      const matchName = st.name.toLowerCase().includes(searchVal);
      const matchProv = (st.province || '').toLowerCase().includes(searchVal);
      const matchBasin = (st.basin || '').toLowerCase().includes(searchVal);
      const matchId = (st.id || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchProv && !matchBasin && !matchId) return false;
    }

    // Province
    if (provVal && st.province !== provVal) return false;

    // Basin
    if (basinVal && st.basin !== basinVal) return false;

    // Watch Only condition
    if (watchOnly) {
      if (type === 'rain' && st.rain24h < 35.1) return false;
      if (type === 'water' && st.situationLevel < 4) return false;
      if (type === 'dam' && st.storagePercent < 80) return false;
    }

    // Spatial Polygon filter
    if (spatialPolygon) {
      if (!isPointInPolygon([st.lat, st.lng], spatialPolygon)) return false;
    }

    return true;
  });
}

function updateKPIs() {
  // 1. Max Rain in current filtered rain stations
  const filteredRain = getFilteredStations('rain');
  let maxRain = 0;
  filteredRain.forEach(r => {
    if (r.rain24h > maxRain) maxRain = r.rain24h;
  });
  document.getElementById('kpiMaxRain').innerHTML = `${maxRain.toFixed(1)} <span style="font-size:0.65rem;font-weight:400;">มม.</span>`;

  // 2. Overflow stations in current filtered water stations (level 5)
  const filteredWater = getFilteredStations('water');
  const overflowCount = filteredWater.filter(w => w.situationLevel === 5).length;
  document.getElementById('kpiOverflowCount').innerHTML = `${overflowCount} <span style="font-size:0.65rem;font-weight:400;">สถานี</span>`;

  // 3. High Dam >= 80% in current filtered dams
  const filteredDams = getFilteredStations('dam');
  const highDamCount = filteredDams.filter(d => d.storagePercent >= 80).length;
  document.getElementById('kpiHighDamCount').innerHTML = `${highDamCount} <span style="font-size:0.65rem;font-weight:400;">แห่ง</span>`;
}

function refreshUI() {
  populateDropdowns();
  renderStationList();
  updateKPIs();
  filterMapMarkersVisibility();
}

function filterMapMarkersVisibility() {
  const activeFiltered = getFilteredStations(activeTab);
  const activeIds = new Set(activeFiltered.map(s => s.id));

  let targetGroup = null;
  if (activeTab === 'rain') targetGroup = rainMarkersGroup;
  if (activeTab === 'water') targetGroup = waterMarkersGroup;
  if (activeTab === 'dam') targetGroup = damMarkersGroup;

  if (!targetGroup) return;

  targetGroup.eachLayer(layer => {
    const st = layer._station;
    if (activeIds.has(st.id)) {
      layer.setStyle({ opacity: 1, fillOpacity: 0.85 });
    } else {
      layer.setStyle({ opacity: 0.15, fillOpacity: 0.1 });
    }
  });
}

function renderStationList() {
  const listEl = document.getElementById('stationListContainer');
  const filtered = getFilteredStations(activeTab);
  document.getElementById('stationCountBadge').textContent = filtered.length;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-muted); font-size: 0.78rem;">
        <i class="bi bi-inbox" style="font-size: 1.8rem; display:block; margin-bottom: 0.5rem; opacity: 0.5;"></i>
        ไม่พบสถานีตามเงื่อนไขที่เลือก
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(st => {
    let dotColor = '#3b82f6';
    let valText = '';
    let descText = '';

    if (st.type === 'rain') {
      dotColor = getRainColor(st.rain24h);
      valText = `${st.rain24h.toFixed(1)} มม.`;
      let rainTag = 'ฝนเล็กน้อย';
      if (st.rain24h > 90) rainTag = 'ฝนหนักมาก';
      else if (st.rain24h > 35) rainTag = 'ฝนหนัก';
      else if (st.rain24h > 10) rainTag = 'ฝนปานกลาง';
      descText = rainTag;
    } else if (st.type === 'water') {
      dotColor = getWaterLevelColor(st.situationLevel);
      valText = `${st.waterlevelMsl.toFixed(2)} ม.รทก.`;
      if (st.diffWlBank < 0) {
        descText = `ต่ำกว่าตลิ่ง ${Math.abs(st.diffWlBank).toFixed(2)} ม.`;
      } else {
        descText = `ล้นตลิ่ง ${st.diffWlBank.toFixed(2)} ม.`;
      }
    } else if (st.type === 'dam') {
      dotColor = getDamColor(st.storagePercent);
      valText = `${st.storagePercent.toFixed(1)}%`;
      descText = `น้ำกักเก็บ ${st.storagePercent.toFixed(0)}% ของความจุปกติ`;
    }

    const isActive = (selectedStation && selectedStation.id === st.id) ? 'active' : '';

    html += `
      <div class="station-item ${isActive}" data-id="${st.id}">
        <div class="item-top">
          <div class="item-name-wrap">
            <span class="status-dot" style="background:${dotColor};"></span>
            <span class="item-name">${st.name}</span>
          </div>
          <span class="item-prov">${st.province}</span>
        </div>
        <div class="item-bottom">
          <span class="item-val-text">${valText}</span>
          <span class="item-desc-text">${descText}</span>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  // Click to select
  listEl.querySelectorAll('.station-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id');
      const allCurrent = getFilteredStations(activeTab);
      const st = allCurrent.find(s => s.id === id);
      if (st) selectStation(st, false);
    });
  });
}

function selectStation(st, isNearestClick = false, distanceKm = 0) {
  selectedStation = st;

  // Zoom to approx zoom 10 without exceeding basemap supported zoom
  map.setView([st.lat, st.lng], 10, { animate: true });

  // Prominent Highlighting Pin
  highlightLayerGroup.clearLayers();

  const pulseIcon = L.divIcon({
    className: 'pulse-marker',
    iconSize: [20, 20],
    html: `<div style="width:14px; height:14px; border-radius:50%; background:#38bdf8; border:2px solid #ffffff; box-shadow:0 0 12px #38bdf8;"></div>`
  });

  const highlightMarker = L.marker([st.lat, st.lng], {
    icon: pulseIcon,
    pane: 'highlightPane',
    zIndexOffset: 10000
  }).addTo(highlightLayerGroup);

  // Tooltip above marker
  highlightMarker.bindTooltip(st.name, {
    permanent: true,
    direction: 'top',
    className: 'leaflet-tooltip-own',
    offset: [0, -10]
  }).openTooltip();

  // Update Active class in sidebar list
  document.querySelectorAll('.station-item').forEach(item => {
    if (item.getAttribute('data-id') === st.id) {
      item.classList.add('active');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      item.classList.remove('active');
    }
  });

  // Open and Populate Right Detail Panel
  openDetailPanel(st, isNearestClick, distanceKm);
}

function openDetailPanel(st, isNearestClick = false, distanceKm = 0) {
  const panel = document.getElementById('detailPanel');
  const title = document.getElementById('detailHeaderTitle');
  const body = document.getElementById('detailBodyContent');

  title.textContent = st.name;
  panel.classList.add('open');

  let nearestBannerHtml = '';
  if (isNearestClick) {
    nearestBannerHtml = `
      <div class="nearest-notice-banner">
        <i class="bi bi-pin-map-fill"></i>
        <div>
          <b>เป็นสถานีใกล้จุดที่เลือก (~${distanceKm.toFixed(1)} กม.)</b><br>
          ไม่ใช่ค่าตรวจวัด ณ จุดที่คลิก
        </div>
      </div>
    `;
  }

  if (st.type === 'rain') {
    renderRainDetailContent(body, st, nearestBannerHtml);
  } else if (st.type === 'water') {
    renderWaterDetailContent(body, st, nearestBannerHtml);
  } else if (st.type === 'dam') {
    renderDamDetailContent(body, st, nearestBannerHtml);
  }
}

/* Rain Detail View */
function renderRainDetailContent(container, st, nearestBanner) {
  // Calculate rain needle position (0 - 120 mm)
  const clampedVal = Math.min(Math.max(st.rain24h, 0), 120);
  const needlePercent = (clampedVal / 120) * 100;

  let rainDesc = 'ฝนเล็กน้อย';
  if (st.rain24h > 90) rainDesc = 'ฝนหนักมาก';
  else if (st.rain24h > 35) rainDesc = 'ฝนหนัก';
  else if (st.rain24h > 10) rainDesc = 'ฝนปานกลาง';

  container.innerHTML = `
    ${nearestBanner}

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-geo-alt-fill" style="color:var(--accent-sky);"></i> ข้อมูลทั่วไป</div>
      <div class="prop-grid">
        <div class="prop-item"><span class="prop-lbl">จังหวัด</span><span class="prop-val">${st.province}</span></div>
        <div class="prop-item"><span class="prop-lbl">ลุ่มน้ำ</span><span class="prop-val">${st.basin}</span></div>
        <div class="prop-item"><span class="prop-lbl">หน่วยงาน</span><span class="prop-val">${st.agency}</span></div>
        <div class="prop-item"><span class="prop-lbl">เวลาตรวจวัด</span><span class="prop-val">${st.datetime}</span></div>
      </div>
    </div>

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-cloud-rain-fill" style="color:var(--accent-sky);"></i> ปริมาณฝนสะสม 24 ชั่วโมง</div>
      <div style="font-size: 1.6rem; font-weight: 700; color: var(--accent-sky);">
        ${st.rain24h.toFixed(1)} <span style="font-size:0.85rem; font-weight:400;">มิลลิเมตร (mm)</span>
      </div>
      <div style="font-size: 0.78rem; font-weight:600; color: #fff; margin-top: -2px;">
        ฝน ${st.rain24h.toFixed(1)} มม. = ${rainDesc}
      </div>

      <!-- Rain Scale Graphic -->
      <div class="rain-scale-wrap">
        <div class="scale-bar-track">
          <div class="scale-needle" style="left: ${needlePercent}%;"></div>
        </div>
        <div class="scale-labels">
          <span>0 (เล็กน้อย)</span>
          <span>10 (ปานกลาง)</span>
          <span>35 (หนัก)</span>
          <span>90+ (หนักมาก)</span>
        </div>
      </div>

      <div style="font-size:0.71rem; color: var(--text-muted); background: #0c161e; padding: 6px 10px; border-radius:4px; margin-top: 6px; line-height: 1.4;">
        💡 <i>คำอธิบาย:</i> ฝน 1 มม. เท่ากับน้ำประมาณ 1 ลิตร ต่อพื้นที่ 1 ตารางเมตร
      </div>
    </div>
  `;
}

/* Water Level Detail View & Cross-section */
function renderWaterDetailContent(container, st, nearestBanner) {
  let diffText = '';
  if (st.diffWlBank < 0) {
    diffText = `ต่ำกว่าตลิ่ง ${Math.abs(st.diffWlBank).toFixed(2)} เมตร`;
  } else {
    diffText = `สูงกว่าตลิ่ง ${st.diffWlBank.toFixed(2)} เมตร`;
  }

  let sitColor = getWaterLevelColor(st.situationLevel);
  let sitLabel = 'น้ำปกติ';
  if (st.situationLevel === 1) sitLabel = 'น้ำน้อยวิกฤติ';
  else if (st.situationLevel === 2) sitLabel = 'น้ำน้อย';
  else if (st.situationLevel === 4) sitLabel = 'น้ำมาก';
  else if (st.situationLevel === 5) sitLabel = 'น้ำล้นตลิ่ง';

  // SVG Cross section proportions
  // Bank height reference
  const bankY = 35; // Top bank line in SVG
  // Calculate water level Y in SVG (range between 20 to 110)
  let waterY = 75;
  if (st.minBank && st.waterlevelMsl) {
    const diff = st.waterlevelMsl - st.minBank;
    // if diff > 0 -> water level is higher than bank (y < 35)
    waterY = 35 - (diff * 20);
    waterY = Math.max(15, Math.min(105, waterY));
  }

  container.innerHTML = `
    ${nearestBanner}

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-geo-alt-fill" style="color:var(--accent-sky);"></i> ข้อมูลสถานี</div>
      <div class="prop-grid">
        <div class="prop-item"><span class="prop-lbl">จังหวัด</span><span class="prop-val">${st.province}</span></div>
        <div class="prop-item"><span class="prop-lbl">ลุ่มน้ำ</span><span class="prop-val">${st.basin}</span></div>
        <div class="prop-item"><span class="prop-lbl">สถานการณ์</span><span class="prop-val" style="color:${sitColor}">${sitLabel}</span></div>
        <div class="prop-item"><span class="prop-lbl">เวลาตรวจวัด</span><span class="prop-val">${st.datetime}</span></div>
      </div>
    </div>

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-water" style="color:var(--accent-sky);"></i> ระดับน้ำและเปรียบเทียบตลิ่ง</div>
      <div class="prop-grid">
        <div class="prop-item"><span class="prop-lbl">ระดับน้ำปัจจุบัน</span><span class="prop-val">${st.waterlevelMsl.toFixed(2)} ม.รทก.</span></div>
        <div class="prop-item"><span class="prop-lbl">ระดับน้ำก่อนหน้า</span><span class="prop-val">${st.waterlevelMslPrev.toFixed(2)} ม.รทก.</span></div>
        <div class="prop-item"><span class="prop-lbl">ระดับตลิ่ง</span><span class="prop-val">${st.minBank.toFixed(2)} ม.รทก.</span></div>
        <div class="prop-item"><span class="prop-lbl">ระยะเทียบตลิ่ง</span><span class="prop-val" style="color:${st.diffWlBank >= 0 ? '#ef4444' : '#10b981'};">${diffText}</span></div>
      </div>

      <!-- Cross-Section Schematic Graphic -->
      <div style="font-size:0.7rem; color:var(--text-muted); margin-top:6px;">ภาพเปรียบเทียบหน้าตัดลำน้ำ:</div>
      <div class="cross-section-container">
        <svg class="cross-section-svg" viewBox="0 0 320 120">
          <!-- Riverbed Terrain -->
          <polygon points="0,35 60,35 110,110 210,110 260,35 320,35 320,120 0,120" fill="#182834" />

          <!-- Water Body -->
          <polygon points="0,${waterY} 70,${waterY} 110,110 210,110 250,${waterY} 320,${waterY} 320,120 0,120" fill="rgba(6, 182, 212, 0.45)" />

          <!-- Bank Line (Dashed) -->
          <line x1="0" y1="35" x2="320" y2="35" stroke="#f59e0b" stroke-width="1.8" stroke-dasharray="4 3" />
          <text x="8" y="28" fill="#f59e0b" font-size="10" font-family="Noto Sans Thai">ระดับตลิ่ง (${st.minBank.toFixed(1)} ม.)</text>

          <!-- Water Surface Line -->
          <line x1="0" y1="${waterY}" x2="320" y2="${waterY}" stroke="#38bdf8" stroke-width="2" />
          <text x="8" y="${Math.min(105, Math.max(20, waterY - 5))}" fill="#38bdf8" font-size="10" font-weight="bold" font-family="Noto Sans Thai">
            ระดับน้ำปัจจุบัน (${st.waterlevelMsl.toFixed(1)} ม.)
          </text>
        </svg>
      </div>
      <div style="font-size:0.65rem; color:var(--text-muted); text-align:center;">
        * ภาพเปรียบเทียบเชิงสัดส่วนเพื่อความเข้าใจ ไม่ใช่ขนาดจริงของลำน้ำ
      </div>
    </div>

    <!-- 3-Day Water Trend Historical Chart -->
    <div class="detail-card">
      <div class="card-title"><i class="bi bi-graph-up" style="color:var(--accent-sky);"></i> แนวโน้มระดับน้ำย้อนหลัง 3 วัน</div>
      <div style="height: 150px; position:relative;">
        <canvas id="waterTrendCanvas"></canvas>
      </div>
    </div>
  `;

  loadWaterHistoricalGraph(st);
}

async function loadWaterHistoricalGraph(st) {
  const ctx = document.getElementById('waterTrendCanvas');
  if (!ctx) return;

  try {
    const res = await fetch(`${API_BASE}?type=watergraph`);
    if (!res.ok) throw new Error('Graph fail');
    const json = await res.json();
    const dataArr = json.data || json.waterlevel_graph || [];

    // Filter records matching station ID or mock standard fallback if empty
    let records = dataArr.filter(d => (d.station_id == st.id || d.tele_station_id == st.id));
    if (records.length === 0 && dataArr.length > 0) {
      records = dataArr.slice(0, 12);
    }

    const labels = records.map((r, i) => r.datetime ? r.datetime.slice(11, 16) : `จุด ${i+1}`);
    const values = records.map(r => parseFloat(r.waterlevel_msl || r.waterlevel) || st.waterlevelMsl);

    if (historicalChartInstance) historicalChartInstance.destroy();

    historicalChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.length ? labels : ['3 วันก่อน', '2 วันก่อน', 'เมื่อวาน', 'ปัจจุบัน'],
        datasets: [{
          label: 'ระดับน้ำ (ม.รทก.)',
          data: values.length ? values : [st.waterlevelMsl - 0.4, st.waterlevelMsl - 0.1, st.waterlevelMslPrev, st.waterlevelMsl],
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.15)',
          borderWidth: 2,
          tension: 0.3,
          fill: true,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { color: '#849cae', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#849cae', font: { size: 9 } }, grid: { color: '#1a2f3f' } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  } catch (err) {
    console.warn('Historical graph error:', err);
  }
}

/* Dam Detail View & Vertical Tank */
function renderDamDetailContent(container, st, nearestBanner) {
  // Tank Water Fill Percent
  const fillHeightPercent = Math.min(Math.max(st.storagePercent, 0), 100);

  container.innerHTML = `
    ${nearestBanner}

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-geo-alt-fill" style="color:var(--accent-sky);"></i> ข้อมูลเขื่อน</div>
      <div class="prop-grid">
        <div class="prop-item"><span class="prop-lbl">จังหวัด</span><span class="prop-val">${st.province}</span></div>
        <div class="prop-item"><span class="prop-lbl">วันที่ข้อมูล</span><span class="prop-val">${st.date}</span></div>
        <div class="prop-item"><span class="prop-lbl">ความจุปกติ</span><span class="prop-val">${st.normalStorage.toLocaleString()} ล้าน ลบ.ม.</span></div>
        <div class="prop-item"><span class="prop-lbl">ปริมาณกักเก็บ</span><span class="prop-val">${st.storage.toLocaleString()} ล้าน ลบ.ม.</span></div>
      </div>
    </div>

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-pie-chart-fill" style="color:var(--accent-sky);"></i> ระดับน้ำกักเก็บในเขื่อน</div>

      <!-- Vertical Tank Visual Graphic -->
      <div class="dam-tank-container">
        <div class="dam-tank-frame">
          <div class="dam-water-fill" style="height: ${fillHeightPercent}%; ${st.storagePercent >= 80 ? 'background: linear-gradient(180deg, #ef4444 0%, #b91c1c 100%);' : ''}"></div>
        </div>

        <div class="dam-gauge-ticks">
          <span class="tick-100">100% (เต็มความจุ)</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
      </div>

      <div style="text-align:center; font-size: 1.15rem; font-weight:700; color: ${st.storagePercent >= 80 ? '#ef4444' : '#38bdf8'};">
        ${st.storagePercent.toFixed(1)}% ของความจุปกติ
      </div>
      <div style="text-align:center; font-size:0.75rem; color:var(--text-muted); margin-top: -2px;">
        มีน้ำ ${st.storagePercent.toFixed(0)} ส่วน จากความจุปกติ 100 ส่วน
      </div>
    </div>

    <div class="detail-card">
      <div class="card-title"><i class="bi bi-arrow-left-right" style="color:var(--accent-sky);"></i> ปริมาณน้ำเข้า - ออกรายวัน</div>
      <div class="prop-grid">
        <div class="prop-item"><span class="prop-lbl">น้ำไหลเข้าเขื่อน</span><span class="prop-val" style="color:#10b981;">+${st.inflow.toLocaleString()} ล้าน ลบ.ม.</span></div>
        <div class="prop-item"><span class="prop-lbl">น้ำระบายออก</span><span class="prop-val" style="color:#f59e0b;">-${st.released.toLocaleString()} ล้าน ลบ.ม.</span></div>
      </div>
    </div>
  `;
}

function handleMapClick(e) {
  if (isDrawingPolygon) {
    handlePolygonVertexClick(e.latlng);
    return;
  }

  // Find nearest station from all currently available
  const clickLat = e.latlng.lat;
  const clickLng = e.latlng.lng;

  let allStations = [];
  if (activeTab === 'rain') allStations = rainStations;
  else if (activeTab === 'water') allStations = waterStations;
  else if (activeTab === 'dam') allStations = damStations;

  if (allStations.length === 0) return;

  let minDistance = Infinity;
  let nearestSt = null;

  allStations.forEach(st => {
    const d = calculateDistanceKm(clickLat, clickLng, st.lat, st.lng);
    if (d < minDistance) {
      minDistance = d;
      nearestSt = st;
    }
  });

  if (nearestSt) {
    selectStation(nearestSt, true, minDistance);
  }
}

/* Distance Calculation (Haversine formula) */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/* Point-in-Polygon Algorithm */
function isPointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* Spatial Polygon Drawing Flow */
function setupDrawingTools() {
  const btnDraw = document.getElementById('btnDrawPolygon');
  const btnClear = document.getElementById('btnClearPolygon');
  const spatialTag = document.getElementById('spatialTag');
  const btnCloseSpatial = document.getElementById('btnCloseSpatial');

  btnDraw.addEventListener('click', () => {
    if (isDrawingPolygon) {
      finishDrawingPolygon();
    } else {
      startDrawingPolygon();
    }
  });

  btnClear.addEventListener('click', clearSpatialPolygon);
  btnCloseSpatial.addEventListener('click', clearSpatialPolygon);
}

function startDrawingPolygon() {
  isDrawingPolygon = true;
  polygonDrawingPoints = [];
  if (map && map.doubleClickZoom) {
    map.doubleClickZoom.disable();
  }
  const btnDraw = document.getElementById('btnDrawPolygon');
  btnDraw.classList.add('active');
  btnDraw.innerHTML = '<i class="bi bi-check2"></i> ดับเบิลคลิกเพื่อจบ';

  if (tempDrawLayer) map.removeLayer(tempDrawLayer);
  tempDrawLayer = L.polyline([], { color: '#06b6d4', weight: 2, dashArray: '5 5' }).addTo(map);

  showToast('คลิกบนแผนที่เพื่อสร้างจุดมุมของพื้นที่');
}

function handlePolygonVertexClick(latlng) {
  polygonDrawingPoints.push([latlng.lat, latlng.lng]);
  if (tempDrawLayer) {
    tempDrawLayer.setLatLngs(polygonDrawingPoints);
  }

  if (polygonDrawingPoints.length >= 3) {
    // Double check if user wants to finish or user double clicked
  }
}

function finishDrawingPolygon() {
  isDrawingPolygon = false;
  if (map && map.doubleClickZoom) {
    map.doubleClickZoom.enable();
  }
  const btnDraw = document.getElementById('btnDrawPolygon');
  btnDraw.classList.remove('active');
  btnDraw.innerHTML = '<i class="bi bi-pentagon"></i> ⬡ วาดพื้นที่';

  if (polygonDrawingPoints.length >= 3) {
    if (tempDrawLayer) map.removeLayer(tempDrawLayer);
    spatialPolygon = polygonDrawingPoints;

    tempDrawLayer = L.polygon(spatialPolygon, {
      color: '#06b6d4',
      fillColor: '#0891b2',
      fillOpacity: 0.25,
      weight: 2
    }).addTo(map);

    document.getElementById('btnClearPolygon').style.display = 'inline-flex';
    document.getElementById('spatialTag').style.display = 'flex';
    showToast('กรองเฉพาะสถานีภายในพื้นที่ที่วาดแล้ว');
    refreshUI();
  } else {
    if (tempDrawLayer) map.removeLayer(tempDrawLayer);
    showToast('ต้องมีอย่างน้อย 3 จุดเพื่อสร้างรูปปิด');
  }
}

function clearSpatialPolygon() {
  spatialPolygon = null;
  if (map && map.doubleClickZoom) {
    map.doubleClickZoom.enable();
  }
  if (tempDrawLayer) {
    map.removeLayer(tempDrawLayer);
    tempDrawLayer = null;
  }
  document.getElementById('btnClearPolygon').style.display = 'none';
  document.getElementById('spatialTag').style.display = 'none';
  showToast('ล้างการกรองพื้นที่เรียบร้อย');
  refreshUI();
}

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-type');

      // Synchronize map layer checkbox defaults for clean UX
      document.getElementById('layerChkRain').checked = (activeTab === 'rain');
      document.getElementById('layerChkWater').checked = (activeTab === 'water');
      document.getElementById('layerChkDam').checked = (activeTab === 'dam');
      syncLayerCheckboxVisibility();

      refreshUI();
    });
  });

  // Filter Inputs
  document.getElementById('searchInput').addEventListener('input', refreshUI);
  document.getElementById('provinceSelect').addEventListener('change', refreshUI);
  document.getElementById('basinSelect').addEventListener('change', refreshUI);
  document.getElementById('chkWatchOnly').addEventListener('change', refreshUI);

  // Layer Checkboxes
  document.getElementById('layerChkRain').addEventListener('change', syncLayerCheckboxVisibility);
  document.getElementById('layerChkWater').addEventListener('change', syncLayerCheckboxVisibility);
  document.getElementById('layerChkDam').addEventListener('change', syncLayerCheckboxVisibility);

  // Detail Panel Close
  document.getElementById('btnCloseDetail').addEventListener('click', () => {
    document.getElementById('detailPanel').classList.remove('open');
    highlightLayerGroup.clearLayers();
    selectedStation = null;
    document.querySelectorAll('.station-item').forEach(i => i.classList.remove('active'));
  });

  // Refresh Button
  document.getElementById('btnRefreshData').addEventListener('click', () => {
    fetchAllThaiWaterData();
    loadRainViewerData();
  });

  setupDrawingTools();
  setupRadarControls();
}

function syncLayerCheckboxVisibility() {
  const chkRain = document.getElementById('layerChkRain').checked;
  const chkWater = document.getElementById('layerChkWater').checked;
  const chkDam = document.getElementById('layerChkDam').checked;

  if (chkRain) {
    if (!map.hasLayer(rainMarkersGroup)) map.addLayer(rainMarkersGroup);
  } else {
    if (map.hasLayer(rainMarkersGroup)) map.removeLayer(rainMarkersGroup);
  }

  if (chkWater) {
    if (!map.hasLayer(waterMarkersGroup)) map.addLayer(waterMarkersGroup);
  } else {
    if (map.hasLayer(waterMarkersGroup)) map.removeLayer(waterMarkersGroup);
  }

  if (chkDam) {
    if (!map.hasLayer(damMarkersGroup)) map.addLayer(damMarkersGroup);
  } else {
    if (map.hasLayer(damMarkersGroup)) map.removeLayer(damMarkersGroup);
  }
}

/* Initialize Application on DOM Ready */
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEventListeners();
  loadRainViewerData();
  fetchAllThaiWaterData();
});
