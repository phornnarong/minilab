/* ==========================================================================
   Global State & Config
   ========================================================================== */
// const GEOJSON_URL = 'https://demofile-lake.vercel.app/rice_fields.geojson';
// const EXCEL_URL = 'https://demofile-lake.vercel.app/rice_monitoring.xlsx';
const GEOJSON_URL = 'spdata/rice_fields.geojson';
const EXCEL_URL = 'spdata/rice_monitoring.xlsx';

let rawGeojsonData = null;
let rawMonitoringRows = [];
let fieldHistoryMap = new Map(); // field_id -> Array of monthly records sorted
let mergedFieldMap = new Map();  // field_id -> { geojsonFeature, latestRecord, allRecords }
let filteredFields = [];         // Array of merged items
let selectedFieldId = null;

let map = null;
let geojsonLayer = null;
let basemapLayers = {};
let activeBasemap = null;

// Chart.js instances
let chartRiskDoughnutInstance = null;
let chartTrendLineInstance = null;
let chartProvinceBarInstance = null;
let chartScatterInstance = null;
let modalChartInstance = null;

/* ==========================================================================
   Colors and Helpers
   ========================================================================== */
const RISK_COLORS = {
  'Low': '#10b981',
  'Medium': '#f59e0b',
  'High': '#ef4444',
  'default': '#64748b'
};

function getRiskColor(level) {
  return RISK_COLORS[level] || RISK_COLORS['default'];
}

function formatNumber(num, decimals = 0) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return Number(num).toLocaleString('th-TH', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/* ==========================================================================
   Initialization
   ========================================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setupEventListeners();
  await loadData();
});

/* ==========================================================================
   Map Setup with Leaflet & Esri
   ========================================================================== */
function initMap() {
  // Initialize map centered roughly around Central Thailand
  map = L.map('map', {
    center: [15.2, 100.5],
    zoom: 7,
    zoomControl: false
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Basemap layers definition
  basemapLayers['imagery'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri World Imagery'
  });
  basemapLayers['dark'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri Dark Gray'
  });
  basemapLayers['topo'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri Topo'
  });
  basemapLayers['osm'] = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: 'OpenStreetMap'
  });

  activeBasemap = basemapLayers['imagery'];
  activeBasemap.addTo(map);

  document.getElementById('basemapSelect').addEventListener('change', (e) => {
    const val = e.target.value;
    if (activeBasemap) map.removeLayer(activeBasemap);
    activeBasemap = basemapLayers[val] || basemapLayers['imagery'];
    activeBasemap.addTo(map);
  });
}

/* ==========================================================================
   Data Loading and Merging
   ========================================================================== */
async function loadData() {
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  loadingOverlay.style.display = 'flex';

  try {
    // Fetch GeoJSON and Excel concurrently
    loadingText.innerText = 'กำลังดาวน์โหลด GeoJSON และ Excel...';
    const [geoRes, excelRes] = await Promise.all([
      fetch(GEOJSON_URL).catch(() => null),
      fetch(EXCEL_URL).catch(() => null)
    ]);

    if (!geoRes || !geoRes.ok || !excelRes || !excelRes.ok) {
      throw new Error('ไม่สามารถดาวน์โหลดไฟล์จากเซิร์ฟเวอร์หลักได้');
    }

    rawGeojsonData = await geoRes.json();
    const arrayBuffer = await excelRes.arrayBuffer();
    parseExcelBuffer(arrayBuffer);

    processMergedData();
    loadingOverlay.style.display = 'none';
  } catch (err) {
    console.warn('Load data error:', err);
    loadingText.innerHTML = `
      <div style="color:#f87171; text-align:center; padding:10px;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:1.8rem; margin-bottom:8px;"></i><br>
        ดาวน์โหลดข้อมูลอัตโนมัติไม่สำเร็จ (อาจติด CORS หรือเครือข่าย)<br>
        <span style="font-size:0.8rem; color:#cbd5e1;">กรุณากดปุ่มด้านล่างเพื่อเลือกไฟล์สำรองในเครื่อง (GeoJSON & Excel)</span>
      </div>
      <button id="btnTriggerUpload" style="background:#10b981; border:none; padding:8px 16px; border-radius:6px; color:#fff; cursor:pointer; font-weight:600;">
        <i class="fa-solid fa-upload"></i> อัปโหลดไฟล์สำรอง
      </button>
    `;
    document.getElementById('btnUploadBackup').style.display = 'inline-flex';
    document.getElementById('btnTriggerUpload').addEventListener('click', promptFallbackUpload);
  }
}

