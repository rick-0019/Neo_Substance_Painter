import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Painter } from './painter.js?v=3.4';
import { DecalSystem } from './decals.js?v=3.4';
import { LayerManager } from './layers.js?v=3.4';
import { PapercraftEngine } from './papercraft.js?v=3.4';

// Configuration
let TEX_SIZE = 2048;

// Application State
const state = {
    mesh: null,
    texture: null,
    uvWireframeVisible: true,
};

// Canvas 2D Setup (Visible UV and hidden render buffer)
const canvas2d = document.getElementById('canvas-2d');
canvas2d.width = TEX_SIZE;
canvas2d.height = TEX_SIZE;

// Layer Manager (Gestor de Capas Acelerado por GPU)
const layerManager = new LayerManager(canvas2d, TEX_SIZE, TEX_SIZE, () => {
    if (state.texture) state.texture.needsUpdate = true;
});
window.layerManager = layerManager;

// Canvas UV Overlay
const canvasUV = document.getElementById('canvas-uv');
canvasUV.width = TEX_SIZE;
canvasUV.height = TEX_SIZE;
const ctxUV = canvasUV.getContext('2d');

document.getElementById('btn-apply-res').addEventListener('click', () => {
    if(!confirm('Cambiar la resolución limpiará la textura actual. ¿Continuar?')) return;
    TEX_SIZE = parseInt(document.getElementById('doc-resolution').value, 10);
    
    layerManager.resize(TEX_SIZE, TEX_SIZE);
    
    canvasUV.width = TEX_SIZE;
    canvasUV.height = TEX_SIZE;
    const canvasUI = document.getElementById('canvas-ui');
    if (canvasUI) {
        canvasUI.width = TEX_SIZE;
        canvasUI.height = TEX_SIZE;
    }
    
    drawUVWireframe();
    state.texture.needsUpdate = true;
});

// Create Three.js Texture from Canvas
const canvasTexture = new THREE.CanvasTexture(canvas2d);
canvasTexture.colorSpace = THREE.SRGBColorSpace;
state.texture = canvasTexture;

// Three.js Setup
const view3d = document.getElementById('view-3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(45, view3d.clientWidth / view3d.clientHeight, 0.1, 1000);
camera.position.set(0, 0, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(view3d.clientWidth, view3d.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
view3d.appendChild(renderer.domElement);

// Configuración de máxima fidelidad y filtrado anisotrópico para evitar efecto serrucho
const maxAniso = renderer.capabilities.getMaxAnisotropy();
canvasTexture.anisotropy = maxAniso;
canvasTexture.minFilter = THREE.LinearMipmapLinearFilter;
canvasTexture.magFilter = THREE.LinearFilter;
canvasTexture.generateMipmaps = true;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = true; // Paneo relativo al plano de la pantalla (suave y natural)

// ASIGNACIÓN DE CONTROLES EN VISTA 3D:
// Botón Izquierdo: Pintar directamente sobre el modelo 3D / Calcomanías
// Botón Central / Rueda presionada: Mover / Panear la vista del modelo
// Botón Derecho: Rotar / Orbitar la cámara alrededor del modelo
// Giro de Rueda: Zoom in / Zoom out
controls.mouseButtons = {
    LEFT: THREE.MOUSE.NONE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE
};

// Evitar menú contextual en clic derecho y autoscroll nativo en clic central
view3d.addEventListener('contextmenu', e => e.preventDefault());
view3d.addEventListener('mousedown', e => {
    if (e.button === 1) e.preventDefault();
});
view3d.addEventListener('auxclick', e => {
    if (e.button === 1) e.preventDefault();
});
view3d.addEventListener('pointerdown', e => {
    if (e.button === 1) {
        e.preventDefault();
        view3d.style.cursor = 'grab';
    }
});
window.addEventListener('pointerup', e => {
    if (e.button === 1) {
        view3d.style.cursor = '';
    }
});

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// Systems
const painter = new Painter(scene, camera, renderer, canvas2d, canvasTexture, layerManager);
window.painter = painter;
const decalSystem = new DecalSystem(scene, camera, renderer, canvas2d, canvasTexture, layerManager, painter);
window.decalSystem = decalSystem;

// Papercraft Engine (Unfold, Solapas, A4 1:1, PDF)
const papercraft = new PapercraftEngine();
window.papercraft = papercraft;
papercraft.setRedrawCallback(() => {
    drawUVWireframe();
    if (typeof renderUnfoldWorkbench === 'function') renderUnfoldWorkbench();
});

// UI Texture para previsualizar formas en 3D
const canvasUI = document.getElementById('canvas-ui');
const textureUI = new THREE.CanvasTexture(canvasUI);
textureUI.colorSpace = THREE.SRGBColorSpace;
textureUI.anisotropy = maxAniso;
textureUI.minFilter = THREE.LinearMipmapLinearFilter;
textureUI.magFilter = THREE.LinearFilter;
textureUI.generateMipmaps = true;
state.textureUI = textureUI;

// Material por defecto (Cubo inicial)
const defaultGeo = new THREE.BoxGeometry(2, 2, 2);
const defaultMat = new THREE.MeshBasicMaterial({ 
    map: state.texture,
    side: THREE.DoubleSide
});
state.mesh = new THREE.Mesh(defaultGeo, defaultMat);

const edges = new THREE.EdgesGeometry(defaultGeo);
const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.2, transparent: true }));
state.mesh.add(line);
scene.add(state.mesh);
painter.setMesh(state.mesh);
decalSystem.setMesh(state.mesh);
layerManager.renderUI();

// Helper para sincronizar valores visuales del panel Papercraft
function updatePapercraftUI() {
    const badge = document.getElementById('unfold-scale-badge');
    if (badge) badge.textContent = papercraft.currentScale;
    const wingspanVal = document.getElementById('unfold-wingspan-val');
    if (wingspanVal) wingspanVal.textContent = papercraft.wingspanMm;
    const heightVal = document.getElementById('unfold-height-val');
    if (heightVal) heightVal.textContent = papercraft.heightMm;
    const lengthInput = document.getElementById('unfold-model-length');
    if (lengthInput) lengthInput.value = papercraft.modelLengthMm;
    const partsCount = document.getElementById('unfold-parts-count');
    if (partsCount) partsCount.textContent = `${papercraft.parts.length} piezas (${papercraft.pagesCount} Hojas A4)`;
}

