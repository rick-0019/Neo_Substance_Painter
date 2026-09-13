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
        
        // Interpolación
        this.lastU = null;
        this.lastV = null;
        this.lastDrawX = null;
        this.lastDrawY = null;
        
        // Sistema de Undo (Ctrl+Z)
        this.undoStack = [];
        this.maxUndo = 15;
        
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'z') {
                this.undo();
            } else if (e.key === 'Enter') {
                if (this.transformState && this.transformState.active) {
                    this.commitLayerTransform();
                } else if (this.editingShape) {
                    this.commitShape();
                }
            } else if (e.key === 'Escape') {
                if (this.transformState && this.transformState.active) {
                    this.cancelLayerTransform();
                }
            }
        });
        
        this.setupEvents();
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
            if (window.decalSystem && window.decalSystem.isActive) return;
            if (this.editingShape) this.commitShape();
            if (!this.mesh) return; // Must have a mesh loaded
            
            try { view3d.setPointerCapture(e.pointerId); } catch (_) {}
            
            const mode = document.getElementById('brush-mode').value;
            
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
            }
        });
        
        this.canvas.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            if (window.decalSystem && window.decalSystem.isActive && window.decalSystem.mode === '2d') return;
            
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
                this.canvas.style.cursor = 'crosshair';
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


    // --- Paint 2D y 3D ---
    getBrushSettings() {
        return {
            color: document.getElementById('brush-color').value,
            size: parseInt(document.getElementById('brush-size').value, 10),
            mode: document.getElementById('brush-mode').value
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
        
        activeCtx.lineWidth = settings.size * 2;
        activeCtx.lineCap = 'round';
        activeCtx.lineJoin = 'round';
        
        if (settings.mode === 'paint') {
            activeCtx.globalCompositeOperation = 'source-over';
            activeCtx.strokeStyle = settings.color;
            activeCtx.fillStyle = settings.color;
        } else if (settings.mode === 'erase') {
            const layer = this.layerManager ? this.layerManager.getActiveLayer() : null;
            if (layer && !layer.isBackground) {
                activeCtx.globalCompositeOperation = 'destination-out';
                activeCtx.strokeStyle = 'rgba(0,0,0,1)';
                activeCtx.fillStyle = 'rgba(0,0,0,1)';
            } else {
                activeCtx.globalCompositeOperation = 'source-over';
                activeCtx.strokeStyle = '#FFFFFF';
                activeCtx.fillStyle = '#FFFFFF';
            }
        }

        if (isNewStroke) {
            activeCtx.beginPath();
            activeCtx.arc(x, y, settings.size, 0, Math.PI * 2);
            activeCtx.fill();
        } else {
            const distU = Math.abs(u - this.lastU);
            const distV = Math.abs(v - this.lastV);
            if (distU > 0.1 || distV > 0.1) {
                activeCtx.beginPath();
                activeCtx.arc(x, y, settings.size, 0, Math.PI * 2);
                activeCtx.fill();
            } else {
                activeCtx.beginPath();
                activeCtx.moveTo(this.lastDrawX, this.lastDrawY);
                activeCtx.lineTo(x, y);
                activeCtx.stroke();
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
