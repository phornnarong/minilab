// Initialize Lucide icons
lucide.createIcons();

// Primary Remote GeoJSON Dataset Target URL
// const PRIMARY_GEOJSON_URL = 'https://demofile-lake.vercel.app/rice_fields.geojson';
const PRIMARY_GEOJSON_URL = 'spdata/rice_fields.geojson';

// Global Variables
let map;
let geojsonLayer = null;
let allGeoJsonData = null;
let activeSelectedLayer = null;

// Tile Basemap Providers (ESRI & OSM)
const basemaps = {
    satellite: L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 19
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
            attribution: '',
            maxZoom: 19
        })
    ]),
    topo: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
        maxZoom: 19
    }),
    dark: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        maxZoom: 16
    })
};

// Initialize GIS Map
function initMap() {
    // Default center point over Central Thailand (Suphan Buri / Ayutthaya area)
    map = L.map('map', {
        center: [14.4744, 100.1172],
        zoom: 9,
        zoomControl: false,
        layers: [basemaps.satellite]
    });

    // Position custom Leaflet zoom control at top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Bind Basemap Switcher Events
    setupBasemapControls();

    // Load primary GeoJSON data from URL
    loadGeoJsonFromUrl(PRIMARY_GEOJSON_URL);
}

// Setup Basemap Switcher Event Listeners
function setupBasemapControls() {
    const btnSat = document.getElementById('btn-basemap-satellite');
    const btnTopo = document.getElementById('btn-basemap-topo');
    const btnDark = document.getElementById('btn-basemap-dark');

    function setActiveBasemapBtn(selectedBtn) {
        [btnSat, btnTopo, btnDark].forEach(btn => {
            btn.className = "basemap-btn px-3 py-1.5 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 border border-transparent flex items-center gap-1.5 transition-all";
        });
        selectedBtn.className = "basemap-btn px-3 py-1.5 rounded-xl text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-1.5 transition-all";
    }

    btnSat.addEventListener('click', () => {
        switchBasemap(basemaps.satellite);
        setActiveBasemapBtn(btnSat);
    });

    btnTopo.addEventListener('click', () => {
        switchBasemap(basemaps.topo);
        setActiveBasemapBtn(btnTopo);
    });

    btnDark.addEventListener('click', () => {
        switchBasemap(basemaps.dark);
        setActiveBasemapBtn(btnDark);
    });
}

function switchBasemap(newLayer) {
    Object.values(basemaps).forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    map.addLayer(newLayer);
}

// Fetch GeoJSON from Remote Server URL
async function loadGeoJsonFromUrl(url) {
    updateStatus("กำลังเชื่อมต่อเซิร์ฟเวอร์เพื่อโหลด GeoJSON...", "loading");

    try {
        const response = await fetch(url, { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`HTTP Error Status: ${response.status}`);
        }
        const data = await response.json();

        if (!data || !data.features || data.features.length === 0) {
            throw new Error("ไฟล์ GeoJSON ไม่มีข้อมูลแปลงนา (Features array empty)");
        }

        // Load and render GeoJSON successfully
        renderGeoJsonOnMap(data);
        updateStatus(`โหลดข้อมูลสำเร็จ (${data.features.length} แปลง)`, "success");

    } catch (error) {
        console.warn("ไม่สามารถโหลด GeoJSON จาก URL หลักได้:", error.message);
        updateStatus("ไม่สามารถโหลด URL ได้ โปรดอัปโหลดไฟล์ GeoJSON", "error");
        enableBackupUploadMode();
    }
}