// Carga y procesamiento de modelos OBJ
function loadOBJContents(contents) {
    try {
        const loader = new OBJLoader();
        const object = loader.parse(contents);

        if (state.mesh) scene.remove(state.mesh);

        let hasUVs = false;
        const meshes = [];
        object.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry && child.geometry.attributes && child.geometry.attributes.uv) {
                    hasUVs = true;
                }
                child.material = new THREE.MeshBasicMaterial({
                    map: state.texture,
                    side: THREE.DoubleSide
                });
                
                // Wireframe sutil sobre cada parte
                const childEdges = new THREE.EdgesGeometry(child.geometry);
                const childLine = new THREE.LineSegments(childEdges, new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.2, transparent: true }));
                child.add(childLine);
                
                meshes.push(child);
            }
        });

        if (!hasUVs || meshes.length === 0) {
            alert('El modelo no tiene coordenadas UV (vt) o no contiene mallas válidas.');
            return;
        }

        state.mesh = object;
        scene.add(state.mesh);
        
        // Encuadrar cámara automáticamente según el tamaño real del modelo
        frameModel(state.mesh);
        
        painter.setMesh(state.mesh);
        decalSystem.setMesh(state.mesh);
        
        // Analizar topología Papercraft (separación de piezas y auto-acomodo en hojas A4)
        papercraft.analyzeMesh(state.mesh, TEX_SIZE);
        updatePapercraftUI();
        
        // Dibujar vista UV / Papercraft
        drawUVWireframe();
        renderUnfoldWorkbench();
    } catch (err) {
        console.error('Error cargando OBJ:', err);
        alert('Error al procesar el archivo OBJ: ' + err.message);
    }
}

// Intentar cargar modelo bomba_v1.obj automáticamente al iniciar
fetch('models/bomba_v1.obj')
    .then(r => { if (r.ok) return r.text(); throw new Error('Not found'); })
    .then(txt => loadOBJContents(txt))
    .catch(() => {
        papercraft.analyzeMesh(state.mesh, TEX_SIZE);
        updatePapercraftUI();
        drawUVWireframe();
        renderUnfoldWorkbench();
    });

// Banco de Trabajo Interactivo A4 (Unfold Workbench)
const canvasUnfold = document.getElementById('canvas-unfold');
const ctxUnfold = canvasUnfold?.getContext('2d');
const unfoldWorkbench = document.getElementById('unfold-workbench');
const canvasContainer = document.querySelector('.canvas-container');
const view2dLabel = document.getElementById('view-2d-label');

function renderUnfoldWorkbench() {
    if (!canvasUnfold || !ctxUnfold || !papercraft.active) return;
    const rect = unfoldWorkbench.getBoundingClientRect();
    if (rect.width > 10 && rect.height > 10) {
        if (canvasUnfold.width !== rect.width || canvasUnfold.height !== rect.height) {
            canvasUnfold.width = rect.width;
            canvasUnfold.height = rect.height;
        }
    }
    papercraft.renderUnfoldWorkbench(ctxUnfold, canvasUnfold.width, canvasUnfold.height, canvas2d);
}
window.renderUnfoldWorkbench = renderUnfoldWorkbench;

// Eventos del Panel Lateral (Tabs: Capas vs Unfold)
const tabBtnLayers = document.getElementById('tab-btn-layers');
const tabBtnUnfold = document.getElementById('tab-btn-unfold');
const tabContentLayers = document.getElementById('tab-content-layers');
const tabContentUnfold = document.getElementById('tab-content-unfold');

function switchSidebarTab(tab) {
    if (tab === 'layers') {
        tabBtnLayers?.classList.add('active');
        tabBtnUnfold?.classList.remove('active');
        tabContentLayers?.classList.add('active');
        tabContentUnfold?.classList.remove('active');
    } else {
        tabBtnUnfold?.classList.add('active');
        tabBtnLayers?.classList.remove('active');
        tabContentUnfold?.classList.add('active');
        tabContentLayers?.classList.remove('active');
    }
}
tabBtnLayers?.addEventListener('click', () => switchSidebarTab('layers'));
tabBtnUnfold?.addEventListener('click', () => {
    switchSidebarTab('unfold');
    if (!papercraft.active) {
        btnRibbonUnfold?.click();
    }
});

// Eventos del Panel de Capas (Layers)
document.getElementById('btn-add-layer')?.addEventListener('click', () => {
    layerManager.addLayer();
});
document.getElementById('btn-duplicate-layer')?.addEventListener('click', () => {
    if (window.painter && window.painter.transformState && window.painter.transformState.active) {
        window.painter.commitLayerTransform();
    }
    const newLayer = layerManager.duplicateLayer();
    if (newLayer && window.painter) {
        const transformBtn = document.getElementById('btn-tool-transform');
        if (transformBtn) {
            toolButtons.forEach(b => b.classList.remove('active'));
            transformBtn.classList.add('active');
            brushModeInput.value = 'transform';
        }
        window.painter.startLayerTransform();
    }
});
document.getElementById('btn-delete-layer')?.addEventListener('click', () => {
    layerManager.removeLayer(layerManager.activeLayerId);
});
document.getElementById('btn-layer-up')?.addEventListener('click', () => {
    layerManager.moveLayer(layerManager.activeLayerId, 1);
});
document.getElementById('btn-layer-down')?.addEventListener('click', () => {
    layerManager.moveLayer(layerManager.activeLayerId, -1);
});
document.getElementById('btn-toggle-layers')?.addEventListener('click', () => {
    const panel = document.getElementById('panel-layers');
    panel.classList.toggle('collapsed');
    const btn = document.getElementById('btn-toggle-layers');
    btn.textContent = panel.classList.contains('collapsed') ? '📑' : '✖';
});

// Load OBJ manual (botón Archivo)
document.getElementById('btn-load-obj').addEventListener('click', () => document.getElementById('input-obj').click());
document.getElementById('input-obj').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        loadOBJContents(event.target.result);
    };
    reader.readAsText(file);
});

// Botón Ribbon Modo Papercraft / Unfold
const btnRibbonUnfold = document.getElementById('btn-ribbon-unfold-mode');
btnRibbonUnfold?.addEventListener('click', () => {
    papercraft.active = !papercraft.active;
    if (papercraft.active) {
        btnRibbonUnfold.style.background = '#e65100';
        btnRibbonUnfold.textContent = '✂️ Unfold (ON)';
        if (unfoldWorkbench) unfoldWorkbench.style.display = 'block';
        if (canvasContainer) canvasContainer.style.display = 'none';
        if (view2dLabel) view2dLabel.style.display = 'none';
        switchSidebarTab('unfold');
        const panel = document.getElementById('panel-layers');
        if (panel?.classList.contains('collapsed')) {
            panel.classList.remove('collapsed');
        }
        renderUnfoldWorkbench();
    } else {
        btnRibbonUnfold.style.background = '#555';
        btnRibbonUnfold.textContent = '✂️ Modo Unfold';
        if (unfoldWorkbench) unfoldWorkbench.style.display = 'none';
        if (canvasContainer) canvasContainer.style.display = 'block';
        if (view2dLabel) {
            view2dLabel.style.display = 'block';
            view2dLabel.textContent = 'Vista 2D (UV)';
        }
        drawUVWireframe();
    }
});

// Interacción de Arrastre y Rotación en el Banco de Hojas A4
let isPanningWorkbench = false;
let startPanX = 0, startPanY = 0;

