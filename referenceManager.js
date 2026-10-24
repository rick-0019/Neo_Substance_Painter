import * as THREE from 'three';

/**
 * ReferenceImageManager - Neo Substance Painter
 * Sistema profesional de Planos e Imágenes de Referencia / Blueprints (Estilo Blender)
 * Permite calcar líneas de panel, remaches y posicionar calcomanías con precisión milimétrica.
 */
export class ReferenceImageManager {
    constructor(scene, getCamera, getControls, state) {
        this.scene = scene;
        this.getCamera = getCamera;
        this.getControls = getControls;
        this.state = state;

        // Grupo Three.js dedicado para las referencias (no interfiere con el pintor/calcas)
        this.group = new THREE.Group();
        this.group.name = 'ReferenceImagesGroup';
        this.group.userData = { isReferenceGroup: true };
        this.scene.add(this.group);

        // Estado global
        this.enabled = true;
        this.onlyInOrtho = true;
        this.currentView = 'right'; // 'right', 'top', 'front', etc.
        this.isOrtho = false;
        this.activeSlotKey = 'right'; // Slot activo en el panel de control
        this.isDragging = false;
        this.dragModeActive = false; // Toggle botón "Arrastrar con Mouse"
        this.lastPointer = { x: 0, y: 0 };

        // Slots de referencia por vista canónica
        // Mapea vistas ortogonales: right (3), top (7), front (1) y sus contrapartes
        this.slots = {
            right: this._createSlotConfig('Lateral (Derecha / 3)', 'right'),
            top: this._createSlotConfig('Planta (Superior / 7)', 'top'),
            front: this._createSlotConfig('Frontal (Alzado / 1)', 'front')
        };

        // Cache de elementos DOM
        this.dom = {};
    }

    _createSlotConfig(label, viewKey) {
        return {
            label,
            viewKey,
            image: null,
            texture: null,
            dataUrl: null,
            fileName: '',
            aspectRatio: 1,
            opacity: 0.5,
            depth: 'front', // 'front' (calco semitransparente) | 'back' (silueta de fondo)
            scale: 1.0,
            offsetX: 0.0,
            offsetY: 0.0,
            rotation: 0.0,
            flipH: false,
            visible: true,
            locked: false,
            planeMesh: null
        };
    }

    init() {
        try {
            this._bindUI();
            this._bindShortcutsAndMouse();
            this._bindDragAndDrop();
            this._loadSavedPreferences();
            this.onViewChanged(window.currentOrthoView || 'user_ortho', window.isOrthographic || false);
        } catch (err) {
            console.error('[ReferenceImageManager] Error durante init:', err);
        }
    }

    updateView(viewName, isOrthographic) {
        return this.onViewChanged(viewName, isOrthographic);
    }

