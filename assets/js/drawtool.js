/* =========================================================================
   State Variables and Configuration
   ========================================================================= */
const THAILAND_CENTER = [15.8700, 100.9925];
const THAILAND_ZOOM = 6;

let map = null;
let basemapLayers = {};
let activeBasemapLayer = null;

// Data structures for polygon features
// Map of id -> { id, layer, properties: { name, crop, desc, area_sqm, area_rai_total, rai, ngan, wah, created_at } }
const fieldsMap = new Map();
let selectedFieldId = null;
let activeEditingId = null;

/* Custom Toast Notification System (replaces alert) */
function showToast(message, isError = false) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast-msg ${isError ? 'error' : ''}`;
  toast.innerHTML = `<i class="bi ${isError ? 'bi-x-circle-fill' : 'bi-check-circle-fill'}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

/* Custom Modal Confirmation Dialog (replaces confirm) */
function showConfirmModal(title, description, onConfirm) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalDesc').textContent = description;
  modal.classList.add('active');

  const cancelBtn = document.getElementById('btnConfirmCancel');
  const okBtn = document.getElementById('btnConfirmOk');

  const cleanUp = () => {
    modal.classList.remove('active');
    cancelBtn.onclick = null;
    okBtn.onclick = null;
  };

  cancelBtn.onclick = cleanUp;
  okBtn.onclick = () => {
    cleanUp();
    if (typeof onConfirm === 'function') onConfirm();
  };
}

/* Initialize Leaflet Map with ESRI Basemaps */
function initMap() {
  map = L.map('map', {
    center: THAILAND_CENTER,
    zoom: THAILAND_ZOOM,
    zoomControl: false,
    attributionControl: false
  });

  // Add Zoom Control to Bottom-Right
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Attribution
  L.control.attribution({ position: 'bottomleft', prefix: 'Mini LandQ GIS' }).addTo(map);

  // Basemap Definitions
  basemapLayers['esri-imagery'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });
  basemapLayers['esri-topo'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });
  basemapLayers['esri-dark'] = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  });
  basemapLayers['osm'] = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  });

  // Set Default Basemap
  activeBasemapLayer = basemapLayers['esri-imagery'];
  activeBasemapLayer.addTo(map);

  // Basemap selector event
  document.getElementById('basemapSelect').addEventListener('change', (e) => {
    const selected = e.target.value;
    if (activeBasemapLayer) {
      map.removeLayer(activeBasemapLayer);
    }
    activeBasemapLayer = basemapLayers[selected] || basemapLayers['esri-imagery'];
    activeBasemapLayer.addTo(map);
  });

  // Reset View Button
  document.getElementById('btnMapResetView').addEventListener('click', () => {
    if (fieldsMap.size > 0) {
      fitMapToAllFields();
    } else {
      map.setView(THAILAND_CENTER, THAILAND_ZOOM);
    }
    showToast('รีเซ็ตมุมมองแผนที่เรียบร้อย');
  });

  initGeomanDrawing();
}

/* Configure Geoman Drawing Tools for Polygons */
function initGeomanDrawing() {
  map.pm.addControls({
    position: 'topleft',
    drawMarker: false,
    drawCircleMarker: false,
    drawPolyline: false,
    drawRectangle: true,
    drawPolygon: true,
    drawCircle: false,
    drawText: false,
    editMode: true,
    dragMode: true,
    cutPolygon: false,
    removalMode: true
  });

  // Set Geoman Path Styling to enterprise green
  map.pm.setPathOptions({
    color: '#4ade80',
    fillColor: '#22c55e',
    fillOpacity: 0.35,
    weight: 2.5
  });

  // Event: When a new shape is drawn
  map.on('pm:create', (e) => {
    const layer = e.layer;
    const newId = 'FIELD-' + Date.now().toString().slice(-6);
    const defaultName = `แปลงที่ ${fieldsMap.size + 1}`;

    // Compute Area via Turf.js
    const areaStats = computeLayerAreaStats(layer);

    // Store Field
    const fieldItem = {
      id: newId,
      layer: layer,
      properties: {
        field_id: newId,
        name: defaultName,
        crop: 'ข้าวหอมมะลิ 105',
        desc: '',
        area_sqm: areaStats.sqm,
        area_rai_total: areaStats.raiTotal,
        rai: areaStats.rai,
        ngan: areaStats.ngan,
        wah: areaStats.wah,
        created_at: new Date().toISOString()
      }
    };

    layer._fieldId = newId;
    fieldsMap.set(newId, fieldItem);

    bindFieldLayerEvents(layer, newId);
    updatePolygonStyle(layer, false);

    selectField(newId);
    populateFieldsTable();
    showToast(`วาด ${defaultName} สำเร็จ (${areaStats.raiTotal} ไร่)`);

    // Switch to fields tab
    switchTab('tab-fields');
  });

  // Event: Global Removal Mode used via toolbar
  map.on('pm:remove', (e) => {
    const fid = e.layer._fieldId;
    if (fid && fieldsMap.has(fid)) {
      fieldsMap.delete(fid);
      if (selectedFieldId === fid) {
        clearSelectedFieldState();
      }
      populateFieldsTable();
      showToast('ลบแปลงเรียบร้อยแล้ว');
    }
  });

  // Quick draw button in floating toolbar
  document.getElementById('btnQuickDraw').addEventListener('click', () => {
    map.pm.enableDraw('Polygon');
    showToast('คลิกบนแผนที่เพื่อเริ่มจุดมุมของแปลง (ดับเบิลคลิกเพื่อสิ้นสุด)');
  });
}

