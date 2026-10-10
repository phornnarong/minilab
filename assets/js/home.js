// Initialize Lucide icons
lucide.createIcons();

// Mobile menu toggle logic
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileDrawer = document.getElementById('mobile-drawer');
if (mobileMenuBtn && mobileDrawer) {
    mobileMenuBtn.addEventListener('click', () => {
        mobileDrawer.classList.toggle('hidden');
    });
}

// =========================================================================
// THREE.JS ISOMETRIC 3D AGRICULTURAL MAP SHOWCASE ENGINE
// =========================================================================

const container = document.getElementById('three-canvas-container');
let scene, camera, renderer, controls;
let fieldMeshes = [];
let markerGroup, scanPlane, particles;
let raycaster, mouse;
let animFrameId;

// Mock Field Metadata for Interactive Raycaster Click
const mockFieldsData = [
    { id: "SP-2026-084", location: "อ.บางปลาม้า จ.สุพรรณบุรี", area: "18 ไร่ 2 งาน", variety: "กข43 (RD43)", ndvi: 0.78, moisture: "64%", harvest: "15 พ.ย. 2026" },
    { id: "NP-2026-112", location: "อ.กำแพงแสน จ.นครปฐม", area: "24 ไร่ 1 งาน", variety: "หอมปทุม", ndvi: 0.85, moisture: "72%", harvest: "02 ธ.ค. 2026" },
    { id: "AY-2026-045", location: "อ.เสนา จ.พระนครศรีอยุธยา", area: "12 ไร่ 3 งาน", variety: "กข79", ndvi: 0.65, moisture: "58%", harvest: "20 พ.ย. 2026" },
    { id: "CN-2026-019", location: "อ.สรรคบุรี จ.ชัยนาท", area: "30 ไร่ 0 งาน", variety: "ข้าวขาวดอกมะลิ 105", ndvi: 0.82, moisture: "68%", harvest: "28 พ.ย. 2026" },
    { id: "SB-2026-056", location: "อ.อินทร์บุรี จ.สิงห์บุรี", area: "15 ไร่ 2 งาน", variety: "กข85", ndvi: 0.73, moisture: "61%", harvest: "10 ธ.ค. 2026" }
];