    _bindUI() {
        // Botón en la barra de herramientas de la Vista 3D
        this.dom.toggleBtn = document.getElementById('btn-view3d-toggle-ref-img');
        this.dom.panel = document.getElementById('view3d-ref-panel');
        this.dom.closeBtn = document.getElementById('btn-ref-close');
        this.dom.lockBtn = document.getElementById('btn-ref-lock');

        // Pestañas
        this.dom.tabBtns = document.querySelectorAll('.btn-ref-tab');

        // Dropzone / File inputs
        this.dom.dropzone = document.getElementById('ref-upload-dropzone');
        this.dom.fileInput = document.getElementById('input-ref-file');
        this.dom.btnSelectFile = document.getElementById('btn-ref-select-file');
        this.dom.btnReplace = document.getElementById('btn-ref-replace');
        this.dom.btnClear = document.getElementById('btn-ref-clear');
        this.dom.previewEmpty = document.getElementById('ref-preview-empty');
        this.dom.previewLoaded = document.getElementById('ref-preview-loaded');
        this.dom.thumbImg = document.getElementById('ref-thumb-img');
        this.dom.fileNameLabel = document.getElementById('ref-file-name');

        // Sliders y Controles
        this.dom.sliderOpacity = document.getElementById('ref-slider-opacity');
        this.dom.labelOpacity = document.getElementById('ref-label-opacity');
        this.dom.btnOpacityDec = document.getElementById('btn-ref-opacity-dec');
        this.dom.btnOpacityInc = document.getElementById('btn-ref-opacity-inc');
        this.dom.btnDepthBack = document.getElementById('btn-ref-depth-back');
        this.dom.btnDepthFront = document.getElementById('btn-ref-depth-front');

        this.dom.sliderScale = document.getElementById('ref-slider-scale');
        this.dom.labelScale = document.getElementById('ref-label-scale');
        this.dom.btnScaleDec = document.getElementById('btn-ref-scale-dec');
        this.dom.btnScaleInc = document.getElementById('btn-ref-scale-inc');

        this.dom.sliderPosX = document.getElementById('ref-slider-pos-x');
        this.dom.btnPosXDec = document.getElementById('btn-ref-pos-x-dec');
        this.dom.btnPosXInc = document.getElementById('btn-ref-pos-x-inc');
        this.dom.btnResetPosX = document.getElementById('btn-ref-reset-pos-x');

        this.dom.sliderPosY = document.getElementById('ref-slider-pos-y');
        this.dom.btnPosYDec = document.getElementById('btn-ref-pos-y-dec');
        this.dom.btnPosYInc = document.getElementById('btn-ref-pos-y-inc');
        this.dom.btnResetPosY = document.getElementById('btn-ref-reset-pos-y');

        this.dom.sliderRot = document.getElementById('ref-slider-rot');
        this.dom.labelRot = document.getElementById('ref-label-rot');
        this.dom.btnRotDec = document.getElementById('btn-ref-rot-dec');
        this.dom.btnRotInc = document.getElementById('btn-ref-rot-inc');
        this.dom.btnResetRot = document.getElementById('btn-ref-reset-rot');

        this.dom.btnFlipH = document.getElementById('btn-ref-flip-h');
        this.dom.checkOnlyOrtho = document.getElementById('ref-check-only-ortho');
        this.dom.btnAutoFit = document.getElementById('btn-ref-auto-fit');
        this.dom.btnDragMode = document.getElementById('btn-ref-drag-mode');

        // Toggle del panel / Visibilidad
        if (this.dom.toggleBtn) {
            this.dom.toggleBtn.addEventListener('click', () => {
                this.togglePanel();
            });
        }

        if (this.dom.closeBtn) {
            this.dom.closeBtn.addEventListener('click', () => {
                this.closePanel();
            });
        }

        // Pestañas de Vista
        if (this.dom.tabBtns) {
            this.dom.tabBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const slot = btn.getAttribute('data-ref-slot');
                    if (slot && this.slots[slot]) {
                        this.selectSlot(slot, true);
                    }
                });
            });
        }

        // Carga de Archivos
        if (this.dom.btnSelectFile) {
            this.dom.btnSelectFile.addEventListener('click', () => this.dom.fileInput && this.dom.fileInput.click());
        }
        if (this.dom.btnReplace) {
            this.dom.btnReplace.addEventListener('click', () => this.dom.fileInput && this.dom.fileInput.click());
        }
        if (this.dom.fileInput) {
            this.dom.fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) this.loadFile(file, this.activeSlotKey);
            });
        }
        if (this.dom.btnClear) {
            this.dom.btnClear.addEventListener('click', () => {
                this.clearSlot(this.activeSlotKey);
            });
        }

        // Opacidad
        if (this.dom.sliderOpacity) {
            this.dom.sliderOpacity.addEventListener('input', (e) => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot) return;
                slot.opacity = parseInt(e.target.value, 10) / 100;
                if (this.dom.labelOpacity) this.dom.labelOpacity.textContent = `${e.target.value}%`;
                this._applySlotMaterial(this.activeSlotKey);
            });
        }
        if (this.dom.btnOpacityDec) {
            this.dom.btnOpacityDec.addEventListener('click', () => this.adjustOpacity(this.activeSlotKey, -0.05));
        }
        if (this.dom.btnOpacityInc) {
            this.dom.btnOpacityInc.addEventListener('click', () => this.adjustOpacity(this.activeSlotKey, 0.05));
        }

        // Profundidad (Detrás / Delante)
        if (this.dom.btnDepthBack) {
            this.dom.btnDepthBack.addEventListener('click', () => {
                this.setDepth(this.activeSlotKey, 'back');
            });
        }
        if (this.dom.btnDepthFront) {
            this.dom.btnDepthFront.addEventListener('click', () => {
                this.setDepth(this.activeSlotKey, 'front');
            });
        }

        // Escala
        if (this.dom.sliderScale) {
            this.dom.sliderScale.addEventListener('input', (e) => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.scale = parseInt(e.target.value, 10) / 100;
                if (this.dom.labelScale) this.dom.labelScale.textContent = `${e.target.value}%`;
                this.updateSlotTransform(this.activeSlotKey);
            });
        }
        if (this.dom.btnScaleDec) {
            this.dom.btnScaleDec.addEventListener('click', (e) => this.adjustScale(this.activeSlotKey, e.shiftKey ? -0.05 : -0.01));
        }
        if (this.dom.btnScaleInc) {
            this.dom.btnScaleInc.addEventListener('click', (e) => this.adjustScale(this.activeSlotKey, e.shiftKey ? 0.05 : 0.01));
        }

        // Posición X / Y
        if (this.dom.sliderPosX) {
            this.dom.sliderPosX.addEventListener('input', (e) => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.offsetX = parseFloat(e.target.value) * this._getSensitivity();
                this.updateSlotTransform(this.activeSlotKey);
            });
        }
        if (this.dom.btnPosXDec) {
            this.dom.btnPosXDec.addEventListener('click', (e) => this.adjustPosX(this.activeSlotKey, e.shiftKey ? -5 : -1));
        }
        if (this.dom.btnPosXInc) {
            this.dom.btnPosXInc.addEventListener('click', (e) => this.adjustPosX(this.activeSlotKey, e.shiftKey ? 5 : 1));
        }
        if (this.dom.btnResetPosX) {
            this.dom.btnResetPosX.addEventListener('click', () => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.offsetX = 0;
                if (this.dom.sliderPosX) this.dom.sliderPosX.value = 0;
                this.updateSlotTransform(this.activeSlotKey);
            });
        }

        if (this.dom.sliderPosY) {
            this.dom.sliderPosY.addEventListener('input', (e) => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.offsetY = parseFloat(e.target.value) * this._getSensitivity();
                this.updateSlotTransform(this.activeSlotKey);
            });
        }
        if (this.dom.btnPosYDec) {
            this.dom.btnPosYDec.addEventListener('click', (e) => this.adjustPosY(this.activeSlotKey, e.shiftKey ? -5 : -1));
        }
        if (this.dom.btnPosYInc) {
            this.dom.btnPosYInc.addEventListener('click', (e) => this.adjustPosY(this.activeSlotKey, e.shiftKey ? 5 : 1));
        }
        if (this.dom.btnResetPosY) {
            this.dom.btnResetPosY.addEventListener('click', () => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.offsetY = 0;
                if (this.dom.sliderPosY) this.dom.sliderPosY.value = 0;
                this.updateSlotTransform(this.activeSlotKey);
            });
        }

        // Rotación
        if (this.dom.sliderRot) {
            this.dom.sliderRot.addEventListener('input', (e) => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.rotation = parseFloat(e.target.value);
                if (this.dom.labelRot) this.dom.labelRot.textContent = `${slot.rotation.toFixed(1)}°`;
                this.updateSlotTransform(this.activeSlotKey);
            });
        }
        if (this.dom.btnRotDec) {
            this.dom.btnRotDec.addEventListener('click', (e) => this.adjustRotation(this.activeSlotKey, e.shiftKey ? -2.5 : -0.5));
        }
        if (this.dom.btnRotInc) {
            this.dom.btnRotInc.addEventListener('click', (e) => this.adjustRotation(this.activeSlotKey, e.shiftKey ? 2.5 : 0.5));
        }
        if (this.dom.btnResetRot) {
            this.dom.btnResetRot.addEventListener('click', () => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot || slot.locked) return;
                slot.rotation = 0;
                if (this.dom.sliderRot) this.dom.sliderRot.value = 0;
                if (this.dom.labelRot) this.dom.labelRot.textContent = '0°';
                this.updateSlotTransform(this.activeSlotKey);
            });
        }

        // Espejo Horizontal
        if (this.dom.btnFlipH) {
            this.dom.btnFlipH.addEventListener('click', () => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot) return;
                slot.flipH = !slot.flipH;
                this.dom.btnFlipH.classList.toggle('active', slot.flipH);
                this._applySlotMaterial(this.activeSlotKey);
            });
        }

        // Bloquear (Candado)
        if (this.dom.lockBtn) {
            this.dom.lockBtn.addEventListener('click', () => {
                const slot = this.slots[this.activeSlotKey];
                if (!slot) return;
                slot.locked = !slot.locked;
                this.dom.lockBtn.textContent = slot.locked ? '🔒' : '🔓';
                this.dom.lockBtn.title = slot.locked ? 'Desbloquear edición de referencia' : 'Bloquear edición de referencia';
                this.dom.lockBtn.classList.toggle('locked', slot.locked);
            });
        }

        // Solo en Ortogonal
        if (this.dom.checkOnlyOrtho) {
            this.dom.checkOnlyOrtho.addEventListener('change', (e) => {
                this.onlyInOrtho = e.target.checked;
                this.updateVisibility();
            });
        }

        // Auto-Ajustar al Modelo
        if (this.dom.btnAutoFit) {
            this.dom.btnAutoFit.addEventListener('click', () => {
                this.autoFitToModel(this.activeSlotKey);
            });
        }

        // Toggle Modo Arrastre Directo
        if (this.dom.btnDragMode) {
            this.dom.btnDragMode.addEventListener('click', () => {
                this.dragModeActive = !this.dragModeActive;
                this.dom.btnDragMode.classList.toggle('active', this.dragModeActive);
                this.dom.btnDragMode.textContent = this.dragModeActive ? '✋ Arrastrando (Clic en 3D)' : '✋ Arrastrar con Mouse';
                const view3d = document.getElementById('view-3d');
                if (view3d) view3d.style.cursor = this.dragModeActive ? 'grab' : '';
            });
        }
    }

    _getSensitivity() {
        if (!this.state.mesh) return 0.02;
        const box = new THREE.Box3().setFromObject(this.state.mesh);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 2;
        return (maxDim / 200); // 100 pasos en el slider equivalen al tamaño del modelo
    }

    _bindShortcutsAndMouse() {
        const view3d = document.getElementById('view-3d');
        if (!view3d) return;

        // Arrastre interactivo con Alt o DragMode
        view3d.addEventListener('pointerdown', (e) => {
            const slot = this.slots[this.activeSlotKey];
            if (!slot || !slot.image || slot.locked || !this.isOrtho) return;

            // Arrastre si tiene Alt apretado O el botón de arrastre activado
            if (e.altKey || this.dragModeActive) {
                this.isDragging = true;
                this.lastPointer = { x: e.clientX, y: e.clientY };
                view3d.style.cursor = 'grabbing';
                e.stopPropagation();
                e.preventDefault();
            }
        }, { capture: true });

        window.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            const slot = this.slots[this.activeSlotKey];
            if (!slot || slot.locked) return;

            const dx = e.clientX - this.lastPointer.x;
            const dy = e.clientY - this.lastPointer.y;
            this.lastPointer = { x: e.clientX, y: e.clientY };

            const camera = this.getCamera();
            if (camera && camera.isOrthographicCamera) {
                const aspect = (view3d.clientWidth || 800) / (view3d.clientHeight || 600);
                const visH = (camera.top - camera.bottom) / (camera.zoom || 1);
                const visW = visH * aspect;
                const unitsPerPxX = visW / (view3d.clientWidth || 800);
                const unitsPerPxY = visH / (view3d.clientHeight || 600);

                slot.offsetX += dx * unitsPerPxX;
                slot.offsetY -= dy * unitsPerPxY;

                this.updateSlotTransform(this.activeSlotKey);
                this._syncSlidersFromSlot(slot);
            }
        }, { capture: true });

        window.addEventListener('pointerup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                if (view3d) view3d.style.cursor = this.dragModeActive ? 'grab' : '';
            }
        });

        // Zoom de referencia con Alt + Rueda
        view3d.addEventListener('wheel', (e) => {
            const slot = this.slots[this.activeSlotKey];
            if ((e.altKey || this.dragModeActive) && slot && slot.image && !slot.locked) {
                e.preventDefault();
                e.stopPropagation();
                const delta = e.deltaY < 0 ? 0.05 : -0.05;
                this.adjustScale(this.activeSlotKey, delta);
            }
        }, { passive: false, capture: true });

        // Ajuste fino con teclado (Flechas, +, -, [, ]) cuando el panel de referencia está abierto
        window.addEventListener('keydown', (e) => {
            if (!this.dom.panel || this.dom.panel.style.display === 'none') return;
            const slot = this.slots[this.activeSlotKey];
            if (!slot || !slot.image || slot.locked) return;

            // Ignorar si el foco está en un input de texto
            const target = e.target;
            if (target && (target.tagName === 'INPUT' && target.type !== 'range' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                return;
            }

            const mult = e.shiftKey ? 5 : 1;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.adjustPosX(this.activeSlotKey, -1 * mult);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.adjustPosX(this.activeSlotKey, 1 * mult);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.adjustPosY(this.activeSlotKey, 1 * mult);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.adjustPosY(this.activeSlotKey, -1 * mult);
            } else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                this.adjustScale(this.activeSlotKey, e.shiftKey ? 0.05 : 0.01);
            } else if (e.key === '-' || e.key === '_') {
                e.preventDefault();
                this.adjustScale(this.activeSlotKey, e.shiftKey ? -0.05 : -0.01);
            } else if (e.key === '[' || e.key === '{') {
                e.preventDefault();
                this.adjustRotation(this.activeSlotKey, e.shiftKey ? -2.5 : -0.5);
            } else if (e.key === ']' || e.key === '}') {
                e.preventDefault();
                this.adjustRotation(this.activeSlotKey, e.shiftKey ? 2.5 : 0.5);
            }
        });
    }

    _bindDragAndDrop() {
        const view3d = document.getElementById('view-3d');
        const dropzone = this.dom.dropzone;

        const handleDrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropzone) dropzone.classList.remove('drag-over');

            const files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    this.loadFile(file, this.activeSlotKey);
                    this.openPanel();
                }
            }
        };

        const handleDragOver = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropzone) dropzone.classList.add('drag-over');
        };

        const handleDragLeave = (e) => {
            e.preventDefault();
            if (dropzone) dropzone.classList.remove('drag-over');
        };

        if (view3d) {
            view3d.addEventListener('dragover', handleDragOver);
            view3d.addEventListener('dragleave', handleDragLeave);
            view3d.addEventListener('drop', handleDrop);
        }

        if (dropzone) {
            dropzone.addEventListener('dragover', handleDragOver);
            dropzone.addEventListener('dragleave', handleDragLeave);
            dropzone.addEventListener('drop', handleDrop);
        }
    }

    loadFile(file, slotKey) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            this.setImageDataUrl(slotKey, dataUrl, file.name);
        };
        reader.readAsDataURL(file);
    }

    setImageDataUrl(slotKey, dataUrl, fileName = 'blueprint.png', preserveTransform = false) {
        const slot = this.slots[slotKey];
        if (!slot) return;

        slot.dataUrl = dataUrl;

        const img = new Image();
        img.onload = () => {
            slot.image = img;
            slot.fileName = fileName;
            slot.aspectRatio = img.naturalWidth / img.naturalHeight;

            // Crear textura Three.js
            if (slot.texture) slot.texture.dispose();
            const texture = new THREE.Texture(img);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.needsUpdate = true;
            slot.texture = texture;

            // Crear o actualizar PlaneMesh
            this._buildPlaneMesh(slotKey);

            if (!preserveTransform) {
                this.autoFitToModel(slotKey);
            } else {
                this._applySlotMaterial(slotKey);
                this.updateSlotTransform(slotKey);
                this._syncSlidersFromSlot(slot);
            }

            this._updateUIForSlot(slotKey);
            this.updateVisibility();
            this._updateToolbarButton();

            // Alinear cámara a la vista del slot recién cargado para que el usuario la vea de inmediato (solo carga interactiva)
            if (!preserveTransform && window.setOrthogonalView) {
                window.setOrthogonalView(slotKey);
            }
        };
        img.src = dataUrl;
    }

    clearSlot(slotKey) {
        const slot = this.slots[slotKey];
        if (!slot) return;

        if (slot.planeMesh) {
            this.group.remove(slot.planeMesh);
            if (slot.planeMesh.geometry) slot.planeMesh.geometry.dispose();
            if (slot.planeMesh.material) slot.planeMesh.material.dispose();
            slot.planeMesh = null;
        }
        if (slot.texture) {
            slot.texture.dispose();
            slot.texture = null;
        }
        slot.image = null;
        slot.dataUrl = null;
        slot.fileName = '';
        slot.scale = 1.0;
        slot.offsetX = 0;
        slot.offsetY = 0;
        slot.rotation = 0;
        slot.flipH = false;

        this._updateUIForSlot(slotKey);
        this.updateVisibility();
        this._updateToolbarButton();
    }

    clearAllSlots() {
        Object.keys(this.slots).forEach(key => this.clearSlot(key));
        this.selectSlot('right', false);
        this.updateVisibility();
        this._updateToolbarButton();
    }

    exportData() {
        const result = {
            version: '1.0',
            enabled: this.enabled,
            onlyInOrtho: this.onlyInOrtho,
            activeSlotKey: this.activeSlotKey,
            slots: {}
        };

        let hasAnyImage = false;
        for (const [key, slot] of Object.entries(this.slots)) {
            if (!slot) continue;
            let dataUrl = slot.dataUrl;
            if (!dataUrl && slot.image) {
                if (typeof slot.image.src === 'string' && slot.image.src.startsWith('data:')) {
                    dataUrl = slot.image.src;
                } else if (slot.image.complete && slot.image.naturalWidth) {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = slot.image.naturalWidth;
                        canvas.height = slot.image.naturalHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(slot.image, 0, 0);
                        dataUrl = canvas.toDataURL('image/png');
                    } catch (e) {
                        console.warn(`[ReferenceImageManager] Error exportando canvas para slot ${key}:`, e);
                    }
                }
            }

            if (dataUrl) {
                hasAnyImage = true;
            }

            result.slots[key] = {
                fileName: slot.fileName || '',
                dataUrl: dataUrl || null,
                aspectRatio: slot.aspectRatio,
                opacity: slot.opacity,
                depth: slot.depth,
                scale: slot.scale,
                offsetX: slot.offsetX,
                offsetY: slot.offsetY,
                rotation: slot.rotation,
                flipH: !!slot.flipH,
                visible: !!slot.visible,
                locked: !!slot.locked
            };
        }

        return hasAnyImage ? result : null;
    }

    importData(data) {
        if (!data || !data.slots) return;

        if (typeof data.enabled === 'boolean') this.enabled = data.enabled;
        if (typeof data.onlyInOrtho === 'boolean') {
            this.onlyInOrtho = data.onlyInOrtho;
            if (this.dom.checkOnlyOrtho) this.dom.checkOnlyOrtho.checked = this.onlyInOrtho;
        }
        if (data.activeSlotKey && this.slots[data.activeSlotKey]) {
            this.activeSlotKey = data.activeSlotKey;
        }

        Object.keys(this.slots).forEach(key => {
            const slotData = data.slots[key];
            const slot = this.slots[key];
            if (!slot) return;

            if (slotData && slotData.dataUrl) {
                slot.fileName = slotData.fileName || '';
                slot.aspectRatio = slotData.aspectRatio || 1;
                slot.opacity = (typeof slotData.opacity === 'number') ? slotData.opacity : 0.5;
                slot.depth = slotData.depth || 'front';
                slot.scale = (typeof slotData.scale === 'number') ? slotData.scale : 1.0;
                slot.offsetX = (typeof slotData.offsetX === 'number') ? slotData.offsetX : 0.0;
                slot.offsetY = (typeof slotData.offsetY === 'number') ? slotData.offsetY : 0.0;
                slot.rotation = (typeof slotData.rotation === 'number') ? slotData.rotation : 0.0;
                slot.flipH = !!slotData.flipH;
                slot.visible = (typeof slotData.visible === 'boolean') ? slotData.visible : true;
                slot.locked = !!slotData.locked;

                this.setImageDataUrl(key, slotData.dataUrl, slot.fileName, true);
            } else {
                this.clearSlot(key);
            }
        });

        this.selectSlot(this.activeSlotKey, false);
        this.updateVisibility();
        this._updateToolbarButton();
    }

    _buildPlaneMesh(slotKey) {
        const slot = this.slots[slotKey];
        if (!slot || !slot.texture) return;

        if (slot.planeMesh) {
            this.group.remove(slot.planeMesh);
            if (slot.planeMesh.geometry) slot.planeMesh.geometry.dispose();
            if (slot.planeMesh.material) slot.planeMesh.material.dispose();
        }

        const geo = new THREE.PlaneGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
            map: slot.texture,
            transparent: true,
            opacity: slot.opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: slot.depth === 'back',
            polygonOffset: true,
            polygonOffsetFactor: slot.depth === 'front' ? -10 : 10
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = slot.depth === 'front' ? 999 : -10;
        mesh.userData = { isReferencePlane: true, slotKey };
        slot.planeMesh = mesh;
        this.group.add(mesh);

        this._applySlotMaterial(slotKey);
        this.updateSlotTransform(slotKey);
    }

    _applySlotMaterial(slotKey) {
        const slot = this.slots[slotKey];
        if (!slot || !slot.planeMesh || !slot.planeMesh.material) return;

        const mat = slot.planeMesh.material;
        mat.opacity = slot.opacity;
        mat.depthTest = (slot.depth === 'back');
        mat.polygonOffsetFactor = (slot.depth === 'front') ? -10 : 10;
        slot.planeMesh.renderOrder = (slot.depth === 'front') ? 999 : -10;

        if (mat.map) {
            mat.map.repeat.x = slot.flipH ? -1 : 1;
            mat.map.offset.x = slot.flipH ? 1 : 0;
            mat.map.needsUpdate = true;
        }
        mat.needsUpdate = true;
    }

    autoFitToModel(slotKey) {
        const slot = this.slots[slotKey];
        if (!slot) return;

        let size = new THREE.Vector3(2, 2, 2);
        if (this.state.mesh) {
            const box = new THREE.Box3().setFromObject(this.state.mesh);
            box.getSize(size);
        }

        slot.scale = 1.0;
        slot.offsetX = 0;
        slot.offsetY = 0;
        slot.rotation = 0;

        this.updateSlotTransform(slotKey);
        this._syncSlidersFromSlot(slot);
    }

    updateSlotTransform(slotKey) {
        const slot = this.slots[slotKey];
        if (!slot || !slot.planeMesh) return;

        let center = new THREE.Vector3(0, 0, 0);
        let size = new THREE.Vector3(2, 2, 2);
        if (this.state.mesh) {
            const box = new THREE.Box3().setFromObject(this.state.mesh);
            box.getCenter(center);
            box.getSize(size);
        }

        // Determinar vectores de proyección según la vista canónica
        let normal = new THREE.Vector3(1, 0, 0);
        let screenUp = new THREE.Vector3(0, 1, 0);
        let screenRight = new THREE.Vector3(0, 0, -1);
        let baseSpan = Math.max(0.01, size.z || 2);
        let halfThickness = Math.max(0.005, (size.x || 1) / 2);

        if (slotKey === 'top') {
            normal.set(0, 1, 0);
            screenUp.set(0, 0, -1);
            screenRight.set(1, 0, 0);
            baseSpan = Math.max(0.01, Math.max(size.x, size.z) || 2);
            halfThickness = Math.max(0.005, (size.y || 1) / 2);
        } else if (slotKey === 'front') {
            normal.set(0, 0, 1);
            screenUp.set(0, 1, 0);
            screenRight.set(1, 0, 0);
            baseSpan = Math.max(0.01, Math.max(size.x, size.z) || 2);
            halfThickness = Math.max(0.005, (size.z || 1) / 2);
        } else if (slotKey === 'right') {
            normal.set(1, 0, 0);
            screenUp.set(0, 1, 0);
            screenRight.set(0, 0, -1);
            baseSpan = Math.max(0.01, Math.max(size.z, size.x) || 2);
            halfThickness = Math.max(0.005, (size.x || 1) / 2);
        }

        const width = baseSpan * slot.scale;
        const height = (baseSpan / (slot.aspectRatio || 1)) * slot.scale;

        // Actualizar geometría si cambia de tamaño
        const currentGeo = slot.planeMesh.geometry;
        if (!currentGeo || currentGeo.parameters.width !== width || currentGeo.parameters.height !== height) {
            slot.planeMesh.geometry.dispose();
            slot.planeMesh.geometry = new THREE.PlaneGeometry(width, height);
        }

        // Rotación plana en el espacio de la vista
        const rad = THREE.MathUtils.degToRad(slot.rotation);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const uRot = new THREE.Vector3().copy(screenRight).multiplyScalar(cos).addScaledVector(screenUp, sin);
        const vRot = new THREE.Vector3().copy(screenRight).multiplyScalar(-sin).addScaledVector(screenUp, cos);

        const rotMat = new THREE.Matrix4().makeBasis(uRot, vRot, normal);
        slot.planeMesh.quaternion.setFromRotationMatrix(rotMat);

        // Posición
        const pos = center.clone();
        pos.addScaledVector(uRot, slot.offsetX);
        pos.addScaledVector(vRot, slot.offsetY);

        const clearance = Math.max(0.001, halfThickness * 0.05);
        const depthOffset = (slot.depth === 'front') ? (halfThickness + clearance) : -(halfThickness + clearance);
        pos.addScaledVector(normal, depthOffset);

        slot.planeMesh.position.copy(pos);
    }

    setDepth(slotKey, depth) {
        const slot = this.slots[slotKey];
        if (!slot) return;
        slot.depth = depth;

        if (this.dom.btnDepthBack && this.dom.btnDepthFront) {
            this.dom.btnDepthBack.classList.toggle('active', depth === 'back');
            this.dom.btnDepthFront.classList.toggle('active', depth === 'front');
        }

        this._applySlotMaterial(slotKey);
        this.updateSlotTransform(slotKey);
    }

    adjustOpacity(slotKey, delta) {
        const slot = this.slots[slotKey];
        if (!slot) return;
        slot.opacity = Math.max(0.05, Math.min(1.0, Math.round((slot.opacity + delta) * 100) / 100));
        if (this.dom.sliderOpacity) this.dom.sliderOpacity.value = Math.round(slot.opacity * 100);
        if (this.dom.labelOpacity) this.dom.labelOpacity.textContent = `${Math.round(slot.opacity * 100)}%`;
        this._applySlotMaterial(slotKey);
    }

    adjustScale(slotKey, delta) {
        const slot = this.slots[slotKey];
        if (!slot || slot.locked) return;
        slot.scale = Math.max(0.1, Math.min(4.0, Math.round((slot.scale + delta) * 100) / 100));
        if (this.dom.sliderScale) this.dom.sliderScale.value = Math.round(slot.scale * 100);
        if (this.dom.labelScale) this.dom.labelScale.textContent = `${Math.round(slot.scale * 100)}%`;
        this.updateSlotTransform(slotKey);
    }

    adjustPosX(slotKey, deltaSteps) {
        const slot = this.slots[slotKey];
        if (!slot || slot.locked) return;
        const sensitivity = this._getSensitivity() || 0.02;
        slot.offsetX += deltaSteps * sensitivity;
        this.updateSlotTransform(slotKey);
        this._syncSlidersFromSlot(slot);
    }

    adjustPosY(slotKey, deltaSteps) {
        const slot = this.slots[slotKey];
        if (!slot || slot.locked) return;
        const sensitivity = this._getSensitivity() || 0.02;
        slot.offsetY += deltaSteps * sensitivity;
        this.updateSlotTransform(slotKey);
        this._syncSlidersFromSlot(slot);
    }

    adjustRotation(slotKey, deltaDeg) {
        const slot = this.slots[slotKey];
        if (!slot || slot.locked) return;
        slot.rotation = Math.max(-180, Math.min(180, Math.round((slot.rotation + deltaDeg) * 10) / 10));
        this.updateSlotTransform(slotKey);
        this._syncSlidersFromSlot(slot);
    }

    onViewChanged(viewName, isOrthographic) {
        this.currentView = viewName;
        this.isOrtho = isOrthographic;

        // Auto-seleccionar la pestaña adecuada según la vista presionada en el teclado / UI
        let matchingSlot = null;
        if (viewName === 'right' || viewName === 'left') matchingSlot = 'right';
        else if (viewName === 'top' || viewName === 'bottom') matchingSlot = 'top';
        else if (viewName === 'front' || viewName === 'back') matchingSlot = 'front';

        if (matchingSlot && matchingSlot !== this.activeSlotKey) {
            this.selectSlot(matchingSlot, false);
        }

        this.updateVisibility();
    }

    onModelLoaded(mesh) {
        Object.keys(this.slots).forEach(slotKey => {
            this.updateSlotTransform(slotKey);
        });
        this.updateVisibility();
    }

    updateVisibility() {
        if (!this.enabled) {
            this.group.visible = false;
            this._updateToolbarButton();
            return;
        }

        this.group.visible = true;

        Object.keys(this.slots).forEach(key => {
            const slot = this.slots[key];
            if (!slot.planeMesh) return;

            if (!slot.visible || !slot.image) {
                slot.planeMesh.visible = false;
                return;
            }

            if (this.onlyInOrtho && !this.isOrtho) {
                slot.planeMesh.visible = false;
                return;
            }

            // Mostrar el plano si coincide con la vista activa o si está en ortogonal con el slot activo
            let shouldShow = false;
            if (!this.onlyInOrtho) {
                shouldShow = true;
            } else if (key === 'right' && (this.currentView === 'right' || this.currentView === 'left')) {
                shouldShow = true;
            } else if (key === 'top' && (this.currentView === 'top' || this.currentView === 'bottom')) {
                shouldShow = true;
            } else if (key === 'front' && (this.currentView === 'front' || this.currentView === 'back')) {
                shouldShow = true;
            } else if (this.isOrtho && key === this.activeSlotKey) {
                shouldShow = true;
            }

            slot.planeMesh.visible = shouldShow;
        });

        this._updateToolbarButton();
    }

    selectSlot(slotKey, triggerViewChange = true) {
        if (!this.slots[slotKey]) return;
        this.activeSlotKey = slotKey;

        // Actualizar pestañas DOM
        if (this.dom.tabBtns) {
            this.dom.tabBtns.forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-ref-slot') === slotKey);
            });
        }

        this._updateUIForSlot(slotKey);
        this.updateVisibility();

        // Si se cambia de pestaña, alinear la cámara automáticamente a esa vista
        if (triggerViewChange && window.setOrthogonalView) {
            window.setOrthogonalView(slotKey);
        }
    }

    _updateUIForSlot(slotKey) {
        const slot = this.slots[slotKey];
        if (!slot) return;

        const hasImage = !!slot.image;
        if (this.dom.previewEmpty) this.dom.previewEmpty.style.display = hasImage ? 'none' : 'flex';
        if (this.dom.previewLoaded) this.dom.previewLoaded.style.display = hasImage ? 'flex' : 'none';
        if (this.dom.thumbImg && hasImage) this.dom.thumbImg.src = slot.image.src;
        if (this.dom.fileNameLabel) this.dom.fileNameLabel.textContent = slot.fileName || 'Plano cargado';

        if (this.dom.sliderOpacity) this.dom.sliderOpacity.value = Math.round(slot.opacity * 100);
        if (this.dom.labelOpacity) this.dom.labelOpacity.textContent = `${Math.round(slot.opacity * 100)}%`;

        if (this.dom.btnDepthBack) this.dom.btnDepthBack.classList.toggle('active', slot.depth === 'back');
        if (this.dom.btnDepthFront) this.dom.btnDepthFront.classList.toggle('active', slot.depth === 'front');

        this._syncSlidersFromSlot(slot);

        if (this.dom.btnFlipH) this.dom.btnFlipH.classList.toggle('active', slot.flipH);
        if (this.dom.lockBtn) {
            this.dom.lockBtn.textContent = slot.locked ? '🔒' : '🔓';
            this.dom.lockBtn.classList.toggle('locked', slot.locked);
        }
    }

    _syncSlidersFromSlot(slot) {
        if (this.dom.sliderScale) this.dom.sliderScale.value = Math.round(slot.scale * 100);
        if (this.dom.labelScale) this.dom.labelScale.textContent = `${Math.round(slot.scale * 100)}%`;

        const sensitivity = this._getSensitivity() || 0.02;
        if (this.dom.sliderPosX) this.dom.sliderPosX.value = Math.round(slot.offsetX / sensitivity);
        if (this.dom.sliderPosY) this.dom.sliderPosY.value = Math.round(slot.offsetY / sensitivity);

        if (this.dom.sliderRot) this.dom.sliderRot.value = slot.rotation.toFixed(1);
        if (this.dom.labelRot) this.dom.labelRot.textContent = `${slot.rotation.toFixed(1)}°`;
    }

    _updateToolbarButton() {
        if (!this.dom.toggleBtn) return;
        const hasAnyImage = Object.values(this.slots).some(s => !!s.image);
        this.dom.toggleBtn.classList.toggle('active', this.enabled && hasAnyImage);
        this.dom.toggleBtn.style.color = (this.enabled && hasAnyImage) ? '#00e5ff' : '#bbb';
        this.dom.toggleBtn.textContent = (this.enabled && hasAnyImage) ? '🖼️ Planos: ON' : '🖼️ Planos: OFF';
    }

    togglePanel() {
        if (!this.dom.panel) return;
        const isHidden = this.dom.panel.style.display === 'none' || !this.dom.panel.style.display;
        if (isHidden) {
            this.openPanel();
        } else {
            this.closePanel();
        }
    }

    openPanel() {
        if (!this.dom.panel) return;
        this.dom.panel.style.display = 'flex';
        this.enabled = true;
        this.selectSlot(this.activeSlotKey, false);
        this.updateVisibility();
    }

    closePanel() {
        if (!this.dom.panel) return;
        this.dom.panel.style.display = 'none';
        this.dragModeActive = false;
        if (this.dom.btnDragMode) {
            this.dom.btnDragMode.classList.remove('active');
            this.dom.btnDragMode.textContent = '✋ Arrastrar con Mouse';
        }
        const view3d = document.getElementById('view-3d');
        if (view3d) view3d.style.cursor = '';
    }

    _loadSavedPreferences() {
        // Al arrancar dejamos 'right' por defecto listo
        this.selectSlot('right', false);
    }
}
