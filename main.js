import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Painter } from './painter.js?v=7.3';
import { DecalSystem } from './decals.js?v=7.4';
import { LayerManager } from './layers.js?v=7.3';
import { PapercraftEngine } from './papercraft.js?v=7.3';
import { SelectionManager } from './selection.js?v=7.3';

// Configuration
let TEX_SIZE = 2048;
window.THREE = THREE;

// Application State
const state = {
    mesh: null,
    texture: null,
    uvWireframeVisible: true,
    uvWireframeMode: 'clean',
};

// Canvas 2D Setup (Visible UV and hidden render buffer)
const canvas2d = document.getElementById('canvas-2d');
canvas2d.width = TEX_SIZE;
canvas2d.height = TEX_SIZE;

// Layer Manager (Gestor de Capas Acelerado por GPU)
const layerManager = new LayerManager(canvas2d, TEX_SIZE, TEX_SIZE, () => {
    if (state.texture) state.texture.needsUpdate = true;
    if (window.modelAssembler && typeof window.modelAssembler.syncActivePieceTexture === 'function') {
        window.modelAssembler.syncActivePieceTexture();
    }
});
window.layerManager = layerManager;

// Selection Manager (Plantilla 2D)
const selectionManager = new SelectionManager(TEX_SIZE, TEX_SIZE);
window.selectionManager = selectionManager;

// Canvas UV Overlay
const canvasUV = document.getElementById('canvas-uv');
canvasUV.width = TEX_SIZE;
canvasUV.height = TEX_SIZE;
const ctxUV = canvasUV.getContext('2d');

export function createNewProject(promptUser = true) {
    if (promptUser && !confirm('¿Crear un nuevo archivo? Se descartarán los cambios no guardados y se reiniciarán las 4 capas estándar (Calcas, Panelado, Color Base y Fondo Blanco).')) {
        return;
    }

    if (window.decalSystem) {
        window.decalSystem.deselectDecal();
    }
    if (window.selectionManager) {
        window.selectionManager.deselect();
    }
    if (window.painter) {
        window.painter.editingShape = null;
        window.painter.transformState = null;
        window.painter.textState = null;
        window.painter.savedCanvasData = null;
        window.painter.clearUI();
        window.painter.undoStack = [];
        window.painter.redoStack = [];
        window.painter.updateUndoRedoUI();
    }

    layerManager.resetToDefaultLayers();
    layerManager.renderUI();

    if (window.painter) {
        window.painter.needsUpdate = true;
        window.painter.forceUpdate = true;
    }
    if (state.texture) {
        state.texture.needsUpdate = true;
    }
    if (window.decalSystem && window.decalSystem.texture) {
        window.decalSystem.texture.needsUpdate = true;
    }
    if (window.papercraft && window.papercraft.active && window.renderUnfoldWorkbench) {
        window.renderUnfoldWorkbench();
    }

    drawUVWireframe();

    const paintFileDropdown = document.getElementById('paint-file-dropdown');
    if (paintFileDropdown) paintFileDropdown.style.display = 'none';
}
window.createNewProject = createNewProject;

document.getElementById('btn-new-project')?.addEventListener('click', () => {
    createNewProject(true);
});

document.getElementById('btn-apply-res')?.addEventListener('click', () => {
    if(!confirm('Cambiar la resolución redimensionará el lienzo y reiniciará el proyecto. ¿Continuar?')) return;
    TEX_SIZE = parseInt(document.getElementById('doc-resolution').value, 10);
    
    layerManager.resize(TEX_SIZE, TEX_SIZE);
    selectionManager.resize(TEX_SIZE, TEX_SIZE);
    
    canvasUV.width = TEX_SIZE;
    canvasUV.height = TEX_SIZE;
    const canvasUI = document.getElementById('canvas-ui');
    if (canvasUI) {
        canvasUI.width = TEX_SIZE;
        canvasUI.height = TEX_SIZE;
    }
    
    createNewProject(false);
});

// Create Three.js Texture from Canvas
const canvasTexture = new THREE.CanvasTexture(canvas2d);
canvasTexture.colorSpace = THREE.SRGBColorSpace;
state.texture = canvasTexture;