function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  rawMonitoringRows = XLSX.utils.sheet_to_json(worksheet);
}

function processMergedData() {
  fieldHistoryMap.clear();
  mergedFieldMap.clear();

  // Normalize & Group monitoring rows by field_id
  rawMonitoringRows.forEach(row => {
    const fid = String(row.field_id || '').trim();
    if (!fid) return;
    if (!fieldHistoryMap.has(fid)) {
      fieldHistoryMap.set(fid, []);
    }
    fieldHistoryMap.get(fid).push(row);
  });

  // Sort history records chronologically per field
  fieldHistoryMap.forEach((records, fid) => {
    records.sort((a, b) => {
      const mA = String(a.month || '');
      const mB = String(b.month || '');
      return mA.localeCompare(mB);
    });
  });

  // Merge with GeoJSON
  if (rawGeojsonData && rawGeojsonData.features) {
    rawGeojsonData.features.forEach(feat => {
      const fid = String(feat.properties.field_id || '').trim();
      const history = fieldHistoryMap.get(fid) || [];
      const latest = history.length > 0 ? history[history.length - 1] : {};

      mergedFieldMap.set(fid, {
        field_id: fid,
        feature: feat,
        properties: feat.properties,
        latest: latest,
        history: history
      });
    });
  }

  populateFilterDropdowns();
  applyFilters();
}

/* Fallback Manual File Upload Handlers */
function promptFallbackUpload() {
  const geoInput = document.getElementById('fallbackGeoJsonInput');
  const excelInput = document.getElementById('fallbackExcelInput');

  geoInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => {
      rawGeojsonData = JSON.parse(re.target.result);
      checkFallbackComplete();
    };
    reader.readAsText(file);
  };

  excelInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => {
      parseExcelBuffer(re.target.result);
      checkFallbackComplete();
    };
    reader.readAsArrayBuffer(file);
  };

  alert('กรุณาเลือกไฟล์ GeoJSON (.geojson) ก่อน แล้วเลือกไฟล์ Excel (.xlsx)');
  geoInput.click();
  setTimeout(() => excelInput.click(), 1000);
}

function checkFallbackComplete() {
  if (rawGeojsonData && rawMonitoringRows.length > 0) {
    document.getElementById('loadingOverlay').style.display = 'none';
    processMergedData();
  }
}

/* ==========================================================================
   Filter Setup & Cascade
   ========================================================================== */
function populateFilterDropdowns() {
  const provinceSelect = document.getElementById('provinceFilter');
  const cropSelect = document.getElementById('cropFilter');

  const provinces = new Set();
  const crops = new Set();

  mergedFieldMap.forEach(item => {
    if (item.properties.province) provinces.add(item.properties.province);
    if (item.properties.crop_type) crops.add(item.properties.crop_type);
  });

  // Sort alphabetically Thai
  const sortedProvinces = Array.from(provinces).sort((a, b) => a.localeCompare(b, 'th'));
  provinceSelect.innerHTML = '<option value="">ทั้งหมด</option>';
  sortedProvinces.forEach(p => {
    provinceSelect.innerHTML += `<option value="${p}">${p}</option>`;
  });

  const sortedCrops = Array.from(crops).sort((a, b) => a.localeCompare(b, 'th'));
  cropSelect.innerHTML = '<option value="">ทั้งหมด</option>';
  sortedCrops.forEach(c => {
    cropSelect.innerHTML += `<option value="${c}">${c}</option>`;
  });

  updateDistrictDropdown();
}

function updateDistrictDropdown() {
  const provinceVal = document.getElementById('provinceFilter').value;
  const districtSelect = document.getElementById('districtFilter');
  const districts = new Set();

  mergedFieldMap.forEach(item => {
    if (!provinceVal || item.properties.province === provinceVal) {
      if (item.properties.district) districts.add(item.properties.district);
    }
  });

  const sortedDistricts = Array.from(districts).sort((a, b) => a.localeCompare(b, 'th'));
  districtSelect.innerHTML = '<option value="">ทั้งหมด</option>';
  sortedDistricts.forEach(d => {
    districtSelect.innerHTML += `<option value="${d}">${d}</option>`;
  });
}