/* Bind popup, click, and edit events to each polygon layer */
function bindFieldLayerEvents(layer, fieldId) {
  layer.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    selectField(fieldId);
  });

  // When vertices are edited or dragged, re-calculate area & update tables
  layer.on('pm:edit', () => {
    handleLayerGeometryUpdated(fieldId);
  });

  layer.on('pm:dragend', () => {
    handleLayerGeometryUpdated(fieldId);
  });
}

function handleLayerGeometryUpdated(fieldId) {
  const item = fieldsMap.get(fieldId);
  if (!item) return;

  const areaStats = computeLayerAreaStats(item.layer);
  item.properties.area_sqm = areaStats.sqm;
  item.properties.area_rai_total = areaStats.raiTotal;
  item.properties.rai = areaStats.rai;
  item.properties.ngan = areaStats.ngan;
  item.properties.wah = areaStats.wah;

  updateFieldPopup(item);
  populateFieldsTable();

  if (selectedFieldId === fieldId) {
    displayFieldCalculationAndCoordinates(item);
  }
  showToast(`อัปเดตพิกัดและเนื้อที่แปลง ${item.properties.name} แล้ว`);
}

function updatePolygonStyle(layer, isSelected) {
  if (isSelected) {
    layer.setStyle({
      color: '#facc15',
      fillColor: '#f59e0b',
      fillOpacity: 0.55,
      weight: 3.5,
      dashArray: null
    });
  } else {
    layer.setStyle({
      color: '#4ade80',
      fillColor: '#22c55e',
      fillOpacity: 0.35,
      weight: 2.5,
      dashArray: null
    });
  }
}

function updateFieldPopup(item) {
  const p = item.properties;
  const content = `
    <div style="font-family:'Noto Sans Thai',sans-serif; min-width:180px; color:#0f172a;">
      <div style="font-weight:700; font-size:13px; color:#14532d; border-bottom:1px solid #cbd5e1; padding-bottom:3px; margin-bottom:5px;">
        <i class="bi bi-polygon"></i> ${p.name}
      </div>
      <div style="font-size:12px; margin-bottom:3px;"><b>พืช:</b> ${p.crop}</div>
      <div style="font-size:12px; margin-bottom:3px;"><b>เนื้อที่:</b> <span style="color:#047857; font-weight:700;">${p.rai} ไร่ ${p.ngan} งาน ${p.wah} ตร.ว.</span></div>
      <div style="font-size:11px; color:#64748b;">(รวม ${p.area_sqm.toLocaleString()} ตร.ม.)</div>
    </div>
  `;
  item.layer.bindPopup(content);
}