// Three.js Setup
const view3d = document.getElementById('view-3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const initialAspect = (view3d.clientWidth || 800) / (view3d.clientHeight || 600);
const perspCamera = new THREE.PerspectiveCamera(45, initialAspect, 0.01, 2000);
perspCamera.position.set(0, 0, 5);

const orthoCamera = new THREE.OrthographicCamera(
    -2.5 * initialAspect, 2.5 * initialAspect,
    2.5, -2.5,
    0.01, 2000
);
orthoCamera.position.set(0, 0, 5);

let camera = perspCamera;
let isOrthographic = false;
let currentOrthoView = null;

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
painter.setSelectionManager(selectionManager);
window.painter = painter;
const decalSystem = new DecalSystem(scene, camera, renderer, canvas2d, canvasTexture, layerManager, painter);
window.decalSystem = decalSystem;

// Exponer sistemas y componentes al scope global para el Ensamblador y extensiones
window.scene = scene;
window.state = state;
window.camera = camera;
window.renderer = renderer;
window.controls = controls;
window.OBJLoader = OBJLoader;

// Grupo contenedor para el Ensamblador 3D (Piezas múltiples montadas)
const assemblerGroup = new THREE.Group();
assemblerGroup.name = 'assemblerGroup';
assemblerGroup.visible = false;
scene.add(assemblerGroup);
window.assemblerGroup = assemblerGroup;

// Papercraft Engine (Unfold, Solapas, A4 1:1, PDF)
const papercraft = new PapercraftEngine();
window.papercraft = papercraft;
papercraft.setRedrawCallback(() => {
    drawUVWireframe();
    if (typeof renderUnfoldWorkbench === 'function') renderUnfoldWorkbench();
});

// UI Texture para previsualizar formas en 3D (Optimizado sin Mipmaps para evitar saturación de bus)
const canvasUI = document.getElementById('canvas-ui');
const textureUI = new THREE.CanvasTexture(canvasUI);
textureUI.colorSpace = THREE.SRGBColorSpace;
textureUI.minFilter = THREE.LinearFilter;
textureUI.magFilter = THREE.LinearFilter;
textureUI.generateMipmaps = false;
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
setupSelection3DOverlay(state.mesh);
layerManager.renderUI();

// Visibilidad optimizada del overlay de selección 3D
function setSelection3DOverlayVisible(visible) {
    if (!state.mesh) return;
    state.mesh.traverse(child => {
        if (child.userData && child.userData.isSelectionOverlay) {
            child.visible = visible;
        }
    });
}
window.setSelection3DOverlayVisible = setSelection3DOverlayVisible;

// Proyección 3D de la Selección y Máscaras (Marching Ants visibles en el modelo 3D)
function setupSelection3DOverlay(root) {
    if (!root) return;

    const toRemove = [];
    root.traverse(child => {
        if (child.userData && child.userData.isSelectionOverlay) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => {
        if (child.parent) child.parent.remove(child);
        if (child.material) child.material.dispose();
    });

    const meshTargets = [];
    root.traverse(child => {
        if (child.isMesh && !child.userData?.isSelectionOverlay && child.geometry && child.geometry.attributes && child.geometry.attributes.uv) {
            meshTargets.push(child);
        }
    });

    meshTargets.forEach(child => {
        const overlayMat = new THREE.MeshBasicMaterial({
            map: state.textureUI,
            transparent: true,
            opacity: 0.95,
            polygonOffset: true,
            polygonOffsetFactor: -1.5,
            polygonOffsetUnits: -1.5,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const overlayMesh = new THREE.Mesh(child.geometry, overlayMat);
        overlayMesh.renderOrder = 99;
        overlayMesh.userData.isSelectionOverlay = true;
        overlayMesh.visible = false; // Oculto por defecto para 144 FPS puros
        child.add(overlayMesh);
    });
}

// Helper para sincronizar valores visuales del panel Papercraft
function updatePapercraftUI() {
    const badge = document.getElementById('unfold-scale-badge');
    if (badge) badge.textContent = papercraft.currentScale;
    
    const fmtMm = (v) => (v == null || isNaN(v)) ? '0' : (Math.round(v * 10) / 10).toString();

    const wingspanInput = document.getElementById('unfold-model-width');
    if (wingspanInput && document.activeElement !== wingspanInput) {
        wingspanInput.value = fmtMm(papercraft.wingspanMm);
    }
    const heightInput = document.getElementById('unfold-model-height');
    if (heightInput && document.activeElement !== heightInput) {
        heightInput.value = fmtMm(papercraft.heightMm);
    }
    const lengthInput = document.getElementById('unfold-model-length');
    if (lengthInput && document.activeElement !== lengthInput) {
        lengthInput.value = fmtMm(papercraft.modelLengthMm);
    }
    const pctInput = document.getElementById('unfold-scale-pct');
    if (pctInput && document.activeElement !== pctInput) {
        const activePct = Math.round((papercraft.scalePct !== undefined ? papercraft.scalePct : ((papercraft.modelLengthMm / (papercraft.baseModelLengthMm || 200.0)) * 100)) * 10) / 10;
        pctInput.value = activePct;
    }

    // Actualizar estilos activos de los botones de escala rápida
    const activePct = Math.round(papercraft.scalePct !== undefined ? papercraft.scalePct : ((papercraft.modelLengthMm / (papercraft.baseModelLengthMm || 200.0)) * 100));
    document.querySelectorAll('.btn-scale-quick').forEach(btn => {
        const bPct = parseFloat(btn.getAttribute('data-pct'));
        if (bPct === activePct) {
            btn.style.color = '#00f3ff';
            btn.style.fontWeight = 'bold';
            btn.style.borderColor = '#00f3ff';
            btn.style.background = 'rgba(0, 243, 255, 0.15)';
        } else {
            btn.style.color = '#ccc';
            btn.style.fontWeight = 'normal';
            btn.style.borderColor = '#555';
            btn.style.background = '#222';
        }
    });

    const partsCount = document.getElementById('unfold-parts-count');
    if (partsCount) partsCount.textContent = `${papercraft.parts.length} piezas (${papercraft.pagesCount} Hojas A4)`;

    updateSelectedPartCard();
}
window.updatePapercraftUI = updatePapercraftUI;

function updateSelectedPartCard() {
    const badge = document.getElementById('unfold-sel-badge');
    const placeholder = document.getElementById('unfold-sel-placeholder');
    const details = document.getElementById('unfold-sel-details');
    const part = papercraft.selectedPart;

    if (!part) {
        if (badge) {
            badge.textContent = 'Ninguna';
            badge.style.color = '#888';
            badge.style.borderColor = '#555';
            badge.style.background = 'rgba(255,255,255,0.05)';
        }
        if (placeholder) placeholder.style.display = 'block';
        if (details) details.style.display = 'none';
        return;
    }

    if (badge) {
        badge.textContent = `Pieza #${part.id + 1}`;
        badge.style.color = '#00e5ff';
        badge.style.borderColor = '#00e5ff';
        badge.style.background = 'rgba(0,229,255,0.12)';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (details) details.style.display = 'flex';

    const dimsEl = document.getElementById('unfold-sel-dimensions');
    if (dimsEl) dimsEl.textContent = `${part.wMm.toFixed(1)} mm × ${part.hMm.toFixed(1)} mm`;

    const pageEl = document.getElementById('unfold-sel-page');
    if (pageEl) {
        if (typeof isAssemblyWorkbenchActive === 'function' && isAssemblyWorkbenchActive() && window.modelAssembler) {
            const activePiece = (typeof window.modelAssembler.getActivePiece === 'function')
                ? window.modelAssembler.getActivePiece()
                : (window.modelAssembler.pieces?.find(p => p.id === window.modelAssembler.activePieceId) || null);
            const pCount = (activePiece?.papercraft?.pagesCount) || papercraft.pagesCount;
            const pName = activePiece ? `[${activePiece.name}] ` : '';
            pageEl.textContent = `${pName}Hoja ${part.layout.pageIndex + 1} de ${pCount}`;
        } else {
            pageEl.textContent = `Hoja ${part.layout.pageIndex + 1} de ${papercraft.pagesCount}`;
        }
    }

    const rotEl = document.getElementById('unfold-sel-rot');
    if (rotEl) rotEl.textContent = `${part.layout.rotation % 360}°`;
}
window.updateSelectedPartCard = updateSelectedPartCard;

// Triangulación robusta con Earcut para N-gonos cóncavos (evita aristas que cruzan huecos y cortes)
function triangulateConcaveNGons(raw) {
    if (!raw || !raw.includes('f ')) return raw;
    const lines = raw.split('\n');
    const positions = [];
    const newLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Omitir líneas sueltas ('l') y puntos ('p') de wireframe exportados por Blender/CAD.
        // En Three.js OBJLoader, la presencia de 'l' en un objeto convierte toda la geometría en LineSegments,
        // descartando completamente las caras poligonales ('f') y provocando el error de "sin mallas válidas".
        if (/^[lpLP](\s+.*)?$/.test(trimmed)) {
            continue;
        }

        if (trimmed.startsWith('v ')) {
            const parts = trimmed.split(/\s+/).slice(1).map(Number);
            positions.push(new THREE.Vector3(parts[0], parts[1], parts[2]));
            newLines.push(line);
        } else if (trimmed.startsWith('f ')) {
            const parts = trimmed.split(/\s+/).slice(1);
            if (parts.length <= 3) {
                newLines.push(line);
                continue;
            }

            const vertIndices = parts.map(p => {
                const s = p.split('/');
                return parseInt(s[0], 10) - 1;
            });

            // Calcular normal del polígono usando el método de Newell para soportar n-gonos complejos
            const normal = new THREE.Vector3(0, 0, 0);
            for (let v = 0; v < vertIndices.length; v++) {
                const curr = positions[vertIndices[v]];
                const next = positions[vertIndices[(v + 1) % vertIndices.length]];
                if (curr && next) {
                    normal.x += (curr.y - next.y) * (curr.z + next.z);
                    normal.y += (curr.z - next.z) * (curr.x + next.x);
                    normal.z += (curr.x - next.x) * (curr.y + next.y);
                }
            }

            if (normal.lengthSq() < 1e-8) {
                // Fallback con los primeros 3 vértices
                const p0 = positions[vertIndices[0]];
                const p1 = positions[vertIndices[1]];
                const p2 = positions[vertIndices[2]];
                if (p0 && p1 && p2) {
                    const vA = new THREE.Vector3().subVectors(p1, p0);
                    const vB = new THREE.Vector3().subVectors(p2, p0);
                    normal.crossVectors(vA, vB);
                }
            }

            if (normal.lengthSq() < 1e-8) {
                // Si la normal es nula/degenerada, fallback a abanico (fan)
                for (let t = 1; t < parts.length - 1; t++) {
                    newLines.push(`f ${parts[0]} ${parts[t]} ${parts[t + 1]}`);
                }
                continue;
            }
            normal.normalize();

            let uAxis = new THREE.Vector3(1, 0, 0);
            if (Math.abs(normal.dot(uAxis)) > 0.9) {
                uAxis = new THREE.Vector3(0, 1, 0);
            }
            const vAxis = new THREE.Vector3().crossVectors(normal, uAxis).normalize();
            uAxis.crossVectors(vAxis, normal).normalize();

            const pts2D = vertIndices.map(vIdx => {
                const p = positions[vIdx];
                return p ? new THREE.Vector2(p.dot(uAxis), p.dot(vAxis)) : new THREE.Vector2(0, 0);
            });

            try {
                const triIndices = THREE.ShapeUtils.triangulateShape(pts2D, []);
                if (triIndices && triIndices.length > 0) {
                    for (const tri of triIndices) {
                        newLines.push(`f ${parts[tri[0]]} ${parts[tri[1]]} ${parts[tri[2]]}`);
                    }
                } else {
                    for (let t = 1; t < parts.length - 1; t++) {
                        newLines.push(`f ${parts[0]} ${parts[t]} ${parts[t + 1]}`);
                    }
                }
            } catch (err) {
                for (let t = 1; t < parts.length - 1; t++) {
                    newLines.push(`f ${parts[0]} ${parts[t]} ${parts[t + 1]}`);
                }
            }
        } else {
            newLines.push(line);
        }
    }
    return newLines.join('\n');
}

// Generación automática de coordenadas UV por proyección triplanar / cúbica para modelos sin mapa UV
function generateAutomaticUVs(geometry) {
    if (!geometry || !geometry.attributes.position) return;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const min = box.min;

    const sx = size.x || 1;
    const sy = size.y || 1;
    const sz = size.z || 1;

    if (!geometry.attributes.normal) {
        geometry.computeVertexNormals();
    }

    const pos = geometry.attributes.position;
    const norm = geometry.attributes.normal;
    const count = pos.count;
    const uvs = new Float32Array(count * 2);

    for (let i = 0; i < count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        const nx = norm ? Math.abs(norm.getX(i)) : 0;
        const ny = norm ? Math.abs(norm.getY(i)) : 1;
        const nz = norm ? Math.abs(norm.getZ(i)) : 0;

        let u, v;
        if (nx >= ny && nx >= nz) {
            u = (z - min.z) / sz;
            v = (y - min.y) / sy;
        } else if (ny >= nx && ny >= nz) {
            u = (x - min.x) / sx;
            v = (z - min.z) / sz;
        } else {
            u = (x - min.x) / sx;
            v = (y - min.y) / sy;
        }

        uvs[i * 2] = Math.max(0, Math.min(1, u));
        uvs[i * 2 + 1] = Math.max(0, Math.min(1, v));
    }

    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.attributes.uv.needsUpdate = true;
}
window.triangulateConcaveNGons = triangulateConcaveNGons;
window.generateAutomaticUVs = generateAutomaticUVs;

// Parser para archivos de materiales Wavefront MTL (colores difusos Kd y nombres)
function parseMTLMaterials(mtlText) {
    if (!mtlText) return {};
    const materials = {};
    let currentMtl = null;
    const lines = mtlText.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('newmtl ')) {
            const name = trimmed.substring(7).trim();
            currentMtl = { name, color: null };
            materials[name] = currentMtl;
        } else if (currentMtl && trimmed.startsWith('Kd ')) {
            const parts = trimmed.substring(3).trim().split(/\s+/).map(Number);
            if (parts.length >= 3) {
                const r = Math.round(Math.max(0, Math.min(1, parts[0])) * 255);
                const g = Math.round(Math.max(0, Math.min(1, parts[1])) * 255);
                const b = Math.round(Math.max(0, Math.min(1, parts[2])) * 255);
                currentMtl.color = `rgb(${r},${g},${b})`;
            }
        }
    }
    return materials;
}

const KNOWN_COLOR_NAMES = {
    rojo: '#e53935', red: '#e53935',
    azul: '#1e88e5', blue: '#1e88e5',
    verde: '#43a047', green: '#43a047',
    amarillo: '#fdd835', yellow: '#fdd835',
    naranja: '#fb8c00', orange: '#fb8c00',
    negro: '#212121', black: '#212121',
    blanco: '#f5f5f5', white: '#f5f5f5',
    gris: '#757575', grey: '#757575', gray: '#757575',
    morado: '#8e24aa', purple: '#8e24aa', violeta: '#8e24aa',
    rosa: '#e91e63', pink: '#e91e63',
    marron: '#6d4c41', brown: '#6d4c41', cafe: '#6d4c41',
    cyan: '#00acc1', celeste: '#42a5f5', turquesa: '#00acc1'
};

// Carga y procesamiento de modelos OBJ
function loadOBJContents(contents, mtlContents = null) {
    try {
        const cleanContents = triangulateConcaveNGons(contents);
        const loader = new OBJLoader();
        const object = loader.parse(cleanContents);

        const parsedMTL = mtlContents ? parseMTLMaterials(mtlContents) : {};
        let autoGeneratedCount = 0;
        const meshes = [];
        const originalMaterialsMap = new Map();

        object.traverse((child) => {
            if (child.isMesh) {
                originalMaterialsMap.set(child, child.material);
                if (!child.geometry.attributes.uv || child.geometry.attributes.uv.count === 0) {
                    generateAutomaticUVs(child.geometry);
                    autoGeneratedCount++;
                }
                child.material = new THREE.MeshBasicMaterial({
                    map: state.texture,
                    side: THREE.DoubleSide
                });
                
                // Wireframe sutil sobre aristas vivas reales (> 25°) evitando líneas de triangulación plana
                const childEdges = new THREE.EdgesGeometry(child.geometry, 25);
                const childLine = new THREE.LineSegments(childEdges, new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.25, transparent: true }));
                child.add(childLine);
                
                meshes.push(child);
            }
        });

        if (meshes.length === 0) {
            alert('El archivo OBJ no contiene mallas geométricas válidas.');
            return;
        }

        // Si el modelo incluye materiales con colores definidos (archivo .mtl o nombres de material reconocibles en Blender),
        // generar automáticamente una capa no destructiva 'Materiales (Blender)' con los colores base
        const matColors = {};
        let hasCustomColors = false;

        meshes.forEach(mesh => {
            const origMats = originalMaterialsMap.get(mesh);
            const matList = Array.isArray(origMats) ? origMats : (origMats ? [origMats] : []);
            matList.forEach(m => {
                if (!m || !m.name) return;
                const mName = m.name;
                if (parsedMTL[mName]?.color) {
                    matColors[mName] = parsedMTL[mName].color;
                    hasCustomColors = true;
                } else {
                    const cleanName = mName.toLowerCase().replace(/[^a-z0-9]/g, '');
                    for (const [colName, colHex] of Object.entries(KNOWN_COLOR_NAMES)) {
                        if (cleanName.includes(colName)) {
                            matColors[mName] = colHex;
                            hasCustomColors = true;
                            break;
                        }
                    }
                }
            });
        });

        if (hasCustomColors && layerManager) {
            let mtlLayer = layerManager.layers.find(l => l.name === 'Materiales (Blender)');
            if (!mtlLayer) {
                mtlLayer = layerManager.addLayer('Materiales (Blender)');
            } else {
                mtlLayer.ctx.clearRect(0, 0, mtlLayer.canvas.width, mtlLayer.canvas.height);
            }

            const mCtx = mtlLayer.ctx;
            const W = mtlLayer.canvas.width;
            const H = mtlLayer.canvas.height;

            meshes.forEach(mesh => {
                const uvAttr = mesh.geometry.attributes.uv;
                const groups = mesh.geometry.groups;
                const origMats = originalMaterialsMap.get(mesh);
                const matList = Array.isArray(origMats) ? origMats : (origMats ? [origMats] : []);

                if (uvAttr && groups && groups.length > 0) {
                    groups.forEach(g => {
                        const mName = matList[g.materialIndex]?.name;
                        const col = matColors[mName];
                        if (col) {
                            mCtx.fillStyle = col;
                            mCtx.strokeStyle = col;
                            mCtx.lineWidth = 1;
                            for (let i = g.start; i < g.start + g.count; i += 3) {
                                const u0 = uvAttr.getX(i) * W;
                                const v0 = (1 - uvAttr.getY(i)) * H;
                                const u1 = uvAttr.getX(i + 1) * W;
                                const v1 = (1 - uvAttr.getY(i + 1)) * H;
                                const u2 = uvAttr.getX(i + 2) * W;
                                const v2 = (1 - uvAttr.getY(i + 2)) * H;

                                mCtx.beginPath();
                                mCtx.moveTo(u0, v0);
                                mCtx.lineTo(u1, v1);
                                mCtx.lineTo(u2, v2);
                                mCtx.closePath();
                                mCtx.fill();
                                mCtx.stroke();
                            }
                        }
                    });
                }
            });

            layerManager.recomposite();
            layerManager.renderUI();
        }

        if (autoGeneratedCount > 0) {
            console.warn(`[OBJLoader] Se generaron coordenadas UV automáticas para ${autoGeneratedCount} malla(s) sin mapeo UV.`);
        }

        if (state.mesh) scene.remove(state.mesh);

        state.mesh = object;
        scene.add(state.mesh);
        state.rawOBJText = contents;
        try {
            localStorage.setItem('nsp_last_model_obj', contents);
        } catch (e) {}
        
        // Si el ensamblador está en Modo 3D Ensamblado, mantener state.mesh invisible
        // para que no colisione con el ensamble completo de piezas
        if (window.modelAssembler && window.modelAssembler.is3DMode) {
            state.mesh.visible = false;
        } else {
            // Encuadrar cámara automáticamente según el tamaño real del modelo
            frameModel(state.mesh);
        }
        
        painter.setMesh(state.mesh);
        decalSystem.setMesh(state.mesh);
        setupSelection3DOverlay(state.mesh);
        
        // Comprobar si las coordenadas UV vienen superpuestas en el OBJ original
        if (papercraft.checkMeshUVOverlaps(state.mesh)) {
            console.log('[Papercraft] Se detectaron islas UV superpuestas. Empaquetando UVs para evitar encimamiento...');
            const packRes = papercraft.packMeshUVs(state.mesh, 0.025);
            if (packRes.success && painter) {
                painter.buildTrianglesCache();
            }
        }
        
        // Analizar topología Papercraft (separación de piezas y auto-acomodo en hojas A4)
        papercraft.baseModelLengthMm = null;
        papercraft.modelLengthMm = null;
        papercraft.scalePct = 100.0;
        papercraft.currentScale = '1:1';
        const presetSel = document.getElementById('unfold-scale-preset');
        if (presetSel) presetSel.value = '1:1';
        
        // Análisis preliminar para detectar dimensiones físicas
        papercraft.objUnit = 'mm';
        papercraft.analyzeMesh(state.mesh, TEX_SIZE);
        
        // Auto-detección inteligente: Si las dimensiones son < 5.0, el modelo fue exportado en Metros desde Blender
        const unitSel = document.getElementById('unfold-obj-unit');
        if (papercraft.raw3dSize && papercraft.raw3dSize.ref3dLen < 5.0) {
            console.log('[Papercraft] Dimensiones 3D < 5.0 detectadas. Ajustando unidad OBJ a Metros (m x1000)...');
            papercraft.objUnit = 'm';
            if (unitSel) unitSel.value = 'm';
            papercraft.baseModelLengthMm = null;
            papercraft.modelLengthMm = null;
            papercraft.analyzeMesh(state.mesh, TEX_SIZE);
        } else if (unitSel) {
            unitSel.value = papercraft.objUnit || 'mm';
        }

        updatePapercraftUI();
        
        // Dibujar vista UV / Papercraft
        drawUVWireframe();
        renderUnfoldWorkbench();
    } catch (err) {
        console.error('Error cargando OBJ:', err);
        alert('Error al procesar el archivo OBJ: ' + err.message);
    }
}
window.loadOBJContents = loadOBJContents;