canvasUnfold?.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Clic izquierdo: arrastrar pieza o mover mesa
        const hit = papercraft.getPartAt(e.offsetX, e.offsetY);
        if (hit) {
            papercraft.selectedPart = hit.part;
            papercraft.isDraggingPart = true;
            canvasUnfold.style.cursor = 'grabbing';
            renderUnfoldWorkbench();
        } else {
            papercraft.selectedPart = null;
            isPanningWorkbench = true;
            startPanX = e.clientX - papercraft.panX;
            startPanY = e.clientY - papercraft.panY;
            canvasUnfold.style.cursor = 'move';
            renderUnfoldWorkbench();
        }
    } else if (e.button === 2) { // Clic derecho: rotar pieza o mover mesa
        const hit = papercraft.getPartAt(e.offsetX, e.offsetY);
        if (hit) {
            papercraft.selectedPart = hit.part;
            papercraft.rotateSelectedPart(45);
            renderUnfoldWorkbench();
        } else {
            isPanningWorkbench = true;
            startPanX = e.clientX - papercraft.panX;
            startPanY = e.clientY - papercraft.panY;
            canvasUnfold.style.cursor = 'move';
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (!papercraft.active || !canvasUnfold) return;

    if (papercraft.isDraggingPart && papercraft.selectedPart) {
        const mmToPx = 4.0;
        const dx_mm = e.movementX / (papercraft.zoom * mmToPx);
        const dy_mm = e.movementY / (papercraft.zoom * mmToPx);

        const sheetGapMm = 20.0;
        const pagePitchMm = papercraft.A4_W + sheetGapMm;

        // Calcular posición global continua en el banco de trabajo
        let curWorkbenchX = papercraft.selectedPart.layout.pageIndex * pagePitchMm + papercraft.selectedPart.layout.x;
        curWorkbenchX += dx_mm;
        papercraft.selectedPart.layout.y = Math.round((papercraft.selectedPart.layout.y + dy_mm) * 10) / 10;

        // Determinar dinámicamente a qué hoja corresponde sin saltos ni cortes
        const newPage = Math.max(0, Math.min(papercraft.pagesCount - 1, Math.floor(curWorkbenchX / pagePitchMm)));
        papercraft.selectedPart.layout.pageIndex = newPage;
        papercraft.selectedPart.layout.x = Math.round((curWorkbenchX - newPage * pagePitchMm) * 10) / 10;

        renderUnfoldWorkbench();
    } else if (isPanningWorkbench) {
        papercraft.panX = e.clientX - startPanX;
        papercraft.panY = e.clientY - startPanY;
        renderUnfoldWorkbench();
    } else {
        const rect = canvasUnfold.getBoundingClientRect();
        const hit = papercraft.getPartAt(e.clientX - rect.left, e.clientY - rect.top);
        canvasUnfold.style.cursor = hit ? 'grab' : 'default';
    }
});

window.addEventListener('mouseup', () => {
    if (!papercraft.active) return;
    papercraft.isDraggingPart = false;
    isPanningWorkbench = false;
    if (canvasUnfold) canvasUnfold.style.cursor = 'default';
    renderUnfoldWorkbench();
});

canvasUnfold?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : (1 / 1.15);
    const oldZoom = papercraft.zoom;
    papercraft.zoom = Math.max(0.2, Math.min(5.0, papercraft.zoom * zoomFactor));
    papercraft.panX = e.offsetX - (e.offsetX - papercraft.panX) * (papercraft.zoom / oldZoom);
    papercraft.panY = e.offsetY - (e.offsetY - papercraft.panY) * (papercraft.zoom / oldZoom);
    renderUnfoldWorkbench();
});

canvasUnfold?.addEventListener('contextmenu', e => e.preventDefault());

// Botones de zoom para Unfold
document.getElementById('btn-unfold-zoom-in')?.addEventListener('click', () => {
    papercraft.zoom = Math.min(5.0, papercraft.zoom * 1.25);
    renderUnfoldWorkbench();
});
document.getElementById('btn-unfold-zoom-out')?.addEventListener('click', () => {
    papercraft.zoom = Math.max(0.2, papercraft.zoom / 1.25);
    renderUnfoldWorkbench();
});
document.getElementById('btn-unfold-zoom-reset')?.addEventListener('click', () => {
    papercraft.zoom = 1.0;
    papercraft.panX = 40;
    papercraft.panY = 40;
    renderUnfoldWorkbench();
});

// Botones Auto-Acomodar, Rotar, +Hoja A4
function handleAutoPack() {
    papercraft.autoPackA4();
    renderUnfoldWorkbench();
}
document.getElementById('btn-unfold-autopack')?.addEventListener('click', handleAutoPack);
document.getElementById('btn-unfold-autopack-side')?.addEventListener('click', handleAutoPack);

function handleRotatePart() {
    papercraft.rotateSelectedPart(45);
    renderUnfoldWorkbench();
}
document.getElementById('btn-unfold-rotate')?.addEventListener('click', handleRotatePart);
document.getElementById('btn-unfold-rotate-side')?.addEventListener('click', handleRotatePart);

function handleAddPage() {
    papercraft.addPage();
    renderUnfoldWorkbench();
}
document.getElementById('btn-unfold-add-page')?.addEventListener('click', handleAddPage);
document.getElementById('btn-unfold-add-page-side')?.addEventListener('click', handleAddPage);

// Exportar PDF A4 1:1 (Ribbon y Panel Unfold)
function triggerPdfExport() {
    papercraft.exportA4PDF(canvas2d, 'Neo_Papercraft_A4_1-1.pdf');
}
document.getElementById('btn-ribbon-export-pdf-a4')?.addEventListener('click', triggerPdfExport);
document.getElementById('btn-unfold-export-pdf')?.addEventListener('click', triggerPdfExport);

// Sincronización Checkbox: Solapas
const ribbonCheckFlaps = document.getElementById('ribbon-toggle-flaps');
const unfoldCheckFlaps = document.getElementById('unfold-check-flaps');
function syncFlaps(val) {
    papercraft.showFlaps = val;
    if (ribbonCheckFlaps) ribbonCheckFlaps.checked = val;
    if (unfoldCheckFlaps) unfoldCheckFlaps.checked = val;
    drawUVWireframe();
    renderUnfoldWorkbench();
}
ribbonCheckFlaps?.addEventListener('change', (e) => syncFlaps(e.target.checked));
unfoldCheckFlaps?.addEventListener('change', (e) => syncFlaps(e.target.checked));

// Sincronización Checkbox: Limpiar curvas
const ribbonCheckSmooth = document.getElementById('ribbon-toggle-hide-smooth');
const unfoldCheckSmooth = document.getElementById('unfold-check-hide-smooth');
function syncHideSmooth(val) {
    papercraft.hideSmoothLines = val;
    if (ribbonCheckSmooth) ribbonCheckSmooth.checked = val;
    if (unfoldCheckSmooth) unfoldCheckSmooth.checked = val;
    drawUVWireframe();
    renderUnfoldWorkbench();
}
ribbonCheckSmooth?.addEventListener('change', (e) => syncHideSmooth(e.target.checked));
unfoldCheckSmooth?.addEventListener('change', (e) => syncHideSmooth(e.target.checked));

