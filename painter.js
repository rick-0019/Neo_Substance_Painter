import * as THREE from 'three';

export class Painter {
    constructor(scene, camera, renderer, canvas2d, texture, layerManager = null) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.canvas = canvas2d;
        this.ctx = canvas2d.getContext('2d');
        this.texture = texture;
        this.layerManager = layerManager;
        this.mesh = null;
        
        this.canvasUI = document.getElementById('canvas-ui');
        this.ctxUI = this.canvasUI ? this.canvasUI.getContext('2d') : null;

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.isPainting = false;
        this.isPaintingShape3D = false;
        this.needsUpdate = false;
        this.forceUpdate = false;
        
        // Editor de Formas
        this.editingShape = null; // { type, x1, y1, x2, y2, color, size }
        this.dragMode = null; 
        this.dragOffset = { x: 0, y: 0 };
        this.savedCanvasData = null;

        // Editor de Transformación de Capas (Mover / Escalar / Rotar / Espejar)
        this.transformState = null;

        // Editor de Texto (Ab)
        this.textState = null;

        // Patrón / Textura activa
        this.currentPatternCanvas = null;
        
        // Interpolación
        this.lastU = null;
        this.lastV = null;
        this.lastDrawX = null;
        this.lastDrawY = null;
        
        // Sistema de Undo (Ctrl+Z)
        this.undoStack = [];
        this.maxUndo = 15;
        
        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
                if (e.key === 'Enter' && e.target.id === 'text-input-value') {
                    if (this.textState && this.textState.active) {
                        this.commitText();
                    }
                }
                return;
            }
            if (e.ctrlKey && e.key === 'z') {
                this.undo();
            } else if (e.key === 'Enter') {
                if (this.textState && this.textState.active) {
                    this.commitText();
                } else if (this.transformState && this.transformState.active) {
                    this.commitLayerTransform();
                } else if (this.editingShape) {
                    this.commitShape();
                }
            } else if (e.key === 'Escape') {
                if (this.textState && this.textState.active) {
                    this.cancelText();
                } else if (this.transformState && this.transformState.active) {
                    this.cancelLayerTransform();
                }
            }
        });
        
        this.setupEvents();
        this.setupBrushCursor();
    }

    setLayerManager(lm) {
        this.layerManager = lm;
    }

    getActiveCtx() {
        if (this.layerManager) {
            const layer = this.layerManager.getActiveLayer();
            if (layer) return layer.ctx;
        }
        return this.ctx;
    }

    getActiveCanvas() {
        if (this.layerManager) {
            const layer = this.layerManager.getActiveLayer();
            if (layer) return layer.canvas;
        }
        return this.canvas;
    }

    setMesh(mesh) {
        this.mesh = mesh;
    }
    
    saveUndoState() {
        if (this.undoStack.length >= this.maxUndo) this.undoStack.shift();
        const ctx = this.getActiveCtx();
        const canvas = this.getActiveCanvas();
        this.undoStack.push({
            layerId: this.layerManager ? this.layerManager.activeLayerId : null,
            data: ctx.getImageData(0, 0, canvas.width, canvas.height)
        });
    }

    undo() {
        if (this.transformState && this.transformState.active) {
            this.cancelLayerTransform();
            return;
        }
        if (this.editingShape) this.commitShape();
        if (this.undoStack.length > 0) {
            const lastState = this.undoStack.pop();
            if (this.layerManager && lastState.layerId) {
                const layer = this.layerManager.layers.find(l => l.id === lastState.layerId);
                if (layer) {
                    layer.ctx.putImageData(lastState.data, 0, 0);
                    this.layerManager.recomposite();
                }
            } else if (lastState.data) {
                this.ctx.putImageData(lastState.data, 0, 0);
            } else {
                this.ctx.putImageData(lastState, 0, 0);
            }
            this.needsUpdate = true;
            this.forceUpdate = true;
        }
    }

    setupEvents() {
        const view3d = this.renderer.domElement;
        
        view3d.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (window.decalSystem && (window.decalSystem.isActive || window.decalSystem.isTextMode)) return;
            if (this.editingShape) this.commitShape();
            if (!this.mesh) return; // Must have a mesh loaded
            
            try { view3d.setPointerCapture(e.pointerId); } catch (_) {}
            
            const mode = document.getElementById('brush-mode').value;
            
            if (mode === 'text') {
                const rect = this.renderer.domElement.getBoundingClientRect();
                this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.mesh, true);
                const hit = intersects.find(i => i.object.isMesh && i.uv);
                if (hit) {
                    if (!this.textState || !this.textState.active) {
                        this.startTextTool();
                    }
                    this.textState.x = hit.uv.x * this.canvas.width;
                    this.textState.y = (1 - hit.uv.y) * this.canvas.height;
                    this.renderTextUI();
                }
                return;
            }

            if (mode === 'texture_fill') {
                const rect = this.renderer.domElement.getBoundingClientRect();
                this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.mesh, true);
                const hit = intersects.find(i => i.object.isMesh && i.uv);
                if (hit) {
                    this.saveUndoState();
                    const tiling = parseInt(document.getElementById('texture-scale')?.value || 4, 10);
                    if (hit.face) {
                        this.fillFaceWithPattern(hit.object, hit.face.a, hit.face.b, hit.face.c, this.getActivePatternCanvas(), tiling);
                    } else {
                        this.floodFillTexture(hit.uv.x * this.canvas.width, (1 - hit.uv.y) * this.canvas.height, this.getActivePatternCanvas(), tiling);
                    }
                }
                return;
            }

            if (mode === 'fill' || mode === 'erase_face') {
                const rect = this.renderer.domElement.getBoundingClientRect();
                this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.mesh, true);
                const hit = intersects.find(i => i.object.isMesh && i.uv);
                if (hit) {
                    this.saveUndoState();
                    if (mode === 'fill') {
                        const uv = hit.uv;
                        this.floodFill(uv.x * this.canvas.width, (1 - uv.y) * this.canvas.height, document.getElementById('brush-color').value);
                    } else if (mode === 'erase_face' && hit.face) {
                        const face = hit.face;
                        this.fillFaceByIndex(hit.object, face.a, face.b, face.c, mode);
                    }
                }
                return;
            }

            if (['line', 'rect', 'circle', 'star'].includes(mode)) {
                const rect = this.renderer.domElement.getBoundingClientRect();
                this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.mesh, true);
                const hit = intersects.find(i => i.object.isMesh && i.uv);
                if (hit) {
                    const uv = hit.uv;
                    const x = uv.x * this.canvas.width;
                    const y = (1 - uv.y) * this.canvas.height;
                    
                    this.saveUndoState();
                    this.savedCanvasData = this.getActiveCtx().getImageData(0, 0, this.canvas.width, this.canvas.height);
                    const settings = this.getBrushSettings();
                    this.editingShape = {
                        type: mode,
                        x1: x, y1: y, x2: x, y2: y,
                        color: settings.color,
                        size: settings.size,
                        angle: 0
                    };
                    this.dragMode = 'create';
                    this.isPaintingShape3D = true;
                }
                return;
            }
            
            this.saveUndoState();
            this.isPainting = true;
            this.lastU = null;
            this.lastV = null;
            this.paint3D(e);
            this.needsUpdate = true;
            this.forceUpdate = true;
        });
        
        view3d.addEventListener('pointermove', (e) => {
            if (this.isPainting) this.paint3D(e);
            if (this.isPaintingShape3D && this.editingShape && this.dragMode === 'create') {
                const rect = this.renderer.domElement.getBoundingClientRect();
                this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.camera);
                const intersects = this.raycaster.intersectObject(this.mesh, true);
                const hit = intersects.find(i => i.object.isMesh && i.uv);
                if (hit) {
                    const uv = hit.uv;
                    const curX = uv.x * this.canvas.width;
                    const curY = (1 - uv.y) * this.canvas.height;
                    const dx = curX - this.editingShape.x1;
                    const dy = curY - this.editingShape.y1;

                    if (['circle', 'star'].includes(this.editingShape.type) || e.shiftKey) {
                        const dim = Math.max(Math.abs(dx), Math.abs(dy));
                        this.editingShape.x2 = this.editingShape.x1 + (dx >= 0 ? 1 : -1) * dim;
                        this.editingShape.y2 = this.editingShape.y1 + (dy >= 0 ? 1 : -1) * dim;
                    } else {
                        this.editingShape.x2 = curX;
                        this.editingShape.y2 = curY;
                    }
                    this.renderEditingShape();
                }
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (this.textState && this.textState.active && this.textState.isDragging) {
                const rect = this.canvas.getBoundingClientRect();
                const scaleX = this.canvas.width / rect.width;
                const scaleY = this.canvas.height / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;

                if (this.textState.dragHandle === 'move') {
                    this.textState.x = x - this.textState.dragOffset.x;
                    this.textState.y = y - this.textState.dragOffset.y;
                } else if (this.textState.dragHandle === 'rotate') {
                    const angleRad = Math.atan2(y - this.textState.y, x - this.textState.x) + Math.PI / 2;
                    let deg = Math.round(angleRad * 180 / Math.PI);
                    while (deg > 180) deg -= 360;
                    while (deg < -180) deg += 360;
                    this.textState.rotation = deg;
                    const rotInput = document.getElementById('text-rotation');
                    const rotVal = document.getElementById('text-rot-val');
                    if (rotInput) rotInput.value = deg;
                    if (rotVal) rotVal.textContent = `${deg}°`;
                }
                this.renderTextUI();
                return;
            }

            if (this.transformState && this.transformState.active && this.transformState.isDragging) {
                const rect = this.canvas.getBoundingClientRect();
                const scaleX = this.canvas.width / rect.width;
                const scaleY = this.canvas.height / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;

                const t = this.transformState;
                const h = t.dragHandle;
                const init = t.initialState;

                if (h === 'move') {
                    t.x = x - t.dragOffset.x;
                    t.y = y - t.dragOffset.y;
                } else if (h === 'rotate') {
                    const angle = Math.atan2(y - t.y, x - t.x) + Math.PI / 2;
                    t.rotation = angle;
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

                    t.width = Math.max(10, newHalfW * 2);
                    t.height = Math.max(10, newHalfH * 2);
                } else if (['n', 's'].includes(h)) {
                    const dx = x - init.x;
                    const dy = y - init.y;
                    const cos = Math.cos(-init.rotation);
                    const sin = Math.sin(-init.rotation);
                    const ly = dx * sin + dy * cos;
                    t.height = Math.max(10, Math.abs(ly) * 2);
                } else if (['e', 'w'].includes(h)) {
                    const dx = x - init.x;
                    const dy = y - init.y;
                    const cos = Math.cos(-init.rotation);
                    const sin = Math.sin(-init.rotation);
                    const lx = dx * cos - dy * sin;
                    t.width = Math.max(10, Math.abs(lx) * 2);
                }

                this.updateLiveLayerPreview();
                this.renderTransformUI();
            }
        });
        
        window.addEventListener('pointerup', (e) => {
            try { view3d.releasePointerCapture(e.pointerId); } catch (_) {}
            if (e.button === 0) {
                if (this.isPainting) {
                    this.isPainting = false;
                    this.lastU = null;
                    this.lastV = null;
                    this.lastDrawX = null;
                    this.lastDrawY = null;
                    this.needsUpdate = true;
                    this.forceUpdate = true;
                }
                if (this.isPaintingShape3D) {
                    this.isPaintingShape3D = false;
                    this.dragMode = null;
                    const dx = this.editingShape.x2 - this.editingShape.x1;
                    const dy = this.editingShape.y2 - this.editingShape.y1;
                    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
                        this.editingShape = null;
                        this.getActiveCtx().putImageData(this.savedCanvasData, 0, 0);
                        this.clearUI();
                        if (this.layerManager) this.layerManager.recomposite();
                    } else {
                        this.renderEditingShape();
                    }
                }
                else if (this.editingShape && this.dragMode) {
                    this.dragMode = null;
                    const dx = this.editingShape.x2 - this.editingShape.x1;
                    const dy = this.editingShape.y2 - this.editingShape.y1;
                    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
                        // Descartar figura muy pequeña
                        this.editingShape = null;
                        this.getActiveCtx().putImageData(this.savedCanvasData, 0, 0);
                        this.clearUI();
                        if (this.layerManager) this.layerManager.recomposite();
                    } else {
                        this.renderEditingShape(); // Dibuja los nodos de control
                    }
                }
                if (this.transformState && this.transformState.isDragging) {
                    this.transformState.isDragging = false;
                    this.transformState.dragHandle = null;
                }
                if (this.textState && this.textState.isDragging) {
                    this.textState.isDragging = false;
                    this.textState.dragHandle = null;
                }
            }
        });
        
        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (window.decalSystem && (window.decalSystem.isActive || window.decalSystem.isTextMode)) return;
            
            const rect = this.canvas.getBoundingClientRect();
            // Obtener coordenadas locales al canvas (resolución)
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            
            if (this.transformState && this.transformState.active) {
                const hit = this.hitTestTransform(x, y);
                if (hit) {
                    this.transformState.isDragging = true;
                    this.transformState.dragHandle = hit;
                    this.transformState.dragOffset = { x: x - this.transformState.x, y: y - this.transformState.y };
                    this.transformState.initialState = { ...this.transformState };
                    this.transformState.dragStart = { x, y };
                }
                return;
            }

            const mode = document.getElementById('brush-mode').value;

            if (mode === 'text' || (this.textState && this.textState.active)) {
                if (!this.textState || !this.textState.active) {
                    this.startTextTool();
                }
                const hit = this.hitTestText(x, y);
                if (hit) {
                    this.textState.isDragging = true;
                    this.textState.dragHandle = hit;
                    this.textState.dragOffset = { x: x - this.textState.x, y: y - this.textState.y };
                } else {
                    this.textState.x = x;
                    this.textState.y = y;
                    this.renderTextUI();
                }
                return;
            }

            if (mode === 'texture_fill') {
                this.saveUndoState();
                const tiling = parseInt(document.getElementById('texture-scale')?.value || 4, 10);
                this.floodFillTexture(x, y, this.getActivePatternCanvas(), tiling);
                return;
            }
            
            if (this.editingShape) {
                const hit = this.hitTestShape(x, y);
                if (hit) {
                    this.dragMode = hit;
                    if (hit === 'move') {
                        this.dragOffset.x = x - this.editingShape.x1;
                        this.dragOffset.y = y - this.editingShape.y1;
                    }
                    return; // Estamos editando
                } else {
                    this.commitShape();
                }
            }
            
            if (['line', 'rect', 'circle', 'star'].includes(mode)) {
                this.savedCanvasData = this.getActiveCtx().getImageData(0, 0, this.canvas.width, this.canvas.height);
                const settings = this.getBrushSettings();
                this.editingShape = {
                    type: mode,
                    x1: x, y1: y, x2: x, y2: y,
                    color: settings.color,
                    size: settings.size,
                    angle: 0
                };
                this.dragMode = 'create';
            } else {
                this.saveUndoState();
                
                if (mode === 'fill') {
                    this.floodFill(x, y, document.getElementById('brush-color').value);
                    return;
                }
                
                this.isPainting = true;
                this.lastU = null;
                this.lastV = null;
                this.paint2D(e);
            }
        });
        
        this.canvas.addEventListener('pointermove', (e) => {
            if (window.decalSystem && window.decalSystem.isActive && window.decalSystem.mode === '2d') return;
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            
            if (this.textState && this.textState.active && !this.textState.isDragging) {
                const hit = this.hitTestText(x, y);
                if (hit === 'rotate') this.canvas.style.cursor = 'grab';
                else if (hit === 'move') this.canvas.style.cursor = 'move';
                else this.canvas.style.cursor = 'crosshair';
                return;
            }

            if (this.transformState && this.transformState.active) {
                if (!this.transformState.isDragging) {
                    const hit = this.hitTestTransform(x, y);
                    if (hit === 'rotate') this.canvas.style.cursor = 'grab';
                    else if (hit === 'move') this.canvas.style.cursor = 'move';
                    else if (['nw', 'se'].includes(hit)) this.canvas.style.cursor = 'nwse-resize';
                    else if (['ne', 'sw'].includes(hit)) this.canvas.style.cursor = 'nesw-resize';
                    else if (['n', 's'].includes(hit)) this.canvas.style.cursor = 'ns-resize';
                    else if (['e', 'w'].includes(hit)) this.canvas.style.cursor = 'ew-resize';
                    else this.canvas.style.cursor = 'default';
                    return;
                }

                const t = this.transformState;
                const h = t.dragHandle;
                const init = t.initialState;

                if (h === 'move') {
                    t.x = x - t.dragOffset.x;
                    t.y = y - t.dragOffset.y;
                } else if (h === 'rotate') {
                    const angle = Math.atan2(y - t.y, x - t.x) + Math.PI / 2;
                    t.rotation = angle;
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

                    t.width = Math.max(10, newHalfW * 2);
                    t.height = Math.max(10, newHalfH * 2);
                } else if (['n', 's'].includes(h)) {
                    const dx = x - init.x;
                    const dy = y - init.y;
                    const cos = Math.cos(-init.rotation);
                    const sin = Math.sin(-init.rotation);
                    const ly = dx * sin + dy * cos;
                    t.height = Math.max(10, Math.abs(ly) * 2);
                } else if (['e', 'w'].includes(h)) {
                    const dx = x - init.x;
                    const dy = y - init.y;
                    const cos = Math.cos(-init.rotation);
                    const sin = Math.sin(-init.rotation);
                    const lx = dx * cos - dy * sin;
                    t.width = Math.max(10, Math.abs(lx) * 2);
                }

                this.updateLiveLayerPreview();
                this.renderTransformUI();
                return;
            }

            if (this.editingShape && this.dragMode) {
                const s = this.editingShape;
                if (this.dragMode === 'create') {
                    const dx = x - s.x1;
                    const dy = y - s.y1;
                    if (['circle', 'star'].includes(s.type) || e.shiftKey) {
                        const dim = Math.max(Math.abs(dx), Math.abs(dy));
                        s.x2 = s.x1 + (dx >= 0 ? 1 : -1) * dim;
                        s.y2 = s.y1 + (dy >= 0 ? 1 : -1) * dim;
                    } else {
                        s.x2 = x;
                        s.y2 = y;
                    }
                } else if (this.dragMode === 'rotate') {
                    const cx = (s.x1 + s.x2) / 2;
                    const cy = (s.y1 + s.y2) / 2;
                    s.angle = Math.atan2(y - cy, x - cx) + Math.PI / 2;
                } else if (this.dragMode === 'move') {
                    const w = s.x2 - s.x1;
                    const h = s.y2 - s.y1;
                    s.x1 = x - this.dragOffset.x;
                    s.y1 = y - this.dragOffset.y;
                    s.x2 = s.x1 + w;
                    s.y2 = s.y1 + h;
                } else {
                    const cx = (s.x1 + s.x2) / 2;
                    const cy = (s.y1 + s.y2) / 2;
                    const dx = x - cx;
                    const dy = y - cy;
                    const rx = cx + dx * Math.cos(-s.angle) - dy * Math.sin(-s.angle);
                    const ry = cy + dx * Math.sin(-s.angle) + dy * Math.cos(-s.angle);
                    
                    const isCorner = ['nw', 'ne', 'sw', 'se'].includes(this.dragMode);
                    if (isCorner && !e.altKey && (['circle', 'star'].includes(s.type) || e.shiftKey)) {
                        // Mantener proporción al arrastrar esquinas
                        if (this.dragMode === 'se') {
                            const diffX = rx - s.x1;
                            const diffY = ry - s.y1;
                            const dim = Math.max(Math.abs(diffX), Math.abs(diffY));
                            s.x2 = s.x1 + (diffX >= 0 ? 1 : -1) * dim;
                            s.y2 = s.y1 + (diffY >= 0 ? 1 : -1) * dim;
                        } else if (this.dragMode === 'sw') {
                            const diffX = s.x2 - rx;
                            const diffY = ry - s.y1;
                            const dim = Math.max(Math.abs(diffX), Math.abs(diffY));
                            s.x1 = s.x2 - (diffX >= 0 ? 1 : -1) * dim;
                            s.y2 = s.y1 + (diffY >= 0 ? 1 : -1) * dim;
                        } else if (this.dragMode === 'ne') {
                            const diffX = rx - s.x1;
                            const diffY = s.y2 - ry;
                            const dim = Math.max(Math.abs(diffX), Math.abs(diffY));
                            s.x2 = s.x1 + (diffX >= 0 ? 1 : -1) * dim;
                            s.y1 = s.y2 - (diffY >= 0 ? 1 : -1) * dim;
                        } else if (this.dragMode === 'nw') {
                            const diffX = s.x2 - rx;
                            const diffY = s.y2 - ry;
                            const dim = Math.max(Math.abs(diffX), Math.abs(diffY));
                            s.x1 = s.x2 - (diffX >= 0 ? 1 : -1) * dim;
                            s.y1 = s.y2 - (diffY >= 0 ? 1 : -1) * dim;
                        }
                    } else {
                        // Deformación libre: los nodos n, s, w, e permiten estirar o comprimir
                        if (this.dragMode.includes('n')) s.y1 = ry;
                        if (this.dragMode.includes('s')) s.y2 = ry;
                        if (this.dragMode.includes('w')) s.x1 = rx;
                        if (this.dragMode.includes('e')) s.x2 = rx;
                    }
                }
                this.renderEditingShape();
                return;
            }
            
            // Cursor icon
            if (this.editingShape) {
                const hit = this.hitTestShape(x, y);
                if (hit === 'rotate') this.canvas.style.cursor = 'grab';
                else if (hit === 'move') this.canvas.style.cursor = 'move';
                else if (hit) this.canvas.style.cursor = 'crosshair'; // TODO: flechas
                else this.canvas.style.cursor = 'default';
            } else {
                const curMode = document.getElementById('brush-mode')?.value;
                if (['paint', 'erase'].includes(curMode)) {
                    this.canvas.style.cursor = 'none';
                } else {
                    this.canvas.style.cursor = 'crosshair';
                }
            }
            
            if (this.isPainting) {
                this.paint2D(e);
            }
        });
    }

    // --- Lógica del Bounding Box (Mover/Escalar Formas) ---
    clearUI() {
        if (this.ctxUI) {
            this.ctxUI.clearRect(0, 0, this.canvasUI.width, this.canvasUI.height);
            this.uiNeedsUpdate = true;
        }
    }
    
    commitShape() {
        this.editingShape = null;
        this.dragMode = null;
        this.clearUI();
        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        this.needsUpdate = true;
        this.forceUpdate = true;
    }
    
    hitTestShape(x, y) {
        const s = this.editingShape;
        const cx = (s.x1 + s.x2) / 2;
        const cy = (s.y1 + s.y2) / 2;
        
        const dx = x - cx;
        const dy = y - cy;
        const rx = cx + dx * Math.cos(-s.angle) - dy * Math.sin(-s.angle);
        const ry = cy + dx * Math.sin(-s.angle) + dy * Math.cos(-s.angle);
        
        const minX = Math.min(s.x1, s.x2);
        const maxX = Math.max(s.x1, s.x2);
        const minY = Math.min(s.y1, s.y2);
        const maxY = Math.max(s.y1, s.y2);
        
        // El polo de rotación
        const rotateDist = Math.hypot(rx - cx, ry - (minY - 40));
        if (rotateDist < 30) return 'rotate';
        
        // Evaluar distancia a cada nodo
        const handles = [
            { id: 'nw', x: minX, y: minY },
            { id: 'ne', x: maxX, y: minY },
            { id: 'sw', x: minX, y: maxY },
            { id: 'se', x: maxX, y: maxY },
            { id: 'n', x: cx, y: minY },
            { id: 's', x: cx, y: maxY },
            { id: 'w', x: minX, y: cy },
            { id: 'e', x: maxX, y: cy }
        ];
        
        let closestHandle = null;
        let minDist = Infinity;
        for (let h of handles) {
            const d = Math.hypot(rx - h.x, ry - h.y);
            if (d < minDist) {
                minDist = d;
                closestHandle = h.id;
            }
        }
        
        const maxDim = Math.max(maxX - minX, maxY - minY);
        const grabRadius = Math.max(12, Math.min(30, maxDim / 3)); // Radio adaptativo
        
        if (minDist < grabRadius) {
            const distToCenter = Math.hypot(rx - cx, ry - cy);
            // Si la figura es enana y tocamos más cerca del centro que del nodo, asume Mover
            if (distToCenter < minDist) {
                return 'move';
            }
            return closestHandle;
        }
        
        // Si no tocó nodos, pero está dentro del cuadro
        if (rx >= minX && rx <= maxX && ry >= minY && ry <= maxY) return 'move';
        
        return null;
    }

    renderEditingShape() {
        if (!this.editingShape) return;
        const s = this.editingShape;
        const activeCtx = this.getActiveCtx();
        activeCtx.putImageData(this.savedCanvasData, 0, 0);
        this.clearUI();
        
        const cx = (s.x1 + s.x2) / 2;
        const cy = (s.y1 + s.y2) / 2;
        
        activeCtx.save();
        activeCtx.translate(cx, cy);
        activeCtx.rotate(s.angle);
        activeCtx.translate(-cx, -cy);
        
        activeCtx.lineWidth = s.size * 2;
        activeCtx.lineCap = 'round';
        activeCtx.lineJoin = 'round';
        activeCtx.strokeStyle = s.color;
        activeCtx.fillStyle = s.color;
        
        activeCtx.beginPath();
        if (s.type === 'line') {
            activeCtx.moveTo(s.x1, s.y1);
            activeCtx.lineTo(s.x2, s.y2);
            activeCtx.stroke();
        } else if (s.type === 'rect') {
            const minX = Math.min(s.x1, s.x2);
            const minY = Math.min(s.y1, s.y2);
            activeCtx.rect(minX, minY, Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
            activeCtx.stroke();
        } else if (s.type === 'circle') {
            const rx = Math.abs(s.x2 - s.x1) / 2;
            const ry = Math.abs(s.y2 - s.y1) / 2;
            activeCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            activeCtx.stroke();
        } else if (s.type === 'star') {
            const rx = Math.abs(s.x2 - s.x1) / 2;
            const ry = Math.abs(s.y2 - s.y1) / 2;
            const spikes = 5;
            let rot = Math.PI / 2 * 3;
            let step = Math.PI / spikes;
            activeCtx.moveTo(cx, cy - ry);
            for (let i = 0; i < spikes; i++) {
                activeCtx.lineTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * ry);
                rot += step;
                activeCtx.lineTo(cx + Math.cos(rot) * (rx * 0.4), cy + Math.sin(rot) * (ry * 0.4));
                rot += step;
            }
            activeCtx.lineTo(cx, cy - ry);
            activeCtx.closePath();
            activeCtx.stroke();
        }
        
        activeCtx.restore();
        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        this.needsUpdate = true;
        
        // Dibujar nodos de control en UI
        if (!this.dragMode && this.ctxUI) {
            this.ctxUI.save();
            this.ctxUI.translate(cx, cy);
            this.ctxUI.rotate(s.angle);
            this.ctxUI.translate(-cx, -cy);
            
            const minX = Math.min(s.x1, s.x2);
            const maxX = Math.max(s.x1, s.x2);
            const minY = Math.min(s.y1, s.y2);
            const maxY = Math.max(s.y1, s.y2);
            
            this.ctxUI.strokeStyle = '#0078d7';
            this.ctxUI.setLineDash([5, 5]);
            this.ctxUI.lineWidth = 2;
            this.ctxUI.strokeRect(minX, minY, maxX - minX, maxY - minY);
            this.ctxUI.setLineDash([]);
            
            const maxDim = Math.max(maxX - minX, maxY - minY);
            const handleRadius = Math.max(4, Math.min(8, maxDim / 10));
            
            const drawHandle = (x, y, isRotate = false) => {
                this.ctxUI.fillStyle = isRotate ? '#00e5ff' : '#fff';
                this.ctxUI.strokeStyle = '#0078d7';
                this.ctxUI.lineWidth = 2;
                if (isRotate) {
                    this.ctxUI.beginPath();
                    this.ctxUI.arc(x, y, handleRadius, 0, Math.PI*2);
                    this.ctxUI.fill();
                    this.ctxUI.stroke();
                } else {
                    this.ctxUI.fillRect(x - handleRadius, y - handleRadius, handleRadius * 2, handleRadius * 2);
                    this.ctxUI.strokeRect(x - handleRadius, y - handleRadius, handleRadius * 2, handleRadius * 2);
                }
            };
            
            const midX = (minX + maxX) / 2;
            const midY = (minY + maxY) / 2;
            drawHandle(minX, minY); drawHandle(midX, minY); drawHandle(maxX, minY);
            drawHandle(minX, midY);                         drawHandle(maxX, midY);
            drawHandle(minX, maxY); drawHandle(midX, maxY); drawHandle(maxX, maxY);
            
            // Palo de rotación
            this.ctxUI.beginPath();
            this.ctxUI.moveTo(midX, minY);
            this.ctxUI.lineTo(midX, minY - 40);
            this.ctxUI.stroke();
            drawHandle(midX, minY - 40, true);
            
            this.ctxUI.restore();
        }
        this.uiNeedsUpdate = true;
    }

    // --- Transformación de Capas (Mover / Escalar / Rotar / Espejar) ---

    startLayerTransform() {
        if (!this.layerManager) return;
        const activeLayer = this.layerManager.getActiveLayer();
        if (!activeLayer) return;

        if (activeLayer.isBackground) {
            alert('La capa de Fondo no se puede mover. Selecciona una capa de dibujo o duplica una capa.');
            return;
        }

        if (this.transformState && this.transformState.active) {
            this.commitLayerTransform();
        }

        const bbox = this.layerManager.getLayerBoundingBox(activeLayer);
        if (!bbox) {
            alert('La capa seleccionada está vacía.');
            return;
        }

        const originalData = activeLayer.ctx.getImageData(0, 0, activeLayer.width, activeLayer.height);

        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = bbox.width;
        sourceCanvas.height = bbox.height;
        const sCtx = sourceCanvas.getContext('2d');
        sCtx.drawImage(
            activeLayer.canvas,
            bbox.x, bbox.y, bbox.width, bbox.height,
            0, 0, bbox.width, bbox.height
        );

        // Limpiar la capa para la previsualización interactiva en tiempo real
        activeLayer.ctx.clearRect(0, 0, activeLayer.width, activeLayer.height);

        this.transformState = {
            active: true,
            layerId: activeLayer.id,
            sourceCanvas: sourceCanvas,
            originalLayerData: originalData,
            x: bbox.x + bbox.width / 2,
            y: bbox.y + bbox.height / 2,
            width: bbox.width,
            height: bbox.height,
            baseWidth: bbox.width,
            baseHeight: bbox.height,
            rotation: 0,
            flipH: false,
            flipV: false,
            isDragging: false,
            dragHandle: null,
            dragOffset: { x: 0, y: 0 },
            initialState: null
        };

        const controls = document.getElementById('transform-controls');
        if (controls) controls.style.display = 'flex';

        this.updateLiveLayerPreview();
        this.renderTransformUI();
    }

    updateLiveLayerPreview() {
        if (!this.transformState || !this.transformState.active || !this.layerManager) return;
        const t = this.transformState;
        const layer = this.layerManager.layers.find(l => l.id === t.layerId);
        if (!layer) return;

        const ctx = layer.ctx;
        ctx.clearRect(0, 0, layer.width, layer.height);

        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(t.rotation);
        ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1);
        ctx.drawImage(t.sourceCanvas, -t.width / 2, -t.height / 2, t.width, t.height);
        ctx.restore();

        this.layerManager.recomposite();
        this.needsUpdate = true;
        this.forceUpdate = true;
        if (this.texture) this.texture.needsUpdate = true;
    }

    renderTransformUI() {
        if (!this.transformState || !this.transformState.active || !this.ctxUI) return;
        this.clearUI();

        const t = this.transformState;
        const ctx = this.ctxUI;
        const halfW = t.width / 2;
        const halfH = t.height / 2;

        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(t.rotation);

        // 1. Marco delimitador punteado
        ctx.strokeStyle = '#00a2ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.strokeRect(-halfW, -halfH, t.width, t.height);
        ctx.setLineDash([]);

        // 2. Tiradores
        const maxDim = Math.max(t.width, t.height);
        const handleRadius = Math.max(6, Math.min(12, maxDim / 15));

        const drawHandle = (hx, hy, isRotate = false, isEdge = false) => {
            ctx.fillStyle = isRotate ? '#00e5ff' : (isEdge ? '#ffffff' : '#00a2ff');
            ctx.strokeStyle = isRotate ? '#0078d7' : (isEdge ? '#00a2ff' : '#ffffff');
            ctx.lineWidth = 2;
            if (isRotate) {
                ctx.beginPath();
                ctx.arc(hx, hy, handleRadius + 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillRect(hx - handleRadius, hy - handleRadius, handleRadius * 2, handleRadius * 2);
                ctx.strokeRect(hx - handleRadius, hy - handleRadius, handleRadius * 2, handleRadius * 2);
            }
        };

        // Esquinas (escala proporcional)
        drawHandle(-halfW, -halfH);
        drawHandle( halfW, -halfH);
        drawHandle(-halfW,  halfH);
        drawHandle( halfW,  halfH);

        // Bordes (ajuste de ancho o alto)
        drawHandle(0, -halfH, false, true);
        drawHandle(0,  halfH, false, true);
        drawHandle(-halfW, 0, false, true);
        drawHandle( halfW, 0, false, true);

        // Mástil y tirador de rotación
        const stemLength = Math.max(30, handleRadius * 3);
        ctx.beginPath();
        ctx.moveTo(0, -halfH);
        ctx.lineTo(0, -halfH - stemLength);
        ctx.strokeStyle = '#00a2ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        drawHandle(0, -halfH - stemLength, true);

        ctx.restore();
    }

    hitTestTransform(canvasX, canvasY) {
        if (!this.transformState || !this.transformState.active) return null;

        const t = this.transformState;
        const dx = canvasX - t.x;
        const dy = canvasY - t.y;
        const cos = Math.cos(-t.rotation);
        const sin = Math.sin(-t.rotation);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;

        const halfW = t.width / 2;
        const halfH = t.height / 2;
        const maxDim = Math.max(t.width, t.height);
        const handleRadius = Math.max(6, Math.min(12, maxDim / 15));
        const tol = Math.max(14, handleRadius + 6);
        const stemLength = Math.max(30, handleRadius * 3);

        // 1. Nodo de rotación
        if (Math.hypot(lx, ly - (-halfH - stemLength)) <= tol) {
            return 'rotate';
        }

        // 2. Esquinas (nw, ne, sw, se)
        if (Math.abs(lx - (-halfW)) <= tol && Math.abs(ly - (-halfH)) <= tol) return 'nw';
        if (Math.abs(lx - ( halfW)) <= tol && Math.abs(ly - (-halfH)) <= tol) return 'ne';
        if (Math.abs(lx - (-halfW)) <= tol && Math.abs(ly - ( halfH)) <= tol) return 'sw';
        if (Math.abs(lx - ( halfW)) <= tol && Math.abs(ly - ( halfH)) <= tol) return 'se';

        // 3. Bordes (n, s, w, e)
        if (Math.abs(lx - 0) <= tol && Math.abs(ly - (-halfH)) <= tol) return 'n';
        if (Math.abs(lx - 0) <= tol && Math.abs(ly - ( halfH)) <= tol) return 's';
        if (Math.abs(lx - (-halfW)) <= tol && Math.abs(ly - 0) <= tol) return 'w';
        if (Math.abs(lx - ( halfW)) <= tol && Math.abs(ly - 0) <= tol) return 'e';

        // 4. Interior (mover)
        if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
            return 'move';
        }

        return null;
    }

    flipTransformH() {
        if (!this.transformState || !this.transformState.active) return;
        this.transformState.flipH = !this.transformState.flipH;
        this.updateLiveLayerPreview();
        this.renderTransformUI();
    }

    flipTransformV() {
        if (!this.transformState || !this.transformState.active) return;
        this.transformState.flipV = !this.transformState.flipV;
        this.updateLiveLayerPreview();
        this.renderTransformUI();
    }

    commitLayerTransform() {
        if (!this.transformState || !this.transformState.active) return;
        const t = this.transformState;

        // Guardar estado en pila de Deshacer
        if (this.undoStack.length >= this.maxUndo) this.undoStack.shift();
        this.undoStack.push({
            layerId: t.layerId,
            data: t.originalLayerData
        });

        this.updateLiveLayerPreview();

        this.transformState = null;
        this.clearUI();
        const controls = document.getElementById('transform-controls');
        if (controls) controls.style.display = 'none';
        this.canvas.style.cursor = 'default';
    }

    cancelLayerTransform() {
        if (!this.transformState || !this.transformState.active) return;
        const t = this.transformState;
        const layer = this.layerManager ? this.layerManager.layers.find(l => l.id === t.layerId) : null;
        if (layer && t.originalLayerData) {
            layer.ctx.putImageData(t.originalLayerData, 0, 0);
            if (this.layerManager) this.layerManager.recomposite();
            this.needsUpdate = true;
            this.forceUpdate = true;
            if (this.texture) this.texture.needsUpdate = true;
        }

        this.transformState = null;
        this.clearUI();
        const controls = document.getElementById('transform-controls');
        if (controls) controls.style.display = 'none';
        this.canvas.style.cursor = 'default';
    }

    // --- Modo Texto (Ab) ---

    startTextTool() {
        const textVal = document.getElementById('text-input-value')?.value || 'TEXTO';
        const fontFamily = document.getElementById('text-font-family')?.value || 'Arial';
        const fontSize = parseInt(document.getElementById('text-font-size')?.value || 64, 10);
        const rotation = parseInt(document.getElementById('text-rotation')?.value || 0, 10);
        const isBold = document.getElementById('btn-text-bold')?.classList.contains('active') ?? true;
        const isItalic = document.getElementById('btn-text-italic')?.classList.contains('active') ?? false;
        const color = document.getElementById('brush-color')?.value || '#ff0000';

        if (!this.textState || !this.textState.active) {
            this.textState = {
                active: true,
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                text: textVal,
                fontFamily: fontFamily,
                fontSize: fontSize,
                rotation: rotation,
                isBold: isBold,
                isItalic: isItalic,
                color: color,
                isDragging: false,
                dragHandle: null,
                dragOffset: { x: 0, y: 0 }
            };
        } else {
            this.textState.text = textVal;
            this.textState.fontFamily = fontFamily;
            this.textState.fontSize = fontSize;
            this.textState.rotation = rotation;
            this.textState.isBold = isBold;
            this.textState.isItalic = isItalic;
            this.textState.color = color;
        }

        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'flex';

        this.renderTextUI();
    }

    updateTextSettings(opts = {}) {
        if (!this.textState) return;
        Object.assign(this.textState, opts);
        this.renderTextUI();
    }

    renderTextUI() {
        if (!this.textState || !this.textState.active || !this.ctxUI) return;
        this.clearUI();

        const s = this.textState;
        const ctx = this.ctxUI;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rotation * Math.PI / 180);

        let fontStyle = '';
        if (s.isItalic) fontStyle += 'italic ';
        if (s.isBold) fontStyle += 'bold ';
        ctx.font = `${fontStyle}${s.fontSize}px "${s.fontFamily}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Medir ancho para cuadro delimitador
        const metrics = ctx.measureText(s.text);
        const w = Math.max(20, metrics.width);
        const h = Math.max(16, s.fontSize * 1.15);
        s.boxWidth = w;
        s.boxHeight = h;

        // Cuadro delimitador interactivo
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(-w / 2 - 8, -h / 2 - 4, w + 16, h + 8);
        ctx.setLineDash([]);

        // Mástil y asa de rotación
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 - 4);
        ctx.lineTo(0, -h / 2 - 28);
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, -h / 2 - 28, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#00f3ff';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Texto renderizado
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, 0, 0);

        ctx.restore();
        this.uiNeedsUpdate = true;
    }

    hitTestText(canvasX, canvasY) {
        if (!this.textState || !this.textState.active) return null;
        const s = this.textState;
        const dx = canvasX - s.x;
        const dy = canvasY - s.y;
        const rad = -s.rotation * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;

        const w = s.boxWidth || 100;
        const h = s.boxHeight || 40;

        // Asa de rotación
        if (Math.hypot(lx, ly - (-h / 2 - 28)) <= 16) {
            return 'rotate';
        }

        // Dentro del cuadro de texto (mover)
        if (Math.abs(lx) <= w / 2 + 16 && Math.abs(ly) <= h / 2 + 12) {
            return 'move';
        }

        return null;
    }

    commitText() {
        if (!this.textState || !this.textState.active) return;
        const s = this.textState;
        const activeCtx = this.getActiveCtx();

        this.saveUndoState();

        activeCtx.save();
        activeCtx.translate(s.x, s.y);
        activeCtx.rotate(s.rotation * Math.PI / 180);

        let fontStyle = '';
        if (s.isItalic) fontStyle += 'italic ';
        if (s.isBold) fontStyle += 'bold ';
        activeCtx.font = `${fontStyle}${s.fontSize}px "${s.fontFamily}", sans-serif`;
        activeCtx.textAlign = 'center';
        activeCtx.textBaseline = 'middle';
        activeCtx.fillStyle = s.color;
        activeCtx.fillText(s.text, 0, 0);
        activeCtx.restore();

        this.textState.active = false;
        this.clearUI();
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'none';

        if (this.layerManager) this.layerManager.recomposite();
        this.needsUpdate = true;
        this.forceUpdate = true;
        if (this.texture) this.texture.needsUpdate = true;
    }

    cancelText() {
        if (!this.textState) return;
        this.textState.active = false;
        this.clearUI();
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'none';
        this.canvas.style.cursor = 'default';
    }

    // --- Generador de Texturas y Patrones Repetibles ---

    static createProceduralPattern(type, customImg = null) {
        if (type === 'custom' && customImg) {
            return customImg;
        }

        const patCanvas = document.createElement('canvas');
        patCanvas.width = 256;
        patCanvas.height = 256;
        const pctx = patCanvas.getContext('2d');

        if (type === 'brick') {
            // Ladrillo a la vista con juntas de mortero
            pctx.fillStyle = '#b5ad9e'; // Mortero
            pctx.fillRect(0, 0, 256, 256);

            const rowH = 32;
            const brickW = 64;
            const mortar = 3;
            const colors = ['#9c3422', '#a83c27', '#8e2e1d', '#b3432d', '#99301f'];

            for (let y = 0; y < 256; y += rowH) {
                const rowIndex = Math.floor(y / rowH);
                const offsetX = (rowIndex % 2 === 1) ? brickW / 2 : 0;
                for (let x = -brickW; x < 256 + brickW; x += brickW) {
                    const bx = x + offsetX + mortar;
                    const by = y + mortar;
                    const bw = brickW - mortar * 2;
                    const bh = rowH - mortar * 2;

                    // Color de ladrillo con variación sutil
                    const cIdx = Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * colors.length | 0;
                    pctx.fillStyle = colors[cIdx % colors.length];
                    pctx.fillRect(bx, by, bw, bh);

                    // Sombra y bisel 3D suave en ladrillos
                    pctx.fillStyle = 'rgba(255,255,255,0.12)';
                    pctx.fillRect(bx, by, bw, 2);
                    pctx.fillRect(bx, by, 2, bh);
                    pctx.fillStyle = 'rgba(0,0,0,0.2)';
                    pctx.fillRect(bx, by + bh - 2, bw, 2);
                    pctx.fillRect(bx + bw - 2, by, 2, bh);
                }
            }
        } else if (type === 'camo_woodland') {
            // Camuflaje Militar Bosque
            pctx.fillStyle = '#4b552b'; // Verde base oliva
            pctx.fillRect(0, 0, 256, 256);

            const drawBlobs = (color, count, minR, maxR) => {
                pctx.fillStyle = color;
                for (let i = 0; i < count; i++) {
                    const cx = ((i * 73 + 29) % 256);
                    const cy = ((i * 127 + 53) % 256);
                    const r = minR + ((i * 37) % (maxR - minR));

                    const offsets = [
                        [0, 0], [256, 0], [-256, 0], [0, 256], [0, -256],
                        [256, 256], [-256, -256], [256, -256], [-256, 256]
                    ];
                    offsets.forEach(([ox, oy]) => {
                        pctx.beginPath();
                        pctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
                        pctx.arc(cx + ox + r * 0.5, cy + oy - r * 0.3, r * 0.7, 0, Math.PI * 2);
                        pctx.arc(cx + ox - r * 0.4, cy + oy + r * 0.4, r * 0.6, 0, Math.PI * 2);
                        pctx.fill();
                    });
                }
            };

            drawBlobs('#2a3818', 7, 30, 65); // Verde oscuro militar
            drawBlobs('#523d24', 6, 25, 55); // Marrón tierra
            drawBlobs('#191919', 5, 20, 45); // Negro carbón
        } else if (type === 'camo_desert') {
            // Camuflaje Desierto
            pctx.fillStyle = '#d8be93'; // Tan arena base
            pctx.fillRect(0, 0, 256, 256);

            const drawBlobs = (color, count, minR, maxR) => {
                pctx.fillStyle = color;
                for (let i = 0; i < count; i++) {
                    const cx = ((i * 83 + 41) % 256);
                    const cy = ((i * 139 + 67) % 256);
                    const r = minR + ((i * 31) % (maxR - minR));
                    const offsets = [
                        [0, 0], [256, 0], [-256, 0], [0, 256], [0, -256],
                        [256, 256], [-256, -256], [256, -256], [-256, 256]
                    ];
                    offsets.forEach(([ox, oy]) => {
                        pctx.beginPath();
                        pctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
                        pctx.arc(cx + ox + r * 0.4, cy + oy + r * 0.4, r * 0.65, 0, Math.PI * 2);
                        pctx.fill();
                    });
                }
            };

            drawBlobs('#be9965', 7, 30, 60); // Ocre arena
            drawBlobs('#825d36', 5, 22, 45); // Marrón arcilla
            drawBlobs('#efe1c6', 6, 25, 50); // Arena clara
        } else if (type === 'metal_plates') {
            // Planchas de acero remachadas
            pctx.fillStyle = '#7a8288';
            pctx.fillRect(0, 0, 256, 256);

            const pSize = 128;
            for (let py = 0; py < 256; py += pSize) {
                for (let px = 0; px < 256; px += pSize) {
                    const grad = pctx.createLinearGradient(px, py, px + pSize, py + pSize);
                    grad.addColorStop(0, '#8c959b');
                    grad.addColorStop(1, '#6c7379');
                    pctx.fillStyle = grad;
                    pctx.fillRect(px + 2, py + 2, pSize - 4, pSize - 4);

                    pctx.fillStyle = '#3a3e42';
                    pctx.fillRect(px, py, pSize, 2);
                    pctx.fillRect(px, py, 2, pSize);
                    pctx.fillStyle = '#a6b0b8';
                    pctx.fillRect(px + 2, py + 2, pSize - 2, 1);
                    pctx.fillRect(px + 2, py + 2, 1, pSize - 2);

                    const rivetCoords = [
                        [px + 14, py + 14], [px + pSize / 2, py + 14], [px + pSize - 14, py + 14],
                        [px + 14, py + pSize - 14], [px + pSize / 2, py + pSize - 14], [px + pSize - 14, py + pSize - 14],
                        [px + 14, py + pSize / 2], [px + pSize - 14, py + pSize / 2]
                    ];
                    rivetCoords.forEach(([rx, ry]) => {
                        pctx.beginPath();
                        pctx.arc(rx, ry, 3.5, 0, Math.PI * 2);
                        pctx.fillStyle = '#222';
                        pctx.fill();
                        pctx.beginPath();
                        pctx.arc(rx - 0.7, ry - 0.7, 2.8, 0, Math.PI * 2);
                        pctx.fillStyle = '#9aa3ab';
                        pctx.fill();
                        pctx.beginPath();
                        pctx.arc(rx - 1.2, ry - 1.2, 1, 0, Math.PI * 2);
                        pctx.fillStyle = '#ffffff';
                        pctx.fill();
                    });
                }
            }
        } else if (type === 'wood') {
            // Vetas de madera
            pctx.fillStyle = '#9e6231';
            pctx.fillRect(0, 0, 256, 256);

            const plankH = 64;
            for (let y = 0; y < 256; y += plankH) {
                pctx.fillStyle = '#3e1e07';
                pctx.fillRect(0, y, 256, 3);
                pctx.fillStyle = '#bd7e47';
                pctx.fillRect(0, y + 3, 256, 1);

                for (let i = 0; i < 18; i++) {
                    const vy = y + (i * plankH / 18);
                    pctx.strokeStyle = (i % 2 === 0) ? 'rgba(70, 32, 10, 0.4)' : 'rgba(195, 134, 78, 0.3)';
                    pctx.lineWidth = 1 + (i % 3);
                    pctx.beginPath();
                    for (let x = 0; x <= 256; x += 16) {
                        const wave = Math.sin((x / 256) * Math.PI * 2 * 2 + i) * 3 + Math.cos((x / 256) * Math.PI * 2 + i * 2) * 2;
                        if (x === 0) pctx.moveTo(x, vy + wave);
                        else pctx.lineTo(x, vy + wave);
                    }
                    pctx.stroke();
                }
            }
        } else if (type === 'carbon') {
            // Fibra de carbono 2x2
            pctx.fillStyle = '#111111';
            pctx.fillRect(0, 0, 256, 256);

            const cSize = 16;
            for (let y = 0; y < 256; y += cSize) {
                for (let x = 0; x < 256; x += cSize) {
                    const isEven = ((x / cSize + y / cSize) % 2 === 0);
                    const grad = pctx.createLinearGradient(x, y, x + cSize, y + cSize);
                    if (isEven) {
                        grad.addColorStop(0, '#2b2b2b');
                        grad.addColorStop(0.5, '#444444');
                        grad.addColorStop(1, '#1a1a1a');
                    } else {
                        grad.addColorStop(0, '#161616');
                        grad.addColorStop(0.5, '#282828');
                        grad.addColorStop(1, '#111111');
                    }
                    pctx.fillStyle = grad;
                    pctx.fillRect(x, y, cSize, cSize);
                    pctx.strokeStyle = '#0a0a0a';
                    pctx.lineWidth = 0.5;
                    pctx.strokeRect(x, y, cSize, cSize);
                }
            }
        }

        return patCanvas;
    }

    getActivePatternCanvas() {
        if (this.currentPatternCanvas) return this.currentPatternCanvas;
        this.currentPatternCanvas = Painter.createProceduralPattern('brick');
        return this.currentPatternCanvas;
    }

    setPattern(canvasOrImg) {
        this.currentPatternCanvas = canvasOrImg;
    }

    fillLayerWithPattern(patternCanvas, tiling = 4) {
        if (!this.layerManager) return;
        const activeLayer = this.layerManager.getActiveLayer();
        if (!activeLayer) return;

        this.saveUndoState();
        const ctx = activeLayer.ctx;
        const patCanvas = document.createElement('canvas');
        const patSize = Math.max(16, Math.floor(activeLayer.width / tiling));
        patCanvas.width = patSize;
        patCanvas.height = patSize;
        const pCtx = patCanvas.getContext('2d');
        pCtx.drawImage(patternCanvas, 0, 0, patSize, patSize);

        const pattern = ctx.createPattern(patCanvas, 'repeat');
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, activeLayer.width, activeLayer.height);

        this.layerManager.recomposite();
        this.needsUpdate = true;
        this.forceUpdate = true;
        if (this.texture) this.texture.needsUpdate = true;
    }

    fillFaceWithPattern(meshObj, a, b, c, patternCanvas, tiling = 4) {
        const targetMesh = (meshObj && meshObj.geometry) ? meshObj : (this.mesh && this.mesh.geometry ? this.mesh : null);
        if (!targetMesh || !targetMesh.geometry || !targetMesh.geometry.attributes || !targetMesh.geometry.attributes.uv) return;
        const uvs = targetMesh.geometry.attributes.uv;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const uA = uvs.getX(a) * w, vA = (1 - uvs.getY(a)) * h;
        const uB = uvs.getX(b) * w, vB = (1 - uvs.getY(b)) * h;
        const uC = uvs.getX(c) * w, vC = (1 - uvs.getY(c)) * h;

        const activeCtx = this.getActiveCtx();
        const patCanvas = document.createElement('canvas');
        const patSize = Math.max(16, Math.floor(w / tiling));
        patCanvas.width = patSize;
        patCanvas.height = patSize;
        const pCtx = patCanvas.getContext('2d');
        pCtx.drawImage(patternCanvas, 0, 0, patSize, patSize);

        const pattern = activeCtx.createPattern(patCanvas, 'repeat');
        activeCtx.save();
        activeCtx.fillStyle = pattern;
        activeCtx.strokeStyle = pattern;
        activeCtx.lineWidth = 2.5;
        activeCtx.lineJoin = 'round';
        activeCtx.beginPath();
        activeCtx.moveTo(uA, vA);
        activeCtx.lineTo(uB, vB);
        activeCtx.lineTo(uC, vC);
        activeCtx.closePath();
        activeCtx.fill();
        activeCtx.stroke();
        activeCtx.restore();

        if (this.layerManager) this.layerManager.recomposite();
        this.needsUpdate = true;
        this.forceUpdate = true;
        if (this.texture) this.texture.needsUpdate = true;
    }

    floodFillTexture(startX, startY, patternCanvas, tiling = 4) {
        if (!patternCanvas) return;
        const activeCanvas = this.getActiveCanvas();
        const activeCtx = this.getActiveCtx();
        const w = activeCanvas.width;
        const h = activeCanvas.height;
        startX = Math.floor(startX);
        startY = Math.floor(startY);
        if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

        const imgData = activeCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const startPos = (startY * w + startX) * 4;
        const startR = data[startPos];
        const startG = data[startPos+1];
        const startB = data[startPos+2];
        const startA = data[startPos+3];

        const tol = 60;
        const matchStartColor = (pos) => {
            return Math.abs(data[pos] - startR) <= tol &&
                   Math.abs(data[pos+1] - startG) <= tol &&
                   Math.abs(data[pos+2] - startB) <= tol &&
                   Math.abs(data[pos+3] - startA) <= tol;
        };

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mctx = maskCanvas.getContext('2d');
        const maskImg = mctx.createImageData(w, h);
        const maskData = maskImg.data;

        const stack = [[startX, startY]];
        const visited = new Uint8Array(w * h);

        while (stack.length > 0) {
            const [curX, curY] = stack.pop();
            let y = curY;
            let pos = (y * w + curX) * 4;

            while (y >= 0 && matchStartColor(pos)) {
                y--;
                pos -= w * 4;
            }
            // DILATACIÓN: borde superior
            if (y >= 0) {
                maskData[pos] = 255; maskData[pos+1] = 255; maskData[pos+2] = 255; maskData[pos+3] = 255;
            }
            y++;
            pos += w * 4;

            let reachLeft = false;
            let reachRight = false;

            while (y < h && matchStartColor(pos)) {
                const pixelIdx = y * w + curX;
                if (visited[pixelIdx]) break;
                visited[pixelIdx] = 1;

                maskData[pos] = 255;
                maskData[pos+1] = 255;
                maskData[pos+2] = 255;
                maskData[pos+3] = 255;

                if (curX > 0) {
                    if (matchStartColor(pos - 4)) {
                        if (!reachLeft) {
                            stack.push([curX - 1, y]);
                            reachLeft = true;
                        }
                    } else {
                        if (reachLeft) reachLeft = false;
                        // DILATACIÓN: borde izquierdo
                        maskData[pos - 4] = 255; maskData[pos - 3] = 255; maskData[pos - 2] = 255; maskData[pos - 1] = 255;
                    }
                }

                if (curX < w - 1) {
                    if (matchStartColor(pos + 4)) {
                        if (!reachRight) {
                            stack.push([curX + 1, y]);
                            reachRight = true;
                        }
                    } else {
                        if (reachRight) reachRight = false;
                        // DILATACIÓN: borde derecho
                        maskData[pos + 4] = 255; maskData[pos + 5] = 255; maskData[pos + 6] = 255; maskData[pos + 7] = 255;
                    }
                }

                y++;
                pos += w * 4;
            }
            // DILATACIÓN: borde inferior
            if (y < h) {
                maskData[pos] = 255; maskData[pos+1] = 255; maskData[pos+2] = 255; maskData[pos+3] = 255;
            }
        }

        mctx.putImageData(maskImg, 0, 0);

        const patCanvas = document.createElement('canvas');
        const patSize = Math.max(16, Math.floor(w / tiling));
        patCanvas.width = patSize;
        patCanvas.height = patSize;
        const pctx = patCanvas.getContext('2d');
        pctx.drawImage(patternCanvas, 0, 0, patSize, patSize);

        mctx.globalCompositeOperation = 'source-in';
        const pat = mctx.createPattern(patCanvas, 'repeat');
        mctx.fillStyle = pat;
        mctx.fillRect(0, 0, w, h);

        activeCtx.drawImage(maskCanvas, 0, 0);

        if (this.layerManager) this.layerManager.recomposite();
        this.needsUpdate = true;
        this.forceUpdate = true;
        if (this.texture) this.texture.needsUpdate = true;
    }


    // --- Paint 2D y 3D ---
    getBrushSettings() {
        const tipEl = document.getElementById('brush-tip');
        return {
            color: document.getElementById('brush-color').value,
            size: parseInt(document.getElementById('brush-size').value, 10),
            mode: document.getElementById('brush-mode').value,
            tip: tipEl ? tipEl.value : 'round'
        };
    }

    paint3D(event) {
        if (!this.mesh) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.mesh, true);
        const hit = intersects.find(i => i.object.isMesh && i.uv);

        if (hit) {
            const uv = hit.uv;
            this.drawAtUV(uv.x, uv.y, this.lastU === null);
            this.lastU = uv.x;
            this.lastV = uv.y;
        } else {
            this.lastU = null;
            this.lastV = null;
        }
    }

    paint2D(event) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        
        const u = x / this.canvas.width;
        const v = 1 - (y / this.canvas.height); 
        this.drawAtUV(u, v, this.lastU === null);
        this.lastU = u;
        this.lastV = v;
    }

    drawAtUV(u, v, isNewStroke = false) {
        const x = u * this.canvas.width;
        const y = (1 - v) * this.canvas.height;
        const settings = this.getBrushSettings();
        const activeCtx = this.getActiveCtx();
        const size = settings.size;
        const tip = settings.tip || 'round';
        
        let strokeColor = settings.color;
        const isErase = (settings.mode === 'erase');
        const layer = this.layerManager ? this.layerManager.getActiveLayer() : null;

        if (isErase) {
            if (layer && !layer.isBackground) {
                activeCtx.globalCompositeOperation = 'destination-out';
                strokeColor = 'rgba(0,0,0,1)';
            } else {
                activeCtx.globalCompositeOperation = 'source-over';
                strokeColor = '#FFFFFF';
            }
        } else {
            activeCtx.globalCompositeOperation = 'source-over';
        }

        activeCtx.strokeStyle = strokeColor;
        activeCtx.fillStyle = strokeColor;

        const hexToRgba = (hex, alpha) => {
            if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
            let clean = hex.replace('#', '');
            if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
            const n = parseInt(clean, 16) || 0;
            return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
        };

        const renderTipStamp = (px, py) => {
            if (tip === 'round') {
                activeCtx.beginPath();
                activeCtx.arc(px, py, size, 0, Math.PI * 2);
                activeCtx.fill();
            } else if (tip === 'soft') {
                const grad = activeCtx.createRadialGradient(px, py, 0, px, py, size);
                if (isErase && layer && !layer.isBackground) {
                    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
                    grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                } else {
                    grad.addColorStop(0, hexToRgba(strokeColor, 0.45));
                    grad.addColorStop(0.5, hexToRgba(strokeColor, 0.2));
                    grad.addColorStop(1, hexToRgba(strokeColor, 0));
                }
                activeCtx.fillStyle = grad;
                activeCtx.beginPath();
                activeCtx.arc(px, py, size, 0, Math.PI * 2);
                activeCtx.fill();
                activeCtx.fillStyle = strokeColor;
            } else if (tip === 'square') {
                activeCtx.fillRect(px - size, py - size, size * 2, size * 2);
            } else if (tip === 'chisel') {
                activeCtx.save();
                activeCtx.translate(px, py);
                activeCtx.rotate(Math.PI / 4);
                activeCtx.fillRect(-size, -size * 0.28, size * 2, size * 0.56);
                activeCtx.restore();
            } else if (tip === 'spray') {
                const count = Math.max(10, Math.floor(size * 1.5));
                for (let k = 0; k < count; k++) {
                    const r = size * Math.sqrt(Math.random());
                    const theta = Math.random() * Math.PI * 2;
                    const dotR = 0.8 + Math.random() * 0.8;
                    activeCtx.fillRect(px + r * Math.cos(theta), py + r * Math.sin(theta), dotR, dotR);
                }
            }
        };

        if (isNewStroke) {
            renderTipStamp(x, y);
        } else {
            const distU = Math.abs(u - this.lastU);
            const distV = Math.abs(v - this.lastV);
            if (distU > 0.1 || distV > 0.1) {
                renderTipStamp(x, y);
            } else {
                if (tip === 'round') {
                    activeCtx.lineWidth = size * 2;
                    activeCtx.lineCap = 'round';
                    activeCtx.lineJoin = 'round';
                    activeCtx.beginPath();
                    activeCtx.moveTo(this.lastDrawX, this.lastDrawY);
                    activeCtx.lineTo(x, y);
                    activeCtx.stroke();
                } else {
                    const dx = x - this.lastDrawX;
                    const dy = y - this.lastDrawY;
                    const dist = Math.hypot(dx, dy);
                    const step = Math.max(2, tip === 'soft' ? size * 0.2 : (tip === 'spray' ? size * 0.35 : size * 0.25));
                    const stepsCount = Math.max(1, Math.ceil(dist / step));
                    for (let s = 1; s <= stepsCount; s++) {
                        const t = s / stepsCount;
                        renderTipStamp(this.lastDrawX + dx * t, this.lastDrawY + dy * t);
                    }
                }
            }
        }

        activeCtx.globalCompositeOperation = 'source-over';
        this.lastDrawX = x;
        this.lastDrawY = y;

        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        this.needsUpdate = true;
    }

    setupBrushCursor() {
        // 1. Puntero Dinámico 2D en #view-2d
        this.cursor2D = document.getElementById('brush-cursor-2d');
        const view2D = document.getElementById('view-2d');

        const update2DCursor = (e) => {
            if (!this.cursor2D || !view2D) return;
            const settings = this.getBrushSettings();
            if (!['paint', 'erase'].includes(settings.mode) || 
                (this.transformState && this.transformState.active) || 
                (window.decalSystem && window.decalSystem.isActive && window.decalSystem.mode === '2d')) {
                this.cursor2D.style.display = 'none';
                this.canvas.style.cursor = 'default';
                return;
            }

            const canvasRect = this.canvas.getBoundingClientRect();
            if (e.clientX < canvasRect.left || e.clientX > canvasRect.right || e.clientY < canvasRect.top || e.clientY > canvasRect.bottom) {
                this.cursor2D.style.display = 'none';
                this.canvas.style.cursor = 'default';
                return;
            }

            this.cursor2D.style.display = 'block';
            this.canvas.style.cursor = 'none'; // Ocultar cursor del SO para mostrar la retícula exacta

            const viewRect = view2D.getBoundingClientRect();
            const posX = e.clientX - viewRect.left;
            const posY = e.clientY - viewRect.top;

            const scale = canvasRect.width / this.canvas.width;
            const diam = Math.max(4, settings.size * 2 * scale);

            this.cursor2D.style.left = `${posX}px`;
            this.cursor2D.style.top = `${posY}px`;
            this.cursor2D.style.width = `${diam}px`;
            this.cursor2D.style.height = `${diam}px`;

            const tip = settings.tip || 'round';
            if (tip === 'round') {
                this.cursor2D.style.borderRadius = '50%';
                this.cursor2D.style.border = '1.5px solid #ffffff';
                this.cursor2D.style.boxShadow = '0 0 0 1px #000000, inset 0 0 0 1px #000000';
                this.cursor2D.style.background = 'transparent';
                this.cursor2D.style.transform = 'translate(-50%, -50%)';
            } else if (tip === 'soft') {
                this.cursor2D.style.borderRadius = '50%';
                this.cursor2D.style.border = '1.5px dashed #ffffff';
                this.cursor2D.style.boxShadow = '0 0 0 1px #000000';
                this.cursor2D.style.background = 'radial-gradient(circle, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.05) 60%, transparent 100%)';
                this.cursor2D.style.transform = 'translate(-50%, -50%)';
            } else if (tip === 'square') {
                this.cursor2D.style.borderRadius = '0px';
                this.cursor2D.style.border = '1.5px solid #ffffff';
                this.cursor2D.style.boxShadow = '0 0 0 1px #000000, inset 0 0 0 1px #000000';
                this.cursor2D.style.background = 'transparent';
                this.cursor2D.style.transform = 'translate(-50%, -50%)';
            } else if (tip === 'chisel') {
                this.cursor2D.style.borderRadius = '2px';
                this.cursor2D.style.border = '1.5px solid #ffffff';
                this.cursor2D.style.boxShadow = '0 0 0 1px #000000';
                this.cursor2D.style.background = 'transparent';
                this.cursor2D.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(1, 0.28)';
            } else if (tip === 'spray') {
                this.cursor2D.style.borderRadius = '50%';
                this.cursor2D.style.border = '1.5px dotted #00ffff';
                this.cursor2D.style.boxShadow = '0 0 0 1px #000000';
                this.cursor2D.style.background = 'radial-gradient(circle, rgba(0,255,255,0.25) 0%, transparent 80%)';
                this.cursor2D.style.transform = 'translate(-50%, -50%)';
            }
        };

        this.canvas.addEventListener('pointermove', update2DCursor);
        this.canvas.addEventListener('pointerleave', () => {
            if (this.cursor2D) this.cursor2D.style.display = 'none';
            this.canvas.style.cursor = 'default';
        });

        // 2. Puntero Dinámico 3D proyectado sobre el modelo
        const ringGeo = new THREE.RingGeometry(0.88, 1.0, 36);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00f3ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4
        });
        this.cursor3DMesh = new THREE.Mesh(ringGeo, ringMat);
        this.cursor3DMesh.raycast = () => {};
        this.cursor3DMesh.visible = false;
        this.scene.add(this.cursor3DMesh);

        const view3dContainer = document.getElementById('view-3d') || this.renderer.domElement;
        const update3DCursor = (e) => {
            if (!this.mesh || !this.cursor3DMesh) return;
            const settings = this.getBrushSettings();
            if (!['paint', 'erase'].includes(settings.mode) || 
                (window.decalSystem && window.decalSystem.isActive && window.decalSystem.mode === '3d') ||
                ((e.buttons & 2) || (e.buttons & 4))) {
                this.cursor3DMesh.visible = false;
                return;
            }

            const canvasRect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - canvasRect.top) / canvasRect.height) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObject(this.mesh, true);
            const hit = intersects.find(i => i.object.isMesh && i.uv);

            if (hit && hit.face) {
                this.cursor3DMesh.visible = true;
                this.cursor3DMesh.position.copy(hit.point);

                const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                this.cursor3DMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
                this.cursor3DMesh.position.addScaledVector(normal, 0.012);

                const geo = hit.object.geometry;
                const posAttr = geo.attributes.position;
                const uvAttr = geo.attributes.uv;
                const idx = geo.index;
                const f = hit.face;
                const iA = idx ? idx.getX(f.a) : f.a;
                const iB = idx ? idx.getX(f.b) : f.b;

                const pA = new THREE.Vector3(posAttr.getX(iA), posAttr.getY(iA), posAttr.getZ(iA));
                const pB = new THREE.Vector3(posAttr.getX(iB), posAttr.getY(iB), posAttr.getZ(iB));
                const uA = new THREE.Vector2(uvAttr.getX(iA), uvAttr.getY(iA));
                const uB = new THREE.Vector2(uvAttr.getX(iB), uvAttr.getY(iB));

                const dist3D = pA.distanceTo(pB) * (hit.object.scale.x || 1.0);
                const distUV = uA.distanceTo(uB);
                const uvRatio = distUV > 1e-4 ? (dist3D / distUV) : 1.0;

                const radiusUV = settings.size / this.canvas.width;
                const radius3D = Math.max(0.02, radiusUV * uvRatio);

                this.cursor3DMesh.scale.set(radius3D, radius3D, radius3D);

                if (settings.mode === 'erase') {
                    ringMat.color.setHex(0xff3366);
                } else {
                    ringMat.color.setHex(0x00f3ff);
                }
            } else {
                this.cursor3DMesh.visible = false;
            }
        };

        view3dContainer.addEventListener('pointermove', update3DCursor);
        view3dContainer.addEventListener('pointerleave', () => {
            if (this.cursor3DMesh) this.cursor3DMesh.visible = false;
        });

        // 3. Reacción inmediata al slider de tamaño
        const sizeInput = document.getElementById('brush-size');
        const onSizeChange = () => {
            const size = parseInt(sizeInput.value, 10);
            const label = document.getElementById('brush-size-label');
            if (label) label.textContent = `${size} px`;
            if (this.cursor2D && this.cursor2D.style.display !== 'none') {
                const canvasRect = this.canvas.getBoundingClientRect();
                const scale = canvasRect.width / this.canvas.width;
                const diam = Math.max(4, size * 2 * scale);
                this.cursor2D.style.width = `${diam}px`;
                this.cursor2D.style.height = `${diam}px`;
            }
            if (this.cursor3DMesh && this.cursor3DMesh.visible) {
                const baseScale = this.cursor3DMesh.scale.x;
                const oldSize = this._lastSize || size;
                const newScale = Math.max(0.02, (baseScale / oldSize) * size);
                this.cursor3DMesh.scale.set(newScale, newScale, newScale);
            }
            this._lastSize = size;
        };
        sizeInput?.addEventListener('input', onSizeChange);

        document.getElementById('btn-size-dec')?.addEventListener('click', () => {
            sizeInput.value = Math.max(1, parseInt(sizeInput.value, 10) - 1);
            onSizeChange();
        });
        document.getElementById('btn-size-inc')?.addEventListener('click', () => {
            sizeInput.value = Math.min(100, parseInt(sizeInput.value, 10) + 1);
            onSizeChange();
        });

        // 4. Selector de Puntas de Pincel
        document.querySelectorAll('.brush-tip-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.brush-tip-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tip = btn.getAttribute('data-tip');
                const tipInput = document.getElementById('brush-tip');
                if (tipInput) tipInput.value = tip;

                const modeInput = document.getElementById('brush-mode');
                if (modeInput && !['paint', 'erase'].includes(modeInput.value)) {
                    const paintBtn = document.querySelector('.tool-btn[data-mode="paint"]');
                    if (paintBtn) paintBtn.click();
                }
            });
        });
    }

    // --- Flood Fill 2D Algoritmo (Bote de Pintura Clásico) ---
    floodFill(startX, startY, fillColorHex) {
        const activeCanvas = this.getActiveCanvas();
        const activeCtx = this.getActiveCtx();
        const w = activeCanvas.width;
        const h = activeCanvas.height;
        startX = Math.floor(startX);
        startY = Math.floor(startY);
        
        if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;
        
        const imgData = activeCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        
        const startPos = (startY * w + startX) * 4;
        const startR = data[startPos];
        const startG = data[startPos+1];
        const startB = data[startPos+2];
        const startA = data[startPos+3];
        
        const hex = fillColorHex.replace('#', '');
        const fillR = parseInt(hex.substring(0, 2), 16);
        const fillG = parseInt(hex.substring(2, 4), 16);
        const fillB = parseInt(hex.substring(4, 6), 16);
        const fillA = 255;
        
        // Tolerancia estricta para abortar (mismo color exacto)
        if (Math.abs(fillR - startR) < 5 && Math.abs(fillG - startG) < 5 && Math.abs(fillB - startB) < 5) return;
        
        // Tolerancia moderada para absorber el degradado anti-aliasing
        const tol = 60; 
        
        const matchStartColor = (pos) => {
            return Math.abs(data[pos] - startR) <= tol &&
                   Math.abs(data[pos+1] - startG) <= tol &&
                   Math.abs(data[pos+2] - startB) <= tol &&
                   Math.abs(data[pos+3] - startA) <= tol;
        };
        
        const colorPixel = (pos) => {
            data[pos] = fillR;
            data[pos+1] = fillG;
            data[pos+2] = fillB;
            data[pos+3] = fillA;
        };
        
        const stack = [[startX, startY]];
        
        // Fast scanline flood fill con Dilatación de Borde
        while (stack.length > 0) {
            const [cx, cy] = stack.pop();
            let x = cx;
            let y = cy;
            
            let pos = (y * w + x) * 4;
            
            // Subir hasta encontrar el límite
            while (y >= 0 && matchStartColor(pos)) {
                y--;
                pos -= w * 4;
            }
            
            // DILATACIÓN: Pintamos 1 píxel extra sobre el borde para tapar el halo blanco
            if (y >= 0) colorPixel(pos);
            
            y++;
            pos += w * 4;
            
            let reachLeft = false;
            let reachRight = false;
            
            while (y < h && matchStartColor(pos)) {
                colorPixel(pos);
                
                if (x > 0) {
                    if (matchStartColor(pos - 4)) {
                        if (!reachLeft) {
                            stack.push([x - 1, y]);
                            reachLeft = true;
                        }
                    } else {
                        if (reachLeft) reachLeft = false;
                        colorPixel(pos - 4); // DILATACIÓN: Borde izquierdo
                    }
                }
                
                if (x < w - 1) {
                    if (matchStartColor(pos + 4)) {
                        if (!reachRight) {
                            stack.push([x + 1, y]);
                            reachRight = true;
                        }
                    } else {
                        if (reachRight) reachRight = false;
                        colorPixel(pos + 4); // DILATACIÓN: Borde derecho
                    }
                }
                
                y++;
                pos += w * 4;
            }
            
            // DILATACIÓN: Pintamos 1 píxel extra en el borde inferior
            if (y < h) colorPixel(pos);
        }
        
        activeCtx.putImageData(imgData, 0, 0);
        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        this.needsUpdate = true;
        this.forceUpdate = true;
    }

    fillFaceByIndex(meshObj, a, b, c, mode = 'fill_face') {
        const targetMesh = (meshObj && meshObj.geometry) ? meshObj : (this.mesh && this.mesh.geometry ? this.mesh : null);
        if (!targetMesh || !targetMesh.geometry || !targetMesh.geometry.attributes || !targetMesh.geometry.attributes.uv) return;
        const uvs = targetMesh.geometry.attributes.uv;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const uA = uvs.getX(a) * w, vA = (1 - uvs.getY(a)) * h;
        const uB = uvs.getX(b) * w, vB = (1 - uvs.getY(b)) * h;
        const uC = uvs.getX(c) * w, vC = (1 - uvs.getY(c)) * h;
        
        const activeCtx = this.getActiveCtx();
        const settings = this.getBrushSettings();
        
        if (mode === 'erase_face') {
            const layer = this.layerManager ? this.layerManager.getActiveLayer() : null;
            if (layer && !layer.isBackground) {
                activeCtx.globalCompositeOperation = 'destination-out';
                activeCtx.fillStyle = 'rgba(0,0,0,1)';
            } else {
                activeCtx.globalCompositeOperation = 'source-over';
                activeCtx.fillStyle = '#FFFFFF';
            }
        } else {
            activeCtx.globalCompositeOperation = 'source-over';
            activeCtx.fillStyle = settings.color;
        }
        
        activeCtx.beginPath();
        activeCtx.moveTo(uA, vA);
        activeCtx.lineTo(uB, vB);
        activeCtx.lineTo(uC, vC);
        activeCtx.closePath();
        activeCtx.fill();
        activeCtx.strokeStyle = activeCtx.fillStyle;
        activeCtx.lineWidth = 1.5;
        activeCtx.stroke();
        activeCtx.globalCompositeOperation = 'source-over';
        
        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        this.needsUpdate = true;
        this.forceUpdate = true;
    }

    fillFaceAtUV(u, v, mode = 'fill_face') {
        if (!this.mesh) return;
        
        const isPointInTriangle = (px, py, ax, ay, bx, by, cx, cy) => {
            const v0 = [cx - ax, cy - ay];
            const v1 = [bx - ax, by - ay];
            const v2 = [px - ax, py - ay];
            const dot00 = (v0[0] * v0[0]) + (v0[1] * v0[1]);
            const dot01 = (v0[0] * v1[0]) + (v0[1] * v1[1]);
            const dot02 = (v0[0] * v2[0]) + (v0[1] * v2[1]);
            const dot11 = (v1[0] * v1[0]) + (v1[1] * v1[1]);
            const dot12 = (v1[0] * v2[0]) + (v1[1] * v2[1]);
            const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
            const baryU = (dot11 * dot02 - dot01 * dot12) * invDenom;
            const baryV = (dot00 * dot12 - dot01 * dot02) * invDenom;
            return (baryU >= 0) && (baryV >= 0) && (baryU + baryV < 1);
        };

        const meshes = [];
        this.mesh.traverse(c => {
            if (c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.uv) {
                meshes.push(c);
            }
        });

        for (const m of meshes) {
            const geom = m.geometry;
            const uvs = geom.attributes.uv;
            const indices = geom.index;
            let faceFound = null;

            const checkFace = (idxA, idxB, idxC) => {
                const uA = uvs.getX(idxA), vA = uvs.getY(idxA);
                const uB = uvs.getX(idxB), vB = uvs.getY(idxB);
                const uC = uvs.getX(idxC), vC = uvs.getY(idxC);
                if (isPointInTriangle(u, v, uA, vA, uB, vB, uC, vC)) {
                    faceFound = { idxA, idxB, idxC };
                    return true;
                }
                return false;
            };

            if (indices) {
                const arr = indices.array;
                for (let i = 0; i < arr.length; i += 3) {
                    if (checkFace(arr[i], arr[i+1], arr[i+2])) break;
                }
            } else {
                for (let i = 0; i < uvs.count; i += 3) {
                    if (checkFace(i, i+1, i+2)) break;
                }
            }

            if (faceFound) {
                this.fillFaceByIndex(m, faceFound.idxA, faceFound.idxB, faceFound.idxC, mode);
                break;
            }
        }
    }
}