function init3DScene() {
    if (!container) return;

    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a12);
    scene.fog = new THREE.FogExp2(0x060a12, 0.018);

    // 2. Isometric Camera Setup
    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 1000);
    const initialCamPos = new THREE.Vector3(32, 28, 32);
    camera.position.copy(initialCamPos);
    camera.lookAt(0, 0, 0);

    // 3. WebGL Renderer Setup (Safe Context Creation)
    try {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
        if (!gl) {
            showWebGLFallback();
            return;
        }
        renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true, 
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false
        });
    } catch (e) {
        console.warn("WebGL Renderer context creation failed, rendering fallback UI:", e);
        showWebGLFallback();
        return;
    }

    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. Orbit Controls
    if (typeof THREE.OrbitControls !== 'undefined') {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxPolarAngle = Math.PI / 2.1; // Limit below ground view
        controls.minDistance = 20;
        controls.maxDistance = 70;
    }

    // 5. Lighting System
    const ambientLight = new THREE.AmbientLight(0x112233, 1.8);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0x34d399, 1.2);
    dirLight.position.set(20, 40, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const cyanLight = new THREE.PointLight(0x06b6d4, 1.5, 50);
    cyanLight.position.set(-15, 10, -15);
    scene.add(cyanLight);

    // 6. Terrain Mesh (Undulating Height displacement)
    const terrainGeo = new THREE.PlaneGeometry(50, 50, 60, 60);
    terrainGeo.rotateX(-Math.PI / 2);

    const posAttr = terrainGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        // Gentle elevation formula
        const y = Math.sin(x * 0.12) * 0.7 + Math.cos(z * 0.12) * 0.7 + Math.sin((x + z) * 0.08) * 0.5;
        posAttr.setY(i, y);
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
        color: 0x0a1c18,
        roughness: 0.85,
        metalness: 0.1,
        flatShading: true
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.receiveShadow = true;
    scene.add(terrain);

    // Grid outline wireframe on ground
    const gridHelper = new THREE.GridHelper(50, 50, 0x10b981, 0x1e293b);
    gridHelper.position.y = 0.02;
    scene.add(gridHelper);

    // 7. Winding Blue Irrigation Canal River
    const riverCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-25, 0.2, -15),
        new THREE.Vector3(-10, 0.2, -8),
        new THREE.Vector3(0, 0.2, 5),
        new THREE.Vector3(12, 0.2, 10),
        new THREE.Vector3(25, 0.2, 20)
    ]);
    const riverGeo = new THREE.TubeGeometry(riverCurve, 40, 1.2, 8, false);
    const riverMat = new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: 0x0369a1,
        emissiveIntensity: 0.6,
        roughness: 0.2,
        transparent: true,
        opacity: 0.85
    });
    const river = new THREE.Mesh(riverGeo, riverMat);
    scene.add(river);

    // 8. Paddy Field Polygons with dynamic NDVI vegetation health shades
    const fieldCoords = [
        { x: -12, z: -12, w: 8, h: 7, color: 0x10b981, ndviIndex: 0 },
        { x: -3, z: -14, w: 7, h: 6, color: 0x34d399, ndviIndex: 1 },
        { x: 6, z: -10, w: 9, h: 8, color: 0x84cc16, ndviIndex: 2 },
        { x: -15, z: 2, w: 7, h: 9, color: 0x10b981, ndviIndex: 3 },
        { x: -6, z: 8, w: 8, h: 8, color: 0x34d399, ndviIndex: 4 },
        { x: 8, z: 2, w: 10, h: 7, color: 0xa3e635, ndviIndex: 0 },
        { x: 15, z: -12, w: 7, h: 7, color: 0x10b981, ndviIndex: 1 },
        { x: -18, z: -2, w: 6, h: 6, color: 0xfacc15, ndviIndex: 2 },
        { x: 12, z: 12, w: 8, h: 8, color: 0x34d399, ndviIndex: 3 },
    ];

    fieldCoords.forEach((field, idx) => {
        const shape = new THREE.Shape();
        const halfW = field.w / 2;
        const halfH = field.h / 2;

        // Organic polygon shape offset
        shape.moveTo(-halfW, -halfH);
        shape.lineTo(halfW - 0.5, -halfH + 0.3);
        shape.lineTo(halfW + 0.2, halfH - 0.4);
        shape.lineTo(-halfW + 0.4, halfH);
        shape.closePath();

        const extrudeSettings = { depth: 0.3, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.1, bevelThickness: 0.1 };
        const fieldGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        fieldGeo.rotateX(-Math.PI / 2);

        const fieldMat = new THREE.MeshStandardMaterial({
            color: field.color,
            roughness: 0.6,
            metalness: 0.2,
            emissive: field.color,
            emissiveIntensity: 0.15
        });

        const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
        fieldMesh.position.set(field.x, 0.4, field.z);
        fieldMesh.castShadow = true;
        fieldMesh.receiveShadow = true;
        fieldMesh.userData = { ...mockFieldsData[field.ndviIndex], meshIndex: idx };

        // Glowing polygon border line
        const edges = new THREE.EdgesGeometry(fieldGeo);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2 });
        const wireframe = new THREE.LineSegments(edges, lineMat);
        fieldMesh.add(wireframe);

        scene.add(fieldMesh);
        fieldMeshes.push(fieldMesh);
    });

    // 9. Scatter Low-Poly Trees
    const treeGeo = new THREE.ConeGeometry(0.8, 2, 5);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.9 });
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.8, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f });

    for (let i = 0; i < 25; i++) {
        const tx = (Math.random() - 0.5) * 42;
        const tz = (Math.random() - 0.5) * 42;

        const treeGroup = new THREE.Group();
        const foliage = new THREE.Mesh(treeGeo, treeMat);
        foliage.position.y = 1.2;
        foliage.castShadow = true;

        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 0.4;

        treeGroup.add(foliage);
        treeGroup.add(trunk);
        treeGroup.position.set(tx, 0.3, tz);
        scene.add(treeGroup);
    }

    // 10. Floating 3D GIS Markers with Pulsing Beams
    markerGroup = new THREE.Group();
    const keyMarkerPositions = [
        { x: -12, z: -12, dataIdx: 0 },
        { x: -3, z: -14, dataIdx: 1 },
        { x: 6, z: -10, dataIdx: 2 },
        { x: -6, z: 8, dataIdx: 3 },
        { x: 12, z: 12, dataIdx: 4 }
    ];

    keyMarkerPositions.forEach((pos) => {
        const mGroup = new THREE.Group();
        mGroup.position.set(pos.x, 3.5, pos.z);

        // Floating Pin Mesh
        const pinGeo = new THREE.OctahedronGeometry(0.7, 0);
        const pinMat = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            emissive: 0x06b6d4,
            emissiveIntensity: 0.8,
            metalness: 0.8,
            roughness: 0.2
        });
        const pin = new THREE.Mesh(pinGeo, pinMat);
        mGroup.add(pin);

        // Vertical Light Beam
        const beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x34d399,
            transparent: true,
            opacity: 0.5
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = -1.75;
        mGroup.add(beam);

        // Pulsing Ground Ring
        const ringGeo = new THREE.RingGeometry(0.8, 1.1, 16);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x34d399,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = -3.4;
        mGroup.add(ring);

        mGroup.userData = mockFieldsData[pos.dataIdx];
        markerGroup.add(mGroup);
    });
    scene.add(markerGroup);

    // 11. Animated Laser Scan Plane
    const scanGeo = new THREE.BoxGeometry(0.2, 10, 50);
    const scanMat = new THREE.MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
    });
    scanPlane = new THREE.Mesh(scanGeo, scanMat);
    scanPlane.position.set(-25, 2, 0);
    scene.add(scanPlane);

    // 12. Floating Atmospheric Particles
    const pCount = 180;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i += 3) {
        pPos[i] = (Math.random() - 0.5) * 50;
        pPos[i + 1] = Math.random() * 15;
        pPos[i + 2] = (Math.random() - 0.5) * 50;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
        color: 0x34d399,
        size: 0.25,
        transparent: true,
        opacity: 0.6
    });
    particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // 13. Raycasting setup for mouse interactivity
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Register Event Listeners
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('click', onCanvasClick);

    // Check reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
        animateScene();
    } else {
        renderer.render(scene, camera);
    }
}