function setupEventListeners() {
  const searchInput = document.getElementById('searchInput');
  const provinceFilter = document.getElementById('provinceFilter');
  const districtFilter = document.getElementById('districtFilter');
  const riskFilter = document.getElementById('riskFilter');
  const cropFilter = document.getElementById('cropFilter');
  const btnClear = document.getElementById('btnClearFilter');

  // Realtime search
  searchInput.addEventListener('input', () => applyFilters());

  // Cascade District when province changes
  provinceFilter.addEventListener('change', () => {
    updateDistrictDropdown();
    applyFilters();
  });

  districtFilter.addEventListener('change', () => applyFilters());
  riskFilter.addEventListener('change', () => applyFilters());
  cropFilter.addEventListener('change', () => applyFilters());

  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    provinceFilter.value = '';
    updateDistrictDropdown();
    districtFilter.value = '';
    riskFilter.value = '';
    cropFilter.value = '';
    selectedFieldId = null;
    applyFilters();
  });

  // Tab switcher
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetTabId = btn.getAttribute('data-tab');
      document.getElementById(targetTabId).classList.add('active');

      if (targetTabId === 'tab-charts') {
        renderCharts();
      }
    });
  });

  // Modal close
  document.getElementById('btnModalClose').addEventListener('click', () => {
    document.getElementById('detailModal').classList.remove('active');
  });
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target.id === 'detailModal') {
      document.getElementById('detailModal').classList.remove('active');
    }
  });

  document.getElementById('btnUploadBackup').addEventListener('click', promptFallbackUpload);
}

/* ==========================================================================
   Apply Filters & Synchronize Map, Table, KPI, Charts
   ========================================================================== */
function applyFilters() {
  const searchVal = document.getElementById('searchInput').value.trim().toLowerCase();
  const provinceVal = document.getElementById('provinceFilter').value;
  const districtVal = document.getElementById('districtFilter').value;
  const riskVal = document.getElementById('riskFilter').value;
  const cropVal = document.getElementById('cropFilter').value;

  filteredFields = [];

  mergedFieldMap.forEach(item => {
    const p = item.properties || {};
    const l = item.latest || {};

    // Search match
    let matchSearch = true;
    if (searchVal) {
      const fid = (item.field_id || '').toLowerCase();
      const prov = (p.province || '').toLowerCase();
      const dist = (p.district || '').toLowerCase();
      const subdist = (p.subdistrict || '').toLowerCase();
      matchSearch = fid.includes(searchVal) || prov.includes(searchVal) || dist.includes(searchVal) || subdist.includes(searchVal);
    }

    // Dropdown filters
    const matchProvince = !provinceVal || p.province === provinceVal;
    const matchDistrict = !districtVal || p.district === districtVal;
    const matchRisk = !riskVal || l.risk_level === riskVal;
    const matchCrop = !cropVal || p.crop_type === cropVal;

    if (matchSearch && matchProvince && matchDistrict && matchRisk && matchCrop) {
      filteredFields.push(item);
    }
  });

  // Render all synced components
  renderMapPolygons();
  renderKPIs();
  renderTable();
  renderCharts();
}

/* ==========================================================================
   Render Map Polygons & Fit Bounds
   ========================================================================== */