// Handle Backup File Upload Mode
function enableBackupUploadMode() {
    const uploadContainer = document.getElementById('upload-container');
    const manualUploadBtn = document.getElementById('btn-manual-upload');

    if (uploadContainer) uploadContainer.classList.remove('hidden');
    if (manualUploadBtn) manualUploadBtn.classList.remove('hidden');

    const fileInput = document.getElementById('geojson-file-input');
    const btnUpload = document.getElementById('btn-upload');

    const triggerFileInput = () => fileInput.click();

    if (btnUpload) btnUpload.onclick = triggerFileInput;
    if (manualUploadBtn) manualUploadBtn.onclick = triggerFileInput;

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const uploadedData = JSON.parse(event.target.result);
                if (!uploadedData.features || uploadedData.features.length === 0) {
                    alert("ไฟล์ GeoJSON ที่อัปโหลดไม่ถูกต้อง หรือไม่มี Polygon");
                    return;
                }
                renderGeoJsonOnMap(uploadedData);
                updateStatus(`อัปโหลดสำเร็จ (${uploadedData.features.length} แปลง)`, "success");
            } catch (err) {
                alert("เกิดข้อผิดพลาดในการอ่านไฟล์ GeoJSON: " + err.message);
                updateStatus("ไฟล์ GeoJSON ไม่ถูกต้อง", "error");
            }
        };
        reader.readAsText(file);
    };
}

// Render GeoJSON Polygons on Leaflet Map
function renderGeoJsonOnMap(data) {
    allGeoJsonData = data;

    // Remove existing layer if any
    if (geojsonLayer) {
        map.removeLayer(geojsonLayer);
    }

    // Define Polygon Styling
    function defaultStyle(feature) {
        return {
            fillColor: '#10b981',
            fillOpacity: 0.35,
            color: '#34d399',
            weight: 2,
            opacity: 0.95
        };
    }

    function highlightStyle() {
        return {
            fillColor: '#38bdf8',
            fillOpacity: 0.65,
            color: '#38bdf8',
            weight: 3,
            opacity: 1
        };
    }

    // Create Leaflet GeoJSON Layer
    geojsonLayer = L.geoJSON(data, {
        style: defaultStyle,
        onEachFeature: (feature, layer) => {

            // Bind Click Event
            layer.on({
                click: (e) => {
                    L.DomEvent.stopPropagation(e);

                    // Reset highlight on previous selection
                    if (activeSelectedLayer) {
                        geojsonLayer.resetStyle(activeSelectedLayer);
                    }

                    // Highlight current layer
                    activeSelectedLayer = layer;
                    layer.setStyle(highlightStyle());

                    // Open Popup
                    showFieldPopup(e, feature.properties);
                },
                mouseover: (e) => {
                    if (layer !== activeSelectedLayer) {
                        layer.setStyle({
                            fillOpacity: 0.55,
                            weight: 2.5,
                            color: '#6ee7b7'
                        });
                    }
                },
                mouseout: (e) => {
                    if (layer !== activeSelectedLayer) {
                        geojsonLayer.resetStyle(layer);
                    }
                }
            });

        }
    }).addTo(map);

    // Update Field Count Badge
    const fieldCountBadge = document.getElementById('field-count-badge');
    if (fieldCountBadge) {
        fieldCountBadge.innerText = `${data.features.length} แปลง`;
    }

    // Auto Zoom & Fit Bounds to all features
    fitMapToBounds();
}

// Fit map view to GeoJSON bounds
function fitMapToBounds() {
    if (geojsonLayer && geojsonLayer.getBounds().isValid()) {
        map.fitBounds(geojsonLayer.getBounds(), {
            padding: [50, 50],
            maxZoom: 16,
            animate: true,
            duration: 1
        });
    }
}