// Sincronización Checkbox: Guía A4
const ribbonCheckA4 = document.getElementById('ribbon-toggle-a4-guide');
const unfoldCheckA4 = document.getElementById('unfold-check-a4-guide');
function syncA4Guide(val) {
    papercraft.showA4Guide = val;
    if (ribbonCheckA4) ribbonCheckA4.checked = val;
    if (unfoldCheckA4) unfoldCheckA4.checked = val;
    drawUVWireframe();
    renderUnfoldWorkbench();
}
ribbonCheckA4?.addEventListener('change', (e) => syncA4Guide(e.target.checked));
unfoldCheckA4?.addEventListener('change', (e) => syncA4Guide(e.target.checked));

// Numeración de piezas (Sincronización Ribbon y Panel Lateral)
const ribbonCheckNumbers = document.getElementById('ribbon-toggle-numbers');
const ribbonNumbersMode = document.getElementById('ribbon-numbers-mode');
const unfoldCheckNumbers = document.getElementById('unfold-check-numbers');
const unfoldNumbersMode = document.getElementById('unfold-numbers-mode');
const unfoldNumbersModeRow = document.getElementById('unfold-numbers-mode-row');

let currentNumberMode = 'flaps';

function syncNumbers(enabled, mode = currentNumberMode) {
    currentNumberMode = mode;
    papercraft.showTabNumbers = enabled;
    papercraft.numberPlacement = enabled ? mode : 'none';

    if (ribbonCheckNumbers) ribbonCheckNumbers.checked = enabled;
    if (unfoldCheckNumbers) unfoldCheckNumbers.checked = enabled;

    if (ribbonNumbersMode) {
        ribbonNumbersMode.style.display = enabled ? 'block' : 'none';
        ribbonNumbersMode.value = mode;
    }
    if (unfoldNumbersModeRow) {
        unfoldNumbersModeRow.style.display = enabled ? 'flex' : 'none';
    }
    if (unfoldNumbersMode) {
        unfoldNumbersMode.value = mode;
    }

    drawUVWireframe();
    renderUnfoldWorkbench();
}

ribbonCheckNumbers?.addEventListener('change', (e) => syncNumbers(e.target.checked));
unfoldCheckNumbers?.addEventListener('change', (e) => syncNumbers(e.target.checked));
ribbonNumbersMode?.addEventListener('change', (e) => syncNumbers(true, e.target.value));
unfoldNumbersMode?.addEventListener('change', (e) => syncNumbers(true, e.target.value));

// Control de altura de solapas (mm)
const tabHSlider = document.getElementById('unfold-tab-height');
const tabHLabel = document.getElementById('unfold-tab-h-val');
function updateTabHeight(val) {
    const clamped = Math.max(2, Math.min(15, parseFloat(val) || 5));
    papercraft.tabHeightMm = clamped;
    if (tabHSlider) tabHSlider.value = clamped;
    if (tabHLabel) tabHLabel.textContent = `${clamped} mm`;
    if (state.mesh) papercraft.analyzeMesh(state.mesh, TEX_SIZE);
    drawUVWireframe();
    renderUnfoldWorkbench();
}
tabHSlider?.addEventListener('input', (e) => updateTabHeight(e.target.value));
document.getElementById('btn-tab-h-dec')?.addEventListener('click', () => updateTabHeight(papercraft.tabHeightMm - 0.5));
document.getElementById('btn-tab-h-inc')?.addEventListener('click', () => updateTabHeight(papercraft.tabHeightMm + 0.5));

// Control de ángulo de solapas
const tabAngleSlider = document.getElementById('unfold-tab-angle');
const tabAngleLabel = document.getElementById('unfold-tab-angle-val');
tabAngleSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    papercraft.tabAngleDeg = val;
    if (tabAngleLabel) tabAngleLabel.textContent = `${val}°`;
    if (state.mesh) papercraft.analyzeMesh(state.mesh, TEX_SIZE);
    drawUVWireframe();
    renderUnfoldWorkbench();
});

// Control de estilo de líneas de corte (Color y Grosor)
const unfoldCutColor = document.getElementById('unfold-cut-color');
unfoldCutColor?.addEventListener('change', (e) => {
    papercraft.cutLineColor = e.target.value;
    renderUnfoldWorkbench();
});

const unfoldCutWidth = document.getElementById('unfold-cut-width');
unfoldCutWidth?.addEventListener('change', (e) => {
    papercraft.cutLineWidthMm = parseFloat(e.target.value);
    renderUnfoldWorkbench();
});

// Control de longitud del modelo armado (mm)
const modelLenInput = document.getElementById('unfold-model-length');
modelLenInput?.addEventListener('change', (e) => {
    const val = parseFloat(e.target.value) || 200;
    papercraft.currentScale = 'custom';
    papercraft.setModelLength(val);
    updatePapercraftUI();
    drawUVWireframe();
    renderUnfoldWorkbench();
});

// Selector de Escala Preset
document.getElementById('unfold-scale-preset')?.addEventListener('change', (e) => {
    const preset = e.target.value;
    papercraft.currentScale = preset;
    const realV1Length = 7900;
    if (preset === '1:33') {
        papercraft.setModelLength(Math.round(realV1Length / 33));
    } else if (preset === '1:24') {
        papercraft.setModelLength(Math.round(realV1Length / 24));
    } else if (preset === '1:48') {
        papercraft.setModelLength(Math.round(realV1Length / 48));
    } else if (preset === '1:72') {
        papercraft.setModelLength(Math.round(realV1Length / 72));
    }
    updatePapercraftUI();
    drawUVWireframe();
    renderUnfoldWorkbench();
});

// Orientación de la hoja A4
document.getElementById('unfold-a4-orient')?.addEventListener('change', (e) => {
    papercraft.a4Orientation = e.target.value;
    drawUVWireframe();
    renderUnfoldWorkbench();
});

// UI Event Listeners para Malla UV clásica
document.getElementById('toggle-wireframe').addEventListener('change', (e) => {
    state.uvWireframeVisible = e.target.checked;
    drawUVWireframe();
});

// Export texture (PNG)
document.getElementById('btn-export').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'textura.png';
    link.href = document.getElementById('canvas-2d').toDataURL('image/png');
    link.click();
});

// Export PDF (A4) rápido desde Archivo
document.getElementById('btn-export-pdf').addEventListener('click', () => {
    triggerPdfExport();
});

// Toolbar buttons logic
const toolButtons = document.querySelectorAll('.tool-btn[data-mode]');
const brushModeInput = document.getElementById('brush-mode');
toolButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.tool-btn[data-mode]');
        if (!targetBtn) return;
        
        if (window.painter && window.painter.editingShape) {
            window.painter.commitShape();
        }

        const mode = targetBtn.getAttribute('data-mode');
        if (!mode) return;

        if (mode === 'transform') {
            toolButtons.forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
            brushModeInput.value = 'transform';
            if (window.painter) {
                window.painter.startLayerTransform();
            }
            return;
        }

        if (mode === 'text') {
            toolButtons.forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
            brushModeInput.value = 'text';
            if (window.decalSystem) {
                window.decalSystem.startTextMode();
            }
            return;
        }

        // Si se cambia de herramienta mientras se transformaba una capa, aplicar cambios
        if (window.painter && window.painter.transformState && window.painter.transformState.active) {
            window.painter.commitLayerTransform();
        }

        // Si se cambia de herramienta mientras se editaba texto o calcomanía, cancelar
        if (window.decalSystem && window.decalSystem.isTextMode && mode !== 'text') {
            window.decalSystem.cancelDecal();
        }
        
        toolButtons.forEach(b => b.classList.remove('active'));
        targetBtn.classList.add('active');
        brushModeInput.value = mode;
    });
});