/* Compute Area (sqm and Thai Traditional Units: ไร่-งาน-ตารางวา) using Turf.js */
function computeLayerAreaStats(layer) {
  const geojson = layer.toGeoJSON();
  let sqm = 0;
  try {
    sqm = turf.area(geojson);
  } catch (err) {
    console.error('Turf area error:', err);
    sqm = 0;
  }

  sqm = Math.round(sqm * 100) / 100;

  // 1 ไร่ = 1,600 ตารางเมตร
  // 1 งาน = 400 ตารางเมตร
  // 1 ตารางวา = 4 ตารางเมตร
  const totalRaiExact = sqm / 1600;
  const rai = Math.floor(sqm / 1600);
  const remainderAfterRai = sqm % 1600;
  const ngan = Math.floor(remainderAfterRai / 400);
  const remainderAfterNgan = remainderAfterRai % 400;
  const wah = Math.round((remainderAfterNgan / 4) * 10) / 10;

  return {
    sqm: sqm,
    raiTotal: Math.round(totalRaiExact * 100) / 100,
    rai: rai,
    ngan: ngan,
    wah: wah
  };
}

/* Extract Polygon Coordinates Array */
function extractLayerCoordinates(layer) {
  const latlngs = layer.getLatLngs();
  // Handle potential nested arrays in polygons (e.g. holes or simple array)
  const flat = Array.isArray(latlngs[0]) && !Array.isArray(latlngs[0][0]) ? latlngs[0] : (Array.isArray(latlngs[0]) ? latlngs[0][0] : latlngs);
  return flat.map((ll, idx) => ({
    index: idx + 1,
    lat: Number(ll.lat.toFixed(6)),
    lng: Number(ll.lng.toFixed(6))
  }));
}

/* Select a field and synchronize all UI panels */
function selectField(fieldId, zoomTo = false) {
  selectedFieldId = fieldId;

  fieldsMap.forEach((item, id) => {
    const isThis = (id === fieldId);
    updatePolygonStyle(item.layer, isThis);
    if (isThis) {
      updateFieldPopup(item);
    }
  });

  const currentItem = fieldsMap.get(fieldId);
  if (!currentItem) return;

  if (zoomTo) {
    map.fitBounds(currentItem.layer.getBounds(), { padding: [40, 40], maxZoom: 17 });
  }

  // Populate Form for Editing
  document.getElementById('fieldNameInput').value = currentItem.properties.name || '';
  document.getElementById('fieldCropInput').value = currentItem.properties.crop || 'ข้าวหอมมะลิ 105';
  document.getElementById('fieldDescInput').value = currentItem.properties.desc || '';
  document.getElementById('editorTitle').textContent = `แก้ไขข้อมูล: ${currentItem.properties.name}`;
  document.getElementById('editorModeBadge').textContent = 'กำลังแก้ไข';
  document.getElementById('btnCancelEdit').style.display = 'inline-flex';

  // Update calculations and coordinates tab
  displayFieldCalculationAndCoordinates(currentItem);

  // Highlight active row in table
  highlightTableRow(fieldId);
}

function clearSelectedFieldState() {
  selectedFieldId = null;
  document.getElementById('fieldNameInput').value = '';
  document.getElementById('fieldCropInput').value = 'ข้าวหอมมะลิ 105';
  document.getElementById('fieldDescInput').value = '';
  document.getElementById('editorTitle').textContent = 'บันทึกข้อมูลแปลง';
  document.getElementById('editorModeBadge').textContent = 'พร้อมใช้งาน';
  document.getElementById('btnCancelEdit').style.display = 'none';

  document.getElementById('selectedFieldNameBadge').textContent = 'ไม่มีแปลงที่เลือก';
  document.getElementById('areaRaiTotal').textContent = '0.00';
  document.getElementById('areaRaiPart').textContent = '0';
  document.getElementById('areaNganPart').textContent = '0';
  document.getElementById('areaWahPart').textContent = '0.0';
  document.getElementById('areaSqmTotal').textContent = '0';

  document.getElementById('coordsTableBody').innerHTML = `
    <tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 18px;">
      เลือกแปลงหรือวาดแปลงเพื่อดูพิกัดจุด
    </td></tr>
  `;

  highlightTableRow(null);
}

/* Save field attributes edited by the user */
function saveFieldAttributes() {
  if (!selectedFieldId || !fieldsMap.has(selectedFieldId)) {
    showToast('กรุณาเลือกหรือวาดแปลงก่อนบันทึกข้อมูล', true);
    return;
  }

  const item = fieldsMap.get(selectedFieldId);
  const nameVal = document.getElementById('fieldNameInput').value.trim();
  const cropVal = document.getElementById('fieldCropInput').value;
  const descVal = document.getElementById('fieldDescInput').value.trim();

  if (!nameVal) {
    showToast('กรุณากรอกชื่อแปลง', true);
    return;
  }

  item.properties.name = nameVal;
  item.properties.crop = cropVal;
  item.properties.desc = descVal;

  updateFieldPopup(item);
  populateFieldsTable();
  displayFieldCalculationAndCoordinates(item);
  showToast(`บันทึกข้อมูล "${nameVal}" สำเร็จ`);
}