let clock = new THREE.Clock();

function animateScene() {
    animFrameId = requestAnimationFrame(animateScene);

    const elapsedTime = clock.getElapsedTime();

    // Controls update
    if (controls) controls.update();

    // Slow Orbit Scene Rotation if user is not interacting
    if (controls && !controls.state == -1) {
        scene.rotation.y = elapsedTime * 0.03;
    } else {
        scene.rotation.y = elapsedTime * 0.02;
    }

    // Animate Scan Light Plane
    scanPlane.position.x = ((elapsedTime * 6) % 50) - 25;

    // Animate GIS Marker Bobbing & Rotation
    if (markerGroup) {
        markerGroup.children.forEach((m, idx) => {
            m.children[0].rotation.y = elapsedTime * 2;
            m.children[0].position.y = Math.sin(elapsedTime * 2.5 + idx) * 0.3;
        });
    }

    // Drifting Particles
    if (particles) {
        particles.rotation.y = elapsedTime * 0.01;
    }

    renderer.render(scene, camera);
}

// Handle Canvas Clicks & Field Selection
function onCanvasClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Check field meshes click
    const intersects = raycaster.intersectObjects([...fieldMeshes, ...markerGroup.children], true);

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj.parent && hitObj.parent !== scene && !hitObj.userData.id) {
            hitObj = hitObj.parent;
        }

        if (hitObj.userData && hitObj.userData.id) {
            showFieldModal(hitObj.userData);
        }
    }
}

// Show Modal Tooltip with Field Details
function showFieldModal(data) {
    const modal = document.getElementById('field-modal');
    if (!modal) return;

    document.getElementById('modal-field-id').innerText = data.id;
    document.getElementById('modal-location').innerText = data.location;
    document.getElementById('modal-area').innerText = data.area;
    document.getElementById('modal-variety').innerText = data.variety;
    document.getElementById('modal-ndvi').innerText = data.ndvi;
    document.getElementById('modal-moisture').innerText = data.moisture;
    document.getElementById('modal-harvest').innerText = data.harvest;

    const ndviBar = document.getElementById('modal-ndvi-bar');
    if (ndviBar) {
        ndviBar.style.width = (data.ndvi * 100) + '%';
    }

    modal.classList.remove('hidden');
}

// Modal Close Button
const closeModalBtn = document.getElementById('close-modal-btn');
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
        document.getElementById('field-modal').classList.add('hidden');
    });
}

// Camera Reset Button
const resetCamBtn = document.getElementById('reset-cam-btn');
if (resetCamBtn) {
    resetCamBtn.addEventListener('click', () => {
        if (camera && controls) {
            camera.position.set(32, 28, 32);
            controls.target.set(0, 0, 0);
            controls.update();
        }
    });
}

// Handle Window Resize
function onWindowResize() {
    if (!container || !camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

window.addEventListener('load', () => {
    try {
        // Test actual WebGL context creation capability
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl && gl instanceof WebGLRenderingContext) {
            init3DScene();
        } else {
            showWebGLFallback();
        }
    } catch (err) {
        console.warn("WebGL initialization failed, loading fallback graphic:", err);
        showWebGLFallback();
    }
});

function showWebGLFallback() {
    if (!container) return;
    container.innerHTML = `
        <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-navy-900/90 rounded-2xl border border-slate-800">
            <div class="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-4">
                <i data-lucide="map" class="w-8 h-8"></i>
            </div>
            <h3 class="text-lg font-bold text-white">Precision GIS Visualizer</h3>
            <p class="text-xs text-slate-400 max-w-sm mt-2">
                แสดงข้อมูลภูมิสารสนเทศจำลองของแปลงนา 5 จังหวัดในระบบ สามารถเข้าชมผ่านระบบแผนที่หลักได้
            </p>
            <a href="map.html" class="mt-4 px-5 py-2.5 rounded-xl bg-emerald-500 text-navy-950 font-bold text-xs hover:bg-emerald-400 transition-colors">
                เข้าสู่แผนที่ interactive
            </a>
        </div>
    `;
    lucide.createIcons();
}