// Banco de Trabajo Interactivo A4 (Unfold Workbench)
const canvasUnfold = document.getElementById('canvas-unfold');
const ctxUnfold = canvasUnfold?.getContext('2d');
const unfoldWorkbench = document.getElementById('unfold-workbench');
const canvasContainer = document.querySelector('.canvas-container');
const view2dLabel = document.getElementById('view-2d-label');

function renderUnfoldWorkbench() {
    if (!canvasUnfold || !ctxUnfold || !papercraft || !papercraft.active) return;
    if (unfoldWorkbench) {
        const rect = unfoldWorkbench.getBoundingClientRect();
        if (rect.width > 10 && rect.height > 10) {
            if (canvasUnfold.width !== rect.width || canvasUnfold.height !== rect.height) {
                canvasUnfold.width = rect.width;
                canvasUnfold.height = rect.height;
            }
        }
    }
    const viewScope = document.getElementById('unfold-view-scope')?.value || 'active';
    if (window.modelAssembler && (window.modelAssembler.is3DMode || viewScope === 'album') && window.modelAssembler.pieces.length > 0) {
        window.modelAssembler.renderWorkbench(ctxUnfold, canvasUnfold.width, canvasUnfold.height);
        return;
    }
    papercraft.renderUnfoldWorkbench(ctxUnfold, canvasUnfold.width, canvasUnfold.height, canvas2d);
}
window.renderUnfoldWorkbench = renderUnfoldWorkbench;

function fetchDefaultModel() {
    fetch('models/Raidar-X.obj')
        .then(r => { if (r.ok) return r.text(); throw new Error('Not found'); })
        .then(txt => loadOBJContents(txt))
        .catch(() => {
            fetch('models/bomba_v1.obj')
                .then(r => { if (r.ok) return r.text(); throw new Error('Not found'); })
                .then(txt => loadOBJContents(txt))
                .catch(() => {
                    papercraft.analyzeMesh(state.mesh, TEX_SIZE);
                    updatePapercraftUI();
                    drawUVWireframe();
                    renderUnfoldWorkbench();
                });
        });
}

// Cargar modelo al iniciar: si hay un modelo guardado en memoria (ej. Raidar-X), restaurarlo; si no, buscar Raidar-X.obj
const lastSavedOBJ = localStorage.getItem('nsp_last_model_obj');
if (lastSavedOBJ) {
    try {
        loadOBJContents(lastSavedOBJ);
    } catch (e) {
        console.warn('Error al restaurar modelo previo de localStorage:', e);
    }
}

if (!state.mesh) {
    localStorage.removeItem('nsp_last_model_obj');
    fetchDefaultModel();
}

// Eventos del Panel Lateral (Tabs: Capas vs Unfold)
const tabBtnLayers = document.getElementById('tab-btn-layers');
const tabBtnUnfold = document.getElementById('tab-btn-unfold');
const tabContentLayers = document.getElementById('tab-content-layers');
const tabContentUnfold = document.getElementById('tab-content-unfold');

function switchSidebarTab(tab) {
    [tabBtnLayers, tabBtnUnfold].forEach(btn => btn?.classList.remove('active'));
    [tabContentLayers, tabContentUnfold].forEach(content => content?.classList.remove('active'));

    if (tab === 'layers') {
        tabBtnLayers?.classList.add('active');
        tabContentLayers?.classList.add('active');
    } else if (tab === 'unfold') {
        tabBtnUnfold?.classList.add('active');
        tabContentUnfold?.classList.add('active');
    }
}
window.switchSidebarTab = switchSidebarTab;

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
document.getElementById('btn-add-camo-layer')?.addEventListener('click', () => {
    const currentColor = document.getElementById('brush-color')?.value || '#4a5d3f';
    layerManager.addCamoLayer(currentColor);
    // Activar automáticamente el pincel para pintar el camuflaje
    document.querySelector('.tool-btn[data-mode="paint"]')?.click();
});
document.getElementById('btn-load-camo-stencil')?.addEventListener('click', () => {
    const currentColor = document.getElementById('brush-color')?.value || '#4a5d3f';
    const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
    const isEditingMask = activeLayer && activeLayer.hasMask && activeLayer.isEditingMask;
    const fillColor = isEditingMask ? '#FFFFFF' : currentColor;

    // Mancha orgánica militar envolvente que abraza fuselaje y alas
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="512" height="512">
        <path d="M 230 40 C 320 25, 430 75, 450 165 C 470 245, 410 320, 360 380 C 290 450, 180 475, 100 415 C 30 355, 35 250, 75 170 C 115 90, 150 55, 230 40 Z" fill="${fillColor}"/>
    </svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
        decalSystem.allowPassthrough = true;
        const passCheck = document.getElementById('decal-passthrough');
        if (passCheck) passCheck.checked = true;
        decalSystem.setDecalImage(img, 'Mancha Camuflaje');
        decalSystem.setMode('3d');
        const thumb = document.getElementById('decal-preview-thumb');
        if (thumb) {
            thumb.innerHTML = `<img src="${url}" style="width: 100%; height: 100%; object-fit: contain;">`;
            thumb.style.display = 'block';
        }
        const controls = document.getElementById('decal-controls');
        if (controls) controls.style.display = 'flex';
    };
    img.src = url;
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
function toggleLayersPanel(forceState) {
    const panel = document.getElementById('panel-layers');
    if (!panel) return;
    if (forceState === true) {
        panel.classList.remove('collapsed');
    } else if (forceState === false) {
        panel.classList.add('collapsed');
    } else {
        panel.classList.toggle('collapsed');
    }
    const isCollapsed = panel.classList.contains('collapsed');
    const btn = document.getElementById('btn-toggle-layers');
    if (btn) btn.textContent = isCollapsed ? '◀' : '✖';
    const ribbonBtn = document.getElementById('btn-ribbon-toggle-layers');
    if (ribbonBtn) {
        ribbonBtn.style.opacity = isCollapsed ? '0.75' : '1.0';
    }
    if (!isCollapsed) {
        switchSidebarTab('layers');
    }
}
window.toggleLayersPanel = toggleLayersPanel;

document.getElementById('btn-ribbon-toggle-layers')?.addEventListener('click', () => {
    toggleLayersPanel();
});
document.getElementById('btn-toggle-layers')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLayersPanel();
});
document.getElementById('panel-layers')?.addEventListener('click', (e) => {
    const panel = document.getElementById('panel-layers');
    if (panel?.classList.contains('collapsed')) {
        toggleLayersPanel(true);
    }
});

// Load OBJ manual (botón Archivo)
document.getElementById('btn-load-obj')?.addEventListener('click', () => document.getElementById('input-obj').click());
document.getElementById('input-obj')?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const objFile = files.find(f => f.name.toLowerCase().endsWith('.obj')) || files[0];
    const mtlFile = files.find(f => f.name.toLowerCase().endsWith('.mtl'));

    window.currentProjectFileName = objFile.name.replace(/\.[^/.]+$/, '');
    const reader = new FileReader();
    reader.onload = (event) => {
        const objText = event.target.result;
        if (mtlFile) {
            const mtlReader = new FileReader();
            mtlReader.onload = (mEvent) => {
                loadOBJContents(objText, mEvent.target.result);
            };
            mtlReader.readAsText(mtlFile);
        } else {
            loadOBJContents(objText);
        }
    };
    reader.readAsText(objFile);
    e.target.value = '';
});

// Carga y renderizado robusto de imágenes y vectores SVG (soporte nativo para Inkscape e Illustrator)
function loadImageOrSVG(file, callback) {
    if (!file) return;
    const isSVG = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml';
    const reader = new FileReader();

    if (isSVG) {
        reader.onload = (e) => {
            let svgText = e.target.result;
            try {
                const parser = new DOMParser();
                const doc = parser.parseFromString(svgText, 'image/svg+xml');
                const svgEl = doc.querySelector('svg');
                if (svgEl) {
                    const viewBox = svgEl.getAttribute('viewBox');
                    let vbW = null, vbH = null;
                    if (viewBox) {
                        const vbParts = viewBox.trim().split(/[\s,]+/).map(Number);
                        if (vbParts.length === 4 && vbParts[2] > 0 && vbParts[3] > 0) {
                            vbW = vbParts[2];
                            vbH = vbParts[3];
                        }
                    }
                    if (!svgEl.getAttribute('width') || svgEl.getAttribute('width').endsWith('%')) {
                        svgEl.setAttribute('width', (vbW || TEX_SIZE || 2048) + 'px');
                    }
                    if (!svgEl.getAttribute('height') || svgEl.getAttribute('height').endsWith('%')) {
                        svgEl.setAttribute('height', (vbH || TEX_SIZE || 2048) + 'px');
                    }
                    const serializer = new XMLSerializer();
                    svgText = serializer.serializeToString(doc);
                }
            } catch (err) {
                console.warn('[SVG Loader] Advertencia al procesar XML del SVG:', err);
            }

            const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                callback(img, file.name.replace(/\.[^/.]+$/, ''));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                alert('No se pudo renderizar el archivo SVG. Verifica que sea un archivo SVG válido exportado desde Inkscape o Illustrator.');
            };
            img.src = url;
        };
        reader.readAsText(file);
    } else {
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                callback(img, file.name.replace(/\.[^/.]+$/, ''));
            };
            img.onerror = () => {
                alert('No se pudo cargar la imagen seleccionada.');
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
}
window.loadImageOrSVG = loadImageOrSVG;

function importImageAsLayer(file) {
    if (!file || !layerManager) return;
    loadImageOrSVG(file, (img, name) => {
        const layer = layerManager.addLayer(name || 'Diseño Inkscape');
        const ctx = layer.ctx;
        const W = layer.canvas.width;
        const H = layer.canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        layerManager.recomposite();
        layerManager.renderUI();
        if (window.painter) {
            window.painter.needsUpdate = true;
            window.painter.forceUpdate = true;
        }
    });
}
window.importImageAsLayer = importImageAsLayer;

// Conexión de botones para importar imagen o SVG como capa
document.getElementById('btn-import-texture-layer')?.addEventListener('click', () => {
    document.getElementById('input-import-layer')?.click();
});
document.getElementById('btn-import-layer-img')?.addEventListener('click', () => {
    document.getElementById('input-import-layer')?.click();
});
document.getElementById('input-import-layer')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
        importImageAsLayer(file);
        e.target.value = '';
    }
});

// Soporte Drag & Drop para archivos .obj, .mtl, .nsp, .nspp y texturas .svg/.png directamente en la ventana
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;

    const nsppFile = files.find(f => f.name.toLowerCase().endsWith('.nspp'));
    const nspFile = files.find(f => f.name.toLowerCase().endsWith('.nsp') || (f.name.toLowerCase().endsWith('.json') && !f.name.toLowerCase().endsWith('.nspp')));
    const objFile = files.find(f => f.name.toLowerCase().endsWith('.obj'));
    const mtlFile = files.find(f => f.name.toLowerCase().endsWith('.mtl'));
    const imgFile = files.find(f => {
        const n = f.name.toLowerCase();
        return n.endsWith('.svg') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.webp');
    });

    if (nsppFile && window.modelAssembler) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const proj = JSON.parse(ev.target.result);
                window.modelAssembler.loadAssemblyProject(proj);
            } catch (err) {
                alert('Error al abrir proyecto ensamblado: ' + err.message);
            }
        };
        reader.readAsText(nsppFile);
    } else if (nspFile && typeof window.loadProjectNSP === 'function') {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const proj = JSON.parse(ev.target.result);
                window.loadProjectNSP(proj);
            } catch (err) {
                alert('Error al abrir proyecto NSP: ' + err.message);
            }
        };
        reader.readAsText(nspFile);
    } else if (objFile) {
        window.currentProjectFileName = objFile.name.replace(/\.[^/.]+$/, '');
        const reader = new FileReader();
        reader.onload = (ev) => {
            const objText = ev.target.result;
            if (mtlFile) {
                const mtlReader = new FileReader();
                mtlReader.onload = (mEv) => {
                    loadOBJContents(objText, mEv.target.result);
                };
                mtlReader.readAsText(mtlFile);
            } else {
                loadOBJContents(objText);
            }
        };
        reader.readAsText(objFile);
    } else if (imgFile) {
        importImageAsLayer(imgFile);
    }
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

// Interacción de Arrastre, Rotación y Medición (Regla) en el Banco de Hojas A4
let isPanningWorkbench = false;
let startPanX = 0, startPanY = 0;
let isMeasuringRuler = false;
let rulerStartMm = null;
let currentHitInfo = null;
let lastMouseX = null, lastMouseY = null;

function isAssemblyWorkbenchActive() {
    const viewScope = document.getElementById('unfold-view-scope')?.value || 'active';
    return !!(window.modelAssembler && (window.modelAssembler.is3DMode || viewScope === 'album') && window.modelAssembler.pieces.length > 0);
}
window.isAssemblyWorkbenchActive = isAssemblyWorkbenchActive;