document.getElementById('btnCancelEdit').addEventListener('click', () => {
  clearSelectedFieldState();
});

function displayFieldCalculationAndCoordinates(item) {
  const p = item.properties;
  document.getElementById('selectedFieldNameBadge').textContent = p.name;
  document.getElementById('areaRaiTotal').textContent = p.area_rai_total.toLocaleString();
  document.getElementById('areaRaiPart').textContent = p.rai.toLocaleString();
  document.getElementById('areaNganPart').textContent = p.ngan;
  document.getElementById('areaWahPart').textContent = p.wah;
  document.getElementById('areaSqmTotal').textContent = p.area_sqm.toLocaleString();

  // Render coordinates
  const coords = extractLayerCoordinates(item.layer);
  const tbody = document.getElementById('coordsTableBody');
  if (coords.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">ไม่พบพิกัดจุด</td></tr>`;
    return;
  }

  let rowsHtml = '';
  coords.forEach(pt => {
    rowsHtml += `
      <tr>
        <td style="font-weight:600; color:var(--accent-green-bright); text-align:center;">P${pt.index}</td>
        <td>${pt.lat.toFixed(6)}</td>
        <td>${pt.lng.toFixed(6)}</td>
      </tr>
    `;
  });
  tbody.innerHTML = rowsHtml;
}