// Controles contextuales de Transformación de Capa
document.getElementById('btn-transform-fliph')?.addEventListener('click', () => {
    window.painter?.flipTransformH();
});
document.getElementById('btn-transform-flipv')?.addEventListener('click', () => {
    window.painter?.flipTransformV();
});
document.getElementById('btn-transform-apply')?.addEventListener('click', () => {
    window.painter?.commitLayerTransform();
});
document.getElementById('btn-transform-cancel')?.addEventListener('click', () => {
    window.painter?.cancelLayerTransform();
});

// --- Controles de Modo Texto (Sincronizado 3D y 2D) ---
const textInputVal = document.getElementById('text-input-value');
const textFontFamily = document.getElementById('text-font-family');
const textFontSize = document.getElementById('text-font-size');
const textSizeVal = document.getElementById('text-size-val');
const textRotation = document.getElementById('text-rotation');
const textRotVal = document.getElementById('text-rot-val');
const textColor = document.getElementById('text-color');
const btnTextBold = document.getElementById('btn-text-bold');
const btnTextItalic = document.getElementById('btn-text-italic');

textInputVal?.addEventListener('input', (e) => {
    window.decalSystem?.updateTextDecal({ text: e.target.value });
});

textFontFamily?.addEventListener('change', (e) => {
    window.decalSystem?.updateTextDecal({ fontFamily: e.target.value });
});

textColor?.addEventListener('input', (e) => {
    window.decalSystem?.updateTextDecal({ color: e.target.value });
});

textFontSize?.addEventListener('input', (e) => {
    const size = parseInt(e.target.value, 10);
    if (textSizeVal) textSizeVal.textContent = `${size} px`;
    window.decalSystem?.updateTextDecal({ fontSize: size });
});

document.getElementById('btn-text-size-dec')?.addEventListener('click', () => {
    if (!textFontSize) return;
    const cur = parseInt(textFontSize.value, 10);
    const next = Math.max(14, cur - 2);
    textFontSize.value = next;
    if (textSizeVal) textSizeVal.textContent = `${next} px`;
    window.decalSystem?.updateTextDecal({ fontSize: next });
});

document.getElementById('btn-text-size-inc')?.addEventListener('click', () => {
    if (!textFontSize) return;
    const cur = parseInt(textFontSize.value, 10);
    const next = Math.min(250, cur + 2);
    textFontSize.value = next;
    if (textSizeVal) textSizeVal.textContent = `${next} px`;
    window.decalSystem?.updateTextDecal({ fontSize: next });
});

textRotation?.addEventListener('input', (e) => {
    const deg = parseInt(e.target.value, 10);
    if (textRotVal) textRotVal.textContent = `${deg}°`;
    window.decalSystem?.updateTextDecal({ rotation: deg });
});

document.getElementById('btn-text-rot-dec')?.addEventListener('click', () => {
    if (!textRotation) return;
    let cur = parseInt(textRotation.value, 10) - 1; // Paso exacto de 1° en 1°
    if (cur < -180) cur = 180;
    textRotation.value = cur;
    if (textRotVal) textRotVal.textContent = `${cur}°`;
    window.decalSystem?.updateTextDecal({ rotation: cur });
});

document.getElementById('btn-text-rot-inc')?.addEventListener('click', () => {
    if (!textRotation) return;
    let cur = parseInt(textRotation.value, 10) + 1; // Paso exacto de 1° en 1°
    if (cur > 180) cur = -180;
    textRotation.value = cur;
    if (textRotVal) textRotVal.textContent = `${cur}°`;
    window.decalSystem?.updateTextDecal({ rotation: cur });
});

btnTextBold?.addEventListener('click', () => {
    btnTextBold.classList.toggle('active');
    window.decalSystem?.updateTextDecal({ isBold: btnTextBold.classList.contains('active') });
});

btnTextItalic?.addEventListener('click', () => {
    btnTextItalic.classList.toggle('active');
    window.decalSystem?.updateTextDecal({ isItalic: btnTextItalic.classList.contains('active') });
});

// --- Menú Archivo Desplegable (Estilo MS Paint) ---
const btnPaintFileMenu = document.getElementById('btn-paint-file-menu');
const paintFileDropdown = document.getElementById('paint-file-dropdown');

btnPaintFileMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!paintFileDropdown) return;
    const isVisible = paintFileDropdown.style.display === 'flex';
    if (isVisible) {
        paintFileDropdown.style.display = 'none';
    } else {
        const rect = btnPaintFileMenu.getBoundingClientRect();
        paintFileDropdown.style.top = `${rect.bottom + 2}px`;
        paintFileDropdown.style.left = `${rect.left}px`;
        paintFileDropdown.style.display = 'flex';
    }
});

// Cerrar menú archivo al hacer clic en cualquier opción
paintFileDropdown?.querySelectorAll('.paint-menu-item').forEach(item => {
    item.addEventListener('click', () => {
        if (paintFileDropdown) paintFileDropdown.style.display = 'none';
    });
});

// Cerrar menús flotantes al hacer clic afuera
document.addEventListener('click', (e) => {
    if (paintFileDropdown && paintFileDropdown.style.display !== 'none') {
        if (!e.target.closest('#btn-paint-file-menu') && !e.target.closest('#paint-file-dropdown')) {
            paintFileDropdown.style.display = 'none';
        }
    }
    if (texturePopupPanel && texturePopupPanel.style.display !== 'none') {
        if (!e.target.closest('#btn-toggle-textures') && !e.target.closest('#texture-preview-thumb') && !e.target.closest('#texture-popup-panel')) {
            texturePopupPanel.style.display = 'none';
        }
    }
});

// --- Panel Flotante de Texturas y Patrones (Estilo Popover) ---
const btnToggleTextures = document.getElementById('btn-toggle-textures');
const texturePopupPanel = document.getElementById('texture-popup-panel');
const btnCloseTexturePanel = document.getElementById('btn-close-texture-panel');
const inputTexture = document.getElementById('input-texture');
const textureThumb = document.getElementById('texture-preview-thumb');
const textureScale = document.getElementById('texture-scale');
const textureScaleLabel = document.getElementById('texture-scale-label');
const btnTextureFillLayer = document.getElementById('btn-texture-fill-layer');
const btnTextureModeFill = document.getElementById('btn-texture-mode-fill');

function updateTexturePreview(patCanvas) {
    if (!textureThumb || !patCanvas) return;
    textureThumb.style.display = 'block';
    if (patCanvas.toDataURL) {
        textureThumb.style.backgroundImage = `url(${patCanvas.toDataURL()})`;
    }
}

// Generar miniaturas para las tarjetas visuales del catálogo
const presetThumbnails = {
    brick: Painter.createProceduralPattern('brick'),
    camo_woodland: Painter.createProceduralPattern('camo_woodland'),
    camo_desert: Painter.createProceduralPattern('camo_desert'),
    metal_plates: Painter.createProceduralPattern('metal_plates'),
    wood: Painter.createProceduralPattern('wood'),
    carbon: Painter.createProceduralPattern('carbon')
};