function getWorkbenchPartAt(canvasX, canvasY) {
    if (isAssemblyWorkbenchActive()) {
        return window.modelAssembler.getPartAt(canvasX, canvasY);
    }
    const hit = papercraft.getPartAt(canvasX, canvasY);
    if (!hit) return null;
    return {
        part: hit.part,
        piece: null,
        localPageIndex: hit.part.layout.pageIndex,
        globalPageIndex: hit.part.layout.pageIndex,
        pieceStartSheet: 0
    };
}
window.getWorkbenchPartAt = getWorkbenchPartAt;

function getActivePartEngine() {
    if (isAssemblyWorkbenchActive() && window.modelAssembler && papercraft.selectedPart) {
        for (const p of window.modelAssembler.pieces) {
            if (p.visible !== false && p.papercraft && p.papercraft.parts.includes(papercraft.selectedPart)) {
                return p.papercraft;
            }
        }
    }
    return papercraft;
}
window.getActivePartEngine = getActivePartEngine;

canvasUnfold?.addEventListener('mousedown', (e) => {
    const rect = canvasUnfold.getBoundingClientRect();
    const mouseCanvasX = e.clientX - rect.left;
    const mouseCanvasY = e.clientY - rect.top;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Si la herramienta de medición (Regla) está activa
    if (papercraft.measureMode) {
        if (e.button === 0) {
            const mmToPx = 4.0;
            const xMm = (mouseCanvasX - papercraft.panX) / (papercraft.zoom * mmToPx);
            const yMm = (mouseCanvasY - papercraft.panY) / (papercraft.zoom * mmToPx);
            rulerStartMm = { x: xMm, y: yMm };
            papercraft.activeMeasurement = {
                start: rulerStartMm,
                end: { x: xMm, y: yMm },
                distMm: 0,
                dx: 0,
                dy: 0
            };
            isMeasuringRuler = true;
            renderUnfoldWorkbench();
        }
        return;
    }

    if (e.button === 0) { // Clic izquierdo: arrastrar pieza o mover mesa
        const hit = getWorkbenchPartAt(mouseCanvasX, mouseCanvasY);
        if (hit) {
            papercraft.selectedPart = hit.part;
            currentHitInfo = hit;
            papercraft.isDraggingPart = true;
            canvasUnfold.style.cursor = 'grabbing';
            updateSelectedPartCard();
            renderUnfoldWorkbench();
        } else {
            papercraft.selectedPart = null;
            currentHitInfo = null;
            isPanningWorkbench = true;
            startPanX = e.clientX - papercraft.panX;
            startPanY = e.clientY - papercraft.panY;
            canvasUnfold.style.cursor = 'move';
            updateSelectedPartCard();
            renderUnfoldWorkbench();
        }
    } else if (e.button === 2) { // Clic derecho: rotar pieza o mover mesa
        const hit = getWorkbenchPartAt(mouseCanvasX, mouseCanvasY);
        if (hit) {
            papercraft.selectedPart = hit.part;
            currentHitInfo = hit;
            hit.part.layout.rotation = (hit.part.layout.rotation + 45) % 360;
            if (hit.piece?.papercraft) hit.piece.papercraft.notifyChange();
            else papercraft.notifyChange();
            updateSelectedPartCard();
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
    const rect = canvasUnfold.getBoundingClientRect();
    const mouseCanvasX = e.clientX - rect.left;
    const mouseCanvasY = e.clientY - rect.top;

    if (papercraft.measureMode) {
        if (isMeasuringRuler && rulerStartMm) {
            const mmToPx = 4.0;
            const xMm = (mouseCanvasX - papercraft.panX) / (papercraft.zoom * mmToPx);
            const yMm = (mouseCanvasY - papercraft.panY) / (papercraft.zoom * mmToPx);
            const dx = Math.abs(xMm - rulerStartMm.x);
            const dy = Math.abs(yMm - rulerStartMm.y);
            const distMm = Math.hypot(xMm - rulerStartMm.x, yMm - rulerStartMm.y);
            papercraft.activeMeasurement = {
                start: rulerStartMm,
                end: { x: xMm, y: yMm },
                distMm,
                dx,
                dy
            };
            renderUnfoldWorkbench();
        } else {
            canvasUnfold.style.cursor = 'crosshair';
        }
        return;
    }

    if (papercraft.isDraggingPart && papercraft.selectedPart) {
        const mmToPx = 4.0;
        const dx_px = lastMouseX !== null ? (e.clientX - lastMouseX) : (e.movementX || 0);
        const dy_px = lastMouseY !== null ? (e.clientY - lastMouseY) : (e.movementY || 0);
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        const dx_mm = dx_px / (papercraft.zoom * mmToPx);
        const dy_mm = dy_px / (papercraft.zoom * mmToPx);

        const sheetGapMm = 20.0;
        const pagePitchMm = papercraft.A4_W + sheetGapMm;

        if (isAssemblyWorkbenchActive() && window.modelAssembler) {
            const totalSheets = window.modelAssembler.getTotalSheets();
            let curWorkbenchX = (papercraft.selectedPart.layout.pageIndex || 0) * pagePitchMm + (papercraft.selectedPart.layout.x || 0) + dx_mm;
            const newSheet = Math.max(0, Math.min(totalSheets - 1, Math.floor(curWorkbenchX / pagePitchMm)));
            papercraft.selectedPart.layout.pageIndex = newSheet;
            papercraft.selectedPart.layout.x = Math.round((curWorkbenchX - newSheet * pagePitchMm) * 10) / 10;
            papercraft.selectedPart.layout.y = Math.round((papercraft.selectedPart.layout.y + dy_mm) * 10) / 10;

            const owningPiece = currentHitInfo?.piece || window.modelAssembler.pieces.find(p => p.papercraft?.parts?.includes(papercraft.selectedPart));
            if (owningPiece?.papercraft) owningPiece.papercraft.notifyChange();
        } else {
            let curWorkbenchX = papercraft.selectedPart.layout.pageIndex * pagePitchMm + papercraft.selectedPart.layout.x;
            curWorkbenchX += dx_mm;
            papercraft.selectedPart.layout.y = Math.round((papercraft.selectedPart.layout.y + dy_mm) * 10) / 10;

            const newPage = Math.max(0, Math.min(papercraft.pagesCount - 1, Math.floor(curWorkbenchX / pagePitchMm)));
            papercraft.selectedPart.layout.pageIndex = newPage;
            papercraft.selectedPart.layout.x = Math.round((curWorkbenchX - newPage * pagePitchMm) * 10) / 10;
            papercraft.notifyChange();
        }

        updateSelectedPartCard();
        renderUnfoldWorkbench();
    } else if (isPanningWorkbench) {
        papercraft.panX = e.clientX - startPanX;
        papercraft.panY = e.clientY - startPanY;
        renderUnfoldWorkbench();
    } else {
        if (mouseCanvasX >= 0 && mouseCanvasX <= rect.width && mouseCanvasY >= 0 && mouseCanvasY <= rect.height) {
            const hit = getWorkbenchPartAt(mouseCanvasX, mouseCanvasY);
            canvasUnfold.style.cursor = hit ? 'grab' : 'default';
        }
    }
});

window.addEventListener('mouseup', () => {
    if (!papercraft.active) return;
    lastMouseX = null;
    lastMouseY = null;
    if (isMeasuringRuler) {
        isMeasuringRuler = false;
        renderUnfoldWorkbench();
    }
    papercraft.isDraggingPart = false;
    isPanningWorkbench = false;
    if (canvasUnfold) canvasUnfold.style.cursor = papercraft.measureMode ? 'crosshair' : 'default';
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
    if (isAssemblyWorkbenchActive() && window.modelAssembler) {
        let targetPiece = currentHitInfo?.piece;
        if (targetPiece && targetPiece.papercraft) {
            targetPiece.papercraft.autoPackA4();
        } else {
            window.modelAssembler.pieces.forEach(p => {
                if (p.papercraft) p.papercraft.autoPackA4();
            });
        }
        updatePapercraftUI();
        renderUnfoldWorkbench();
        return;
    }
    papercraft.autoPackA4();
    renderUnfoldWorkbench();
}
document.getElementById('btn-unfold-autopack')?.addEventListener('click', handleAutoPack);
document.getElementById('btn-unfold-autopack-side')?.addEventListener('click', handleAutoPack);

function handleRotatePart() {
    if (papercraft.selectedPart) {
        papercraft.selectedPart.layout.rotation = (papercraft.selectedPart.layout.rotation + 45) % 360;
        const pEngine = getActivePartEngine();
        if (pEngine) pEngine.notifyChange();
        updateSelectedPartCard();
        renderUnfoldWorkbench();
    }
}
document.getElementById('btn-unfold-rotate')?.addEventListener('click', handleRotatePart);
document.getElementById('btn-unfold-rotate-side')?.addEventListener('click', handleRotatePart);

function handleAddPage() {
    if (isAssemblyWorkbenchActive() && window.modelAssembler) {
        window.modelAssembler.addSheet();
        updatePapercraftUI();
        renderUnfoldWorkbench();
        return;
    }
    papercraft.addPage();
    updatePapercraftUI();
    renderUnfoldWorkbench();
}
document.getElementById('btn-unfold-add-page')?.addEventListener('click', handleAddPage);
document.getElementById('btn-unfold-add-page-side')?.addEventListener('click', handleAddPage);

// Botón Limpiar Hojas Vacías (elimina y compacta páginas sin piezas)
function handleCleanEmptyPages() {
    let removed = 0;
    let totalPages = papercraft.pagesCount;
    if (isAssemblyWorkbenchActive() && window.modelAssembler) {
        removed = window.modelAssembler.cleanEmptySheets();
        totalPages = window.modelAssembler.getTotalSheets();
    } else {
        removed = papercraft.cleanEmptyPages();
        totalPages = papercraft.pagesCount;
    }
    updatePapercraftUI();
    renderUnfoldWorkbench();
    const countBadge = document.getElementById('unfold-parts-count');
    if (countBadge) {
        if (removed > 0) {
            countBadge.textContent = `✓ ${removed} hoja(s) eliminada(s) • ${totalPages} A4`;
            setTimeout(() => updatePapercraftUI(), 3000);
        } else {
            countBadge.textContent = `Sin hojas vacías • ${totalPages} A4`;
            setTimeout(() => updatePapercraftUI(), 2500);
        }
    }
}
document.getElementById('btn-unfold-clean-pages')?.addEventListener('click', handleCleanEmptyPages);
document.getElementById('btn-unfold-clean-pages-side')?.addEventListener('click', handleCleanEmptyPages);

// Botón de Regla (Herramienta de Medición Interactiva)
const btnMeasure = document.getElementById('btn-unfold-measure');
function toggleMeasureMode() {
    papercraft.measureMode = !papercraft.measureMode;
    if (papercraft.measureMode) {
        if (btnMeasure) {
            btnMeasure.style.background = '#ff9800';
            btnMeasure.style.color = '#000000';
            btnMeasure.style.fontWeight = 'bold';
        }
        if (canvasUnfold) canvasUnfold.style.cursor = 'crosshair';
    } else {
        if (btnMeasure) {
            btnMeasure.style.background = '';
            btnMeasure.style.color = '#ffecb3';
            btnMeasure.style.fontWeight = '';
        }
        papercraft.activeMeasurement = null;
        if (canvasUnfold) canvasUnfold.style.cursor = 'default';
        renderUnfoldWorkbench();
    }
}
btnMeasure?.addEventListener('click', toggleMeasureMode);

// Acciones de Pieza Seleccionada en Sidebar (Girar y Centrar en Hoja)
document.getElementById('btn-unfold-sel-rotate')?.addEventListener('click', () => {
    if (papercraft.selectedPart) {
        papercraft.selectedPart.layout.rotation = (papercraft.selectedPart.layout.rotation + 45) % 360;
        const pEngine = typeof getActivePartEngine === 'function' ? getActivePartEngine() : papercraft;
        if (pEngine) pEngine.notifyChange();
        updateSelectedPartCard();
        renderUnfoldWorkbench();
    }
});
document.getElementById('btn-unfold-sel-center')?.addEventListener('click', () => {
    if (papercraft.selectedPart) {
        papercraft.selectedPart.layout.x = Math.round(papercraft.A4_W / 2);
        papercraft.selectedPart.layout.y = Math.round(papercraft.A4_H / 2);
        const pEngine = typeof getActivePartEngine === 'function' ? getActivePartEngine() : papercraft;
        if (pEngine) pEngine.notifyChange();
        updateSelectedPartCard();
        renderUnfoldWorkbench();
    }
});

// Botones Deshacer / Rehacer (Ribbon)
document.getElementById('btn-undo')?.addEventListener('click', () => {
    if (painter) painter.undo();
});
document.getElementById('btn-redo')?.addEventListener('click', () => {
    if (painter) painter.redo();
});

// Botón Separar UVs (Ribbon Papercraft)
document.getElementById('btn-ribbon-pack-uv')?.addEventListener('click', () => {
    if (!state.mesh) {
        alert('Cargue un modelo 3D primero.');
        return;
    }
    const res = papercraft.packMeshUVs(state.mesh, 0.025);
    if (res.success) {
        if (painter) painter.buildTrianglesCache();
        papercraft.analyzeMesh(state.mesh, TEX_SIZE);
        updatePapercraftUI();
        drawUVWireframe();
        if (papercraft.active) renderUnfoldWorkbench();
        if (state.texture) state.texture.needsUpdate = true;
    } else {
        alert(res.message || 'No se pudieron reorganizar las UVs.');
    }
});

// Exportar PDF A4 1:1 (Ribbon y Panel Unfold)
function triggerPdfExport() {
    if (window.modelAssembler && (window.modelAssembler.is3DMode || window.modelAssembler.pieces.length > 1)) {
        window.modelAssembler.exportFinalAlbumPDF();
        return;
    }
    papercraft.exportA4PDF(canvas2d, 'Neo_Papercraft_A4_1-1.pdf');
}
document.getElementById('btn-ribbon-export-pdf-a4')?.addEventListener('click', triggerPdfExport);
document.getElementById('btn-unfold-export-pdf')?.addEventListener('click', triggerPdfExport);
document.getElementById('btn-unfold-canvas-export-pdf')?.addEventListener('click', triggerPdfExport);
document.getElementById('unfold-view-scope')?.addEventListener('change', () => {
    if (typeof renderUnfoldWorkbench === 'function') renderUnfoldWorkbench();
});

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

// Control de Escala por Porcentaje (%)
const scalePctInput = document.getElementById('unfold-scale-pct');
function applyScalePct(pct) {
    const clampedPct = Math.max(0.1, Math.min(100000, parseFloat(pct) || 100));
    papercraft.scalePct = clampedPct;
    papercraft.currentScale = `${Math.round(clampedPct * 10) / 10}%`;
    const presetSelect = document.getElementById('unfold-scale-preset');
    if (presetSelect) presetSelect.value = 'custom';

    const isGlobal = document.getElementById('unfold-check-global-scale')?.checked ?? true;
    if (isGlobal && window.modelAssembler && window.modelAssembler.pieces.length > 0) {
        window.modelAssembler.applyGlobalScale(clampedPct);
    } else {
        const base = papercraft.baseModelLengthMm || papercraft.modelLengthMm || 200.0;
        const newLen = Math.max(0.1, base * (clampedPct / 100));
        papercraft.setModelLength(newLen);
        papercraft.autoPackA4();
        updatePapercraftUI();
        drawUVWireframe();
        renderUnfoldWorkbench();
    }
}
scalePctInput?.addEventListener('change', (e) => applyScalePct(e.target.value));
scalePctInput?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 0.1 && val <= 100000) {
        applyScalePct(val);
    }
});