// Format and Show Field Attribute Popup
function showFieldPopup(e, props) {
    // Robust property key fallbacks to handle potential variations in field naming
    const fieldId = props.field_id || props.FIELD_ID || props.id || 'N/A';
    const province = props.province || props.PROVINCE || props.prov_nam_t || 'N/A';
    const district = props.district || props.DISTRICT || props.amphoe || 'N/A';
    const subdistrict = props.subdistrict || props.SUBDISTRICT || props.tambon || 'N/A';
    const cropType = props.crop_type || props.CROP_TYPE || props.crop || 'ข้าว (Rice)';
    const areaRai = props.area_rai || props.AREA_RAI || props.area || 'N/A';

    const popupContent = `
        <div class="p-3 max-w-xs space-y-3">
            <!-- Header -->
            <div class="flex items-center justify-between border-b border-slate-800 pb-2">
                <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span class="font-mono font-bold text-sm text-emerald-400">${fieldId}</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                    ${cropType}
                </span>
            </div>

            <!-- Attribute Details Table -->
            <div class="space-y-1.5 text-xs text-slate-300">
                <div class="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                    <span class="text-slate-400 flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3 text-cyan-400"></i> จังหวัด:</span>
                    <span class="font-semibold text-white">${province}</span>
                </div>
                <div class="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                    <span class="text-slate-400 flex items-center gap-1"><i data-lucide="navigation" class="w-3 h-3 text-cyan-400"></i> อำเภอ:</span>
                    <span class="font-semibold text-slate-200">${district}</span>
                </div>
                <div class="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                    <span class="text-slate-400 flex items-center gap-1"><i data-lucide="compass" class="w-3 h-3 text-cyan-400"></i> ตำบล:</span>
                    <span class="font-semibold text-slate-200">${subdistrict}</span>
                </div>
                <div class="flex justify-between items-center py-0.5 border-b border-slate-800/50">
                    <span class="text-slate-400 flex items-center gap-1"><i data-lucide="sprout" class="w-3 h-3 text-emerald-400"></i> ชนิดพืช:</span>
                    <span class="font-semibold text-emerald-300">${cropType}</span>
                </div>
                <div class="flex justify-between items-center py-0.5">
                    <span class="text-slate-400 flex items-center gap-1"><i data-lucide="ruler" class="w-3 h-3 text-amber-400"></i> พื้นที่:</span>
                    <span class="font-bold text-amber-300 font-mono">${areaRai} ไร่</span>
                </div>
            </div>
        </div>
    `;

    L.popup({
        closeButton: true,
        offset: [0, -10]
    })
    .setLatLng(e.latlng)
    .setContent(popupContent)
    .openOn(map);

    // Re-initialize dynamic icons inside Leaflet popup content
    setTimeout(() => lucide.createIcons(), 50);
}

// Filter Features by Selected Province or Search Input Query
function filterFeatures() {
    if (!allGeoJsonData) return;

    const selectedProvince = document.getElementById('province-filter').value;
    const searchQuery = document.getElementById('search-input').value.trim().toLowerCase();

    const filteredFeatures = allGeoJsonData.features.filter(feature => {
        const props = feature.properties || {};
        const fieldId = String(props.field_id || props.FIELD_ID || props.id || '').toLowerCase();
        const province = String(props.province || props.PROVINCE || '');

        const matchesProvince = (selectedProvince === 'ALL') || (province === selectedProvince);
        const matchesSearch = !searchQuery || fieldId.includes(searchQuery);

        return matchesProvince && matchesSearch;
    });

    const filteredGeoJson = {
        type: "FeatureCollection",
        features: filteredFeatures
    };

    renderGeoJsonOnMap(filteredGeoJson);

    // Show search clear button toggle
    const clearBtn = document.getElementById('clear-search-btn');
    if (clearBtn) {
        if (searchQuery) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }
    }
}

// Update UI Status Banner
function updateStatus(message, state) {
    const bannerText = document.getElementById('status-text');
    const pingDot = document.getElementById('status-ping');
    const statusDot = document.getElementById('status-dot');

    if (!bannerText) return;

    bannerText.innerText = message;

    if (state === 'loading') {
        pingDot.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75";
        statusDot.className = "relative inline-flex rounded-full h-2 w-2 bg-cyan-500";
    } else if (state === 'success') {
        pingDot.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75";
        statusDot.className = "relative inline-flex rounded-full h-2 w-2 bg-emerald-500";
    } else if (state === 'error') {
        pingDot.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75";
        statusDot.className = "relative inline-flex rounded-full h-2 w-2 bg-rose-500";
    }
}

// Attach Event Handlers on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
    initMap();

    // Province filter change listener
    const provinceFilter = document.getElementById('province-filter');
    if (provinceFilter) {
        provinceFilter.addEventListener('change', filterFeatures);
    }

    // Search input listener
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', filterFeatures);
    }

    // Search clear button
    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            filterFeatures();
        });
    }

    // Reset bounds button
    const btnResetView = document.getElementById('btn-reset-view');
    if (btnResetView) {
        btnResetView.addEventListener('click', fitMapToBounds);
    }
});