Object.entries(presetThumbnails).forEach(([name, canvas]) => {
    const el = document.getElementById(`thumb-preset-${name}`);
    if (el && canvas) {
        el.style.backgroundImage = `url(${canvas.toDataURL()})`;
    }
});

// Inicializar textura de ladrillo por defecto
const initialPat = presetThumbnails.brick;
window.painter.setPattern(initialPat);
updateTexturePreview(initialPat);

function toggleTexturePanel(e) {
    if (e) e.stopPropagation();
    if (!texturePopupPanel) return;
    const isVisible = texturePopupPanel.style.display === 'block';
    if (isVisible) {
        texturePopupPanel.style.display = 'none';
    } else {
        const rect = (btnToggleTextures || textureThumb).getBoundingClientRect();
        texturePopupPanel.style.top = `${rect.bottom + 6}px`;
        const panelWidth = 500;
        let left = rect.left - 120;
        if (left + panelWidth > window.innerWidth - 10) {
            left = window.innerWidth - panelWidth - 10;
        }
        if (left < 10) left = 10;
        texturePopupPanel.style.left = `${left}px`;
        texturePopupPanel.style.display = 'block';
    }
}

btnToggleTextures?.addEventListener('click', toggleTexturePanel);
textureThumb?.addEventListener('click', toggleTexturePanel);
btnCloseTexturePanel?.addEventListener('click', () => {
    if (texturePopupPanel) texturePopupPanel.style.display = 'none';
});

// Selección de tarjetas de texturas
document.querySelectorAll('.texture-card[data-preset]').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.texture-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const preset = card.getAttribute('data-preset');

        if (preset === 'custom') {
            inputTexture?.click();
        } else {
            const pat = presetThumbnails[preset] || Painter.createProceduralPattern(preset);
            window.painter.setPattern(pat);
            updateTexturePreview(pat);
        }
    });
});

inputTexture?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            window.painter.setPattern(img);
            if (textureThumb) {
                textureThumb.style.display = 'block';
                textureThumb.style.backgroundImage = `url(${ev.target.result})`;
            }
            const customThumb = document.getElementById('thumb-preset-custom');
            if (customThumb) {
                customThumb.style.backgroundImage = `url(${ev.target.result})`;
                customThumb.textContent = '';
            }
            document.querySelectorAll('.texture-card').forEach(c => c.classList.remove('active'));
            document.getElementById('card-custom-upload')?.classList.add('active');
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

textureScale?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (textureScaleLabel) textureScaleLabel.textContent = `${val}x`;
});

document.getElementById('btn-texture-scale-dec')?.addEventListener('click', () => {
    if (!textureScale) return;
    const cur = parseInt(textureScale.value, 10);
    const next = Math.max(1, cur - 1);
    textureScale.value = next;
    if (textureScaleLabel) textureScaleLabel.textContent = `${next}x`;
});

document.getElementById('btn-texture-scale-inc')?.addEventListener('click', () => {
    if (!textureScale) return;
    const cur = parseInt(textureScale.value, 10);
    const next = Math.min(16, cur + 1);
    textureScale.value = next;
    if (textureScaleLabel) textureScaleLabel.textContent = `${next}x`;
});

btnTextureFillLayer?.addEventListener('click', () => {
    const tiling = parseInt(textureScale?.value || 4, 10);
    window.painter?.fillLayerWithPattern(window.painter.getActivePatternCanvas(), tiling);
});

btnTextureModeFill?.addEventListener('click', () => {
    toolButtons.forEach(b => b.classList.remove('active'));
    btnTextureModeFill.classList.add('active');
    brushModeInput.value = 'texture_fill';
    if (texturePopupPanel) texturePopupPanel.style.display = 'none'; // cerrar para pintar libremente
});

// --- Fondo de Color Personalizable (Vista 3D y 2D) ---
function setViewportBackground(colorHex) {
    if (!colorHex) return;
    scene.background = new THREE.Color(colorHex);
    if (view3d) view3d.style.backgroundColor = colorHex;
    const v2d = document.getElementById('view-2d');
    if (v2d) v2d.style.backgroundColor = colorHex;
}

const bgPresetSelect = document.getElementById('viewport-bg-preset');
const bgColorPicker = document.getElementById('viewport-bg-color');

bgPresetSelect?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'custom') {
        if (bgColorPicker) {
            bgColorPicker.style.display = 'inline-block';
            bgColorPicker.click();
        }
    } else {
        if (bgColorPicker) bgColorPicker.style.display = 'none';
        setViewportBackground(val);
    }
});

bgColorPicker?.addEventListener('input', (e) => {
    setViewportBackground(e.target.value);
});

// --- Ranuras de Colores Rápidos (Color 1, Color 2, Color 3) ---
const colorInput = document.getElementById('brush-color');
let activeQuickSlot = document.getElementById('slot-color-1');
const quickSlots = document.querySelectorAll('.quick-color-slot');

quickSlots.forEach(slot => {
    slot.addEventListener('click', () => {
        quickSlots.forEach(s => s.classList.remove('active'));
        slot.classList.add('active');
        activeQuickSlot = slot;
        const color = slot.getAttribute('data-color');
        if (color && colorInput) {
            colorInput.value = color;
            if (window.decalSystem && window.decalSystem.isTextMode) {
                window.decalSystem.updateTextDecal({ color });
                const textColorInput = document.getElementById('text-color');
                if (textColorInput) textColorInput.value = color;
            }
        }
    });

    slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const curColor = colorInput ? colorInput.value : '#ff0000';
        slot.setAttribute('data-color', curColor);
        slot.style.backgroundColor = curColor;
        quickSlots.forEach(s => s.classList.remove('active'));
        slot.classList.add('active');
        activeQuickSlot = slot;
    });
});

function updateActiveQuickColor(newColor) {
    if (activeQuickSlot) {
        activeQuickSlot.setAttribute('data-color', newColor);
        activeQuickSlot.style.backgroundColor = newColor;
    }
    if (window.decalSystem && window.decalSystem.isTextMode) {
        window.decalSystem.updateTextDecal({ color: newColor });
        const textColorInput = document.getElementById('text-color');
        if (textColorInput) textColorInput.value = newColor;
    }
}

colorInput?.addEventListener('input', (e) => {
    updateActiveQuickColor(e.target.value);
});

document.querySelectorAll('.palette-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
        const col = e.target.getAttribute('data-color');
        if (colorInput) colorInput.value = col;
        updateActiveQuickColor(col);
    });
});