function populateFieldsTable() {
  const tbody = document.getElementById('fieldsTableBody');
  const badge = document.getElementById('fieldCountBadge');
  badge.textContent = fieldsMap.size;

  if (fieldsMap.size === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 18px;">
          ยังไม่มีแปลงในระบบ คลิกปุ่ม <b>"วาดแปลง"</b> บนแผนที่
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  fieldsMap.forEach((item, id) => {
    const p = item.properties;
    const isSel = (id === selectedFieldId) ? 'active-row' : '';
    html += `
      <tr class="${isSel}" data-id="${id}" onclick="selectField('${id}', true)">
        <td style="font-weight:600; color:var(--text-white);">
          <i class="bi bi-polygon" style="color:var(--accent-green-bright); margin-right:4px;"></i>${p.name}
        </td>
        <td><span class="badge badge-crop">${p.crop}</span></td>
        <td>${p.rai}-${p.ngan}-${p.wah} ไร่</td>
        <td style="text-align:center;">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); zoomToField('${id}')" title="ซูมไปยังแปลง">
            <i class="bi bi-crosshair"></i>
          </button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); promptDeleteField('${id}')" title="ลบแปลงนี้">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function highlightTableRow(fieldId) {
  document.querySelectorAll('#fieldsTableBody tr').forEach(tr => {
    if (tr.getAttribute('data-id') === fieldId) {
      tr.classList.add('active-row');
    } else {
      tr.classList.remove('active-row');
    }
  });
}

function zoomToField(fieldId) {
  selectField(fieldId, true);
}

function promptDeleteField(fieldId) {
  const item = fieldsMap.get(fieldId);
  if (!item) return;
  showConfirmModal(
    'ยืนยันการลบแปลง',
    `คุณต้องการลบ "${item.properties.name}" ใช่หรือไม่? แปลงนี้จะถูกนำออกจากแผนที่ทันที`,
    () => {
      map.removeLayer(item.layer);
      fieldsMap.delete(fieldId);
      if (selectedFieldId === fieldId) {
        clearSelectedFieldState();
      }
      populateFieldsTable();
      showToast(`ลบแปลง "${item.properties.name}" สำเร็จ`);
    }
  );
}

// Clear all fields
document.getElementById('btnClearAllFields').addEventListener('click', () => {
  if (fieldsMap.size === 0) {
    showToast('ไม่มีแปลงที่ต้องลบ', true);
    return;
  }
  showConfirmModal(
    'ยืนยันการลบทุกแปลง',
    `คุณต้องการลบแปลงทั้งหมดจำนวน ${fieldsMap.size} แปลงหรือไม่? ข้อมูลจะไม่สามารถกู้คืนได้`,
    () => {
      fieldsMap.forEach(item => map.removeLayer(item.layer));
      fieldsMap.clear();
      clearSelectedFieldState();
      populateFieldsTable();
      showToast('ลบแปลงทั้งหมดเรียบร้อยแล้ว');
    }
  );
});

function fitMapToAllFields() {
  if (fieldsMap.size === 0) return;
  const group = new L.featureGroup(Array.from(fieldsMap.values()).map(f => f.layer));
  map.fitBounds(group.getBounds(), { padding: [40, 40] });
}

/* Export to GeoJSON file */
document.getElementById('btnExportGeoJSON').addEventListener('click', () => {
  if (fieldsMap.size === 0) {
    showToast('ไม่มีข้อมูลแปลงสำหรับส่งออก', true);
    return;
  }

  const features = [];
  fieldsMap.forEach(item => {
    const feat = item.layer.toGeoJSON();
    feat.properties = { ...item.properties };
    features.push(feat);
  });

  const featureCollection = {
    type: 'FeatureCollection',
    name: 'MiniLandQ_Rice_Fields',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    features: features
  };

  downloadBlobFile(JSON.stringify(featureCollection, null, 2), 'mini_landq_fields.geojson', 'application/geo+json');
  showToast('ส่งออกไฟล์ GeoJSON เรียบร้อย');
});

/* Export to Excel (.xlsx) using SheetJS */
document.getElementById('btnExportExcel').addEventListener('click', () => {
  if (fieldsMap.size === 0) {
    showToast('ไม่มีข้อมูลแปลงสำหรับส่งออก', true);
    return;
  }

  const rows = [];
  fieldsMap.forEach(item => {
    const p = item.properties;
    const coords = extractLayerCoordinates(item.layer);
    const coordsStr = coords.map(c => `[${c.lat},${c.lng}]`).join('; ');

    rows.push({
      'รหัสแปลง': p.field_id,
      'ชื่อแปลง': p.name,
      'พืชที่ปลูก': p.crop,
      'เนื้อที่ (ไร่)': p.rai,
      'เนื้อที่ (งาน)': p.ngan,
      'เนื้อที่ (ตร.วา)': p.wah,
      'เนื้อที่รวม (ไร่)': p.area_rai_total,
      'เนื้อที่รวม (ตร.ม.)': p.area_sqm,
      'รายละเอียด': p.desc,
      'พิกัดจุดมุม': coordsStr,
      'วันที่บันทึก': p.created_at
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'แปลงนา_LandQ');
  XLSX.writeFile(workbook, 'mini_landq_fields_report.xlsx');
  showToast('ส่งออกไฟล์ Excel (.xlsx) เรียบร้อย');
});

/* Export to CSV */
document.getElementById('btnExportCSV').addEventListener('click', () => {
  if (fieldsMap.size === 0) {
    showToast('ไม่มีข้อมูลแปลงสำหรับส่งออก', true);
    return;
  }

  const headers = ['รหัสแปลง', 'ชื่อแปลง', 'พืช', 'ไร่', 'งาน', 'ตารางวา', 'เนื้อที่รวม_ไร่', 'เนื้อที่รวม_ตรม', 'รายละเอียด'];
  const csvLines = [headers.join(',')];

  fieldsMap.forEach(item => {
    const p = item.properties;
    const line = [
      `"${p.field_id}"`,
      `"${p.name}"`,
      `"${p.crop}"`,
      p.rai,
      p.ngan,
      p.wah,
      p.area_rai_total,
      p.area_sqm,
      `"${(p.desc || '').replace(/"/g, '""')}"`
    ];
    csvLines.push(line.join(','));
  });

  // Add UTF-8 BOM so Excel opens Thai CSV cleanly
  const bom = '\uFEFF';
  downloadBlobFile(bom + csvLines.join('\n'), 'mini_landq_fields.csv', 'text/csv;charset=utf-8;');
  showToast('ส่งออกไฟล์ CSV เรียบร้อย');
});

/* Export Coordinates Text */
document.getElementById('btnExportKML').addEventListener('click', () => {
  if (!selectedFieldId || !fieldsMap.has(selectedFieldId)) {
    showToast('กรุณาเลือกแปลงที่ต้องการดาวน์โหลดพิกัด', true);
    return;
  }
  const item = fieldsMap.get(selectedFieldId);
  const coords = extractLayerCoordinates(item.layer);
  let text = `# พิกัดจุดมุม: ${item.properties.name}\n# Point, Latitude, Longitude\n`;
  coords.forEach(pt => {
    text += `P${pt.index}, ${pt.lat}, ${pt.lng}\n`;
  });

  downloadBlobFile(text, `${item.properties.field_id}_coordinates.txt`, 'text/plain;charset=utf-8;');
  showToast('ดาวน์โหลดพิกัดข้อความสำเร็จ');
});

