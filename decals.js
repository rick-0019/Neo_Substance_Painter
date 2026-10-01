import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

export class DecalSystem {
    constructor(scene, camera, renderer, canvas2d, texture, layerManager = null, painter = null) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.canvas = canvas2d;
        this.texture = texture;
        this.layerManager = layerManager;
        this.painter = painter;
        this.mesh = null;

        this.canvasUI = document.getElementById('canvas-ui');
        this.ctxUI = this.canvasUI ? this.canvasUI.getContext('2d') : null;

        // Modo actual: '3d' o '2d'
        this.mode = '3d';

        this.currentDecalImage = null;
        this.decalTexture = null;
        this.isActive = false;
        this.isLocked = false;
        this.isTextMode = false;
        this.textOptions = null;

        // Parámetros del proyector 3D
        this.projectorPosition = new THREE.Vector3();
        this.projectorNormal = new THREE.Vector3(0, 0, 1);
        this.projectorRotation = 0; // en radianes
        this.projectorScale = 100;  // 100% por defecto
        this.currentProjectorOrientation = new THREE.Euler();
        this.currentProjectorSize = new THREE.Vector3(1, 1, 1);
        this.allowPassthrough = false; // false = solo cara frontal (por defecto), true = atravesar caras opuestas

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.lastHit = null;

        // Búfer GPU para previsualización 2D en tiempo real de proyección 3D multi-pieza
        this.previewRenderTarget = null;
        this.previewOrthoCamera = null;
        this.previewBakeScene = null;
        this.previewBakeMaterial = null;
        this.previewOffscreenCanvas = null;
        this.previewOffscreenCtx = null;
        this.previewPixelBuffer = null;
        this._preview3DPending = false;

        // Parámetros de la calcomanía en Modo 2D
        this.decal2D = {
            x: 1024,
            y: 1024,
            width: 300,
            height: 300,
            baseWidth: 300,
            baseHeight: 300,
            rotation: 0,
            isDragging: false,
            dragHandle: null,
            dragOffset: { x: 0, y: 0 },
            initialDecal: null
        };

        // Objeto 3D de previsualización
        this.previewGroup = new THREE.Group();
        this.previewGroup.visible = false;
        this.scene.add(this.previewGroup);

        this.selectedDecalId = null; // ID de la pegatina actualmente seleccionada