document.querySelectorAll('.btn-scale-quick').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const pct = parseFloat(e.currentTarget.getAttribute('data-pct')) || 100;
        if (scalePctInput) scalePctInput.value = pct;
        applyScalePct(pct);
    });
});

// Control de longitud del modelo armado (Largo Z en mm)
const modelLenInput = document.getElementById('unfold-model-length');
modelLenInput?.addEventListener('change', (e) => {
    const val = Math.max(0.1, Math.min(50000, parseFloat(e.target.value) || 200));
    const base = papercraft.baseModelLengthMm || 200.0;
    const newPct = (val / base) * 100;
    applyScalePct(newPct);
});

// Control de envergadura del modelo armado (Ancho X en mm)
const modelWidthInput = document.getElementById('unfold-model-width');
modelWidthInput?.addEventListener('change', (e) => {
    const val = Math.max(0.1, Math.min(50000, parseFloat(e.target.value) || 100));
    const rx = (papercraft.ratioX && papercraft.ratioX > 0.001) ? papercraft.ratioX : 0.67;
    const newLen = val / rx;
    const base = papercraft.baseModelLengthMm || 200.0;
    const newPct = (newLen / base) * 100;
    applyScalePct(newPct);
});

// Control de altura del modelo armado (Alto Y en mm)
const modelHeightInput = document.getElementById('unfold-model-height');
modelHeightInput?.addEventListener('change', (e) => {
    const val = Math.max(0.1, Math.min(50000, parseFloat(e.target.value) || 30));
    const ry = (papercraft.ratioY && papercraft.ratioY > 0.001) ? papercraft.ratioY : 0.19;
    const newLen = val / ry;
    const base = papercraft.baseModelLengthMm || 200.0;
    const newPct = (newLen / base) * 100;
    applyScalePct(newPct);
});

// Selector de Escala Preset
document.getElementById('unfold-scale-preset')?.addEventListener('change', (e) => {
    const preset = e.target.value;
    if (preset === 'custom') return;
    if (preset === '1:1') {
        applyScalePct(100);
        papercraft.currentScale = '1:1';
        updatePapercraftUI();
        return;
    }
    papercraft.currentScale = preset;
    let factor = 1.0;
    if (preset === '1:10') factor = 1 / 10;
    else if (preset === '1:33') factor = 1 / 33;
    else if (preset === '1:24') factor = 1 / 24;
    else if (preset === '1:48') factor = 1 / 48;
    else if (preset === '1:72') factor = 1 / 72;

    const newPct = Math.round(factor * 1000) / 10;
    applyScalePct(newPct);
    papercraft.currentScale = preset;
    updatePapercraftUI();
});

// Selector de Unidad de Origen del OBJ (Metros / Milímetros / Centímetros)
document.getElementById('unfold-obj-unit')?.addEventListener('change', (e) => {
    const unit = e.target.value;
    papercraft.objUnit = unit;
    papercraft.baseModelLengthMm = null;
    papercraft.modelLengthMm = null;
    papercraft.scalePct = 100.0;
    papercraft.currentScale = '1:1';
    const presetSel = document.getElementById('unfold-scale-preset');
    if (presetSel) presetSel.value = '1:1';
    if (state.mesh) {
        papercraft.analyzeMesh(state.mesh, TEX_SIZE);
        papercraft.autoPackA4();
        updatePapercraftUI();
        drawUVWireframe();
        renderUnfoldWorkbench();
    }
});

// Orientación de la hoja A4
document.getElementById('unfold-a4-orient')?.addEventListener('change', (e) => {
    papercraft.a4Orientation = e.target.value;
    drawUVWireframe();
    renderUnfoldWorkbench();
});

// UI Event Listeners para Malla UV clásica
const uvWireframeSelect = document.getElementById('uv-wireframe-mode');
const toggleWireframeCheck = document.getElementById('toggle-wireframe');

if (uvWireframeSelect) {
    uvWireframeSelect.addEventListener('change', (e) => {
        state.uvWireframeMode = e.target.value;
        state.uvWireframeVisible = (e.target.value !== 'none');
        if (toggleWireframeCheck) toggleWireframeCheck.checked = state.uvWireframeVisible;
        drawUVWireframe();
    });
}

if (toggleWireframeCheck) {
    toggleWireframeCheck.addEventListener('change', (e) => {
        state.uvWireframeVisible = e.target.checked;
        if (!e.target.checked) {
            state.uvWireframeMode = 'none';
            if (uvWireframeSelect) uvWireframeSelect.value = 'none';
        } else {
            if (state.uvWireframeMode === 'none') {
                state.uvWireframeMode = 'clean';
                if (uvWireframeSelect) uvWireframeSelect.value = 'clean';
            }
        }
        drawUVWireframe();
    });
}

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

        // Desactivar botón de gotero si estuviera activo
        document.getElementById('btn-eyedropper')?.classList.remove('active');

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

        const isShape = ['line', 'curve', 'rect', 'circle', 'triangle', 'star', 'polygon', 'arrow', 'badge'].includes(mode);

        brushModeInput.value = mode;
        toolButtons.forEach(b => b.classList.remove('active'));
        document.getElementById('btn-select-rect')?.classList.remove('active');
        document.getElementById('btn-select-lasso')?.classList.remove('active');
        targetBtn.classList.add('active');

        // Si se cambia a cualquier herramienta que no sea texto, desactivar calcomanías y texto
        if (window.decalSystem) {
            if (window.decalSystem.isTextMode && mode !== 'text') {
                window.decalSystem.cancelDecal(false);
            }
            if (mode === 'select') {
                window.decalSystem.isActive = true;
                if (!window.decalSystem.mode) {
                    window.decalSystem.setMode('2d');
                }
            } else if (!isShape) {
                window.decalSystem.deselectDecal();
                window.decalSystem.isActive = false;
            }
        }

        const shapeBar = document.getElementById('shape-controls');
        const ribbon = document.getElementById('ribbon');
        if (isShape) {
            if (shapeBar) shapeBar.style.display = 'flex';
            if (ribbon) ribbon.classList.add('shape-mode-active');
            const curDash = window.currentShapeStrokeDash || 'solid';
            document.querySelectorAll('.btn-shape-dash').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-dash') === curDash);
            });
            document.querySelectorAll('.btn-catalog-dash').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-dash') === curDash);
            });
        } else if (mode !== 'select') {
            if (shapeBar) shapeBar.style.display = 'none';
            if (ribbon) ribbon.classList.remove('shape-mode-active');
        }
    });
});

// --- Herramientas de Marco / Área de Selección (Raster / Enmascarado) ---
const btnSelectRect = document.getElementById('btn-select-rect');
const btnSelectLasso = document.getElementById('btn-select-lasso');
const btnQuickFill = document.getElementById('btn-quick-fill-sel');
const btnQuickInvert = document.getElementById('btn-quick-invert-sel');
const btnQuickDel = document.getElementById('btn-quick-del-sel');
const btnQuickDesel = document.getElementById('btn-quick-desel');
const btnQuickCamo = document.getElementById('btn-quick-camo-sel');
const maskIndicator = document.getElementById('selection-mask-indicator');

function activateSelectionMode(mode) {
    if (window.painter && window.painter.editingShape) {
        window.painter.commitShape();
    }
    if (window.painter && window.painter.transformState && window.painter.transformState.active) {
        window.painter.commitLayerTransform();
    }
    if (window.decalSystem && window.decalSystem.isTextMode) {
        window.decalSystem.cancelDecal();
    }
    document.getElementById('btn-eyedropper')?.classList.remove('active');

    toolButtons.forEach(b => b.classList.remove('active'));
    btnSelectRect?.classList.toggle('active', mode === 'select_rect');
    btnSelectLasso?.classList.toggle('active', mode === 'select_lasso');
    if (brushModeInput) brushModeInput.value = mode;
    if (painter) painter.previousMode = 'paint';

    document.querySelectorAll('.mask-tool-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-masktool') === mode);
    });
}

function applySelectionFill() {
    if (!selectionManager || !selectionManager.active) return;
    const brushColor = document.getElementById('brush-color')?.value || '#2e7d32';
    selectionManager.fillContent(layerManager, brushColor);
    if (painter) {
        painter.needsUpdate = true;
        painter.forceUpdate = true;
    }
}

function applySelectionToCamo() {
    if (!selectionManager || !selectionManager.active) return;
    const brushColor = document.getElementById('brush-color')?.value || '#2e7d32';
    const camoLayer = layerManager.addCamoLayer(brushColor);
    selectionManager.fillContent(layerManager, '#FFFFFF');
    selectionManager.deselect();
    layerManager.setEditingTarget(camoLayer.id, 'mask');
    if (painter) {
        painter.needsUpdate = true;
        painter.forceUpdate = true;
    }
}

btnSelectRect?.addEventListener('click', () => activateSelectionMode('select_rect'));
btnSelectLasso?.addEventListener('click', () => activateSelectionMode('select_lasso'));
btnQuickFill?.addEventListener('click', applySelectionFill);
btnQuickInvert?.addEventListener('click', () => selectionManager.invert());
btnQuickDel?.addEventListener('click', () => {
    selectionManager.deleteContent(layerManager);
    if (painter) {
        painter.needsUpdate = true;
        painter.forceUpdate = true;
    }
});
btnQuickDesel?.addEventListener('click', () => selectionManager.deselect());
btnQuickCamo?.addEventListener('click', applySelectionToCamo);