/* Copy coordinates to clipboard */
document.getElementById('btnCopyCoords').addEventListener('click', () => {
  if (!selectedFieldId || !fieldsMap.has(selectedFieldId)) {
    showToast('กรุณาเลือกแปลงก่อนคัดลอกพิกัด', true);
    return;
  }
  const item = fieldsMap.get(selectedFieldId);
  const coords = extractLayerCoordinates(item.layer);
  const text = coords.map(c => `P${c.index}: ${c.lat}, ${c.lng}`).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showToast('คัดลอกพิกัดลงในคลิปบอร์ดแล้ว');
  }).catch(() => {
    showToast('ไม่สามารถคัดลอกพิกัดได้', true);
  });
});

function downloadBlobFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Import GeoJSON from file input */
document.getElementById('fieldForm').addEventListener('submit', (event) => {
  event.preventDefault();
  saveFieldAttributes();
});

document.getElementById('btnSelectGeoJSON').addEventListener('click', () => {
  document.getElementById('geojsonFileInput').click();
});

document.getElementById('geojsonFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      importGeoJsonFeatures(parsed);
      e.target.value = ''; // reset file input
    } catch (err) {
      console.error(err);
      showToast('ไฟล์ GeoJSON ไม่ถูกต้องหรือเสียหาย', true);
    }
  };
  reader.readAsText(file);
});

function importGeoJsonFeatures(geojson) {
  const features = geojson.type === 'FeatureCollection' ? geojson.features : (geojson.type === 'Feature' ? [geojson] : []);
  if (!features || features.length === 0) {
    showToast('ไม่พบข้อมูล Polygon ในไฟล์ที่นำเข้า', true);
    return;
  }

  let importedCount = 0;
  features.forEach((feat, index) => {
    if (!feat.geometry) return;
    const geomType = feat.geometry.type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') return;

    // Create Leaflet layer from GeoJSON feature
    const geoLayer = L.geoJSON(feat, {
      style: {
        color: '#4ade80',
        fillColor: '#22c55e',
        fillOpacity: 0.35,
        weight: 2.5
      }
    });

    // Loop sublayers
    geoLayer.eachLayer(layer => {
      const fid = feat.properties?.field_id || ('IMP-' + (Date.now() + index).toString().slice(-6));
      const name = feat.properties?.name || feat.properties?.field_name || `แปลงนำเข้า ${fieldsMap.size + 1}`;
      const crop = feat.properties?.crop || feat.properties?.crop_type || 'ข้าวหอมมะลิ 105';
      const desc = feat.properties?.desc || feat.properties?.description || '';

      const areaStats = computeLayerAreaStats(layer);
      const fieldItem = {
        id: fid,
        layer: layer,
        properties: {
          field_id: fid,
          name: name,
          crop: crop,
          desc: desc,
          area_sqm: areaStats.sqm,
          area_rai_total: areaStats.raiTotal,
          rai: areaStats.rai,
          ngan: areaStats.ngan,
          wah: areaStats.wah,
          created_at: feat.properties?.created_at || new Date().toISOString()
        }
      };

      layer._fieldId = fid;
      layer.addTo(map);

      fieldsMap.set(fid, fieldItem);
      bindFieldLayerEvents(layer, fid);
      updateFieldPopup(fieldItem);
      importedCount++;
    });
  });

  if (importedCount > 0) {
    populateFieldsTable();
    fitMapToAllFields();
    switchTab('tab-fields');
    showToast(`นำเข้าสำเร็จทั้งหมด ${importedCount} แปลง`);
  } else {
    showToast('ไม่มีข้อมูล Polygon ที่สามารถแสดงผลได้', true);
  }
}

/* Tab Switcher Logic */
function switchTab(targetTabId) {
  document.querySelectorAll('.tab-item').forEach(t => {
    if (t.getAttribute('data-tab') === targetTabId) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    if (p.id === targetTabId) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
}

document.querySelectorAll('.tab-item').forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.getAttribute('data-tab'));
  });
});

window.addEventListener('DOMContentLoaded', () => {
  initMap();
});