// --- Sistema de Guardado y Carga de Proyecto Completo (.nsp) ---
function saveProjectNSP() {
    try {
        const layersData = layerManager.layers.map(layer => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            isBackground: layer.isBackground,
            imageData: layer.canvas.toDataURL('image/png')
        }));

        const slots = [
            document.getElementById('slot-color-1')?.getAttribute('data-color') || '#ff0000',
            document.getElementById('slot-color-2')?.getAttribute('data-color') || '#00ff00',
            document.getElementById('slot-color-3')?.getAttribute('data-color') || '#0000ff'
        ];

        const project = {
            format: 'NeoSubstancePainter',
            version: '1.0',
            date: new Date().toISOString(),
            resolution: TEX_SIZE,
            backgroundColor: bgPresetSelect?.value || '#222222',
            quickColors: slots,
            layers: layersData,
            papercraft: {
                modelLengthMm: papercraft.modelLengthMm,
                scalePreset: document.getElementById('unfold-scale-preset')?.value || '1:33',
                showFlaps: papercraft.showFlaps,
                tabHeightMm: papercraft.tabHeightMm,
                tabAngleDeg: papercraft.tabAngleDeg,
                hideSmoothLines: papercraft.hideSmoothLines,
                showTabNumbers: papercraft.showTabNumbers,
                numberPlacement: papercraft.numberPlacement,
                cutLineColor: papercraft.cutLineColor,
                cutLineWidthMm: papercraft.cutLineWidthMm,
                foldLineColor: papercraft.foldLineColor,
                foldLineWidthMm: papercraft.foldLineWidthMm,
                a4Orientation: papercraft.a4Orientation,
                pagesCount: papercraft.pagesCount,
                partsLayout: papercraft.parts.map(p => ({
                    id: p.id,
                    layout: { ...p.layout }
                }))
            }
        };

        const jsonStr = JSON.stringify(project);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'proyecto_substance.nsp';
        link.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Error guardando proyecto .nsp:', err);
        alert('Error al guardar el proyecto: ' + err.message);
    }
}

async function loadProjectNSP(file) {
    try {
        const text = await file.text();
        const project = JSON.parse(text);

        if (!project.format || project.format !== 'NeoSubstancePainter') {
            if (!confirm('El archivo no parece ser un proyecto .nsp válido. ¿Deseas intentar cargarlo de todos modos?')) {
                return;
            }
        }

        // 1. Restaurar resolución si cambió
        if (project.resolution && project.resolution !== TEX_SIZE) {
            TEX_SIZE = project.resolution;
            layerManager.resize(TEX_SIZE, TEX_SIZE);
            canvasUV.width = TEX_SIZE;
            canvasUV.height = TEX_SIZE;
            if (canvasUI) {
                canvasUI.width = TEX_SIZE;
                canvasUI.height = TEX_SIZE;
            }
            const resSelect = document.getElementById('doc-resolution');
            if (resSelect) resSelect.value = String(TEX_SIZE);
        }

        // 2. Restaurar Colores Rápidos
        if (project.quickColors && Array.isArray(project.quickColors)) {
            project.quickColors.forEach((col, idx) => {
                const slot = document.getElementById(`slot-color-${idx + 1}`);
                if (slot && col) {
                    slot.setAttribute('data-color', col);
                    slot.style.backgroundColor = col;
                }
            });
        }

        // 3. Restaurar Color de Fondo
        if (project.backgroundColor) {
            setViewportBackground(project.backgroundColor);
            if (bgPresetSelect) bgPresetSelect.value = project.backgroundColor;
        }

        // 4. Restaurar Capas
        if (project.layers && Array.isArray(project.layers)) {
            layerManager.layers = [];

            for (const lData of project.layers) {
                const layer = layerManager.createLayer(lData.name, lData.isBackground);
                layer.id = lData.id;
                layer.visible = lData.visible !== undefined ? lData.visible : true;
                layer.opacity = lData.opacity !== undefined ? lData.opacity : 1;
                layer.blendMode = lData.blendMode || 'source-over';

                if (lData.imageData) {
                    await new Promise(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            layer.ctx.drawImage(img, 0, 0);
                            resolve();
                        };
                        img.onerror = resolve;
                        img.src = lData.imageData;
                    });
                }
                layerManager.layers.push(layer);
            }

            layerManager.activeLayerId = layerManager.layers[layerManager.layers.length - 1]?.id || null;
            layerManager.recomposite();
            layerManager.renderUI();
        }

        // 5. Restaurar Configuración de Papercraft y Disposición de Piezas
        if (project.papercraft) {
            const pp = project.papercraft;
            if (pp.cutLineColor) {
                papercraft.cutLineColor = pp.cutLineColor;
                const sel = document.getElementById('unfold-cut-color');
                if (sel) sel.value = pp.cutLineColor;
            }
            if (pp.cutLineWidthMm) {
                papercraft.cutLineWidthMm = pp.cutLineWidthMm;
                const sel = document.getElementById('unfold-cut-width');
                if (sel) sel.value = String(pp.cutLineWidthMm);
            }
            if (pp.tabHeightMm) updateTabHeight(pp.tabHeightMm);
            if (pp.tabAngleDeg) {
                papercraft.tabAngleDeg = pp.tabAngleDeg;
                if (tabAngleSlider) tabAngleSlider.value = pp.tabAngleDeg;
                if (tabAngleLabel) tabAngleLabel.textContent = `${pp.tabAngleDeg}°`;
            }
            if (pp.showFlaps !== undefined) syncFlaps(pp.showFlaps);
            if (pp.hideSmoothLines !== undefined) syncHideSmooth(pp.hideSmoothLines);
            if (pp.showTabNumbers !== undefined) syncNumbers(pp.showTabNumbers, pp.numberPlacement || 'flaps');
            if (pp.pagesCount) papercraft.pagesCount = pp.pagesCount;

            if (pp.partsLayout && Array.isArray(pp.partsLayout)) {
                pp.partsLayout.forEach(pl => {
                    const part = papercraft.parts.find(p => p.id === pl.id);
                    if (part && pl.layout) {
                        Object.assign(part.layout, pl.layout);
                    }
                });
            }
        }

        drawUVWireframe();
        if (typeof renderUnfoldWorkbench === 'function') renderUnfoldWorkbench();
        if (state.texture) state.texture.needsUpdate = true;

        alert('¡Proyecto cargado exitosamente!');
    } catch (err) {
        console.error('Error cargando proyecto .nsp:', err);
        alert('Error al abrir el proyecto: ' + err.message);
    }
}

document.getElementById('btn-save-project')?.addEventListener('click', saveProjectNSP);
document.getElementById('btn-load-project')?.addEventListener('click', () => {
    document.getElementById('input-project')?.click();
});
document.getElementById('input-project')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadProjectNSP(file);
    e.target.value = '';
});

// Brush size controls & persistence (Guarda el último tamaño usado)
const sizeInput = document.getElementById('brush-size');
const sizeLabel = document.getElementById('brush-size-label');
const btnSizeDec = document.getElementById('btn-size-dec');
const btnSizeInc = document.getElementById('btn-size-inc');

function updateBrushSize(val) {
    const clamped = Math.max(1, Math.min(100, Math.round(val)));
    sizeInput.value = clamped;
    sizeLabel.textContent = clamped + ' px';
    localStorage.setItem('neo_substance_brush_size', clamped);
}

// Cargar tamaño previo guardado en localStorage
const savedSize = localStorage.getItem('neo_substance_brush_size');
if (savedSize) {
    const parsed = parseInt(savedSize, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
        updateBrushSize(parsed);
    }
}