// --- Indicador de Estado de Máscara de Capa (Substance Painter) y Selección ---
function updateMaskFloatingIndicator() {
    if (!maskIndicator) return;
    const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
    const isEditingLayerMask = activeLayer && activeLayer.hasMask && activeLayer.isEditingMask;
    const hasSelection = selectionManager && selectionManager.active;

    const btnFill = document.getElementById('btn-mask-fill');
    const btnToCamo = document.getElementById('btn-mask-to-camo');
    const btnInvert = document.getElementById('btn-mask-invert');
    const btnClear = document.getElementById('btn-mask-clear');
    const btnExit = document.getElementById('btn-mask-exit');

    if (isEditingLayerMask) {
        maskIndicator.classList.add('visible');
        const spanText = document.getElementById('mask-indicator-label') || maskIndicator.querySelector('span');
        if (spanText) {
            spanText.textContent = `🎭 Pintando en Máscara: "${activeLayer.name}" (Pincel revela • Borrador oculta)`;
        }
        if (btnFill) btnFill.style.display = hasSelection ? 'inline-block' : 'none';
        if (btnToCamo) btnToCamo.style.display = 'none';
        if (btnInvert) {
            btnInvert.style.display = 'inline-block';
            btnInvert.textContent = hasSelection ? 'Invertir Sel.' : 'Invertir Máscara';
        }
        if (btnClear) {
            btnClear.style.display = 'inline-block';
            btnClear.textContent = hasSelection ? 'Borrar Sel.' : 'Limpiar Máscara';
        }
        if (btnExit) {
            btnExit.style.display = 'inline-block';
            btnExit.textContent = 'Pintar Color';
        }
    } else if (hasSelection) {
        maskIndicator.classList.add('visible');
        const spanText = document.getElementById('mask-indicator-label') || maskIndicator.querySelector('span');
        if (spanText) {
            spanText.textContent = selectionManager.inverted 
                ? '🎭 Selección Invertida (Pintar fuera)' 
                : '🎭 Selección Activa (Pintar dentro)';
        }
        if (btnFill) btnFill.style.display = 'inline-block';
        if (btnToCamo) btnToCamo.style.display = 'inline-block';
        if (btnInvert) {
            btnInvert.style.display = 'inline-block';
            btnInvert.textContent = 'Invertir';
        }
        if (btnClear) {
            btnClear.style.display = 'inline-block';
            btnClear.textContent = 'Borrar';
        }
        if (btnExit) {
            btnExit.style.display = 'inline-block';
            btnExit.textContent = '✖ Deseleccionar';
        }
    } else {
        maskIndicator.classList.remove('visible');
    }
}

document.getElementById('btn-mask-fill')?.addEventListener('click', () => {
    if (!selectionManager || !selectionManager.active) return;
    const brushColor = document.getElementById('brush-color')?.value || '#2e7d32';
    selectionManager.fillContent(layerManager, brushColor);
    if (painter) {
        painter.needsUpdate = true;
        painter.forceUpdate = true;
    }
});

document.getElementById('btn-mask-to-camo')?.addEventListener('click', () => {
    if (!selectionManager || !selectionManager.active) return;
    const brushColor = document.getElementById('brush-color')?.value || '#2e7d32';
    const camoLayer = layerManager.addCamoLayer(brushColor);
    selectionManager.fillContent(layerManager, '#FFFFFF');
    selectionManager.deselect();
    layerManager.setEditingTarget(camoLayer.id, 'mask');
    if (painter) {
        painter.needsUpdate = true;
        painter.forceUpdate = true;
    }
});

document.getElementById('btn-mask-invert')?.addEventListener('click', () => {
    const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
    if (selectionManager && selectionManager.active) {
        selectionManager.invert();
    } else if (activeLayer && activeLayer.hasMask && activeLayer.isEditingMask) {
        activeLayer.invertMask();
        layerManager.recomposite();
        layerManager.renderUI();
        if (painter) {
            painter.needsUpdate = true;
            painter.forceUpdate = true;
        }
    }
});

document.getElementById('btn-mask-clear')?.addEventListener('click', () => {
    const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
    if (selectionManager && selectionManager.active) {
        selectionManager.deleteContent(layerManager);
        if (painter) {
            painter.needsUpdate = true;
            painter.forceUpdate = true;
        }
    } else if (activeLayer && activeLayer.hasMask) {
        activeLayer.clearMask('black');
        layerManager.recomposite();
        layerManager.renderUI();
        if (painter) {
            painter.needsUpdate = true;
            painter.forceUpdate = true;
        }
    }
});

document.getElementById('btn-mask-exit')?.addEventListener('click', () => {
    const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
    if (selectionManager && selectionManager.active) {
        selectionManager.deselect();
    } else if (activeLayer && activeLayer.hasMask && activeLayer.isEditingMask) {
        layerManager.setEditingTarget(activeLayer.id, 'color');
    }
    updateMaskFloatingIndicator();
});

layerManager.onMaskModeChange = (isEditingMask, layer) => {
    updateMaskFloatingIndicator();
};

selectionManager.onSelectionChange = (info) => {
    updateMaskFloatingIndicator();
    const hasSel = selectionManager && (selectionManager.active || selectionManager.creating);
    setSelection3DOverlayVisible(hasSel);
    if (painter) {
        painter.uiNeedsUpdate = true;
    }
    if (hasSel && state.textureUI) {
        state.textureUI.needsUpdate = true;
    }
};

// Herramienta Gotero / Cuentagotas (Eyedropper)
const btnEyedropper = document.getElementById('btn-eyedropper');
function activateEyedropper() {
    if (!brushModeInput) return;
    if (brushModeInput.value === 'eyedropper') {
        if (window.painter && typeof window.painter.restorePreviousTool === 'function') {
            window.painter.restorePreviousTool();
        }
        return;
    }

    if (window.painter) {
        window.painter.previousMode = brushModeInput.value || 'paint';
        if (window.painter.editingShape) window.painter.commitShape();
        if (window.painter.transformState && window.painter.transformState.active) {
            window.painter.commitLayerTransform();
        }
    }
    if (window.decalSystem && window.decalSystem.isTextMode) {
        window.decalSystem.cancelDecal();
    }

    toolButtons.forEach(b => b.classList.remove('active'));
    if (btnEyedropper) btnEyedropper.classList.add('active');
    brushModeInput.value = 'eyedropper';
}

if (btnEyedropper) {
    btnEyedropper.addEventListener('click', activateEyedropper);
}

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

// Precargar tipografías militares y especiales para renderizado en Canvas
['AmarilloUSAF', 'Gunplay', 'Gunplay 3D', 'Steiner'].forEach(f => {
    try { document.fonts?.load(`24px "${f}"`); } catch (_) {}
});

textFontFamily?.addEventListener('change', (e) => {
    const fam = e.target.value;
    if (document.fonts?.load) {
        document.fonts.load(`256px "${fam}"`).then(() => {
            window.decalSystem?.updateTextDecal({ fontFamily: fam });
        }).catch(() => {
            window.decalSystem?.updateTextDecal({ fontFamily: fam });
        });
    } else {
        window.decalSystem?.updateTextDecal({ fontFamily: fam });
    }
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
    const step = cur <= 10 ? 1 : 2;
    const next = Math.max(4, cur - step);
    textFontSize.value = next;
    if (textSizeVal) textSizeVal.textContent = `${next} px`;
    window.decalSystem?.updateTextDecal({ fontSize: next });
});

document.getElementById('btn-text-size-inc')?.addEventListener('click', () => {
    if (!textFontSize) return;
    const cur = parseInt(textFontSize.value, 10);
    const step = cur < 10 ? 1 : 2;
    const next = Math.min(250, cur + step);
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

const btnTextAlignLeft = document.getElementById('btn-text-align-left');
const btnTextAlignCenter = document.getElementById('btn-text-align-center');
const btnTextAlignRight = document.getElementById('btn-text-align-right');

function setTextAlign(align) {
    [btnTextAlignLeft, btnTextAlignCenter, btnTextAlignRight].forEach(b => b?.classList.remove('active'));
    if (align === 'left') btnTextAlignLeft?.classList.add('active');
    else if (align === 'right') btnTextAlignRight?.classList.add('active');
    else btnTextAlignCenter?.classList.add('active');
    window.decalSystem?.updateTextDecal({ align });
}

btnTextAlignLeft?.addEventListener('click', () => setTextAlign('left'));
btnTextAlignCenter?.addEventListener('click', () => setTextAlign('center'));
btnTextAlignRight?.addEventListener('click', () => setTextAlign('right'));

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
window.updateActiveQuickColor = updateActiveQuickColor;

colorInput?.addEventListener('input', (e) => {
    updateActiveQuickColor(e.target.value);
    if (window.decalSystem && window.decalSystem.selectedDecalId) {
        window.decalSystem.updateSelectedShapeFillFromColor(e.target.value);
    }
});

document.querySelectorAll('.palette-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
        const col = e.target.getAttribute('data-color');
        if (colorInput) colorInput.value = col;
        updateActiveQuickColor(col);
        if (window.decalSystem && window.decalSystem.selectedDecalId) {
            window.decalSystem.updateSelectedShapeFillFromColor(col);
        }
    });
});

// --- Sistema de Guardado y Carga de Proyecto Completo (.nsp) ---
function getProjectNSPData() {
    try {
        const layersData = layerManager.layers.map(layer => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            isBackground: layer.isBackground,
            imageData: layer.canvas.toDataURL('image/png'),
            decals: layer.decals ? layer.decals.map(d => {
                let dataUrl = d.dataUrl;
                if (!dataUrl && d.img) {
                    try {
                        const tc = document.createElement('canvas');
                        tc.width = d.img.naturalWidth || d.img.width || 100;
                        tc.height = d.img.naturalHeight || d.img.height || 100;
                        const tctx = tc.getContext('2d');
                        tctx.drawImage(d.img, 0, 0);
                        dataUrl = tc.toDataURL('image/png');
                    } catch (err) {}
                }
                return {
                    id: d.id,
                    name: d.name,
                    type: d.type || 'decal',
                    textOptions: d.textOptions,
                    shapeOptions: d.shapeOptions,
                    dataUrl: dataUrl,
                    x: d.x,
                    y: d.y,
                    width: d.width,
                    height: d.height,
                    baseWidth: d.baseWidth,
                    baseHeight: d.baseHeight,
                    rotation: d.rotation,
                    flipH: !!d.flipH,
                    flipV: !!d.flipV,
                    opacity: d.opacity,
                    visible: d.visible
                };
            }) : []
        }));

        const slots = [
            document.getElementById('slot-color-1')?.getAttribute('data-color') || '#ff0000',
            document.getElementById('slot-color-2')?.getAttribute('data-color') || '#00ff00',
            document.getElementById('slot-color-3')?.getAttribute('data-color') || '#0000ff'
        ];

        return {
            format: 'NeoSubstancePainter',
            version: '1.0',
            date: new Date().toISOString(),
            resolution: TEX_SIZE,
            modelOBJ: state.rawOBJText || null,
            backgroundColor: bgPresetSelect?.value || '#222222',
            quickColors: slots,
            layers: layersData,
            papercraft: {
                modelLengthMm: papercraft.modelLengthMm,
                baseModelLengthMm: papercraft.baseModelLengthMm,
                scalePct: papercraft.scalePct,
                scalePreset: document.getElementById('unfold-scale-preset')?.value || papercraft.currentScale || '1:33',
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
    } catch (err) {
        console.error('Error generando datos de proyecto .nsp:', err);
        return null;
    }
}
window.getProjectNSPData = getProjectNSPData;

async function saveProjectNSP() {
    try {
        const project = getProjectNSPData();
        if (!project) throw new Error('No se pudieron compilar los datos del proyecto');

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

let isLoadingProjectNSP = false;
async function loadProjectNSP(fileOrData, silent = false) {
    while (isLoadingProjectNSP) {
        await new Promise(r => setTimeout(r, 50));
    }
    isLoadingProjectNSP = true;
    try {
        let project;
        if (typeof fileOrData === 'object' && fileOrData !== null && !(fileOrData instanceof Blob) && !(fileOrData instanceof File)) {
            project = fileOrData;
        } else if (typeof fileOrData === 'string') {
            project = JSON.parse(fileOrData);
        } else if (fileOrData && typeof fileOrData.text === 'function') {
            const text = await fileOrData.text();
            project = JSON.parse(text);
        } else {
            throw new Error('Formato de datos .nsp no reconocido.');
        }

        if (!silent && (!project.format || project.format !== 'NeoSubstancePainter')) {
            if (!confirm('El archivo no parece ser un proyecto .nsp válido. ¿Deseas intentar cargarlo de todos modos?')) {
                return;
            }
        }

        // 0. Si el proyecto incluye su propio modelo 3D (OBJ), cargarlo primero
        if (project.modelOBJ) {
            loadOBJContents(project.modelOBJ);
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
                const layer = layerManager.createLayer(lData.name, lData.isBackground, lData.id);
                layer.visible = lData.visible !== undefined ? lData.visible : true;
                layer.opacity = lData.opacity !== undefined ? lData.opacity : 1;
                layer.blendMode = lData.blendMode || 'source-over';

                if (lData.imageData) {
                    await new Promise(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            layer.ctx.clearRect(0, 0, layer.width, layer.height);
                            layer.ctx.drawImage(img, 0, 0);
                            resolve();
                        };
                        img.onerror = resolve;
                        img.src = lData.imageData;
                    });
                }

                if (lData.decals && Array.isArray(lData.decals)) {
                    layer.decals = [];
                    for (const d of lData.decals) {
                        if (d.dataUrl) {
                            await new Promise(resolve => {
                                const dImg = new Image();
                                dImg.onload = () => {
                                    layer.addDecal({
                                        id: d.id,
                                        name: d.name,
                                        type: d.type || 'decal',
                                        textOptions: d.textOptions,
                                        shapeOptions: d.shapeOptions,
                                        img: dImg,
                                        dataUrl: d.dataUrl,
                                        x: d.x,
                                        y: d.y,
                                        width: d.width,
                                        height: d.height,
                                        baseWidth: d.baseWidth || d.width,
                                        baseHeight: d.baseHeight || d.height,
                                        rotation: d.rotation || 0,
                                        flipH: !!d.flipH,
                                        flipV: !!d.flipV,
                                        opacity: d.opacity !== undefined ? d.opacity : 1.0,
                                        visible: d.visible !== undefined ? d.visible : true
                                    });
                                    resolve();
                                };
                                dImg.onerror = resolve;
                                dImg.src = d.dataUrl;
                            });
                        }
                    }
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
            if (pp.baseModelLengthMm) {
                papercraft.baseModelLengthMm = pp.baseModelLengthMm;
            } else if (pp.modelLengthMm) {
                papercraft.baseModelLengthMm = pp.modelLengthMm;
            }

            if (pp.scalePct !== undefined) {
                papercraft.scalePct = pp.scalePct;
            } else if (pp.modelLengthMm && papercraft.baseModelLengthMm) {
                papercraft.scalePct = Math.round((pp.modelLengthMm / papercraft.baseModelLengthMm) * 100);
            } else {
                papercraft.scalePct = 100;
            }

            if (pp.modelLengthMm) {
                papercraft.modelLengthMm = pp.modelLengthMm;
            }
            if (pp.scalePreset) {
                papercraft.currentScale = pp.scalePreset;
                const presetSel = document.getElementById('unfold-scale-preset');
                if (presetSel) presetSel.value = pp.scalePreset;
            }

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

        if (!silent) {
            alert('¡Proyecto cargado exitosamente!');
        }
    } catch (err) {
        console.error('Error cargando proyecto .nsp:', err);
        if (!silent) {
            alert('Error al abrir el proyecto: ' + err.message);
        }
    } finally {
        isLoadingProjectNSP = false;
    }
}
window.saveProjectNSP = saveProjectNSP;
window.loadProjectNSP = loadProjectNSP;

document.getElementById('btn-save-project')?.addEventListener('click', saveProjectNSP);
document.getElementById('btn-load-project')?.addEventListener('click', () => {
    document.getElementById('input-project')?.click();
});
document.getElementById('input-project')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        window.currentProjectFileName = file.name.replace(/\.[^/.]+$/, '');
        loadProjectNSP(file);
    }
    e.target.value = '';
});