function renderMapPolygons() {
  if (geojsonLayer) {
    map.removeLayer(geojsonLayer);
  }

  const activeFeatures = filteredFields.map(f => f.feature);
  const featureCollection = {
    type: 'FeatureCollection',
    features: activeFeatures
  };

  geojsonLayer = L.geoJSON(featureCollection, {
    style: (feature) => {
      const fid = feature.properties.field_id;
      const merged = mergedFieldMap.get(fid);
      const risk = merged?.latest?.risk_level || 'default';
      const isSelected = selectedFieldId === fid;

      return {
        fillColor: getRiskColor(risk),
        weight: isSelected ? 3.5 : 1.5,
        opacity: 1,
        color: isSelected ? '#ffffff' : '#0f172a',
        fillOpacity: isSelected ? 0.9 : 0.65
      };
    },
    onEachFeature: (feature, layer) => {
      const fid = feature.properties.field_id;
      const merged = mergedFieldMap.get(fid);
      const p = merged?.properties || {};
      const l = merged?.latest || {};

      // Popup content
      const popupHtml = `
        <div style="font-family:'Noto Sans Thai', sans-serif; font-size:12px; color:#1e293b; min-width:180px;">
          <div style="font-weight:700; font-size:13px; color:#0f172a; margin-bottom:4px; border-bottom:1px solid #cbd5e1; padding-bottom:3px;">
            แปลง: ${fid}
          </div>
          <div><b>ที่ตั้ง:</b> อ.${p.district || '-'} จ.${p.province || '-'}</div>
          <div><b>พืช:</b> ${p.crop_type || '-'} (${formatNumber(p.area_rai, 1)} ไร่)</div>
          <div><b>ผลผลิต:</b> ${formatNumber(l.yield_kg_rai, 1)} กก./ไร่</div>
          <div><b>NDVI:</b> ${formatNumber(l.ndvi, 2)}</div>
          <div><b>ความเสี่ยง:</b> <span style="font-weight:bold; color:${getRiskColor(l.risk_level)}">${l.risk_level || '-'}</span></div>
        </div>
      `;
      layer.bindPopup(popupHtml);

      layer.on({
        mouseover: (e) => {
          if (selectedFieldId !== fid) {
            const target = e.target;
            target.setStyle({ fillOpacity: 0.85, weight: 2.5 });
          }
        },
        mouseout: (e) => {
          if (selectedFieldId !== fid) {
            geojsonLayer.resetStyle(e.target);
          }
        },
        click: (e) => {
          selectField(fid, true);
          layer.openPopup();
        }
      });
    }
  }).addTo(map);

  // Fit bounds to filtered polygons if available
  if (activeFeatures.length > 0) {
    try {
      const bounds = geojsonLayer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [25, 25], maxZoom: 15 });
      }
    } catch (e) {
      console.error(e);
    }
  }
}

/* ==========================================================================
   Select Field Handler (Sync Map & Table & Drill-down)
   ========================================================================== */
function selectField(fieldId, fromMap = false) {
  selectedFieldId = fieldId;

  // Update Map styling
  if (geojsonLayer) {
    geojsonLayer.eachLayer(layer => {
      const fid = layer.feature.properties.field_id;
      if (fid === fieldId) {
        layer.setStyle({
          weight: 3.5,
          color: '#ffffff',
          fillOpacity: 0.95
        });
        layer.bringToFront();
        if (!fromMap) {
          map.fitBounds(layer.getBounds(), { maxZoom: 14, padding: [40, 40] });
          layer.openPopup();
        }
      } else {
        geojsonLayer.resetStyle(layer);
      }
    });
  }

  // Highlight row in table
  document.querySelectorAll('#fieldsTableBody tr').forEach(row => {
    if (row.getAttribute('data-field-id') === fieldId) {
      row.classList.add('selected');
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      row.classList.remove('selected');
    }
  });
}

/* ==========================================================================
   Render KPI Cards
   ========================================================================== */
function renderKPIs() {
  const totalCount = filteredFields.length;
  let totalArea = 0;
  let ndviSum = 0;
  let validNdviCount = 0;
  let totalYieldSum = 0;
  let highRiskCount = 0;

  filteredFields.forEach(item => {
    const area = parseFloat(item.properties.area_rai) || 0;
    totalArea += area;

    const ndvi = parseFloat(item.latest?.ndvi);
    if (!isNaN(ndvi)) {
      ndviSum += ndvi;
      validNdviCount++;
    }

    const yld = parseFloat(item.latest?.yield_kg_rai) || 0;
    totalYieldSum += yld;

    if (item.latest?.risk_level === 'High') {
      highRiskCount++;
    }
  });

  const avgNdvi = validNdviCount > 0 ? (ndviSum / validNdviCount) : 0;

  document.getElementById('kpiFieldCount').innerText = formatNumber(totalCount);
  document.getElementById('kpiTotalArea').innerText = formatNumber(totalArea, 1);
  document.getElementById('kpiAvgNdvi').innerText = formatNumber(avgNdvi, 2);
  document.getElementById('kpiTotalYield').innerText = formatNumber(totalYieldSum, 1);
  document.getElementById('kpiHighRisk').innerText = formatNumber(highRiskCount);
}

/* ==========================================================================
   Render Table Data
   ========================================================================== */