        this.setupPreviewMesh();
        this.setupEvents();
    }

    setMesh(mesh) {
        this.mesh = mesh;
    }

    setLayerManager(lm) {
        this.layerManager = lm;
    }

    setPainter(painter) {
        this.painter = painter;
    }

    setMode(mode) {
        this.mode = mode;
        const btnMode3D = document.getElementById('btn-decal-mode-3d');
        const btnMode2D = document.getElementById('btn-decal-mode-2d');
        if (btnMode3D) btnMode3D.classList.toggle('active', mode === '3d');
        if (btnMode2D) btnMode2D.classList.toggle('active', mode === '2d');

        const btnTextMode3D = document.getElementById('btn-text-mode-3d');
        const btnTextMode2D = document.getElementById('btn-text-mode-2d');
        if (btnTextMode3D) btnTextMode3D.classList.toggle('active', mode === '3d');
        if (btnTextMode2D) btnTextMode2D.classList.toggle('active', mode === '2d');

        const passGroup = document.getElementById('decal-passthrough-group');
        if (passGroup) passGroup.style.display = mode === '3d' ? 'flex' : 'none';

        if (mode === '2d') {
            // Si el modo Unfold / Papercraft está activo, cambiar a la Vista 2D (UV) para poder ver y manipular la calcomanía
            if (window.papercraft && window.papercraft.active) {
                const btnRibbonUnfold = document.getElementById('btn-ribbon-unfold-mode');
                if (btnRibbonUnfold) {
                    btnRibbonUnfold.click();
                }
            }

            this.previewGroup.visible = false;
            if (this.isActive) {
                // Sincronizar sliders con valores 2D
                const scaleInput = document.getElementById('decal-scale');
                const rotInput = document.getElementById('decal-rotation');
                const rotLabel = document.getElementById('decal-rot-label');
                const currentScalePct = Math.round((this.decal2D.width / this.decal2D.baseWidth) * 100);
                if (scaleInput) scaleInput.value = Math.min(300, Math.max(10, currentScalePct));
                const deg = Math.round((this.decal2D.rotation * 180 / Math.PI) % 360);
                const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
                if (rotInput) rotInput.value = normDeg;
                if (rotLabel) rotLabel.textContent = `${normDeg}°`;

                if (this.isTextMode) {
                    const textRot = document.getElementById('text-rotation');
                    const textRotLabel = document.getElementById('text-rot-val');
                    if (textRot) textRot.value = normDeg;
                    if (textRotLabel) textRotLabel.textContent = `${normDeg}°`;
                    if (this.textOptions) this.textOptions.rotation = normDeg;
                }

                this.render2DPreview();
            }
        } else {
            if (this.isActive) {
                this.previewGroup.visible = true;
                const scaleInput = document.getElementById('decal-scale');
                const rotInput = document.getElementById('decal-rotation');
                const rotLabel = document.getElementById('decal-rot-label');
                if (scaleInput) scaleInput.value = this.projectorScale;
                const deg = Math.round((this.projectorRotation * 180 / Math.PI) % 360);
                if (rotInput) rotInput.value = deg;
                if (rotLabel) rotLabel.textContent = `${deg}°`;

                if (this.isTextMode) {
                    const textRot = document.getElementById('text-rotation');
                    const textRotLabel = document.getElementById('text-rot-val');
                    if (textRot) textRot.value = deg;
                    if (textRotLabel) textRotLabel.textContent = `${deg}°`;
                    if (this.textOptions) this.textOptions.rotation = deg;
                }

                this.updatePreviewTransform();
                this.render2DPreview();
            }
        }
    }

    setupPreviewMesh() {
        this.previewMaterial = new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
            side: THREE.DoubleSide
        });

        // Malla adaptativa DecalGeometry (se amolda a la curvatura 3D)
        this.previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.previewMaterial);
        this.previewGroup.add(this.previewMesh);

        // Borde azul adaptativo a la superficie
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00a2ff, linewidth: 2 });
        this.previewBorder = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
        this.previewGroup.add(this.previewBorder);

        // Plano de respaldo (fallback si el cursor sale del modelo)
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        this.fallbackPlane = new THREE.Mesh(planeGeo, this.previewMaterial);
        this.fallbackBorder = new THREE.LineSegments(new THREE.EdgesGeometry(planeGeo), lineMat);
        this.previewGroup.add(this.fallbackPlane);
        this.previewGroup.add(this.fallbackBorder);
        this.fallbackPlane.visible = false;
        this.fallbackBorder.visible = false;
    }

    setupEvents() {
        const inputDecal = document.getElementById('input-decal');
        const btnLoad = document.getElementById('btn-load-decal');
        const btnBake = document.getElementById('btn-bake-decal');
        const btnBake2D = document.getElementById('btn-bake-decal-2d');
        const btnBake3D = document.getElementById('btn-bake-decal-3d');
        const btnCancel = document.getElementById('btn-cancel-decal');
        const scaleInput = document.getElementById('decal-scale');
        const rotInput = document.getElementById('decal-rotation');
        const rotLabel = document.getElementById('decal-rot-label');
        const btnScaleDec = document.getElementById('btn-decal-scale-dec');
        const btnScaleInc = document.getElementById('btn-decal-scale-inc');

        const btnMode3D = document.getElementById('btn-decal-mode-3d');
        const btnMode2D = document.getElementById('btn-decal-mode-2d');

        btnMode3D?.addEventListener('click', () => this.setMode('3d'));
        btnMode2D?.addEventListener('click', () => this.setMode('2d'));

        btnLoad?.addEventListener('click', () => inputDecal?.click());

        inputDecal?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const decalName = file.name.replace(/\.[^/.]+$/, '');
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // Optimizar imágenes de ultra-alta resolución (>2048px) para evitar saturar VRAM y CPU
                    const maxDim = Math.max(window.layerManager?.width || 2048, 2048);
                    if (img.width > maxDim || img.height > maxDim) {
                        const ratio = Math.min(maxDim / img.width, maxDim / img.height);
                        const optCanvas = document.createElement('canvas');
                        optCanvas.width = Math.round(img.width * ratio);
                        optCanvas.height = Math.round(img.height * ratio);
                        const optCtx = optCanvas.getContext('2d');
                        optCtx.imageSmoothingEnabled = true;
                        optCtx.imageSmoothingQuality = 'high';
                        optCtx.drawImage(img, 0, 0, optCanvas.width, optCanvas.height);

                        const optImg = new Image();
                        optImg.onload = () => {
                            this.setDecalImage(optImg, decalName);
                        };
                        optImg.src = optCanvas.toDataURL('image/png');
                    } else {
                        this.setDecalImage(img, decalName);
                    }
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
            inputDecal.value = '';
        });

        scaleInput?.addEventListener('input', (e) => {
            if (this.mode === '2d') {
                const scale = parseFloat(e.target.value) / 100;
                this.decal2D.width = this.decal2D.baseWidth * scale;
                this.decal2D.height = this.decal2D.baseHeight * scale;
                this.scheduleSync(false);
            } else {
                this.projectorScale = parseFloat(e.target.value);
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        });
        scaleInput?.addEventListener('change', () => {
            if (this.mode === '2d') this.syncCurrentDecalToObject(true);
        });

        btnScaleDec?.addEventListener('click', () => {
            if (!scaleInput) return;
            scaleInput.value = Math.max(10, parseInt(scaleInput.value, 10) - 10);
            if (this.mode === '2d') {
                const scale = parseFloat(scaleInput.value) / 100;
                this.decal2D.width = this.decal2D.baseWidth * scale;
                this.decal2D.height = this.decal2D.baseHeight * scale;
                this.syncCurrentDecalToObject(true);
                this.render2DPreview();
            } else {
                this.projectorScale = parseFloat(scaleInput.value);
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        });

        btnScaleInc?.addEventListener('click', () => {
            if (!scaleInput) return;
            scaleInput.value = Math.min(300, parseInt(scaleInput.value, 10) + 10);
            if (this.mode === '2d') {
                const scale = parseFloat(scaleInput.value) / 100;
                this.decal2D.width = this.decal2D.baseWidth * scale;
                this.decal2D.height = this.decal2D.baseHeight * scale;
                this.syncCurrentDecalToObject(true);
                this.render2DPreview();
            } else {
                this.projectorScale = parseFloat(scaleInput.value);
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        });

        const btnRotDec = document.getElementById('btn-decal-rot-dec');
        const btnRotInc = document.getElementById('btn-decal-rot-inc');

        const updateRotation = (deg, isFinal = false) => {
            deg = Math.max(-180, Math.min(180, deg));
            if (rotInput) rotInput.value = deg;
            if (rotLabel) rotLabel.textContent = `${deg}°`;
            if (this.mode === '2d') {
                this.decal2D.rotation = (deg * Math.PI) / 180;
                if (isFinal) {
                    this.syncCurrentDecalToObject(true);
                    this.render2DPreview();
                } else {
                    this.scheduleSync(false);
                }
            } else {
                this.projectorRotation = (deg * Math.PI) / 180;
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        };

        rotInput?.addEventListener('input', (e) => {
            const deg = parseInt(e.target.value, 10);
            updateRotation(deg, false);
        });
        rotInput?.addEventListener('change', (e) => {
            const deg = parseInt(e.target.value, 10);
            updateRotation(deg, true);
        });

        btnRotDec?.addEventListener('click', () => {
            const current = parseInt(rotInput?.value || 0, 10);
            updateRotation(current - 1, true);
        });

        btnRotInc?.addEventListener('click', () => {
            const current = parseInt(rotInput?.value || 0, 10);
            updateRotation(current + 1, true);
        });

        const chkPassthrough = document.getElementById('decal-passthrough');
        chkPassthrough?.addEventListener('change', (e) => {
            this.allowPassthrough = e.target.checked;
            if (this.mode === '3d' && this.isActive) {
                this.updatePreviewTransform();
            }
        });

        const btnDuplicate = document.getElementById('btn-decal-duplicate');
        const btnDelete = document.getElementById('btn-decal-delete');
        btnDuplicate?.addEventListener('click', () => this.duplicateSelectedDecal());
        btnDelete?.addEventListener('click', () => this.deleteSelectedDecal());

        const shapeFillColor = document.getElementById('shape-fill-color');
        const btnShapeFillNone = document.getElementById('btn-shape-fill-none');
        const shapeStrokeColor = document.getElementById('shape-stroke-color');

        const updateSelectedShape = (newFill, newStroke) => {
            if (newFill !== undefined) {
                window.currentShapeFillColor = newFill;
                const btnNone = document.getElementById('btn-shape-bar-fill-none');
                if (btnNone) btnNone.classList.toggle('active', newFill === 'transparent');
            }
            if (newStroke !== undefined) {
                window.currentShapeStrokeColor = newStroke;
            }

            if (this.selectedDecalId && this.layerManager) {
                const activeLayer = this.layerManager.getActiveLayer();
                const decal = activeLayer ? activeLayer.getDecal(this.selectedDecalId) : null;
                if (decal) {
                    if (!decal.shapeOptions) {
                        decal.shapeOptions = {
                            type: decal.type || 'rect',
                            color: '#000000',
                            strokeColor: '#000000',
                            strokeWidth: 4,
                            cornerRadius: 0,
                            size: 2,
                            fillColor: 'transparent',
                            x1: 0, y1: 0,
                            x2: decal.width || 200, y2: decal.height || 200
                        };
                    }

                    if (newFill !== undefined) decal.shapeOptions.fillColor = newFill;
                    if (newStroke !== undefined) {
                        decal.shapeOptions.color = newStroke;
                        decal.shapeOptions.strokeColor = newStroke;
                    }

                    decal.shapeOptions.width = decal.width;
                    decal.shapeOptions.height = decal.height;
                    decal.shapeOptions.x1 = 0;
                    decal.shapeOptions.y1 = 0;
                    decal.shapeOptions.x2 = decal.width;
                    decal.shapeOptions.y2 = decal.height;

                    if (window.painter && window.painter.createShapeCanvas) {
                        const newCanvas = window.painter.createShapeCanvas(decal.shapeOptions);
                        decal.img = newCanvas;
                        try {
                            decal.dataUrl = newCanvas.toDataURL('image/png');
                        } catch (_) {}
                        this.currentDecalImage = newCanvas;
                        this.syncCurrentDecalToObject(true);
                        this.render2DPreview();
                        if (this.layerManager) this.layerManager.renderUI();
                    }
                }
            } else if (window.painter && window.painter.editingShape) {
                if (newFill !== undefined) window.painter.editingShape.fillColor = newFill;
                if (newStroke !== undefined) {
                    window.painter.editingShape.color = newStroke;
                    window.painter.editingShape.strokeColor = newStroke;
                }
                window.painter.renderEditingShape();
            }
        };

        shapeFillColor?.addEventListener('input', (e) => updateSelectedShape(e.target.value, undefined));
        btnShapeFillNone?.addEventListener('click', () => updateSelectedShape('transparent', undefined));
        shapeStrokeColor?.addEventListener('input', (e) => updateSelectedShape(undefined, e.target.value));

        // Controles contextuales en la barra frontal (shape-controls)
        const shapeBarFill = document.getElementById('shape-bar-fill-color');
        const shapeBarFillNone = document.getElementById('btn-shape-bar-fill-none');
        const shapeBarStroke = document.getElementById('shape-bar-stroke-color');
        const shapeBarRadius = document.getElementById('shape-bar-radius');
        const shapeBarRadiusVal = document.getElementById('shape-bar-radius-val');
        const btnShapeRadiusZero = document.getElementById('btn-shape-radius-zero');
        const btnShapeRadiusInc = document.getElementById('btn-shape-radius-inc');
        const shapeBarStrokeWidth = document.getElementById('shape-bar-stroke-width');
        const shapeBarStrokeVal = document.getElementById('shape-bar-stroke-val');
        const btnShapeStrokeDec = document.getElementById('btn-shape-stroke-dec');
        const btnShapeStrokeInc = document.getElementById('btn-shape-stroke-inc');
        const shapeBarSpacing = document.getElementById('shape-bar-spacing');
        const shapeBarSpacingVal = document.getElementById('shape-bar-spacing-val');
        const btnShapeSpacingDec = document.getElementById('btn-shape-spacing-dec');
        const btnShapeSpacingInc = document.getElementById('btn-shape-spacing-inc');
        const btnShapeDashes = document.querySelectorAll('.btn-shape-dash');
        const btnCatalogDashes = document.querySelectorAll('.btn-catalog-dash');
        const shapeScaleInput = document.getElementById('shape-scale');
        const btnShapeScaleDec = document.getElementById('btn-shape-scale-dec');
        const btnShapeScaleInc = document.getElementById('btn-shape-scale-inc');
        const shapeRotInput = document.getElementById('shape-rotation');
        const shapeRotVal = document.getElementById('shape-rot-val');
        const btnShapeRotDec = document.getElementById('btn-shape-rot-dec');
        const btnShapeRotInc = document.getElementById('btn-shape-rot-inc');
        const btnShapeBake2D = document.getElementById('btn-shape-bake-2d');
        const btnShapeBake3D = document.getElementById('btn-shape-bake-3d');
        const btnShapeDel = document.getElementById('btn-shape-delete');
        const btnShapeCancel = document.getElementById('btn-shape-cancel');
        const btnShapeMode3D = document.getElementById('btn-shape-mode-3d');
        const btnShapeMode2D = document.getElementById('btn-shape-mode-2d');

        shapeBarFill?.addEventListener('input', (e) => updateSelectedShape(e.target.value, undefined));
        shapeBarFillNone?.addEventListener('click', () => updateSelectedShape('transparent', undefined));
        shapeBarStroke?.addEventListener('input', (e) => updateSelectedShape(undefined, e.target.value));

        const updateShapeRadius = (val) => {
            const num = Math.max(0, Math.min(60, parseInt(val, 10) || 0));
            if (shapeBarRadius) shapeBarRadius.value = num;
            if (shapeBarRadiusVal) shapeBarRadiusVal.textContent = `${num} px`;
            
            if (this.selectedDecalId) {
                const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
                const decal = activeLayer ? activeLayer.getDecal(this.selectedDecalId) : null;
                if (decal) {
                    if (!decal.shapeOptions) {
                        decal.shapeOptions = {
                            type: decal.type || 'rect',
                            color: '#000000',
                            strokeWidth: 4,
                            cornerRadius: 0,
                            fillColor: '#ffff00',
                            x1: 0, y1: 0,
                            x2: decal.width || 200, y2: decal.height || 200
                        };
                    }
                    decal.shapeOptions.cornerRadius = num;
                    decal.shapeOptions.width = decal.width;
                    decal.shapeOptions.height = decal.height;
                    decal.shapeOptions.x1 = 0;
                    decal.shapeOptions.y1 = 0;
                    decal.shapeOptions.x2 = decal.width;
                    decal.shapeOptions.y2 = decal.height;
                    if (window.painter && window.painter.createShapeCanvas) {
                        const newCanvas = window.painter.createShapeCanvas(decal.shapeOptions);
                        decal.img = newCanvas;
                        try { decal.dataUrl = newCanvas.toDataURL('image/png'); } catch(_) {}
                        this.currentDecalImage = newCanvas;
                        this.syncCurrentDecalToObject(true);
                        this.render2DPreview();
                        if (this.layerManager) this.layerManager.renderUI();
                    }
                }
            } else if (window.painter && window.painter.editingShape) {
                window.painter.editingShape.cornerRadius = num;
                window.painter.renderEditingShape();
            }
        };

        const updateShapeStrokeWidth = (val) => {
            const num = Math.max(1, Math.min(50, parseInt(val, 10) || 4));
            if (shapeBarStrokeWidth) shapeBarStrokeWidth.value = num;
            if (shapeBarStrokeVal) shapeBarStrokeVal.textContent = `${num} px`;
            
            if (this.selectedDecalId) {
                const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
                const decal = activeLayer ? activeLayer.getDecal(this.selectedDecalId) : null;
                if (decal) {
                    if (!decal.shapeOptions) {
                        decal.shapeOptions = {
                            type: decal.type || 'rect',
                            color: '#000000',
                            strokeWidth: 4,
                            cornerRadius: 0,
                            fillColor: '#ffff00',
                            x1: 0, y1: 0,
                            x2: decal.width || 200, y2: decal.height || 200
                        };
                    }
                    decal.shapeOptions.strokeWidth = num;
                    decal.shapeOptions.width = decal.width;
                    decal.shapeOptions.height = decal.height;
                    decal.shapeOptions.x1 = 0;
                    decal.shapeOptions.y1 = 0;
                    decal.shapeOptions.x2 = decal.width;
                    decal.shapeOptions.y2 = decal.height;
                    if (window.painter && window.painter.createShapeCanvas) {
                        const newCanvas = window.painter.createShapeCanvas(decal.shapeOptions);
                        decal.img = newCanvas;
                        try { decal.dataUrl = newCanvas.toDataURL('image/png'); } catch(_) {}
                        this.currentDecalImage = newCanvas;
                        this.syncCurrentDecalToObject(true);
                        this.render2DPreview();
                        if (this.layerManager) this.layerManager.renderUI();
                    }
                }
            } else if (window.painter && window.painter.editingShape) {
                window.painter.editingShape.strokeWidth = num;
                window.painter.renderEditingShape();
            }
        };

        shapeBarRadius?.addEventListener('input', (e) => updateShapeRadius(e.target.value));
        btnShapeRadiusZero?.addEventListener('click', () => updateShapeRadius(0));
        btnShapeRadiusInc?.addEventListener('click', () => {
            const cur = parseInt(shapeBarRadius?.value || 0, 10);
            updateShapeRadius(cur + 5);
        });

        shapeBarStrokeWidth?.addEventListener('input', (e) => updateShapeStrokeWidth(e.target.value));
        btnShapeStrokeDec?.addEventListener('click', () => {
            const cur = parseInt(shapeBarStrokeWidth?.value || 4, 10);
            updateShapeStrokeWidth(cur - 1);
        });
        btnShapeStrokeInc?.addEventListener('click', () => {
            const cur = parseInt(shapeBarStrokeWidth?.value || 4, 10);
            updateShapeStrokeWidth(cur + 1);
        });

        const updateShapeStrokeDash = (dashStyle) => {
            window.currentShapeStrokeDash = dashStyle;
            document.querySelectorAll('.btn-shape-dash').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-dash') === dashStyle);
            });
            document.querySelectorAll('.btn-catalog-dash').forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-dash') === dashStyle);
            });

            if (this.selectedDecalId) {
                const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
                const decal = activeLayer ? activeLayer.getDecal(this.selectedDecalId) : null;
                if (decal) {
                    if (!decal.shapeOptions) {
                        decal.shapeOptions = {
                            type: decal.type || 'rect',
                            color: '#000000',
                            strokeWidth: 4,
                            cornerRadius: 0,
                            fillColor: '#ffff00',
                            x1: 0, y1: 0,
                            x2: decal.width || 200, y2: decal.height || 200
                        };
                    }
                    decal.shapeOptions.strokeDash = dashStyle;
                    decal.shapeOptions.width = decal.width;
                    decal.shapeOptions.height = decal.height;
                    decal.shapeOptions.x1 = 0;
                    decal.shapeOptions.y1 = 0;
                    decal.shapeOptions.x2 = decal.width;
                    decal.shapeOptions.y2 = decal.height;
                    if (window.painter && window.painter.createShapeCanvas) {
                        const newCanvas = window.painter.createShapeCanvas(decal.shapeOptions);
                        decal.img = newCanvas;
                        try { decal.dataUrl = newCanvas.toDataURL('image/png'); } catch(_) {}
                        this.currentDecalImage = newCanvas;
                        this.syncCurrentDecalToObject(true);
                        this.render2DPreview();
                        if (this.layerManager) this.layerManager.renderUI();
                    }
                }
            } else if (window.painter && window.painter.editingShape) {
                window.painter.editingShape.strokeDash = dashStyle;
                window.painter.renderEditingShape();
            } else {
                // Si no hay figura seleccionada, asegurar que la herramienta de formas esté activa y lista para dibujar
                const brushModeInput = document.getElementById('brush-mode');
                const curMode = brushModeInput?.value;
                const shapeModes = ['line', 'rect', 'circle', 'triangle', 'star', 'polygon', 'arrow', 'badge'];
                if (!shapeModes.includes(curMode)) {
                    const rectBtn = document.querySelector('.tool-btn[data-mode="rect"]');
                    if (rectBtn) {
                        rectBtn.click();
                    } else if (brushModeInput) {
                        brushModeInput.value = 'rect';
                    }
                }

                const shapeBar = document.getElementById('shape-controls');
                if (shapeBar) shapeBar.style.display = 'flex';
                const ribbon = document.getElementById('ribbon');
                if (ribbon) ribbon.classList.add('shape-mode-active');
            }
        };

        const updateShapeDashSpacing = (val) => {
            const num = Math.max(2, Math.min(100, parseInt(val, 10) || 10));
            if (shapeBarSpacing) shapeBarSpacing.value = num;
            if (shapeBarSpacingVal) shapeBarSpacingVal.textContent = `${num} px`;

            if (this.selectedDecalId) {
                const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
                const decal = activeLayer ? activeLayer.getDecal(this.selectedDecalId) : null;
                if (decal) {
                    if (!decal.shapeOptions) {
                        decal.shapeOptions = {
                            type: decal.type || 'rect',
                            color: '#000000',
                            strokeWidth: 4,
                            cornerRadius: 0,
                            fillColor: '#ffff00',
                            x1: 0, y1: 0,
                            x2: decal.width || 200, y2: decal.height || 200
                        };
                    }
                    decal.shapeOptions.dashSpacing = num;
                    decal.shapeOptions.width = decal.width;
                    decal.shapeOptions.height = decal.height;
                    decal.shapeOptions.x1 = 0;
                    decal.shapeOptions.y1 = 0;
                    decal.shapeOptions.x2 = decal.width;
                    decal.shapeOptions.y2 = decal.height;
                    if (window.painter && window.painter.createShapeCanvas) {
                        const newCanvas = window.painter.createShapeCanvas(decal.shapeOptions);
                        decal.img = newCanvas;
                        try { decal.dataUrl = newCanvas.toDataURL('image/png'); } catch(_) {}
                        this.currentDecalImage = newCanvas;
                        this.syncCurrentDecalToObject(true);
                        this.render2DPreview();
                        if (this.layerManager) this.layerManager.renderUI();
                    }
                }
            } else if (window.painter && window.painter.editingShape) {
                window.painter.editingShape.dashSpacing = num;
                window.painter.renderEditingShape();
            }
        };

        this.updateShapeStrokeDash = updateShapeStrokeDash;
        window.updateShapeStrokeDash = updateShapeStrokeDash;

        // Delegated click listener para garantizar respuesta inmediata
        document.addEventListener('click', (e) => {
            const dashBtn = e.target.closest('.btn-shape-dash, .btn-catalog-dash');
            if (dashBtn) {
                const style = dashBtn.getAttribute('data-dash') || 'solid';
                updateShapeStrokeDash(style);
            }
        });

        btnShapeDashes.forEach(btn => {
            btn.addEventListener('click', () => {
                updateShapeStrokeDash(btn.getAttribute('data-dash') || 'solid');
            });
        });

        btnCatalogDashes.forEach(btn => {
            btn.addEventListener('click', () => {
                updateShapeStrokeDash(btn.getAttribute('data-dash') || 'solid');
            });
        });

        shapeBarSpacing?.addEventListener('input', (e) => updateShapeDashSpacing(e.target.value));
        btnShapeSpacingDec?.addEventListener('click', () => {
            const cur = parseInt(shapeBarSpacing?.value || 10, 10);
            updateShapeDashSpacing(cur - 2);
        });
        btnShapeSpacingInc?.addEventListener('click', () => {
            const cur = parseInt(shapeBarSpacing?.value || 10, 10);
            updateShapeDashSpacing(cur + 2);
        });

        shapeScaleInput?.addEventListener('input', (e) => {
            const scale = parseFloat(e.target.value) / 100;
            this.decal2D.width = this.decal2D.baseWidth * scale;
            this.decal2D.height = this.decal2D.baseHeight * scale;
            this.scheduleSync(false);
        });
        shapeScaleInput?.addEventListener('change', () => this.syncCurrentDecalToObject(true));
        btnShapeScaleDec?.addEventListener('click', () => {
            if (!shapeScaleInput) return;
            shapeScaleInput.value = Math.max(10, parseInt(shapeScaleInput.value, 10) - 10);
            shapeScaleInput.dispatchEvent(new Event('input'));
            this.syncCurrentDecalToObject(true);
        });
        btnShapeScaleInc?.addEventListener('click', () => {
            if (!shapeScaleInput) return;
            shapeScaleInput.value = Math.min(300, parseInt(shapeScaleInput.value, 10) + 10);
            shapeScaleInput.dispatchEvent(new Event('input'));
            this.syncCurrentDecalToObject(true);
        });

        const updateShapeRotation = (deg, isFinal = false) => {
            deg = Math.max(-180, Math.min(180, deg));
            if (shapeRotInput) shapeRotInput.value = deg;
            if (shapeRotVal) shapeRotVal.textContent = `${deg}°`;
            this.decal2D.rotation = (deg * Math.PI) / 180;
            if (isFinal) {
                this.syncCurrentDecalToObject(true);
                this.render2DPreview();
            } else {
                this.scheduleSync(false);
            }
        };

        shapeRotInput?.addEventListener('input', (e) => updateShapeRotation(parseInt(e.target.value, 10), false));
        shapeRotInput?.addEventListener('change', (e) => updateShapeRotation(parseInt(e.target.value, 10), true));
        btnShapeRotDec?.addEventListener('click', () => updateShapeRotation(parseInt(shapeRotInput?.value || 0, 10) - 1, true));
        btnShapeRotInc?.addEventListener('click', () => updateShapeRotation(parseInt(shapeRotInput?.value || 0, 10) + 1, true));

        btnShapeBake2D?.addEventListener('click', () => this.bake2DToActiveLayer());
        btnShapeBake3D?.addEventListener('click', () => this.bake3DToActiveLayer());
        btnShapeDel?.addEventListener('click', () => this.deleteSelectedDecal());
        btnShapeCancel?.addEventListener('click', () => this.deselectDecal());
        btnShapeMode3D?.addEventListener('click', () => this.setMode('3d'));
        btnShapeMode2D?.addEventListener('click', () => this.setMode('2d'));

        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
            if (this.isActive && this.mode === '2d' && this.selectedDecalId) {
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    this.deleteSelectedDecal();
                    e.preventDefault();
                } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
                    this.duplicateSelectedDecal();
                    e.preventDefault();
                } else if (e.key === 'Escape') {
                    this.deselectDecal();
                    e.preventDefault();
                }
            }
        });

        btnBake?.addEventListener('click', () => {
            this.bakeToActiveLayer();
        });

        btnBake2D?.addEventListener('click', () => {
            this.bake2DToActiveLayer();
        });

        btnBake3D?.addEventListener('click', () => {
            this.bake3DToActiveLayer();
        });

        btnCancel?.addEventListener('click', () => {
            this.deselectDecal();
        });

        // Controles de Modo Texto integrados
        const btnTextMode3D = document.getElementById('btn-text-mode-3d');
        const btnTextMode2D = document.getElementById('btn-text-mode-2d');
        btnTextMode3D?.addEventListener('click', () => this.setMode('3d'));
        btnTextMode2D?.addEventListener('click', () => this.setMode('2d'));

        const btnTextBake2D = document.getElementById('btn-text-bake-2d');
        const btnTextBake3D = document.getElementById('btn-text-bake-3d');
        const btnTextCancel = document.getElementById('btn-text-cancel');
        btnTextBake2D?.addEventListener('click', () => this.bake2DToActiveLayer());
        btnTextBake3D?.addEventListener('click', () => this.bake3DToActiveLayer());
        btnTextCancel?.addEventListener('click', () => this.cancelDecal());

        // Eventos del Viewport 3D para posicionar la calcomanía
        const view3d = this.renderer.domElement;

        view3d.addEventListener('pointermove', (e) => {
            if (!this.isActive || this.mode === '2d' || this.isLocked) return;
            this.raycastSurface(e);
        });

        view3d.addEventListener('pointerdown', (e) => {
            if (!this.isActive || this.mode === '2d' || e.button !== 0) return;
            this.raycastSurface(e);
            this.isLocked = true;
        });

        // Eventos del Canvas 2D para interactuar con la calcomanía en Modo 2D
        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown2D(e));
        window.addEventListener('pointermove', (e) => this.onPointerMove2D(e));
        window.addEventListener('pointerup', (e) => this.onPointerUp2D(e));
    }

    setDecalImage(img, decalName = null) {
        this.currentDecalImage = img;
        this.decalTexture = new THREE.Texture(img);
        this.decalTexture.colorSpace = THREE.SRGBColorSpace;
        this.decalTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.decalTexture.magFilter = THREE.LinearFilter;
        this.decalTexture.generateMipmaps = true;
        if (this.renderer && this.renderer.capabilities) {
            this.decalTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        }
        this.decalTexture.needsUpdate = true;

        this.previewMaterial.map = this.decalTexture;
        this.previewMaterial.needsUpdate = true;

        this.isActive = true;
        this.isLocked = true;

        // Inicializar dimensiones 2D con fidelidad 1:1 y aspecto original
        const baseDim = 400;
        let w = baseDim;
        let h = baseDim;
        if (img.width > 0 && img.height > 0) {
            if (img.width >= img.height) {
                h = baseDim * (img.height / img.width);
            } else {
                w = baseDim * (img.width / img.height);
            }
        }

        // Obtener dataUrl garantizada para serialización en .nsp
        let dataUrl = null;
        try {
            if (img.src && img.src.startsWith('data:')) {
                dataUrl = img.src;
            } else {
                const c = document.createElement('canvas');
                c.width = img.width || w;
                c.height = img.height || h;
                const cx = c.getContext('2d');
                cx.drawImage(img, 0, 0);
                dataUrl = c.toDataURL('image/png');
            }
        } catch (e) {}

        // Crear objeto de pegatina vivo en la capa activa
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        let decalObj = null;
        if (activeLayer) {
            const count = (activeLayer.decals ? activeLayer.decals.length : 0) + 1;
            const finalName = decalName || ('Calca ' + count);
            decalObj = {
                id: 'decal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                name: finalName,
                img: img,
                dataUrl: dataUrl,
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                width: w,
                height: h,
                baseWidth: w,
                baseHeight: h,
                rotation: 0,
                opacity: 1.0,
                visible: true
            };
            activeLayer.addDecal(decalObj);
            this.selectedDecalId = decalObj.id;
        }

        this.decal2D = {
            x: decalObj ? decalObj.x : this.canvas.width / 2,
            y: decalObj ? decalObj.y : this.canvas.height / 2,
            width: w,
            height: h,
            baseWidth: w,
            baseHeight: h,
            rotation: 0,
            isDragging: false,
            dragHandle: null,
            dragOffset: { x: 0, y: 0 },
            initialDecal: null
        };

        // Mostrar controles en UI
        this.isTextMode = false;
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'none';

        const controls = document.getElementById('decal-controls');
        const thumb = document.getElementById('decal-preview-thumb');
        if (controls) controls.style.display = 'flex';
        if (thumb) {
            thumb.style.display = 'block';
            thumb.style.backgroundImage = `url(${img.src})`;
        }

        // Resetear controles a valores predeterminados
        const scaleInput = document.getElementById('decal-scale');
        const rotInput = document.getElementById('decal-rotation');
        const rotLabel = document.getElementById('decal-rot-label');
        const chkPassthrough = document.getElementById('decal-passthrough');
        if (scaleInput) scaleInput.value = 100;
        if (rotInput) rotInput.value = 0;
        if (rotLabel) rotLabel.textContent = '0°';
        if (chkPassthrough) chkPassthrough.checked = this.allowPassthrough;
        this.projectorScale = 100;
        this.projectorRotation = 0;

        // Posicionar por defecto al centro del modelo en 3D
        if (this.mesh) {
            const box = new THREE.Box3().setFromObject(this.mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            this.projectorPosition.set(center.x, center.y, center.z + size.z * 0.5);
            this.projectorNormal.set(0, 0, 1);

            const rayOrigin = new THREE.Vector3(center.x, center.y + size.y * 0.3, center.z + size.z * 1.5);
            const rayDir = new THREE.Vector3(0, 0, -1);
            this.raycaster.set(rayOrigin, rayDir);
            const intersects = this.raycaster.intersectObject(this.mesh, true);
            const hit = intersects.find(i => i.object.isMesh && i.uv && i.face);
            if (hit) {
                this.lastHit = hit;
                this.projectorPosition.copy(hit.point);
                const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                this.projectorNormal.copy(worldNormal);
                this.sync2DFrom3D(hit);
            }
        }

        if (this.mode === '2d') {
            this.previewGroup.visible = false;
        } else {
            this.previewGroup.visible = true;
            this.updatePreviewTransform();
        }

        if (this.layerManager) {
            this.layerManager.recomposite();
            this.layerManager.renderUI();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
            this.painter.uiNeedsUpdate = true;
        }
        if (this.texture) {
            this.texture.needsUpdate = true;
        }
        this.render2DPreview();
    }

    selectDecal(decal) {
        if (!decal) {
            this.deselectDecal();
            return;
        }
        this.selectedDecalId = decal.id;
        this.currentDecalImage = decal.img;
        this.decal2D = {
            x: decal.x,
            y: decal.y,
            width: decal.width,
            height: decal.height,
            baseWidth: decal.baseWidth || decal.width,
            baseHeight: decal.baseHeight || decal.height,
            rotation: decal.rotation || 0,
            isDragging: false,
            dragHandle: null,
            dragOffset: { x: 0, y: 0 },
            initialDecal: null
        };
        this.isActive = true;
        this.mode = '2d';

        if (decal.type === 'text') {
            this.isTextMode = true;
            this.textOptions = Object.assign({
                text: decal.name ? decal.name.replace(/^Texto:\s*"?/, '').replace(/"?$/, '') : 'TEXTO',
                fontFamily: 'Arial',
                fontSize: 48,
                rotation: Math.round((decal.rotation * 180 / Math.PI) % 360),
                isBold: true,
                isItalic: false,
                color: '#111111'
            }, decal.textOptions || {});

            const textInput = document.getElementById('text-input-value');
            const fontFam = document.getElementById('text-font-family');
            const fontSize = document.getElementById('text-font-size');
            const sizeLabel = document.getElementById('text-size-val');
            const textRot = document.getElementById('text-rotation');
            const rotLabel = document.getElementById('text-rot-val');
            const textColor = document.getElementById('text-color');
            const btnBold = document.getElementById('btn-text-bold');
            const btnItalic = document.getElementById('btn-text-italic');

            if (textInput && this.textOptions.text) textInput.value = this.textOptions.text;
            if (fontFam && this.textOptions.fontFamily) fontFam.value = this.textOptions.fontFamily;
            if (fontSize && this.textOptions.fontSize) {
                fontSize.value = this.textOptions.fontSize;
                if (sizeLabel) sizeLabel.textContent = `${this.textOptions.fontSize} px`;
            }
            if (textRot) {
                const deg = Math.round((decal.rotation * 180 / Math.PI) % 360);
                const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
                textRot.value = normDeg;
                if (rotLabel) rotLabel.textContent = `${normDeg}°`;
            }
            if (textColor && this.textOptions.color) textColor.value = this.textOptions.color;
            if (btnBold) {
                if (this.textOptions.isBold) btnBold.classList.add('active');
                else btnBold.classList.remove('active');
            }
            if (btnItalic) {
                if (this.textOptions.isItalic) btnItalic.classList.add('active');
                else btnItalic.classList.remove('active');
            }

            const textControls = document.getElementById('text-controls');
            if (textControls) textControls.style.display = 'flex';
            const decalControls = document.getElementById('decal-controls');
            if (decalControls) decalControls.style.display = 'none';

            document.querySelectorAll('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
            document.querySelector('.tool-btn[data-mode="text"]')?.classList.add('active');
            const brushMode = document.getElementById('brush-mode');
            if (brushMode) brushMode.value = 'text';
        } else {
            this.isTextMode = false;
            const textControls = document.getElementById('text-controls');
            if (textControls) textControls.style.display = 'none';
            const controls = document.getElementById('decal-controls');
            if (controls) controls.style.display = 'flex';

            const scaleInput = document.getElementById('decal-scale');
            const rotInput = document.getElementById('decal-rotation');
            const rotLabel = document.getElementById('decal-rot-label');
            if (scaleInput && decal.baseWidth) {
                const scalePct = Math.round((decal.width / decal.baseWidth) * 100);
                scaleInput.value = Math.min(300, Math.max(10, scalePct));
            }
            if (rotInput && rotLabel) {
                const deg = Math.round((decal.rotation * 180 / Math.PI) % 360);
                const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
                rotInput.value = normDeg;
                rotLabel.textContent = `${normDeg}°`;
            }
            const thumb = document.getElementById('decal-preview-thumb');
            if (thumb && (decal.img || decal.dataUrl)) {
                thumb.style.display = 'block';
                thumb.style.backgroundImage = decal.dataUrl ? `url(${decal.dataUrl})` : (decal.img && decal.img.src ? `url(${decal.img.src})` : '');
            }

            const isShape = ['rect', 'circle', 'triangle', 'star', 'polygon', 'arrow', 'badge', 'line'].includes(decal.type);
            const shapeBar = document.getElementById('shape-controls');
            const ribbon = document.getElementById('ribbon');
            if (isShape) {
                if (shapeBar) shapeBar.style.display = 'flex';
                if (controls) controls.style.display = 'none';
                if (ribbon) ribbon.classList.add('shape-mode-active');

                if (!decal.shapeOptions) {
                    decal.shapeOptions = {
                        type: decal.type,
                        color: '#000000',
                        strokeColor: '#000000',
                        strokeWidth: 4,
                        strokeDash: 'solid',
                        dashSpacing: 10,
                        cornerRadius: 0,
                        size: 2,
                        fillColor: '#ffff00',
                        x1: 0, y1: 0,
                        x2: decal.width || 200, y2: decal.height || 200
                    };
                }
                const shapeBarFill = document.getElementById('shape-bar-fill-color');
                const shapeBarStroke = document.getElementById('shape-bar-stroke-color');
                const shapeBarRadius = document.getElementById('shape-bar-radius');
                const shapeBarRadiusVal = document.getElementById('shape-bar-radius-val');
                const shapeBarStrokeWidth = document.getElementById('shape-bar-stroke-width');
                const shapeBarStrokeVal = document.getElementById('shape-bar-stroke-val');
                const shapeBarSpacing = document.getElementById('shape-bar-spacing');
                const shapeBarSpacingVal = document.getElementById('shape-bar-spacing-val');
                const shapeScaleInput = document.getElementById('shape-scale');
                const shapeRotInput = document.getElementById('shape-rotation');
                const shapeRotVal = document.getElementById('shape-rot-val');

                const currentDash = decal.shapeOptions.strokeDash || 'solid';
                document.querySelectorAll('.btn-shape-dash').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-dash') === currentDash);
                });
                document.querySelectorAll('.btn-catalog-dash').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-dash') === currentDash);
                });

                if (shapeBarSpacing && shapeBarSpacingVal) {
                    const sp = decal.shapeOptions.dashSpacing || Math.max(6, Math.round((decal.shapeOptions.strokeWidth || 4) * 2.5));
                    shapeBarSpacing.value = sp;
                    shapeBarSpacingVal.textContent = `${sp} px`;
                }

                if (shapeBarFill) {
                    shapeBarFill.value = (decal.shapeOptions.fillColor && decal.shapeOptions.fillColor !== 'transparent')
                        ? decal.shapeOptions.fillColor
                        : '#ffff00';
                }
                if (shapeBarStroke) {
                    shapeBarStroke.value = (decal.shapeOptions.color && decal.shapeOptions.color !== 'transparent')
                        ? decal.shapeOptions.color
                        : '#000000';
                }
                if (shapeBarRadius && shapeBarRadiusVal) {
                    const rad = decal.shapeOptions.cornerRadius || 0;
                    shapeBarRadius.value = rad;
                    shapeBarRadiusVal.textContent = `${rad} px`;
                }
                if (shapeBarStrokeWidth && shapeBarStrokeVal) {
                    const sw = decal.shapeOptions.strokeWidth || 4;
                    shapeBarStrokeWidth.value = sw;
                    shapeBarStrokeVal.textContent = `${sw} px`;
                }
                if (shapeScaleInput && decal.baseWidth) {
                    const scalePct = Math.round((decal.width / decal.baseWidth) * 100);
                    shapeScaleInput.value = Math.min(300, Math.max(10, scalePct));
                }
                if (shapeRotInput && shapeRotVal) {
                    const deg = Math.round((decal.rotation * 180 / Math.PI) % 360);
                    const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
                    shapeRotInput.value = normDeg;
                    shapeRotVal.textContent = `${normDeg}°`;
                }
            } else {
                if (shapeBar) shapeBar.style.display = 'none';
                if (controls) controls.style.display = 'flex';
                if (ribbon) ribbon.classList.remove('shape-mode-active');
            }
        }

        const btnMode2D = document.getElementById('btn-decal-mode-2d');
        const btnMode3D = document.getElementById('btn-decal-mode-3d');
        btnMode2D?.classList.add('active');
        btnMode3D?.classList.remove('active');

        this.render2DPreview();
        if (this.layerManager) {
            this.layerManager.recomposite();
            this.layerManager.renderUI();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
            this.painter.uiNeedsUpdate = true;
        }
    }

    deselectDecal() {
        this.selectedDecalId = null;
        this.isActive = false;
        this.clear2DUI();
        const ribbon = document.getElementById('ribbon');
        const shapeBar = document.getElementById('shape-controls');

        const curBrushMode = document.getElementById('brush-mode')?.value;
        const isShapeTool = ['line', 'rect', 'circle', 'triangle', 'star', 'polygon', 'arrow', 'badge'].includes(curBrushMode);

        if (!isShapeTool) {
            if (ribbon) ribbon.classList.remove('shape-mode-active');
            if (shapeBar) shapeBar.style.display = 'none';
        } else {
            if (ribbon) ribbon.classList.add('shape-mode-active');
            if (shapeBar) shapeBar.style.display = 'flex';
        }

        const controls = document.getElementById('decal-controls');
        if (controls) controls.style.display = 'none';
        const shapeControls = document.getElementById('shape-style-controls');
        if (shapeControls) shapeControls.style.display = 'none';
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'none';
        this.canvas.style.cursor = 'default';
        if (this.painter) this.painter.uiNeedsUpdate = true;
        if (this.layerManager) this.layerManager.renderUI();
    }

    updateSelectedShapeFillFromColor(col) {
        if (!this.selectedDecalId || !this.layerManager) return;
        const activeLayer = this.layerManager.getActiveLayer();
        if (!activeLayer) return;
        const decal = activeLayer.getDecal(this.selectedDecalId);
        if (!decal || !['rect', 'circle', 'triangle', 'star', 'polygon', 'arrow', 'badge', 'line'].includes(decal.type)) return;

        if (!decal.shapeOptions) {
            decal.shapeOptions = {
                type: decal.type,
                color: '#000000',
                size: 2,
                fillColor: col,
                x1: 0, y1: 0,
                x2: decal.width || 200, y2: decal.height || 200
            };
        } else {
            decal.shapeOptions.fillColor = col;
        }

        decal.shapeOptions.width = decal.width;
        decal.shapeOptions.height = decal.height;
        decal.shapeOptions.x1 = 0;
        decal.shapeOptions.y1 = 0;
        decal.shapeOptions.x2 = decal.width;
        decal.shapeOptions.y2 = decal.height;

        const fillInput = document.getElementById('shape-bar-fill-color');
        if (fillInput) fillInput.value = col;

        if (window.painter && window.painter.createShapeCanvas) {
            const newCanvas = window.painter.createShapeCanvas(decal.shapeOptions);
            decal.img = newCanvas;
            try {
                decal.dataUrl = newCanvas.toDataURL('image/png');
            } catch (_) {}
            this.currentDecalImage = newCanvas;
            this.syncCurrentDecalToObject(true);
            this.render2DPreview();
            if (this.layerManager) this.layerManager.renderUI();
        }
    }

    findDecalAt(canvasX, canvasY) {
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        if (!activeLayer || !activeLayer.decals || activeLayer.decals.length === 0) return null;

        for (let i = activeLayer.decals.length - 1; i >= 0; i--) {
            const d = activeLayer.decals[i];
            if (d.visible === false) continue;
            const dx = canvasX - d.x;
            const dy = canvasY - d.y;
            const cos = Math.cos(-d.rotation);
            const sin = Math.sin(-d.rotation);
            const lx = dx * cos - dy * sin;
            const ly = dx * sin + dy * cos;
            if (Math.abs(lx) <= d.width / 2 && Math.abs(ly) <= d.height / 2) {
                return d;
            }
        }
        return null;
    }

    duplicateSelectedDecal() {
        if (!this.selectedDecalId) return;
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        if (!activeLayer) return;
        const cur = activeLayer.getDecal(this.selectedDecalId);
        if (!cur) return;

        const clone = {
            ...cur,
            id: 'decal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: cur.name + ' (copia)',
            x: cur.x + 25,
            y: cur.y + 25
        };
        activeLayer.addDecal(clone);
        this.selectDecal(clone);
    }

    deleteSelectedDecal() {
        if (!this.selectedDecalId) return;
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        if (activeLayer) {
            activeLayer.removeDecal(this.selectedDecalId);
            this.deselectDecal();
            if (this.layerManager) {
                this.layerManager.recomposite();
                this.layerManager.renderUI();
            }
            if (this.painter) {
                this.painter.needsUpdate = true;
                this.painter.forceUpdate = true;
            }
            if (this.texture) {
                this.texture.needsUpdate = true;
            }
        }
    }

    scheduleSync(force = false) {
        if (this._syncRaf) return;
        this._syncRaf = requestAnimationFrame(() => {
            this._syncRaf = null;
            this.syncCurrentDecalToObject(force);
            this.render2DPreview();
        });
    }

    syncCurrentDecalToObject(force = true) {
        if (!this.selectedDecalId || !this.layerManager) return;
        const activeLayer = this.layerManager.getActiveLayer();
        if (!activeLayer || !activeLayer.decals) return;
        const dObj = activeLayer.getDecal(this.selectedDecalId);
        if (!dObj) return;

        dObj.x = this.decal2D.x;
        dObj.y = this.decal2D.y;
        dObj.width = this.decal2D.width;
        dObj.height = this.decal2D.height;
        dObj.baseWidth = this.decal2D.baseWidth;
        dObj.baseHeight = this.decal2D.baseHeight;
        dObj.rotation = this.decal2D.rotation;
        if (this.currentDecalImage) {
            dObj.img = this.currentDecalImage;
        }

        this.layerManager.recomposite();
        if (this.painter) {
            this.painter.needsUpdate = true;
            if (force) {
                this.painter.forceUpdate = true;
            }
        }
        if (force && this.texture) {
            this.texture.needsUpdate = true;
        }
    }

    startTextMode(opts = {}) {
        this.isTextMode = true;
        this.textOptions = Object.assign({
            text: document.getElementById('text-input-value')?.value || 'TEXTO',
            fontFamily: document.getElementById('text-font-family')?.value || 'Arial',
            fontSize: parseInt(document.getElementById('text-font-size')?.value || 48, 10),
            rotation: parseInt(document.getElementById('text-rotation')?.value || 0, 10),
            isBold: document.getElementById('btn-text-bold')?.classList.contains('active') ?? true,
            isItalic: document.getElementById('btn-text-italic')?.classList.contains('active') ?? false,
            color: document.getElementById('text-color')?.value || '#111111',
            mode: this.mode || '3d'
        }, opts);

        const decalControls = document.getElementById('decal-controls');
        if (decalControls) decalControls.style.display = 'none';
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'flex';

        this.updateTextDecal();
    }

    updateTextDecal(opts = {}) {
        if (!this.isTextMode) return;
        if (opts) Object.assign(this.textOptions, opts);
        const o = this.textOptions;

        // Renderizado vectorial de texto en canvas offscreen de alta fidelidad
        const offscreen = document.createElement('canvas');
        const ctx = offscreen.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const renderFontSize = 256;
        let style = '';
        if (o.isItalic) style += 'italic ';
        if (o.isBold) style += 'bold ';
        ctx.font = `${style}${renderFontSize}px "${o.fontFamily}", sans-serif`;

        const txt = (o.text !== undefined && o.text !== null && o.text.length > 0) ? o.text : ' ';
        const metrics = ctx.measureText(txt);
        const textW = Math.max(20, Math.ceil(metrics.width));
        const textH = Math.max(20, Math.ceil(renderFontSize * 1.25));
        const pad = 24;
        offscreen.width = textW + pad * 2;
        offscreen.height = textH + pad * 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.font = `${style}${renderFontSize}px "${o.fontFamily}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = o.color || '#111111';
        ctx.fillText(txt, offscreen.width / 2, offscreen.height / 2);

        this.currentDecalImage = offscreen;

        if (this.decalTexture) {
            this.decalTexture.dispose();
        }
        this.decalTexture = new THREE.CanvasTexture(offscreen);
        this.decalTexture.colorSpace = THREE.SRGBColorSpace;
        this.decalTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.decalTexture.magFilter = THREE.LinearFilter;
        this.decalTexture.generateMipmaps = true;
        if (this.renderer && this.renderer.capabilities) {
            this.decalTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        }
        this.decalTexture.needsUpdate = true;
        this.previewMaterial.map = this.decalTexture;
        this.previewMaterial.needsUpdate = true;

        this.isActive = true;

        // Dimensiones proporcionales en 2D
        const aspect = offscreen.width / offscreen.height;
        const target2DHeight = Math.max(20, o.fontSize * 2.5);
        const target2DWidth = target2DHeight * aspect;

        // Sincronizar / crear objeto de texto en la capa activa
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        let textObj = null;
        if (activeLayer) {
            if (this.selectedDecalId) {
                textObj = activeLayer.getDecal(this.selectedDecalId);
                if (textObj && textObj.type !== 'text') {
                    textObj = null;
                }
            }

            const dataUrl = offscreen.toDataURL('image/png');
            const displayName = (o.text && o.text.trim()) ? `Texto: "${o.text.substring(0, 14)}"` : 'Texto';

            if (!textObj) {
                const count = (activeLayer.decals ? activeLayer.decals.filter(d => d.type === 'text').length : 0) + 1;
                textObj = {
                    id: 'text_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    name: displayName,
                    type: 'text',
                    textOptions: { ...o },
                    img: offscreen,
                    dataUrl: dataUrl,
                    x: this.decal2D?.x || this.canvas.width / 2,
                    y: this.decal2D?.y || this.canvas.height / 2,
                    width: target2DWidth,
                    height: target2DHeight,
                    baseWidth: target2DWidth,
                    baseHeight: target2DHeight,
                    rotation: (o.rotation * Math.PI) / 180,
                    opacity: 1.0,
                    visible: true
                };
                activeLayer.addDecal(textObj);
                this.selectedDecalId = textObj.id;
            } else {
                textObj.img = offscreen;
                textObj.dataUrl = dataUrl;
                textObj.name = displayName;
                textObj.textOptions = { ...o };
                textObj.width = target2DWidth;
                textObj.height = target2DHeight;
                textObj.baseWidth = target2DWidth;
                textObj.baseHeight = target2DHeight;
                textObj.rotation = (o.rotation * Math.PI) / 180;
            }
        }

        if (!this.decal2D || !this.decal2D.x) {
            this.decal2D = {
                x: textObj ? textObj.x : this.canvas.width / 2,
                y: textObj ? textObj.y : this.canvas.height / 2,
                width: target2DWidth,
                height: target2DHeight,
                baseWidth: target2DWidth,
                baseHeight: target2DHeight,
                rotation: (o.rotation * Math.PI) / 180,
                isDragging: false,
                dragHandle: null,
                dragOffset: { x: 0, y: 0 },
                initialDecal: null
            };
        } else {
            this.decal2D.width = target2DWidth;
            this.decal2D.height = target2DHeight;
            this.decal2D.baseWidth = target2DWidth;
            this.decal2D.baseHeight = target2DHeight;
            this.decal2D.rotation = (o.rotation * Math.PI) / 180;
        }

        this.projectorRotation = (o.rotation * Math.PI) / 180;
        this.projectorScale = Math.max(10, Math.min(300, (o.fontSize / 48) * 100));

        // Posicionamiento 3D inicial si aún no se ha proyectado
        if (!this.lastHit && this.mesh) {
            const box = new THREE.Box3().setFromObject(this.mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            this.projectorPosition.set(center.x, center.y, center.z + size.z * 0.5);
            this.projectorNormal.set(0, 0, 1);

            const rayOrigin = new THREE.Vector3(center.x, center.y + size.y * 0.3, center.z + size.z * 1.5);
            const rayDir = new THREE.Vector3(0, 0, -1);
            this.raycaster.set(rayOrigin, rayDir);
            const intersects = this.raycaster.intersectObject(this.mesh, true);
            const hit = intersects.find(i => i.object.isMesh && i.uv && i.face);
            if (hit) {
                this.lastHit = hit;
                this.projectorPosition.copy(hit.point);
                const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                this.projectorNormal.copy(worldNormal);
                this.sync2DFrom3D(hit);
            }
        } else if (this.lastHit) {
            this.sync2DFrom3D(this.lastHit);
        }

        this.setMode(this.textOptions.mode || this.mode || '3d');
        this.updatePreviewTransform();
        this.render2DPreview();

        if (this.layerManager) {
            this.layerManager.recomposite();
            this.layerManager.renderUI();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
            this.painter.uiNeedsUpdate = true;
        }
        if (this.texture) {
            this.texture.needsUpdate = true;
        }
    }

    cancelDecal() {
        this.isActive = false;
        this.isLocked = false;
        this.previewGroup.visible = false;
        this.clear2DUI();
        const controls = document.getElementById('decal-controls');
        const thumb = document.getElementById('decal-preview-thumb');
        if (controls) controls.style.display = 'none';
        if (thumb) thumb.style.display = 'none';

        if (this.isTextMode) {
            this.isTextMode = false;
            const textControls = document.getElementById('text-controls');
            if (textControls) textControls.style.display = 'none';
            document.querySelectorAll('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
            const paintBtn = document.querySelector('.tool-btn[data-mode="paint"]');
            if (paintBtn) paintBtn.classList.add('active');
            const brushMode = document.getElementById('brush-mode');
            if (brushMode) brushMode.value = 'paint';
        }

        this.canvas.style.cursor = 'default';
    }

    raycastSurface(event) {
        if (!this.mesh) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.mesh, true);
        const hit = intersects.find(i => i.object.isMesh && i.uv && i.face);

        if (hit) {
            this.lastHit = hit;
            this.projectorPosition.copy(hit.point);
            const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
            this.projectorNormal.copy(worldNormal);
            this.updatePreviewTransform();
            this.sync2DFrom3D(hit);
        }
    }

    sync2DFrom3D(hit) {
        if (!hit || !hit.uv || !this.currentDecalImage) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        this.decal2D.x = hit.uv.x * w;
        this.decal2D.y = (1 - hit.uv.y) * h;

        let syncDone = false;

        if (hit.face && hit.object && hit.object.geometry) {
            const geom = hit.object.geometry;
            const pos = geom.attributes.position;
            const uvs = geom.attributes.uv;
            const a = hit.face.a, b = hit.face.b, c = hit.face.c;

            if (pos && uvs && a !== undefined && b !== undefined && c !== undefined) {
                const pA = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(hit.object.matrixWorld);
                const pB = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(hit.object.matrixWorld);
                const pC = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(hit.object.matrixWorld);

                const uvA = new THREE.Vector2(uvs.getX(a) * w, (1 - uvs.getY(a)) * h);
                const uvB = new THREE.Vector2(uvs.getX(b) * w, (1 - uvs.getY(b)) * h);
                const uvC = new THREE.Vector2(uvs.getX(c) * w, (1 - uvs.getY(c)) * h);

                const e1 = new THREE.Vector3().subVectors(pB, pA);
                const e2 = new THREE.Vector3().subVectors(pC, pA);

                const u1 = new THREE.Vector2().subVectors(uvB, uvA);
                const u2 = new THREE.Vector2().subVectors(uvC, uvA);

                const orientation = this.currentProjectorOrientation || new THREE.Euler();
                const projX = new THREE.Vector3(1, 0, 0).applyEuler(orientation);

                const e11 = e1.dot(e1);
                const e12 = e1.dot(e2);
                const e22 = e2.dot(e2);
                const det = e11 * e22 - e12 * e12;

                if (Math.abs(det) > 1e-8) {
                    const d1 = projX.dot(e1);
                    const d2 = projX.dot(e2);
                    const alpha = (d1 * e22 - d2 * e12) / det;
                    const beta = (e11 * d2 - e12 * d1) / det;

                    const v2D = new THREE.Vector2(
                        alpha * u1.x + beta * u2.x,
                        alpha * u1.y + beta * u2.y
                    );

                    const len2D = v2D.length();
                    if (len2D > 0.0001) {
                        this.decal2D.rotation = Math.atan2(v2D.y, v2D.x);

                        const size3DX = this.currentProjectorSize ? this.currentProjectorSize.x : (this.getModelBaseSize() * (this.projectorScale / 100));
                        const pxWidth = size3DX * len2D;
                        if (pxWidth > 15 && pxWidth < w * 0.9) {
                            const aspect = (this.decal2D.baseWidth && this.decal2D.baseHeight) ? (this.decal2D.baseWidth / this.decal2D.baseHeight) : 1;
                            this.decal2D.width = Math.round(pxWidth);
                            this.decal2D.height = Math.round(pxWidth / aspect);
                            syncDone = true;
                        }
                    }
                }
            }
        }

        if (!syncDone) {
            const scale = (this.projectorScale || 100) / 100;
            this.decal2D.width = this.decal2D.baseWidth * scale;
            this.decal2D.height = this.decal2D.baseHeight * scale;
            this.decal2D.rotation = this.projectorRotation || 0;
        }

        this.render2DPreview();
    }

    getModelBaseSize() {
        if (!this.mesh) return 1.0;
        const box = new THREE.Box3().setFromObject(this.mesh);
        const size = box.getSize(new THREE.Vector3());
        return Math.max(0.1, Math.max(size.x, size.y, size.z) * 0.25);
    }

    updatePreviewTransform() {
        if (!this.previewGroup || !this.isActive) return;

        // 1. Orientación alineada con la normal de la superficie
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(this.projectorNormal.dot(up)) > 0.95) {
            up.set(1, 0, 0);
        }

        const zAxis = this.projectorNormal.clone().normalize();
        const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

        const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const baseQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

        // Giro del usuario alrededor de la normal
        const angleQuat = new THREE.Quaternion().setFromAxisAngle(this.projectorNormal, this.projectorRotation);
        const finalQuat = angleQuat.multiply(baseQuat);

        // 2. Escala con relación de aspecto
        const baseSize = this.getModelBaseSize();
        const finalScale = baseSize * (this.projectorScale / 100);

        let aspect = 1;
        if (this.currentDecalImage && this.currentDecalImage.height > 0) {
            aspect = this.currentDecalImage.width / this.currentDecalImage.height;
        }

        let scaleX = finalScale;
        let scaleY = finalScale;
        if (aspect >= 1) {
            scaleY = finalScale / aspect;
        } else {
            scaleX = finalScale * aspect;
        }

        // Profundidad óptima: suficiente para abrazar la curvatura del fuselaje sin atravesar el objeto
        const depth = Math.max(scaleX, scaleY) * (this.allowPassthrough ? 3.0 : 1.8);
        const size = new THREE.Vector3(scaleX, scaleY, depth);
        const orientation = new THREE.Euler().setFromQuaternion(finalQuat);

        this.currentProjectorOrientation = orientation;
        this.currentProjectorSize = size;

        // 3. Generar DecalGeometry adaptada a la curvatura 3D (soportando múltiples mallas como fuselaje + alas)
        const candidateMeshes = this.getMeshesToBake();
        const decalGeos = [];

        for (const targetMesh of candidateMeshes) {
            try {
                let geo = new DecalGeometry(targetMesh, this.projectorPosition, orientation, size);
                geo = this.filterDecalGeometry(geo, this.projectorNormal, this.allowPassthrough);
                if (geo.attributes.position && geo.attributes.position.count > 0) {
                    decalGeos.push(geo);
                } else {
                    geo.dispose();
                }
            } catch (err) {
                // Silenciosamente continuar con las otras mallas
            }
        }

        if (decalGeos.length > 0) {
            const decalGeo = this.mergeDecalGeometries(decalGeos);
            this.previewMesh.geometry.dispose();
            this.previewMesh.geometry = decalGeo;
            this.previewMesh.visible = true;

            const edges = new THREE.EdgesGeometry(decalGeo);
            this.previewBorder.geometry.dispose();
            this.previewBorder.geometry = edges;
            this.previewBorder.visible = true;

            this.fallbackPlane.visible = false;
            this.fallbackBorder.visible = false;

            this.previewGroup.position.set(0, 0, 0);
            this.previewGroup.quaternion.identity();
            this.previewGroup.scale.set(1, 1, 1);
            return;
        }

        // Respaldo plano si el cursor sale de la malla
        const offsetPoint = this.projectorPosition.clone().addScaledVector(this.projectorNormal, 0.003);
        this.previewGroup.position.copy(offsetPoint);
        this.previewGroup.quaternion.copy(finalQuat);
        this.previewGroup.scale.set(scaleX, scaleY, 1);
        this.previewMesh.visible = false;
        this.previewBorder.visible = false;
        this.fallbackPlane.visible = true;
        this.fallbackBorder.visible = true;
    }

    getMeshesToBake() {
        const meshes = [];
        if (this.mesh) {
            this.mesh.traverse(c => {
                if (c.isMesh && !c.userData?.isSelectionOverlay && c.geometry && c.geometry.attributes && c.geometry.attributes.uv) {
                    meshes.push(c);
                }
            });
        }
        return meshes;
    }

    mergeDecalGeometries(geos) {
        if (geos.length === 1) return geos[0];
        let totalPos = 0, totalNorm = 0, totalUv = 0;
        for (const g of geos) {
            totalPos += g.attributes.position ? g.attributes.position.array.length : 0;
            totalNorm += g.attributes.normal ? g.attributes.normal.array.length : 0;
            totalUv += g.attributes.uv ? g.attributes.uv.array.length : 0;
        }
        const posArr = new Float32Array(totalPos);
        const normArr = totalNorm > 0 ? new Float32Array(totalNorm) : null;
        const uvArr = totalUv > 0 ? new Float32Array(totalUv) : null;

        let posOff = 0, normOff = 0, uvOff = 0;
        for (const g of geos) {
            if (g.attributes.position) {
                posArr.set(g.attributes.position.array, posOff);
                posOff += g.attributes.position.array.length;
            }
            if (normArr && g.attributes.normal) {
                normArr.set(g.attributes.normal.array, normOff);
                normOff += g.attributes.normal.array.length;
            }
            if (uvArr && g.attributes.uv) {
                uvArr.set(g.attributes.uv.array, uvOff);
                uvOff += g.attributes.uv.array.length;
            }
            g.dispose();
        }
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        if (normArr) merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
        if (uvArr) merged.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
        return merged;
    }

    /**
     * Filtra los triángulos generados por DecalGeometry.
     * Si allowPassthrough es false, elimina solo las caras opuestas (> 110°, dot < -0.35),
     * permitiendo que la calca/mancha abrace perfectamente uniones a 90° (como fuselaje con alas).
     */
    filterDecalGeometry(decalGeo, projectorNormal, allowPassthrough) {
        if (allowPassthrough) return decalGeo;

        const pos = decalGeo.attributes.position;
        const norm = decalGeo.attributes.normal;
        const uv = decalGeo.attributes.uv;
        if (!pos || pos.count === 0) return decalGeo;

        const filteredPos = [];
        const filteredNorm = [];
        const filteredUv = [];

        const v0 = new THREE.Vector3();
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();
        const faceNormal = new THREE.Vector3();

        for (let i = 0; i < pos.count; i += 3) {
            v0.set(pos.getX(i), pos.getY(i), pos.getZ(i));
            v1.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
            v2.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

            edge1.subVectors(v1, v0);
            edge2.subVectors(v2, v0);
            faceNormal.crossVectors(edge1, edge2).normalize();

            // Descartar solo caras totalmente opuestas al proyector (permite abrazar uniones de 90° como fuselaje a ala)
            if (faceNormal.dot(projectorNormal) >= -0.35) {
                for (let j = 0; j < 3; j++) {
                    const idx = i + j;
                    filteredPos.push(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
                    if (norm) filteredNorm.push(norm.getX(idx), norm.getY(idx), norm.getZ(idx));
                    if (uv) filteredUv.push(uv.getX(idx), uv.getY(idx));
                }
            }
        }

        if (filteredPos.length === 0) {
            return decalGeo;
        }

        const filteredGeo = new THREE.BufferGeometry();
        filteredGeo.setAttribute('position', new THREE.Float32BufferAttribute(filteredPos, 3));
        if (filteredNorm.length > 0) {
            filteredGeo.setAttribute('normal', new THREE.Float32BufferAttribute(filteredNorm, 3));
        }
        if (filteredUv.length > 0) {
            filteredGeo.setAttribute('uv', new THREE.Float32BufferAttribute(filteredUv, 2));
        }

        decalGeo.dispose();
        return filteredGeo;
    }

    // ==========================================
    // PREVISUALIZACIÓN 2D GPU DESDE MODO 3D
    // ==========================================

    initPreviewBake() {
        if (this.previewBakeMaterial) return;

        this.previewRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType
        });
        this.previewOrthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.previewBakeScene = new THREE.Scene();

        this.previewBakeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProjectorMatrix: { value: new THREE.Matrix4() },
                uProjectorNormal: { value: new THREE.Vector3() },
                uDecalTexture: { value: null },
                uModelMatrix: { value: new THREE.Matrix4() },
                uAllowPassthrough: { value: 0.0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                uniform mat4 uModelMatrix;

                void main() {
                    vec4 worldPos = uModelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vWorldNormal = normalize((uModelMatrix * vec4(normal, 0.0)).xyz);
                    gl_Position = vec4(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform mat4 uProjectorMatrix;
                uniform vec3 uProjectorNormal;
                uniform sampler2D uDecalTexture;
                uniform float uAllowPassthrough;

                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;

                void main() {
                    if (uAllowPassthrough < 0.5) {
                        if (dot(vWorldNormal, uProjectorNormal) < -0.35) discard;
                    }

                    vec4 p = uProjectorMatrix * vec4(vWorldPosition, 1.0);
                    if (abs(p.x) > 0.5 || abs(p.y) > 0.5 || abs(p.z) > 0.5) discard;

                    vec2 decalUV = vec2(p.x + 0.5, p.y + 0.5);
                    vec4 col = texture2D(uDecalTexture, decalUV);
                    if (col.a < 0.01) discard;

                    gl_FragColor = col;
                }
            `,
            side: THREE.DoubleSide,
            transparent: true
        });

        this.previewOffscreenCanvas = document.createElement('canvas');
        this.previewOffscreenCanvas.width = 512;
        this.previewOffscreenCanvas.height = 512;
        this.previewOffscreenCtx = this.previewOffscreenCanvas.getContext('2d');
        this.previewPixelBuffer = new Uint8Array(512 * 512 * 4);
    }

    schedule2DPreview3D() {
        if (this._preview3DPending) return;
        this._preview3DPending = true;
        requestAnimationFrame(() => {
            this._preview3DPending = false;
            if (this.isActive && this.mode === '3d') {
                this.render2DPreview3D();
            }
        });
    }

    render2DPreview3D() {
        if (!this.isActive || !this.currentDecalImage || !this.ctxUI || !this.renderer || !this.mesh) return;

        this.initPreviewBake();

        const orientation = this.currentProjectorOrientation || new THREE.Euler();
        const size = this.currentProjectorSize || new THREE.Vector3(1, 1, 1);

        const projectorWorldMatrix = new THREE.Matrix4();
        projectorWorldMatrix.makeRotationFromEuler(orientation);
        projectorWorldMatrix.setPosition(this.projectorPosition);
        projectorWorldMatrix.multiply(new THREE.Matrix4().makeScale(size.x, size.y, size.z));
        const inverseProjectorMatrix = projectorWorldMatrix.clone().invert();

        const meshesToBake = this.getMeshesToBake();
        if (meshesToBake.length === 0) return;

        while (this.previewBakeScene.children.length > 0) {
            this.previewBakeScene.remove(this.previewBakeScene.children[0]);
        }

        this.previewBakeMaterial.uniforms.uProjectorMatrix.value = inverseProjectorMatrix;
        this.previewBakeMaterial.uniforms.uProjectorNormal.value.copy(this.projectorNormal);
        this.previewBakeMaterial.uniforms.uDecalTexture.value = this.decalTexture;
        this.previewBakeMaterial.uniforms.uAllowPassthrough.value = this.allowPassthrough ? 1.0 : 0.0;

        meshesToBake.forEach(m => {
            const meshClone = new THREE.Mesh(m.geometry, this.previewBakeMaterial);
            meshClone.material.uniforms.uModelMatrix.value.copy(m.matrixWorld);
            this.previewBakeScene.add(meshClone);
        });

        const prevTarget = this.renderer.getRenderTarget();
        const prevClearAlpha = this.renderer.getClearAlpha();
        const prevClearColor = this.renderer.getClearColor(new THREE.Color());

        this.renderer.setRenderTarget(this.previewRenderTarget);
        this.renderer.setClearColor(0x000000, 0.0);
        this.renderer.clear(true, true, true);
        this.renderer.render(this.previewBakeScene, this.previewOrthoCamera);
        this.renderer.setRenderTarget(prevTarget);
        this.renderer.setClearColor(prevClearColor, prevClearAlpha);

        this.renderer.readRenderTargetPixels(this.previewRenderTarget, 0, 0, 512, 512, this.previewPixelBuffer);
        const imgData = new ImageData(new Uint8ClampedArray(this.previewPixelBuffer.buffer), 512, 512);
        this.previewOffscreenCtx.putImageData(imgData, 0, 0);

        this.clear2DUI();
        this.ctxUI.save();
        this.ctxUI.imageSmoothingEnabled = true;
        this.ctxUI.imageSmoothingQuality = 'high';
        this.ctxUI.globalAlpha = 0.9;
        this.ctxUI.drawImage(this.previewOffscreenCanvas, 0, 0, this.canvasUI.width, this.canvasUI.height);
        this.ctxUI.restore();
    }

    // ==========================================
    // SISTEMA DE CALCOMANÍAS 2D (Fidelidad 1:1)
    // ==========================================

    getCanvas2DCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    clear2DUI() {
        if (this.ctxUI && this.canvasUI) {
            this.ctxUI.clearRect(0, 0, this.canvasUI.width, this.canvasUI.height);
        }
    }

    render2DPreview() {
        if (!this.isActive || !this.ctxUI) return;

        if (this.mode === '3d') {
            this.schedule2DPreview3D();
            return;
        }

        this.clear2DUI();

        // En Modo 2D, si no hay calca seleccionada, dejar la UI limpia
        if (!this.selectedDecalId) return;

        const d = this.decal2D;
        const ctx = this.ctxUI;
        const halfW = d.width / 2;
        const halfH = d.height / 2;

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);

        // Si la calca no estuviera aún en la capa activa, dibujarla aquí
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        const inLayer = activeLayer && activeLayer.decals && activeLayer.decals.some(x => x.id === this.selectedDecalId);
        if (!inLayer && this.currentDecalImage) {
            ctx.drawImage(this.currentDecalImage, -halfW, -halfH, d.width, d.height);
        }

        // Modo 2D: Controles interactivos con nodos de escala y rotación transparentes
        ctx.strokeStyle = '#0078d7';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-halfW, -halfH, d.width, d.height);
        ctx.setLineDash([]);

        const minDim = Math.min(d.width, d.height);
        const handleRadius = Math.max(3.5, Math.min(6, Math.round(minDim / 12)));
        const showEdgeHandles = d.width >= 36 && d.height >= 36;

        const drawHandle = (hx, hy, isRotate = false) => {
            // Nodos con interior 100% transparente para ver el panelado y la figura debajo
            if (isRotate) {
                ctx.beginPath();
                ctx.arc(hx, hy, handleRadius + 1, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = '#0078d7';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.lineWidth = 3;
                ctx.strokeRect(hx - handleRadius, hy - handleRadius, handleRadius * 2, handleRadius * 2);
                ctx.strokeStyle = '#0078d7';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(hx - handleRadius, hy - handleRadius, handleRadius * 2, handleRadius * 2);
            }
        };

        // Esquinas (escala proporcional)
        drawHandle(-halfW, -halfH);
        drawHandle( halfW, -halfH);
        drawHandle(-halfW,  halfH);
        drawHandle( halfW,  halfH);

        // Bordes (ajuste de anchura o altura) - solo visibles si el tamaño lo amerita
        if (showEdgeHandles) {
            drawHandle(0, -halfH);
            drawHandle(0,  halfH);
            drawHandle(-halfW, 0);
            drawHandle( halfW, 0);
        }

        // Palo de rotación proporcional
        const stemLength = Math.max(16, Math.min(28, Math.round(minDim * 0.25 + 10)));
        ctx.beginPath();
        ctx.moveTo(0, -halfH);
        ctx.lineTo(0, -halfH - stemLength);
        ctx.strokeStyle = '#0078d7';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        drawHandle(0, -halfH - stemLength, true);

        ctx.restore();
    }

    hitTest2D(canvasX, canvasY) {
        if (!this.isActive || this.mode !== '2d' || !this.selectedDecalId) return null;

        const d = this.decal2D;
        const dx = canvasX - d.x;
        const dy = canvasY - d.y;
        const cos = Math.cos(-d.rotation);
        const sin = Math.sin(-d.rotation);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;

        const halfW = d.width / 2;
        const halfH = d.height / 2;
        const minDim = Math.min(d.width, d.height);
        const handleRadius = Math.max(3.5, Math.min(6, Math.round(minDim / 12)));
        const stemLength = Math.max(16, Math.min(28, Math.round(minDim * 0.25 + 10)));
        const showEdgeHandles = d.width >= 36 && d.height >= 36;

        // Tolerancia delimitada dinámicamente para no solapar la zona central de arrastre
        const maxTol = Math.max(4, Math.min(halfW, halfH) * 0.45);
        const tol = Math.max(4, Math.min(handleRadius + 3, maxTol));
        const rotTol = Math.max(6, handleRadius + 4);

        // 1. Nodo de rotación
        if (Math.hypot(lx, ly - (-halfH - stemLength)) <= rotTol) {
            return 'rotate';
        }

        // 2. Esquinas (nw, ne, sw, se)
        if (Math.abs(lx - (-halfW)) <= tol && Math.abs(ly - (-halfH)) <= tol) return 'nw';
        if (Math.abs(lx - ( halfW)) <= tol && Math.abs(ly - (-halfH)) <= tol) return 'ne';
        if (Math.abs(lx - (-halfW)) <= tol && Math.abs(ly - ( halfH)) <= tol) return 'sw';
        if (Math.abs(lx - ( halfW)) <= tol && Math.abs(ly - ( halfH)) <= tol) return 'se';

        // 3. Bordes (n, s, w, e)
        if (showEdgeHandles) {
            if (Math.abs(lx - 0) <= tol && Math.abs(ly - (-halfH)) <= tol) return 'n';
            if (Math.abs(lx - 0) <= tol && Math.abs(ly - ( halfH)) <= tol) return 's';
            if (Math.abs(lx - (-halfW)) <= tol && Math.abs(ly - 0) <= tol) return 'w';
            if (Math.abs(lx - ( halfW)) <= tol && Math.abs(ly - 0) <= tol) return 'e';
        }

        // 4. Interior de la calcomanía (mover)
        if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
            return 'move';
        }

        return null;
    }

    onPointerDown2D(e) {
        if (e.button !== 0) return;
        const currentBrushMode = document.getElementById('brush-mode')?.value;
        if (currentBrushMode === 'select' && this.mode !== '2d') {
            this.mode = '2d';
        }
        if (this.mode !== '2d') return;
        const { x, y } = this.getCanvas2DCoords(e);

        // 1. Si hay una calca seleccionada, verificar si se hizo clic en sus nodos o su interior
        if (this.selectedDecalId) {
            const hit = this.hitTest2D(x, y);
            if (hit) {
                this.decal2D.isDragging = true;
                this.decal2D.dragHandle = hit;
                this.decal2D.dragOffset = { x: x - this.decal2D.x, y: y - this.decal2D.y };
                this.decal2D.initialDecal = { ...this.decal2D };
                this.decal2D.dragStart = { x, y };
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
        }

        // 2. Si no se tocó la calca seleccionada, buscar si se hizo clic sobre OTRA pegatina de la capa activa
        const clickedDecal = this.findDecalAt(x, y);
        if (clickedDecal) {
            this.selectDecal(clickedDecal);
            this.decal2D.isDragging = true;
            this.decal2D.dragHandle = 'move';
            this.decal2D.dragOffset = { x: x - this.decal2D.x, y: y - this.decal2D.y };
            this.decal2D.initialDecal = { ...this.decal2D };
            this.decal2D.dragStart = { x, y };
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }

        // 3. Clic en espacio vacío: deseleccionar para dejar el lienzo despejado
        if (this.selectedDecalId) {
            this.deselectDecal();
        }
    }

    onPointerMove2D(e) {
        const currentBrushMode = document.getElementById('brush-mode')?.value;
        if (currentBrushMode === 'select' && this.mode !== '2d') {
            this.mode = '2d';
        }
        if (this.mode !== '2d') return;
        const { x, y } = this.getCanvas2DCoords(e);

        if (!this.decal2D.isDragging) {
            if (this.selectedDecalId) {
                const hit = this.hitTest2D(x, y);
                if (hit === 'rotate') { this.canvas.style.cursor = 'grab'; return; }
                else if (hit === 'move') { this.canvas.style.cursor = 'move'; return; }
                else if (['nw', 'se'].includes(hit)) { this.canvas.style.cursor = 'nwse-resize'; return; }
                else if (['ne', 'sw'].includes(hit)) { this.canvas.style.cursor = 'nesw-resize'; return; }
                else if (['n', 's'].includes(hit)) { this.canvas.style.cursor = 'ns-resize'; return; }
                else if (['e', 'w'].includes(hit)) { this.canvas.style.cursor = 'ew-resize'; return; }
            }
            const hoverDecal = this.findDecalAt(x, y);
            if (hoverDecal) {
                this.canvas.style.cursor = 'pointer';
            }
            return;
        }

        const h = this.decal2D.dragHandle;
        const d = this.decal2D;
        const init = this.decal2D.initialDecal;

        if (h === 'move') {
            d.x = x - d.dragOffset.x;
            d.y = y - d.dragOffset.y;
        } else if (h === 'rotate') {
            const angle = Math.atan2(y - d.y, x - d.x) + Math.PI / 2;
            d.rotation = angle;
            const deg = Math.round((d.rotation * 180 / Math.PI) % 360);
            const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
            const rotInput = document.getElementById('decal-rotation');
            const rotLabel = document.getElementById('decal-rot-label');
            if (rotInput) rotInput.value = normDeg;
            if (rotLabel) rotLabel.textContent = `${normDeg}°`;

            if (this.isTextMode) {
                const textRot = document.getElementById('text-rotation');
                const textRotLabel = document.getElementById('text-rot-val');
                if (textRot) textRot.value = normDeg;
                if (textRotLabel) textRotLabel.textContent = `${normDeg}°`;
                if (this.textOptions) this.textOptions.rotation = normDeg;
            }
        } else if (['nw', 'ne', 'sw', 'se'].includes(h)) {
            const dx = x - init.x;
            const dy = y - init.y;
            const cos = Math.cos(-init.rotation);
            const sin = Math.sin(-init.rotation);
            const lx = dx * cos - dy * sin;
            const ly = dx * sin + dy * cos;

            const aspect = init.baseWidth / init.baseHeight;
            let newHalfW = Math.abs(lx);
            let newHalfH = newHalfW / aspect;
            if (Math.abs(ly) * aspect > newHalfW) {
                newHalfH = Math.abs(ly);
                newHalfW = newHalfH * aspect;
            }

            d.width = Math.max(20, newHalfW * 2);
            d.height = Math.max(20, newHalfH * 2);

            const scalePct = Math.round((d.width / d.baseWidth) * 100);
            const scaleInput = document.getElementById('decal-scale');
            if (scaleInput) scaleInput.value = Math.min(300, Math.max(10, scalePct));

            if (this.isTextMode) {
                const textFontSize = document.getElementById('text-font-size');
                const textSizeVal = document.getElementById('text-size-val');
                const approxFont = Math.max(14, Math.min(250, Math.round(d.height / 2.5)));
                if (textFontSize) textFontSize.value = approxFont;
                if (textSizeVal) textSizeVal.textContent = `${approxFont} px`;
                if (this.textOptions) this.textOptions.fontSize = approxFont;
            }
        } else if (['n', 's'].includes(h)) {
            const dx = x - init.x;
            const dy = y - init.y;
            const cos = Math.cos(-init.rotation);
            const sin = Math.sin(-init.rotation);
            const ly = dx * sin + dy * cos;
            d.height = Math.max(20, Math.abs(ly) * 2);
        } else if (['e', 'w'].includes(h)) {
            const dx = x - init.x;
            const dy = y - init.y;
            const cos = Math.cos(-init.rotation);
            const sin = Math.sin(-init.rotation);
            const lx = dx * cos - dy * sin;
            d.width = Math.max(20, Math.abs(lx) * 2);
        }

        this.scheduleSync(false);
    }

    onPointerUp2D(e) {
        if (this.decal2D && this.decal2D.isDragging) {
            if (this._syncRaf) {
                cancelAnimationFrame(this._syncRaf);
                this._syncRaf = null;
            }
            this.decal2D.isDragging = false;
            this.decal2D.dragHandle = null;
            this.syncCurrentDecalToObject(true);
            this.render2DPreview();
            if (this.layerManager) this.layerManager.renderUI();
        }
    }

    bakeToActiveLayer() {
        if (this.mode === '2d') {
            this.bake2DToActiveLayer();
        } else {
            this.bake3DToActiveLayer();
        }
    }

    bake2DToActiveLayer() {
        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        if (!activeLayer) return;

        if (this.selectedDecalId && activeLayer.getDecal && activeLayer.getDecal(this.selectedDecalId)) {
            if (this.painter) this.painter.saveUndoState();
            activeLayer.bakeDecal(this.selectedDecalId);
        } else if (activeLayer.decals && activeLayer.decals.length > 0) {
            if (this.painter) this.painter.saveUndoState();
            activeLayer.bakeDecals();
        } else if (this.currentDecalImage && this.isActive) {
            if (this.painter) this.painter.saveUndoState();
            const isEditingMask = (activeLayer.hasMask && activeLayer.isEditingMask);
            const targetCtx = isEditingMask ? activeLayer.maskCtx : activeLayer.ctx;
            const d = this.decal2D;
            targetCtx.save();
            targetCtx.imageSmoothingEnabled = true;
            targetCtx.imageSmoothingQuality = 'high';
            targetCtx.translate(d.x, d.y);
            targetCtx.rotate(d.rotation);
            targetCtx.drawImage(this.currentDecalImage, -d.width / 2, -d.height / 2, d.width, d.height);
            targetCtx.restore();
        } else {
            alert('No hay pegatinas en la capa activa para estampar.');
            return;
        }

        this.deselectDecal();

        if (this.layerManager) {
            this.layerManager.recomposite();
            this.layerManager.renderUI();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
        }
        if (this.texture) {
            this.texture.needsUpdate = true;
        }
        if (window.papercraft && window.papercraft.active && window.renderUnfoldWorkbench) {
            window.renderUnfoldWorkbench();
        }

        // Feedback visual en botón
        const btn2D = this.isTextMode ? document.getElementById('btn-text-bake-2d') : document.getElementById('btn-bake-decal-2d');
        if (btn2D) {
            const oldText = btn2D.textContent;
            btn2D.textContent = '✅ ¡Estampado a Capa!';
            btn2D.style.backgroundColor = '#1e7e34';
            setTimeout(() => { 
                btn2D.textContent = oldText; 
                btn2D.style.backgroundColor = '#28a745';
            }, 1200);
        }
    }

    /**
     * Horneado ultrarrápido por GPU (RTX) en espacio de textura UV.
     * Despliega la geometría directamente en un WebGLRenderTarget y fusiona el resultado en la capa activa.
     */
    bake3DToActiveLayer() {
        if (!this.isActive || !this.currentDecalImage || !this.mesh) {
            alert(this.isTextMode ? 'Introduce un texto para estampar.' : 'Carga primero una imagen de calcomanía.');
            return;
        }

        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        const isEditingMask = (activeLayer && activeLayer.hasMask && activeLayer.isEditingMask);
        const targetCanvas = isEditingMask ? activeLayer.maskCanvas : (activeLayer ? activeLayer.canvas : this.canvas);
        const targetCtx = isEditingMask ? activeLayer.maskCtx : (activeLayer ? activeLayer.ctx : this.canvas.getContext('2d'));
        const width = targetCanvas.width;
        const height = targetCanvas.height;

        // 1. Guardar historial Deshacer (Ctrl + Z)
        if (this.painter) {
            this.painter.saveUndoState();
        }

        // 2. Matriz inversa del proyector en espacio mundo (idéntica a DecalGeometry)
        const orientation = this.currentProjectorOrientation || new THREE.Euler();
        const size = this.currentProjectorSize || new THREE.Vector3(1, 1, 1);

        const projectorWorldMatrix = new THREE.Matrix4();
        projectorWorldMatrix.makeRotationFromEuler(orientation);
        projectorWorldMatrix.setPosition(this.projectorPosition);
        projectorWorldMatrix.multiply(new THREE.Matrix4().makeScale(size.x, size.y, size.z));
        const inverseProjectorMatrix = projectorWorldMatrix.clone().invert();

        // 3. Mallas objetivo a proyectar
        const meshesToBake = this.getMeshesToBake();
        if (meshesToBake.length === 0) return;

        // 4. Shader de Despliegue UV por Hardware (RTX)
        const bakeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProjectorMatrix: { value: inverseProjectorMatrix },
                uProjectorNormal: { value: this.projectorNormal },
                uDecalTexture: { value: this.decalTexture },
                uModelMatrix: { value: new THREE.Matrix4() },
                uAllowPassthrough: { value: this.allowPassthrough ? 1.0 : 0.0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                uniform mat4 uModelMatrix;

                void main() {
                    vec4 worldPos = uModelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vWorldNormal = normalize((uModelMatrix * vec4(normal, 0.0)).xyz);
                    // Mapeo directo de UV al espacio NDC de la GPU
                    // (Invertido en Y para que coincida 1:1 con el sistema de coordenadas de Canvas2D)
                    gl_Position = vec4(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform mat4 uProjectorMatrix;
                uniform vec3 uProjectorNormal;
                uniform sampler2D uDecalTexture;
                uniform float uAllowPassthrough;

                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;

                void main() {
                    // Si no está habilitado traspasar, descartar solo caras totalmente opuestas (> 110°)
                    // (Permite abrazar suavemente uniones a 90° como fuselaje con alas y curvaturas)
                    if (uAllowPassthrough < 0.5) {
                        if (dot(vWorldNormal, uProjectorNormal) < -0.35) discard;
                    }

                    vec4 p = uProjectorMatrix * vec4(vWorldPosition, 1.0);

                    // Verificar límites de la caja proyectora [-0.5, 0.5]
                    if (abs(p.x) > 0.5 || abs(p.y) > 0.5 || abs(p.z) > 0.5) discard;

                    // Muestrear textura de la calca
                    vec2 decalUV = vec2(p.x + 0.5, p.y + 0.5);
                    vec4 col = texture2D(uDecalTexture, decalUV);
                    if (col.a < 0.01) discard;

                    gl_FragColor = col;
                }
            `,
            side: THREE.DoubleSide,
            transparent: true
        });

        // 5. Renderizar en WebGLRenderTarget con antialiasing MSAA (4x)
        const renderTarget = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            samples: 4
        });

        const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const bakeScene = new THREE.Scene();

        meshesToBake.forEach(m => {
            const meshClone = new THREE.Mesh(m.geometry, bakeMaterial.clone());
            meshClone.material.uniforms.uModelMatrix.value.copy(m.matrixWorld);
            meshClone.material.uniforms.uProjectorMatrix.value = inverseProjectorMatrix;
            meshClone.material.uniforms.uProjectorNormal.value = this.projectorNormal;
            meshClone.material.uniforms.uDecalTexture.value = this.decalTexture;
            meshClone.material.uniforms.uAllowPassthrough.value = this.allowPassthrough ? 1.0 : 0.0;
            bakeScene.add(meshClone);
        });

        const prevTarget = this.renderer.getRenderTarget();
        const prevClearAlpha = this.renderer.getClearAlpha();
        const prevClearColor = this.renderer.getClearColor(new THREE.Color());

        this.renderer.setRenderTarget(renderTarget);
        this.renderer.setClearColor(0x000000, 0.0);
        this.renderer.clear(true, true, true);
        this.renderer.render(bakeScene, orthoCamera);
        this.renderer.setRenderTarget(prevTarget);
        this.renderer.setClearColor(prevClearColor, prevClearAlpha);

        // 6. Leer búfer horneado y fusionar en la capa activa con aceleración de hardware
        const pixelData = new Uint8Array(width * height * 4);
        this.renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixelData);

        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;
        const offCtx = offscreen.getContext('2d');
        const clamped = new Uint8ClampedArray(pixelData.buffer);
        const imgData = new ImageData(clamped, width, height);
        offCtx.putImageData(imgData, 0, 0);

        targetCtx.save();
        let clipApplied3D = false;
        if (window.selectionManager) {
            clipApplied3D = window.selectionManager.applyClip(targetCtx);
        }
        targetCtx.imageSmoothingEnabled = true;
        targetCtx.imageSmoothingQuality = 'high';
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.drawImage(offscreen, 0, 0);
        if (clipApplied3D) targetCtx.restore();
        targetCtx.restore();

        // 7. Limpiar recursos GPU
        renderTarget.dispose();
        bakeMaterial.dispose();

        // 8. Recomponer capas y actualizar vistas
        if (activeLayer && this.selectedDecalId) {
            activeLayer.removeDecal(this.selectedDecalId);
            this.selectedDecalId = null;
        }
        if (this.layerManager) {
            this.layerManager.recomposite();
            this.layerManager.renderUI();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
        }
        if (this.texture) {
            this.texture.needsUpdate = true;
        }
        if (window.papercraft && window.papercraft.active && window.renderUnfoldWorkbench) {
            window.renderUnfoldWorkbench();
        }

        // Feedback visual en botón
        const btn3D = this.isTextMode ? document.getElementById('btn-text-bake-3d') : document.getElementById('btn-bake-decal-3d');
        if (btn3D) {
            const oldText = btn3D.textContent;
            btn3D.textContent = '✅ ¡Estampado!';
            btn3D.style.backgroundColor = '#0a58ca';
            setTimeout(() => { 
                btn3D.textContent = oldText; 
                btn3D.style.backgroundColor = '#0d6efd';
            }, 1200);
        }

        // Dejar fijada la calca por si quiere moverla o estampar en otro lugar
        this.isLocked = true;
        this.clear2DUI();
    }
}