// Guardar y Cargar Proyecto Ensamblado (.nspp) desde menú Archivo
document.getElementById('btn-save-assembly-project')?.addEventListener('click', () => {
    const dropdown = document.getElementById('paint-file-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    if (window.modelAssembler) {
        window.modelAssembler.exportAssemblyProject();
    } else {
        alert('El ensamblador no está inicializado.');
    }
});
document.getElementById('btn-load-assembly-project')?.addEventListener('click', () => {
    const dropdown = document.getElementById('paint-file-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    document.getElementById('input-assembler-project')?.click();
});
document.getElementById('input-assembler-project')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && window.modelAssembler) {
        await window.modelAssembler.loadAssemblyProject(file);
    }
    e.target.value = '';
});

// Brush size controls & persistence (Guarda el último tamaño usado)
const sizeInput = document.getElementById('brush-size');
const sizeLabel = document.getElementById('brush-size-label');
const btnSizeDec = document.getElementById('btn-size-dec');
const btnSizeInc = document.getElementById('btn-size-inc');

function updateBrushSize(val, triggerEvent = true) {
    const clamped = Math.max(1, Math.min(100, Math.round(val)));
    sizeInput.value = clamped;
    sizeLabel.textContent = clamped + ' px';
    localStorage.setItem('neo_substance_brush_size', clamped);
    if (triggerEvent) {
        sizeInput.dispatchEvent(new Event('input'));
    }
}

// Cargar tamaño previo guardado en localStorage
const savedSize = localStorage.getItem('neo_substance_brush_size');
if (savedSize) {
    const parsed = parseInt(savedSize, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
        updateBrushSize(parsed, true);
    }
}

sizeInput.addEventListener('input', (e) => {
    updateBrushSize(parseInt(e.target.value, 10), false);
});

btnSizeDec?.addEventListener('click', () => {
    updateBrushSize(parseInt(sizeInput.value, 10) - 1, true);
});

btnSizeInc?.addEventListener('click', () => {
    updateBrushSize(parseInt(sizeInput.value, 10) + 1, true);
});

if (sizeLabel) {
    sizeLabel.style.cursor = 'pointer';
    sizeLabel.title = 'Haz clic para ingresar un valor exacto (1 - 100 px)';
    sizeLabel.addEventListener('click', () => {
        const current = parseInt(sizeInput.value, 10) || 10;
        const val = prompt('Tamaño exacto del pincel (1 a 100 px):', current);
        if (val !== null) {
            const num = parseInt(val, 10);
            if (!isNaN(num)) {
                updateBrushSize(num, true);
            }
        }
    });
}

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

// --- SISTEMA DE VISTAS ORTOGONALES Y PERSPECTIVA ESTILO BLENDER ---
let isProgrammaticCameraChange = false;

function updateCameraReferences() {
    isProgrammaticCameraChange = true;
    window.camera = camera;
    controls.object = camera;
    if (window.painter) window.painter.camera = camera;
    if (window.decalSystem) window.decalSystem.camera = camera;
    controls.update();
    isProgrammaticCameraChange = false;
    updateView3DIndicator();
}

function updateView3DIndicator() {
    const labelEl = document.getElementById('view3d-cam-label');
    const toggleBtn = document.getElementById('btn-view3d-toggle-ortho');
    const viewButtons = document.querySelectorAll('.btn-v3d-view');

    if (toggleBtn) {
        toggleBtn.classList.toggle('active', isOrthographic);
        toggleBtn.textContent = isOrthographic ? '📐 Ortogonal' : '🎥 Perspectiva';
    }

    viewButtons.forEach(btn => {
        btn.classList.toggle('active', isOrthographic && btn.getAttribute('data-view') === currentOrthoView);
    });

    if (!labelEl) return;
    if (!isOrthographic) {
        labelEl.textContent = 'Perspectiva Usuario';
        return;
    }

    switch (currentOrthoView) {
        case 'front': labelEl.textContent = 'Frontal Ortogonal (1)'; break;
        case 'back': labelEl.textContent = 'Trasera Ortogonal (Ctrl+1)'; break;
        case 'right': labelEl.textContent = 'Derecha Ortogonal (3)'; break;
        case 'left': labelEl.textContent = 'Izquierda Ortogonal (Ctrl+3)'; break;
        case 'top': labelEl.textContent = 'Superior Ortogonal (7)'; break;
        case 'bottom': labelEl.textContent = 'Inferior Ortogonal (Ctrl+7)'; break;
        default: labelEl.textContent = 'Ortogonal Usuario (5)'; break;
    }
}

function syncCameras(fromCam, toCam) {
    const target = controls.target.clone();
    const dist = fromCam.position.distanceTo(target) || 5;
    const dir = new THREE.Vector3().subVectors(fromCam.position, target).normalize();
    const aspect = (view3d.clientWidth || 800) / (view3d.clientHeight || 600);

    if (toCam.isOrthographicCamera) {
        const vFOV = THREE.MathUtils.degToRad(fromCam.fov || 45);
        const visibleHeight = 2 * Math.tan(vFOV / 2) * dist;
        const visibleWidth = visibleHeight * aspect;

        toCam.left = -visibleWidth / 2;
        toCam.right = visibleWidth / 2;
        toCam.top = visibleHeight / 2;
        toCam.bottom = -visibleHeight / 2;
        toCam.zoom = 1;
        toCam.near = Math.max(0.01, dist / 100);
        toCam.far = Math.max(1000, dist * 50);
        toCam.position.copy(target).addScaledVector(dir, dist);
        toCam.up.copy(fromCam.up);
        toCam.lookAt(target);
        toCam.updateProjectionMatrix();
    } else {
        toCam.aspect = aspect;
        toCam.near = Math.max(0.01, dist / 100);
        toCam.far = Math.max(1000, dist * 50);
        toCam.position.copy(target).addScaledVector(dir, dist);
        toCam.up.copy(fromCam.up);
        toCam.lookAt(target);
        toCam.updateProjectionMatrix();
    }
}

function setCameraMode(ortho = true) {
    if (ortho === isOrthographic) return;
    const fromCam = camera;
    isOrthographic = ortho;
    camera = isOrthographic ? orthoCamera : perspCamera;
    currentOrthoView = isOrthographic ? 'user_ortho' : null;

    syncCameras(fromCam, camera);
    updateCameraReferences();
}

function toggleCameraMode() {
    setCameraMode(!isOrthographic);
}

function setOrthogonalView(viewName) {
    currentOrthoView = viewName;
    isOrthographic = true;
    camera = orthoCamera;

    const target = controls.target.clone();
    const aspect = (view3d.clientWidth || 800) / (view3d.clientHeight || 600);

    let maxDim = 3;
    if (state.mesh) {
        const box = new THREE.Box3().setFromObject(state.mesh);
        const size = box.getSize(new THREE.Vector3());
        maxDim = Math.max(size.x, size.y, size.z) || 3;
        const center = box.getCenter(new THREE.Vector3());
        controls.target.copy(center);
        target.copy(center);
    }

    const dist = Math.max(5, maxDim * 2.5);
    const visibleHeight = maxDim * 1.35;
    const visibleWidth = visibleHeight * aspect;

    orthoCamera.left = -visibleWidth / 2;
    orthoCamera.right = visibleWidth / 2;
    orthoCamera.top = visibleHeight / 2;
    orthoCamera.bottom = -visibleHeight / 2;
    orthoCamera.zoom = 1;
    orthoCamera.near = 0.01;
    orthoCamera.far = Math.max(1000, dist * 50);

    switch (viewName) {
        case 'front': // Frontal (Numpad 1)
            orthoCamera.position.set(target.x, target.y, target.z + dist);
            orthoCamera.up.set(0, 1, 0);
            break;
        case 'back': // Trasera (Ctrl + Numpad 1)
            orthoCamera.position.set(target.x, target.y, target.z - dist);
            orthoCamera.up.set(0, 1, 0);
            break;
        case 'right': // Derecha / Lateral (Numpad 3)
            orthoCamera.position.set(target.x + dist, target.y, target.z);
            orthoCamera.up.set(0, 1, 0);
            break;
        case 'left': // Izquierda (Ctrl + Numpad 3)
            orthoCamera.position.set(target.x - dist, target.y, target.z);
            orthoCamera.up.set(0, 1, 0);
            break;
        case 'top': // Superior (Numpad 7)
            orthoCamera.position.set(target.x, target.y + dist, target.z);
            orthoCamera.up.set(0, 0, -1);
            break;
        case 'bottom': // Inferior (Ctrl + Numpad 7)
            orthoCamera.position.set(target.x, target.y - dist, target.z);
            orthoCamera.up.set(0, 0, 1);
            break;
    }

    orthoCamera.lookAt(target);
    orthoCamera.updateProjectionMatrix();

    updateCameraReferences();
}
window.setCameraMode = setCameraMode;
window.toggleCameraMode = toggleCameraMode;
window.setOrthogonalView = setOrthogonalView;

controls.addEventListener('change', () => {
    if (isProgrammaticCameraChange) return;
    if (isOrthographic && currentOrthoView && currentOrthoView !== 'user_ortho') {
        currentOrthoView = 'user_ortho';
        updateView3DIndicator();
    }
});

// Encuadrar / Centrar la cámara sobre el modelo 3D
function frameModel(mesh = state.mesh) {
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const aspect = (view3d.clientWidth || 800) / (view3d.clientHeight || 600);

    controls.target.copy(center);

    // Ajustar Perspectiva
    const fov = perspCamera.fov * (Math.PI / 180);
    const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
    perspCamera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);
    perspCamera.near = Math.max(0.01, maxDim / 100);
    perspCamera.far = Math.max(1000, maxDim * 100);
    perspCamera.updateProjectionMatrix();

    // Ajustar Ortográfica
    const visibleHeight = maxDim * 1.4;
    const visibleWidth = visibleHeight * aspect;
    orthoCamera.left = -visibleWidth / 2;
    orthoCamera.right = visibleWidth / 2;
    orthoCamera.top = visibleHeight / 2;
    orthoCamera.bottom = -visibleHeight / 2;
    orthoCamera.zoom = 1;
    orthoCamera.near = Math.max(0.01, maxDim / 100);
    orthoCamera.far = Math.max(1000, maxDim * 100);
    if (!isOrthographic) {
        orthoCamera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.7);
    }
    orthoCamera.updateProjectionMatrix();

    controls.update();
    updateView3DIndicator();
}
window.frameModel = frameModel;

// Controles de Cámara Vista 3D (+, -, Centrar y atajo tecla F)
document.getElementById('btn-3d-zoom-in')?.addEventListener('click', () => {
    if (isOrthographic) {
        orthoCamera.zoom = Math.min(20, orthoCamera.zoom * 1.25);
        orthoCamera.updateProjectionMatrix();
    } else {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, 0.5);
    }
    controls.update();
});
document.getElementById('btn-3d-zoom-out')?.addEventListener('click', () => {
    if (isOrthographic) {
        orthoCamera.zoom = Math.max(0.05, orthoCamera.zoom / 1.25);
        orthoCamera.updateProjectionMatrix();
    } else {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        camera.position.addScaledVector(dir, -0.5);
    }
    controls.update();
});
document.getElementById('btn-3d-reset')?.addEventListener('click', () => {
    frameModel();
});