function renderTable() {
  const tbody = document.getElementById('fieldsTableBody');
  const badge = document.getElementById('tableRowsBadge');
  badge.innerText = filteredFields.length;

  if (filteredFields.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:30px; color:#64748b;">
          <i class="fa-solid fa-folder-open" style="font-size:1.6rem; margin-bottom:8px;"></i><br>
          ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา
        </td>
      </tr>
    `;
    return;
  }

  let rowsHtml = '';
  filteredFields.forEach(item => {
    const p = item.properties || {};
    const l = item.latest || {};
    const fid = item.field_id;
    const risk = l.risk_level || 'Low';
    const isSelected = selectedFieldId === fid ? 'selected' : '';

    const riskClass = risk === 'High' ? 'risk-high' : (risk === 'Medium' ? 'risk-medium' : 'risk-low');

    rowsHtml += `
      <tr class="table-row ${isSelected}" data-field-id="${fid}">
        <td style="font-weight:600; color:#38bdf8;">${fid}</td>
        <td>${p.province || '-'}</td>
        <td>${p.district || '-'}</td>
        <td>${p.crop_type || '-'}</td>
        <td>${formatNumber(p.area_rai, 1)}</td>
        <td>${formatNumber(l.yield_kg_rai, 1)}</td>
        <td><span class="badge-risk ${riskClass}">${risk}</span></td>
        <td style="text-align:center;">
          <button class="btn-detail" onclick="event.stopPropagation(); openDetailModal('${fid}')">
            <i class="fa-solid fa-chart-line"></i> ดูประวัติ
          </button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml;

  // Click row to zoom to polygon
  tbody.querySelectorAll('tr.table-row').forEach(row => {
    row.addEventListener('click', () => {
      const fid = row.getAttribute('data-field-id');
      selectField(fid, false);
    });
  });
}

/* ==========================================================================
   Render 4 Main Charts
   ========================================================================== */
function renderCharts() {
  renderRiskDoughnut();
  renderMonthlyTrendLine();
  renderProvinceBarLine();
  renderNdviYieldScatter();
}

// Chart 1: Doughnut (Risk Level)
function renderRiskDoughnut() {
  const counts = { Low: 0, Medium: 0, High: 0 };
  filteredFields.forEach(item => {
    const r = item.latest?.risk_level;
    if (counts[r] !== undefined) counts[r]++;
  });

  const ctx = document.getElementById('chartRiskDoughnut').getContext('2d');
  if (chartRiskDoughnutInstance) chartRiskDoughnutInstance.destroy();

  chartRiskDoughnutInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['ต่ำ (Low)', 'ปานกลาง (Medium)', 'สูง (High)'],
      datasets: [{
        data: [counts.Low, counts.Medium, counts.High],
        backgroundColor: [RISK_COLORS.Low, RISK_COLORS.Medium, RISK_COLORS.High],
        borderColor: '#111d21',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#cbd5e1', font: { family: 'Noto Sans Thai', size: 10 }, boxWidth: 12 }
        }
      },
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const risks = ['Low', 'Medium', 'High'];
          document.getElementById('riskFilter').value = risks[index];
          applyFilters();
        }
      }
    }
  });
}

// Chart 2: Monthly Trends (Line Chart)
function renderMonthlyTrendLine() {
  const monthMap = new Map();

  filteredFields.forEach(item => {
    item.history.forEach(rec => {
      const m = rec.month;
      if (!m) return;
      if (!monthMap.has(m)) {
        monthMap.set(m, { count: 0, sumNdvi: 0, sumYield: 0, sumRain: 0 });
      }
      const cur = monthMap.get(m);
      cur.count++;
      cur.sumNdvi += parseFloat(rec.ndvi) || 0;
      cur.sumYield += parseFloat(rec.yield_kg_rai) || 0;
      cur.sumRain += parseFloat(rec.rainfall_mm) || 0;
    });
  });

  const sortedMonths = Array.from(monthMap.keys()).sort();
  const avgNdviArr = [];
  const avgYieldArr = [];
  const avgRainArr = [];

  sortedMonths.forEach(m => {
    const d = monthMap.get(m);
    avgNdviArr.push(d.count ? +(d.sumNdvi / d.count).toFixed(2) : 0);
    avgYieldArr.push(d.count ? +(d.sumYield / d.count).toFixed(1) : 0);
    avgRainArr.push(d.count ? +(d.sumRain / d.count).toFixed(1) : 0);
  });

  const ctx = document.getElementById('chartTrendLine').getContext('2d');
  if (chartTrendLineInstance) chartTrendLineInstance.destroy();

  chartTrendLineInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedMonths,
      datasets: [
        {
          label: 'NDVI เฉลี่ย',
          data: avgNdviArr,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          yAxisID: 'yNDVI',
          tension: 0.3,
          fill: false
        },
        {
          label: 'ผลผลิต (กก./ไร่)',
          data: avgYieldArr,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          yAxisID: 'yYield',
          tension: 0.3,
          fill: false
        },
        {
          label: 'ฝน (มม.)',
          data: avgRainArr,
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          yAxisID: 'yYield',
          borderDash: [4, 4],
          tension: 0.3,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1a2e35' } },
        yNDVI: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'NDVI', color: '#10b981', font: { size: 10 } },
          ticks: { color: '#10b981' },
          grid: { color: '#1a2e35' }
        },
        yYield: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'ผลผลิต / ฝน', color: '#f59e0b', font: { size: 10 } },
          ticks: { color: '#f59e0b' },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: { labels: { color: '#cbd5e1', font: { family: 'Noto Sans Thai', size: 10 }, boxWidth: 10 } }
      }
    }
  });
}