sizeInput.addEventListener('input', (e) => {
    updateBrushSize(parseInt(e.target.value, 10));
});

btnSizeDec?.addEventListener('click', () => {
    updateBrushSize(parseInt(sizeInput.value, 10) - 1);
});

btnSizeInc?.addEventListener('click', () => {
    updateBrushSize(parseInt(sizeInput.value, 10) + 1);
});

// 2D View Pan & Zoom
let zoom2D = 1;
let panX = 0;
let panY = 0;
const view2D = document.getElementById('view-2d');
const container2D = document.querySelector('.canvas-container');

view2D.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSensitivity = 0.1;
    const oldZoom = zoom2D;
    
    if (e.deltaY < 0) {
        zoom2D *= (1 + zoomSensitivity);
    } else {
        zoom2D /= (1 + zoomSensitivity);
    }
    zoom2D = Math.max(0.1, Math.min(zoom2D, 20));
    
    // Zoom toward mouse pointer
    const rect = view2D.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    
    panX = mouseX - (mouseX - panX) * (zoom2D / oldZoom);
    panY = mouseY - (mouseY - panY) * (zoom2D / oldZoom);
    
    updateTransform2D();
});

let isPanning2D = false;
view2D.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2) { // Middle or Right click
        isPanning2D = true;
    }
});
window.addEventListener('mousemove', (e) => {
    if (isPanning2D) {
        panX += e.movementX;
        panY += e.movementY;
        updateTransform2D();
    }
});
window.addEventListener('mouseup', (e) => {
    if (e.button === 1 || e.button === 2) {
        isPanning2D = false;
    }
});
view2D.addEventListener('contextmenu', e => e.preventDefault());

function updateTransform2D() {
    container2D.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom2D})`;
}

document.getElementById('btn-zoom-in').addEventListener('click', () => applyZoom2D(1.2));
document.getElementById('btn-zoom-out').addEventListener('click', () => applyZoom2D(1 / 1.2));
document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    zoom2D = 1; panX = 0; panY = 0; updateTransform2D();
});

function applyZoom2D(factor) {
    const oldZoom = zoom2D;
    zoom2D *= factor;
    zoom2D = Math.max(0.1, Math.min(zoom2D, 20));
    panX *= (zoom2D / oldZoom);
    panY *= (zoom2D / oldZoom);
    updateTransform2D();
}

// Encuadrar / Centrar la cámara sobre el modelo 3D
function frameModel(mesh = state.mesh) {
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    
    controls.target.copy(center);
    if (maxDim > 0) {
        const fov = camera.fov * (Math.PI / 180);
        const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
        camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);
        camera.near = Math.max(0.01, maxDim / 100);
        camera.far = Math.max(1000, maxDim * 100);
        camera.updateProjectionMatrix();
    }
    controls.update();
}
window.frameModel = frameModel;

// Controles de Cámara Vista 3D (+, -, Centrar y atajo tecla F)
document.getElementById('btn-3d-zoom-in')?.addEventListener('click', () => {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.addScaledVector(dir, 0.5);
    controls.update();
});
document.getElementById('btn-3d-zoom-out')?.addEventListener('click', () => {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.addScaledVector(dir, -0.5);
    controls.update();
});
document.getElementById('btn-3d-reset')?.addEventListener('click', () => {
    frameModel();
});
window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
    if (e.key === 'f' || e.key === 'F') {
        frameModel();
    }
});

// Resize Handling
window.addEventListener('resize', () => {
    camera.aspect = view3d.clientWidth / view3d.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(view3d.clientWidth, view3d.clientHeight);
});

// Simple Resizer logic
let isResizing = false;
const resizer = document.getElementById('resizer');
resizer.addEventListener('mousedown', () => { isResizing = true; });
document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    document.getElementById('view-2d').style.flex = `0 0 ${e.clientX}px`;
    window.dispatchEvent(new Event('resize'));
});
document.addEventListener('mouseup', () => { isResizing = false; });

// UV Wireframe & Papercraft Draw Logic
function drawUVWireframe() {
    ctxUV.clearRect(0, 0, canvasUV.width, canvasUV.height);
    if (!state.mesh) return;

    // Si el modo Papercraft está activo, dibujar vista técnica Papercraft (solapas, líneas limpias y A4)
    if (window.papercraft && window.papercraft.active) {
        if (typeof window.papercraft.renderOverlay === 'function') {
            window.papercraft.renderOverlay(ctxUV, canvasUV.width, canvasUV.height);
        }
        return;
    }

    if (!state.uvWireframeVisible) return;
    
    ctxUV.strokeStyle = 'rgba(0, 0, 0, 0.7)'; // Líneas negras/oscuras para fondo blanco
    ctxUV.lineWidth = 1;
    ctxUV.beginPath();

    const w = canvasUV.width;
    const h = canvasUV.height;

    function drawLineUV(uvs, idxA, idxB) {
        const uA = uvs.getX(idxA);
        const vA = uvs.getY(idxA);
        const uB = uvs.getX(idxB);
        const vB = uvs.getY(idxB);
        
        ctxUV.moveTo(uA * w, (1 - vA) * h);
        ctxUV.lineTo(uB * w, (1 - vB) * h);
    }

    const meshes = [];
    state.mesh.traverse(c => {
        if (c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.uv) {
            meshes.push(c);
        }
    });

    meshes.forEach(mesh => {
        const geometry = mesh.geometry;
        const uvs = geometry.attributes.uv;
        const indices = geometry.index;

        if (indices) {
            const arr = indices.array;
            for (let i = 0; i < arr.length; i += 3) {
                drawLineUV(uvs, arr[i], arr[i+1]);
                drawLineUV(uvs, arr[i+1], arr[i+2]);
                drawLineUV(uvs, arr[i+2], arr[i]);
            }
        } else {
            for (let i = 0; i < uvs.count; i += 3) {
                drawLineUV(uvs, i, i+1);
                drawLineUV(uvs, i+1, i+2);
                drawLineUV(uvs, i+2, i);
            }
        }
    });
    
    ctxUV.stroke();
}


// Animation Loop
let lastTextureUpdate = 0;
function animate(time) {
    requestAnimationFrame(animate);
    controls.update();
    
    // SÚPER OPTIMIZACIÓN: Desacoplar los FPS del Pincel 2D de la carga a la GPU.
    // Solo mandamos la textura a la RTX cada ~33ms (30fps) o cuando se suelta el click, 
    // liberando el procesador para que el trazo 2D vaya a máxima velocidad sin lag.
    if (painter && painter.needsUpdate) {
        if (painter.forceUpdate || (time - lastTextureUpdate > 33)) {
            state.texture.needsUpdate = true;
            painter.needsUpdate = false;
            painter.forceUpdate = false;
            lastTextureUpdate = time;
            if (papercraft && papercraft.active) renderUnfoldWorkbench();
        }
    }
    
    if (painter && painter.uiNeedsUpdate) {
        state.textureUI.needsUpdate = true;
        painter.uiNeedsUpdate = false;
    }
    
    renderer.render(scene, camera);
}
requestAnimationFrame(animate);