document.getElementById('btn-view3d-toggle-ortho')?.addEventListener('click', () => {
    toggleCameraMode();
});
document.querySelectorAll('.btn-v3d-view').forEach(btn => {
    btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-view');
        if (view) setOrthogonalView(view);
    });
});

window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

    // Atajos de cámara estilo Blender (5 = Toggle Persp/Ortho, 1 = Front, 3 = Right, 7 = Top, Ctrl para opuestas)
    if (e.key === '5' || e.code === 'Numpad5') {
        e.preventDefault();
        toggleCameraMode();
        return;
    }
    if (e.key === '1' || e.code === 'Numpad1') {
        e.preventDefault();
        setOrthogonalView(e.ctrlKey ? 'back' : 'front');
        return;
    }
    if (e.key === '3' || e.code === 'Numpad3') {
        e.preventDefault();
        setOrthogonalView(e.ctrlKey ? 'left' : 'right');
        return;
    }
    if (e.key === '7' || e.code === 'Numpad7') {
        e.preventDefault();
        setOrthogonalView(e.ctrlKey ? 'bottom' : 'top');
        return;
    }
    if (e.key === 'f' || e.key === 'F') {
        frameModel();
    }
    if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey) {
        document.getElementById('btn-tool-select')?.click();
    }
    if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey) {
        document.querySelector('.tool-btn[data-mode="paint"]')?.click();
    }
    if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey) {
        activateEyedropper();
    }
    // Atajos de Selección y Máscaras
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) {
        activateSelectionMode('select_rect');
    }
    if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
        activateSelectionMode('select_lasso');
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selectionManager.selectAll();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
        if (activeLayer && activeLayer.hasMask && activeLayer.isEditingMask) {
            activeLayer.invertMask();
            layerManager.recomposite();
            layerManager.renderUI();
            if (painter) {
                painter.needsUpdate = true;
                painter.forceUpdate = true;
            }
        } else {
            selectionManager.invert();
        }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        selectionManager.deselect();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        createNewProject(true);
    }
    if (e.key === 'Escape') {
        if (papercraft && (papercraft.measureMode || papercraft.activeMeasurement)) {
            papercraft.measureMode = false;
            papercraft.activeMeasurement = null;
            const btnMeasure = document.getElementById('btn-unfold-measure');
            if (btnMeasure) {
                btnMeasure.style.background = '';
                btnMeasure.style.color = '#ffecb3';
                btnMeasure.style.fontWeight = '';
            }
            if (canvasUnfold) canvasUnfold.style.cursor = 'default';
            renderUnfoldWorkbench();
            return;
        }
        const activeLayer = layerManager ? layerManager.getActiveLayer() : null;
        if (activeLayer && activeLayer.hasMask && activeLayer.isEditingMask) {
            layerManager.setEditingTarget(activeLayer.id, 'color');
            updateMaskFloatingIndicator();
        } else if (selectionManager.active) {
            selectionManager.deselect();
        }
    }
    if (e.key === 'Enter' || (e.altKey && (e.key === 'Backspace' || e.key === 'Delete'))) {
        if (selectionManager && selectionManager.active) {
            e.preventDefault();
            const brushColor = document.getElementById('brush-color')?.value || '#2e7d32';
            selectionManager.fillContent(layerManager, brushColor);
            if (painter) {
                painter.needsUpdate = true;
                painter.forceUpdate = true;
            }
        }
    }
    if (e.key === 'Delete' || e.key === 'Del' || e.key === 'Backspace') {
        if (selectionManager.active) {
            selectionManager.deleteContent(layerManager);
            if (painter) {
                painter.needsUpdate = true;
                painter.forceUpdate = true;
            }
        }
    }
});

// Resize Handling
window.addEventListener('resize', () => {
    const aspect = (view3d.clientWidth || 800) / (view3d.clientHeight || 600);
    perspCamera.aspect = aspect;
    perspCamera.updateProjectionMatrix();

    const currentHeight = orthoCamera.top - orthoCamera.bottom;
    const newWidth = currentHeight * aspect;
    orthoCamera.left = -newWidth / 2;
    orthoCamera.right = newWidth / 2;
    orthoCamera.updateProjectionMatrix();

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

// Cálculo y caché de aristas UV inteligentes (Contornos, pliegues vivos y eliminación de líneas internas)
function getMeshUVEdges(mesh) {
    if (mesh.userData && mesh.userData._uvEdges) return mesh.userData._uvEdges;

    const geometry = mesh.geometry;
    if (!geometry || !geometry.attributes || !geometry.attributes.uv || !geometry.attributes.position) {
        return null;
    }

    const uvs = geometry.attributes.uv;
    const pos = geometry.attributes.position;
    const indices = geometry.index;

    const hashUV = (u, v) => `${Math.round(u * 10000)}_${Math.round(v * 10000)}`;

    const numFaces = indices ? indices.count / 3 : uvs.count / 3;
    const edgeMap = new Map();
    const allEdges = [];

    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const pC = new THREE.Vector3();
    const vBA = new THREE.Vector3();
    const vCA = new THREE.Vector3();

    for (let f = 0; f < numFaces; f++) {
        let i0, i1, i2;
        if (indices) {
            i0 = indices.getX(f * 3);
            i1 = indices.getX(f * 3 + 1);
            i2 = indices.getX(f * 3 + 2);
        } else {
            i0 = f * 3;
            i1 = f * 3 + 1;
            i2 = f * 3 + 2;
        }

        const u0 = uvs.getX(i0), v0 = uvs.getY(i0);
        const u1 = uvs.getX(i1), v1 = uvs.getY(i1);
        const u2 = uvs.getX(i2), v2 = uvs.getY(i2);

        pA.fromBufferAttribute(pos, i0);
        pB.fromBufferAttribute(pos, i1);
        pC.fromBufferAttribute(pos, i2);

        vBA.subVectors(pB, pA);
        vCA.subVectors(pC, pA);
        const normal = new THREE.Vector3().crossVectors(vBA, vCA).normalize();

        const triUVs = [{ u: u0, v: v0 }, { u: u1, v: v1 }, { u: u2, v: v2 }];

        for (let e = 0; e < 3; e++) {
            const next = (e + 1) % 3;
            const ptA = triUVs[e];
            const ptB = triUVs[next];

            const hA = hashUV(ptA.u, ptA.v);
            const hB = hashUV(ptB.u, ptB.v);
            if (hA === hB) continue; // Ignorar aristas degeneradas

            const edgeKey = hA < hB ? `${hA}|${hB}` : `${hB}|${hA}`;

            let entry = edgeMap.get(edgeKey);
            if (!entry) {
                entry = {
                    uA: ptA.u, vA: ptA.v,
                    uB: ptB.u, vB: ptB.v,
                    faces: []
                };
                edgeMap.set(edgeKey, entry);
            }
            entry.faces.push({ faceIdx: f, normal });
        }
    }

    const boundaryEdges = [];
    const creaseEdges = [];
    // Umbral de 25 grados para diferenciar pliegue vivo de curvatura suave
    const cosThreshold = Math.cos(25 * Math.PI / 180); // ~0.9063

    for (const edge of edgeMap.values()) {
        allEdges.push({ uA: edge.uA, vA: edge.vA, uB: edge.uB, vB: edge.vB });

        if (edge.faces.length === 1) {
            // Perímetro exterior de la pieza o costura UV
            boundaryEdges.push({ uA: edge.uA, vA: edge.vA, uB: edge.uB, vB: edge.vB });
        } else if (edge.faces.length === 2) {
            const n1 = edge.faces[0].normal;
            const n2 = edge.faces[1].normal;
            const dot = Math.max(-1, Math.min(1, n1.dot(n2)));
            if (dot < cosThreshold) {
                // Pliegue o arista viva (> 25°)
                creaseEdges.push({ uA: edge.uA, vA: edge.vA, uB: edge.uB, vB: edge.vB });
            }
            // Si dot >= cosThreshold (<= 25°), es curva suave o triangulación plana -> se oculta
        } else {
            creaseEdges.push({ uA: edge.uA, vA: edge.vA, uB: edge.uB, vB: edge.vB });
        }
    }

    mesh.userData._uvEdges = { boundaryEdges, creaseEdges, allEdges };
    return mesh.userData._uvEdges;
}

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

    if (!state.uvWireframeVisible || state.uvWireframeMode === 'none') return;

    const mode = state.uvWireframeMode || 'clean';
    const w = canvasUV.width;
    const h = canvasUV.height;

    const meshes = [];
    state.mesh.traverse(c => {
        if (c.isMesh && !c.userData?.isSelectionOverlay && c.geometry && c.geometry.attributes && c.geometry.attributes.uv) {
            meshes.push(c);
        }
    });

    if (mode === 'full') {
        // Malla completa: todos los triángulos
        ctxUV.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctxUV.lineWidth = 1;
        ctxUV.beginPath();

        meshes.forEach(mesh => {
            const edgesData = getMeshUVEdges(mesh);
            if (edgesData) {
                edgesData.allEdges.forEach(e => {
                    ctxUV.moveTo(e.uA * w, (1 - e.vA) * h);
                    ctxUV.lineTo(e.uB * w, (1 - e.vB) * h);
                });
            }
        });
        ctxUV.stroke();
    } else if (mode === 'outlines') {
        // Solo contornos exteriores
        ctxUV.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctxUV.lineWidth = 1.2;
        ctxUV.beginPath();

        meshes.forEach(mesh => {
            const edgesData = getMeshUVEdges(mesh);
            if (edgesData) {
                edgesData.boundaryEdges.forEach(e => {
                    ctxUV.moveTo(e.uA * w, (1 - e.vA) * h);
                    ctxUV.lineTo(e.uB * w, (1 - e.vB) * h);
                });
            }
        });
        ctxUV.stroke();
    } else {
        // Modo 'clean' (por defecto): Contornos oscuros + pliegues vivos (> 25°)
        // 1. Pliegues vivos internos
        ctxUV.strokeStyle = 'rgba(40, 40, 40, 0.55)';
        ctxUV.lineWidth = 1;
        ctxUV.beginPath();

        meshes.forEach(mesh => {
            const edgesData = getMeshUVEdges(mesh);
            if (edgesData) {
                edgesData.creaseEdges.forEach(e => {
                    ctxUV.moveTo(e.uA * w, (1 - e.vA) * h);
                    ctxUV.lineTo(e.uB * w, (1 - e.vB) * h);
                });
            }
        });
        ctxUV.stroke();

        // 2. Contornos exteriores
        ctxUV.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctxUV.lineWidth = 1.2;
        ctxUV.beginPath();

        meshes.forEach(mesh => {
            const edgesData = getMeshUVEdges(mesh);
            if (edgesData) {
                edgesData.boundaryEdges.forEach(e => {
                    ctxUV.moveTo(e.uA * w, (1 - e.vA) * h);
                    ctxUV.lineTo(e.uB * w, (1 - e.vB) * h);
                });
            }
        });
        ctxUV.stroke();
    }
}


// Animation Loop ultra-fluido a 144+ FPS (Zero Lag en RTX)
let lastTextureUpdate = 0;
let lastUIAnimUpdate = 0;
function animate(time) {
    requestAnimationFrame(animate);
    controls.update();

    // Actualizar orientación y escala visual de los nodos del Gizmo 3D con la cámara
    if (window.decalSystem && window.decalSystem.isActive && window.decalSystem.mode === '3d' && window.decalSystem.selectionGizmo3D?.visible) {
        window.decalSystem.update3DSelectionGizmo();
    }

    const isSelectionActive = selectionManager && (selectionManager.active || selectionManager.creating);

    // Sincronizar visibilidad del overlay 3D con la selección activa
    setSelection3DOverlayVisible(isSelectionActive);

    // Animar retícula y hormigas marchantes de la selección (~15 FPS para suavidad y mínimo consumo)
    if (isSelectionActive) {
        if (time - lastUIAnimUpdate > 65) {
            if (painter) painter.updateUI(time);
            if (state.textureUI) state.textureUI.needsUpdate = true;
            lastUIAnimUpdate = time;
        }
    } else if (painter && painter.uiNeedsUpdate) {
        painter.updateUI(time);
        if (state.textureUI) state.textureUI.needsUpdate = true;
        painter.uiNeedsUpdate = false;
    }
    
    // Desacoplar textura principal a ~30fps durante pintura interactiva
    if (painter && painter.needsUpdate) {
        if (painter.forceUpdate || (time - lastTextureUpdate > 33)) {
            state.texture.needsUpdate = true;
            painter.needsUpdate = false;
            painter.forceUpdate = false;
            lastTextureUpdate = time;
            if (papercraft && papercraft.active) renderUnfoldWorkbench();
        }
    }
    
    renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// Desplazamiento horizontal fluido con la rueda del ratón en la barra de herramientas (Ribbon)
const ribbonEl = document.getElementById('ribbon');
ribbonEl?.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
        ribbonEl.scrollLeft += e.deltaY;
        e.preventDefault();
    }
}, { passive: false });

// Inicializar el panel de capas visible por defecto en pestaña Capas
const initialLayersPanel = document.getElementById('panel-layers');
if (initialLayersPanel) {
    initialLayersPanel.classList.remove('collapsed');
}
if (typeof switchSidebarTab === 'function') {
    switchSidebarTab('layers');
}