// Chart 3: Dual-Axis Bar & Line (Province or District Drill-down)
function renderProvinceBarLine() {
  const selectedProvince = document.getElementById('provinceFilter').value;
  const isDistrictMode = Boolean(selectedProvince);

  const titleEl = document.getElementById('chartGeoTitle');
  const tagEl = document.getElementById('chartGeoTag');

  if (isDistrictMode) {
    titleEl.innerHTML = `<i class="fa-solid fa-chart-simple" style="color:var(--accent-green);"></i> ผลผลิต & พื้นที่ (ระดับอำเภอใน ${selectedProvince})`;
    tagEl.innerText = 'ระดับอำเภอ';
  } else {
    titleEl.innerHTML = `<i class="fa-solid fa-chart-simple" style="color:var(--accent-green);"></i> ผลผลิต & พื้นที่ (แยกตามจังหวัด)`;
    tagEl.innerText = 'ระดับจังหวัด';
  }

  const geoAggregation = new Map();

  filteredFields.forEach(item => {
    const key = isDistrictMode ? (item.properties.district || 'ไม่ระบุ') : (item.properties.province || 'ไม่ระบุ');
    if (!geoAggregation.has(key)) {
      geoAggregation.set(key, { totalArea: 0, totalYield: 0, count: 0 });
    }
    const data = geoAggregation.get(key);
    data.totalArea += parseFloat(item.properties.area_rai) || 0;
    data.totalYield += parseFloat(item.latest?.yield_kg_rai) || 0;
    data.count++;
  });

  const labels = Array.from(geoAggregation.keys());
  const areaData = [];
  const yieldData = [];

  labels.forEach(k => {
    const d = geoAggregation.get(k);
    areaData.push(d.totalArea);
    yieldData.push(d.count ? +(d.totalYield / d.count).toFixed(1) : 0);
  });

  const ctx = document.getElementById('chartProvinceBar').getContext('2d');
  if (chartProvinceBarInstance) chartProvinceBarInstance.destroy();

  chartProvinceBarInstance = new Chart(ctx, {
    data: {
      labels: labels,
      datasets: [
        {
          type: 'bar',
          label: 'พื้นที่รวม (ไร่)',
          data: areaData,
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: '#10b981',
          borderWidth: 1,
          yAxisID: 'yArea'
        },
        {
          type: 'line',
          label: 'ผลผลิตเฉลี่ย (กก./ไร่)',
          data: yieldData,
          borderColor: '#38bdf8',
          backgroundColor: '#38bdf8',
          yAxisID: 'yYield',
          borderWidth: 2,
          tension: 0.2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1a2e35' } },
        yArea: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'พื้นที่ (ไร่)', color: '#10b981', font: { size: 10 } },
          ticks: { color: '#10b981' },
          grid: { color: '#1a2e35' }
        },
        yYield: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'ผลผลิต (กก./ไร่)', color: '#38bdf8', font: { size: 10 } },
          ticks: { color: '#38bdf8' },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: { labels: { color: '#cbd5e1', font: { family: 'Noto Sans Thai', size: 10 }, boxWidth: 10 } }
      },
      onClick: (evt, elements) => {
        if (!isDistrictMode && elements.length > 0) {
          const labelClicked = labels[elements[0].index];
          document.getElementById('provinceFilter').value = labelClicked;
          updateDistrictDropdown();
          applyFilters();
        }
      }
    }
  });
}

