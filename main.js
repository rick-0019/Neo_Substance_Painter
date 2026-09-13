import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Painter } from './painter.js?v=2.5';
import { DecalSystem } from './decals.js?v=2.5';
import { LayerManager } from './layers.js?v=2.5';

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

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// REASIGNAR BOTONES: Izquierdo para pintar, Derecho para rotar, Rueda para zoom
controls.mouseButtons = {
    LEFT: THREE.MOUSE.NONE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
};
// Evitar que el clic derecho abra el menú del navegador
view3d.addEventListener('contextmenu', e => e.preventDefault());

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

// UI Texture para previsualizar formas en 3D
const canvasUI = document.getElementById('canvas-ui');
const textureUI = new THREE.CanvasTexture(canvasUI);
textureUI.colorSpace = THREE.SRGBColorSpace;
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
drawUVWireframe();
layerManager.renderUI();

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

// Load OBJ
document.getElementById('btn-load-obj').addEventListener('click', () => document.getElementById('input-obj').click());
document.getElementById('input-obj').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const contents = event.target.result;
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

            // Usar el objeto completo o la malla única
            state.mesh = object;
            scene.add(state.mesh);
            
            // Encuadrar cámara automáticamente según el tamaño real del modelo
            const box = new THREE.Box3().setFromObject(state.mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            controls.target.copy(center);
            if (maxDim > 0) {
                const fov = camera.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.8;
                camera.position.set(center.x, center.y, center.z + cameraZ);
                camera.near = Math.max(0.01, maxDim / 100);
                camera.far = Math.max(1000, maxDim * 100);
                camera.updateProjectionMatrix();
            }
            controls.update();
            
            painter.setMesh(state.mesh);
            decalSystem.setMesh(state.mesh);
            
            // Dibujar wireframe
            drawUVWireframe();
        } catch (err) {
            console.error('Error cargando OBJ:', err);
            alert('Error al procesar el archivo OBJ: ' + err.message);
        }
    };
    reader.readAsText(file);
});

// UI Event Listeners
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

// Export PDF (A4) con Malla UV combinada
document.getElementById('btn-export-pdf').addEventListener('click', () => {
    const canvas2d = document.getElementById('canvas-2d');
    const canvasUV = document.getElementById('canvas-uv');
    
    // Crear un canvas temporal para combinar pintura + malla UV
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas2d.width;
    tempCanvas.height = canvas2d.height;
    const ctx = tempCanvas.getContext('2d');
    
    // Fondo blanco
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // Dibujar pintura
    ctx.drawImage(canvas2d, 0, 0);
    
    // Dibujar malla UV encima
    ctx.drawImage(canvasUV, 0, 0);
    
    const imgData = tempCanvas.toDataURL('image/png', 1.0);
    
    // Crear PDF formato A4
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 10;
    const size = pageWidth - margin * 2; // El canvas es cuadrado, limitamos al ancho de la hoja
    
    pdf.addImage(imgData, 'PNG', margin, margin, size, size);
    pdf.save('Plantilla_Pepakura.pdf');
});

// Toolbar buttons logic
const toolButtons = document.querySelectorAll('.tool-btn');
const brushModeInput = document.getElementById('brush-mode');
toolButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetBtn = e.target.closest('.tool-btn');
        if (!targetBtn) return;
        
        if (window.painter && window.painter.editingShape) {
            window.painter.commitShape();
        }

        const mode = targetBtn.getAttribute('data-mode');

        if (mode === 'transform') {
            toolButtons.forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');
            brushModeInput.value = 'transform';
            if (window.painter) {
                window.painter.startLayerTransform();
            }
            return;
        }

        // Si se cambia de herramienta mientras se transformaba una capa, aplicar cambios
        if (window.painter && window.painter.transformState && window.painter.transformState.active) {
            window.painter.commitLayerTransform();
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

// Color palette
const colorInput = document.getElementById('brush-color');
document.querySelectorAll('.palette-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
        colorInput.value = e.target.getAttribute('data-color');
    });
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

// UV Wireframe Draw Logic
function drawUVWireframe() {
    ctxUV.clearRect(0, 0, canvasUV.width, canvasUV.height);
    if (!state.mesh || !state.uvWireframeVisible) return;
    
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
        }
    }
    
    if (painter && painter.uiNeedsUpdate) {
        state.textureUI.needsUpdate = true;
        painter.uiNeedsUpdate = false;
    }
    
    renderer.render(scene, camera);
}
requestAnimationFrame(animate);