// Chart 4: Scatter Plot (NDVI vs Yield)
function renderNdviYieldScatter() {
  const scatterPoints = [];

  filteredFields.forEach(item => {
    const ndvi = parseFloat(item.latest?.ndvi);
    const yld = parseFloat(item.latest?.yield_kg_rai);
    if (!isNaN(ndvi) && !isNaN(yld)) {
      scatterPoints.push({
        x: ndvi,
        y: yld,
        field_id: item.field_id,
        risk: item.latest?.risk_level
      });
    }
  });

  const ctx = document.getElementById('chartScatter').getContext('2d');
  if (chartScatterInstance) chartScatterInstance.destroy();

  chartScatterInstance = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'แปลงข้าว (NDVI vs Yield)',
        data: scatterPoints,
        backgroundColor: (context) => {
          const pt = context.raw;
          return pt ? getRiskColor(pt.risk) : '#38bdf8';
        },
        borderColor: 'rgba(255, 255, 255, 0.4)',
        borderWidth: 1,
        pointRadius: 4.5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'ค่า NDVI (เดือนล่าสุด)', color: '#94a3b8', font: { size: 10 } },
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { color: '#1a2e35' }
        },
        y: {
          title: { display: true, text: 'ผลผลิต (กก./ไร่)', color: '#94a3b8', font: { size: 10 } },
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { color: '#1a2e35' }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context) => {
              const pt = context.raw;
              return `แปลง: ${pt.field_id} | NDVI: ${pt.x} | ผลผลิต: ${pt.y} กก./ไร่ (${pt.risk})`;
            }
          }
        },
        legend: { display: false }
      },
      onClick: (evt, elements) => {
        if (elements.length > 0) {
          const pt = scatterPoints[elements[0].index];
          if (pt && pt.field_id) {
            selectField(pt.field_id, false);
          }
        }
      }
    }
  });
}

/* ==========================================================================
   Drill-down Modal & Trend Line
   ========================================================================== */
function openDetailModal(fieldId) {
  const item = mergedFieldMap.get(fieldId);
  if (!item) return;

  const modal = document.getElementById('detailModal');
  const title = document.getElementById('modalFieldTitle');
  const tbody = document.getElementById('modalHistoryTbody');

  title.innerHTML = `ประวัติการติดตามย้อนหลัง - แปลง <span style="color:#38bdf8;">${fieldId}</span> (จ.${item.properties.province || '-'} อ.${item.properties.district || '-'})`;

  const history = item.history || [];
  let rowsHtml = '';
  const months = [];
  const riskScores = [];

  history.forEach(r => {
    const risk = r.risk_level || 'Low';
    const riskClass = risk === 'High' ? 'risk-high' : (risk === 'Medium' ? 'risk-medium' : 'risk-low');
    months.push(r.month || '-');
    riskScores.push(parseFloat(r.risk_score) || 0);

    rowsHtml += `
      <tr>
        <td style="font-weight:600; color:#38bdf8;">${r.month || '-'}</td>
        <td>${formatNumber(r.ndvi, 2)}</td>
        <td>${formatNumber(r.rainfall_mm, 1)}</td>
        <td>${formatNumber(r.temperature_c, 1)}</td>
        <td>${r.water_status || '-'}</td>
        <td>${formatNumber(r.yield_kg_rai, 1)}</td>
        <td style="font-weight:600;">${formatNumber(r.risk_score, 2)}</td>
        <td><span class="badge-risk ${riskClass}">${risk}</span></td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml || '<tr><td colspan="8" style="text-align:center;">ไม่มีข้อมูลย้อนหลัง</td></tr>';

  modal.classList.add('active');

  // Render Modal Line Chart for risk_score (0-1)
  const ctx = document.getElementById('modalTrendChart').getContext('2d');
  if (modalChartInstance) modalChartInstance.destroy();

  modalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months,
      datasets: [{
        label: 'แนวโน้ม Risk Score (0-1)',
        data: riskScores,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        borderWidth: 2,
        pointBackgroundColor: '#ef4444',
        pointRadius: 5,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: '#1a2e35' } },
        y: {
          min: 0,
          max: 1,
          ticks: { color: '#94a3b8' },
          grid: { color: '#1a2e35' },
          title: { display: true, text: 'Risk Score (0 - 1)', color: '#ef4444' }
        }
      },
      plugins: {
        legend: { labels: { color: '#cbd5e1', font: { family: 'Noto Sans Thai' } } }
      }
    }
  });
}
