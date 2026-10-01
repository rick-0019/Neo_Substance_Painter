export class Layer {
    constructor(id, name, width, height, isBackground = false) {
        this.id = id;
        this.name = name;
        this.width = width;
        this.height = height;
        this.isBackground = isBackground;
        this.visible = true;
        this.opacity = 1.0;

        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');

        if (isBackground) {
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(0, 0, width, height);
        }

        // --- SISTEMA DE MÁSCARA DE CAPA (ESTILO SUBSTANCE PAINTER) ---
        this.hasMask = false;
        this.maskCanvas = null;
        this.maskCtx = null;
        this.isEditingMask = false; // true si las herramientas de pintura dibujan en la máscara

        // --- SISTEMA DE OBJETOS DE PEGATINAS VIVAS (NO DESTRUCTIVO) ---
        this.decals = []; // Colección de objetos Decal vivos editables
    }

    addDecal(decal) {
        if (!decal.id) {
            decal.id = 'decal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        this.decals.push(decal);
        return decal;
    }

    removeDecal(id) {
        const idx = this.decals.findIndex(d => d.id === id);
        if (idx !== -1) {
            this.decals.splice(idx, 1);
            return true;
        }
        return false;
    }

    getDecal(id) {
        return this.decals.find(d => d.id === id) || null;
    }

    renderDecals(targetCtx, scaleX = 1, scaleY = 1) {
        if (!this.decals || this.decals.length === 0) return;
        for (const d of this.decals) {
            if (d.visible === false) continue;
            if (!d.img) continue;
            targetCtx.save();
            targetCtx.imageSmoothingEnabled = true;
            targetCtx.imageSmoothingQuality = 'high';
            targetCtx.globalAlpha = (d.opacity !== undefined ? d.opacity : 1.0);
            const x = d.x * scaleX;
            const y = d.y * scaleY;
            const w = d.width * scaleX;
            const h = d.height * scaleY;
            targetCtx.translate(x, y);
            targetCtx.rotate(d.rotation || 0);
            targetCtx.drawImage(d.img, -w / 2, -h / 2, w, h);
            targetCtx.restore();
        }
    }

    bakeDecals() {
        if (!this.decals || this.decals.length === 0) return false;
        this.renderDecals(this.ctx);
        if (this.hasMask && this.maskCtx) {
            this.decals.forEach(d => this.unmaskDecal(d));
        }
        this.decals = [];
        return true;
    }

    bakeDecal(id) {
        if (!this.decals || this.decals.length === 0) return false;
        const idx = this.decals.findIndex(d => d.id === id);
        if (idx === -1) return false;
        const d = this.decals[idx];
        if (d.visible !== false && d.img) {
            this.ctx.save();
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
            this.ctx.globalAlpha = (d.opacity !== undefined ? d.opacity : 1.0);
            this.ctx.translate(d.x, d.y);
            this.ctx.rotate(d.rotation || 0);
            this.ctx.drawImage(d.img, -d.width / 2, -d.height / 2, d.width, d.height);
            this.ctx.restore();

            if (this.hasMask && this.maskCtx) {
                this.unmaskDecal(d);
            }
        }
        this.decals.splice(idx, 1);
        return true;
    }

    unmaskDecal(d) {
        if (!this.maskCtx || !d || !d.img) return;
        try {
            const w = Math.max(1, Math.round(d.width || d.baseWidth || 100));
            const h = Math.max(1, Math.round(d.height || d.baseHeight || 100));
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(d.img, 0, 0, w, h);
            tempCtx.globalCompositeOperation = 'source-in';
            tempCtx.fillStyle = '#FFFFFF';
            tempCtx.fillRect(0, 0, w, h);

            this.maskCtx.save();
            this.maskCtx.translate(d.x, d.y);
            this.maskCtx.rotate(d.rotation || 0);
            this.maskCtx.drawImage(tempCanvas, -w / 2, -h / 2, w, h);
            this.maskCtx.restore();
        } catch (_) {}
    }

    addMask(type = 'black') {
        if (!this.maskCanvas) {
            this.maskCanvas = document.createElement('canvas');
            this.maskCanvas.width = this.width;
            this.maskCanvas.height = this.height;
            this.maskCtx = this.maskCanvas.getContext('2d');
        }

        this.hasMask = true;
        this.clearMask(type);
        this.isEditingMask = true;
    }

    removeMask() {
        this.hasMask = false;
        this.maskCanvas = null;
        this.maskCtx = null;
        this.isEditingMask = false;
    }

    clearMask(type = 'black') {
        if (!this.maskCtx) return;
        this.maskCtx.clearRect(0, 0, this.width, this.height);
        if (type === 'white') {
            this.maskCtx.fillStyle = '#FFFFFF';
            this.maskCtx.fillRect(0, 0, this.width, this.height);
        }
    }

    invertMask() {
        if (!this.hasMask || !this.maskCtx) return;
        const imgData = this.maskCtx.getImageData(0, 0, this.width, this.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255 - a;
        }
        this.maskCtx.putImageData(imgData, 0, 0);
    }

    clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.decals = [];
        if (this.isBackground) {
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(0, 0, this.width, this.height);
        }
    }

    resize(newWidth, newHeight) {
        const sx = newWidth / this.width;
        const sy = newHeight / this.height;

        const temp = document.createElement('canvas');
        temp.width = this.width;
        temp.height = this.height;
        const tempCtx = temp.getContext('2d');
        tempCtx.drawImage(this.canvas, 0, 0);

        this.width = newWidth;
        this.height = newHeight;
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;

        if (this.isBackground) {
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(0, 0, newWidth, newHeight);
        }
        this.ctx.drawImage(temp, 0, 0, newWidth, newHeight);

        if (this.decals && this.decals.length > 0) {
            for (const d of this.decals) {
                d.x *= sx;
                d.y *= sy;
                d.width *= sx;
                d.height *= sy;
                if (d.baseWidth) d.baseWidth *= sx;
                if (d.baseHeight) d.baseHeight *= sy;
            }
        }

        if (this.hasMask && this.maskCanvas) {
            const tempM = document.createElement('canvas');
            tempM.width = temp.width;
            tempM.height = temp.height;
            tempM.getContext('2d').drawImage(this.maskCanvas, 0, 0);

            this.maskCanvas.width = newWidth;
            this.maskCanvas.height = newHeight;
            this.maskCtx = this.maskCanvas.getContext('2d');
            this.maskCtx.drawImage(tempM, 0, 0, newWidth, newHeight);
        }
    }
}

export class LayerManager {
    constructor(compositeCanvas, initialWidth = 2048, initialHeight = 2048, onUpdate = null) {
        this.compositeCanvas = compositeCanvas;
        this.compositeCtx = compositeCanvas.getContext('2d');
        this.width = initialWidth;
        this.height = initialHeight;
        this.onUpdate = onUpdate;
        this.onMaskModeChange = null; // Callback para alertar UI del modo máscara activo

        this.layers = [];
        this.nextId = 1;
        this.activeLayerId = null;

        // Buffer reutilizable para recortar capas con máscara mediante GPU
        this.tempMaskCanvas = null;
        this.tempMaskCtx = null;

        // Capa base blanca por defecto (fondo)
        const baseLayer = new Layer(this.nextId++, 'Fondo Blanco', this.width, this.height, true);
        this.layers.push(baseLayer);
        this.activeLayerId = baseLayer.id;

        // Capa de pintura inicial
        const paintLayer = new Layer(this.nextId++, 'Capa 1', this.width, this.height, false);
        this.layers.push(paintLayer);
        this.activeLayerId = paintLayer.id;

        this.recomposite();
    }

    getActiveLayer() {
        return this.layers.find(l => l.id === this.activeLayerId) || this.layers[this.layers.length - 1];
    }

    setActiveLayer(id) {
        if (this.layers.some(l => l.id === id)) {
            const prevLayer = this.getActiveLayer();
            this.activeLayerId = id;
            const newLayer = this.getActiveLayer();

            if (window.decalSystem && window.decalSystem.selectedDecalId) {
                const belongsToNew = newLayer && newLayer.decals && newLayer.decals.some(d => d.id === window.decalSystem.selectedDecalId);
                if (!belongsToNew) {
                    window.decalSystem.deselectDecal();
                }
            }

            // Si cambiamos de capa, notificar si la nueva capa está en modo máscara
            if (this.onMaskModeChange) {
                this.onMaskModeChange(newLayer ? newLayer.isEditingMask : false, newLayer);
            }
            this.renderUI();
        }
    }

    setEditingTarget(layerId, target = 'color') {
        const layer = this.layers.find(l => l.id === layerId);
        if (!layer) return;

        this.activeLayerId = layerId;
        if (target === 'mask' && layer.hasMask) {
            layer.isEditingMask = true;
        } else {
            layer.isEditingMask = false;
        }

        if (this.onMaskModeChange) {
            this.onMaskModeChange(layer.isEditingMask, layer);
        }
        this.renderUI();
    }

    addLayer(name = null) {
        if (window.painter) {
            if (window.painter.editingShape) window.painter.commitShape();
            window.painter.savedCanvasData = null;
            window.painter.clearUI();
        }
        const layerName = name || `Capa ${this.nextId}`;
        const newLayer = new Layer(this.nextId++, layerName, this.width, this.height, false);
        // Garantizar que la nueva capa sea 100% transparente y no herede píxeles de capas previas
        newLayer.ctx.clearRect(0, 0, this.width, this.height);
        this.layers.push(newLayer);
        this.activeLayerId = newLayer.id;

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
        if (this.onMaskModeChange) this.onMaskModeChange(false, newLayer);
        return newLayer;
    }

    createLayer(name = null, isBackground = false, id = null) {
        const layerId = id !== null ? id : this.nextId++;
        if (layerId >= this.nextId) this.nextId = layerId + 1;
        const layerName = name || (isBackground ? 'Fondo Blanco' : `Capa ${layerId}`);
        return new Layer(layerId, layerName, this.width, this.height, isBackground);
    }

    /**
     * Flujo de 1 Clic para Camuflaje estilo Substance Painter.
     * Crea una capa rellena con un color de camuflaje y le acopla una Máscara Negra.
     * Deja el pincel listo para revelar el camuflaje directamente sobre el 3D.
     */
    addCamoLayer(colorHex = '#4a5d3f', name = null) {
        const camoName = name || `Camuflaje ${this.nextId}`;
        const newLayer = new Layer(this.nextId++, camoName, this.width, this.height, false);

        // Rellenar toda la capa con el color de camuflaje elegido
        newLayer.ctx.fillStyle = colorHex;
        newLayer.ctx.fillRect(0, 0, this.width, this.height);

        // Añadir máscara negra (oculta todo inicialmente)
        newLayer.addMask('black');
        newLayer.isEditingMask = true; // Activar pincel de máscara

        this.layers.push(newLayer);
        this.activeLayerId = newLayer.id;

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
        if (this.onMaskModeChange) this.onMaskModeChange(true, newLayer);
        return newLayer;
    }

    duplicateLayer(id = null) {
        const targetId = id !== null ? id : this.activeLayerId;
        const index = this.layers.findIndex(l => l.id === targetId);
        if (index === -1) return null;

        const source = this.layers[index];
        const newLayer = new Layer(this.nextId++, `${source.name} (copia)`, this.width, this.height, false);
        newLayer.opacity = source.opacity;
        newLayer.visible = source.visible;

        // Copiar píxeles del lienzo original
        newLayer.ctx.drawImage(source.canvas, 0, 0);

        // Copiar máscara si existía
        if (source.hasMask && source.maskCanvas) {
            newLayer.addMask('black');
            newLayer.maskCtx.drawImage(source.maskCanvas, 0, 0);
            newLayer.isEditingMask = source.isEditingMask;
        }

        // Copiar pegatinas vivas si existían
        if (source.decals && source.decals.length > 0) {
            newLayer.decals = source.decals.map(d => ({
                ...d,
                id: 'decal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
            }));
        }

        // Insertar justo encima de la capa original
        this.layers.splice(index + 1, 0, newLayer);
        this.activeLayerId = newLayer.id;

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
        if (this.onMaskModeChange) this.onMaskModeChange(newLayer.isEditingMask, newLayer);
        return newLayer;
    }

    removeLayer(id) {
        if (this.layers.length <= 1) {
            alert('No puedes eliminar todas las capas.');
            return;
        }
        const layer = this.layers.find(l => l.id === id);
        if (layer && layer.isBackground) {
            alert('La capa de Fondo no se puede eliminar.');
            return;
        }
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;

        // Deseleccionar calcomanía viva si pertenecía a la capa eliminada
        if (window.decalSystem && window.decalSystem.selectedDecalId) {
            const hasSelected = layer && layer.decals && layer.decals.some(d => d.id === window.decalSystem.selectedDecalId);
            if (hasSelected) {
                window.decalSystem.deselectDecal();
            }
        }

        if (window.painter) {
            window.painter.editingShape = null;
            window.painter.savedCanvasData = null;
            window.painter.clearUI();
        }

        this.layers.splice(index, 1);
        if (this.activeLayerId === id) {
            const nextActive = this.layers[Math.max(0, index - 1)];
            this.activeLayerId = nextActive ? nextActive.id : null;
        }

        const activeLayer = this.getActiveLayer();
        if (this.onMaskModeChange) {
            this.onMaskModeChange(activeLayer ? activeLayer.isEditingMask : false, activeLayer);
        }

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
        if (window.painter) {
            window.painter.needsUpdate = true;
            window.painter.forceUpdate = true;
        }
        if (window.state && window.state.texture) {
            window.state.texture.needsUpdate = true;
        }
        if (window.papercraft && window.papercraft.active && window.renderUnfoldWorkbench) {
            window.renderUnfoldWorkbench();
        }
    }

    moveLayer(id, direction) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;

        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= this.layers.length) return;

        const temp = this.layers[index];
        this.layers[index] = this.layers[targetIndex];
        this.layers[targetIndex] = temp;

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
    }

    setLayerOpacity(id, opacity) {
        const layer = this.layers.find(l => l.id === id);
        if (layer) {
            layer.opacity = Math.max(0, Math.min(1, opacity));
            this.recomposite();
            if (this.onUpdate) this.onUpdate();
        }
    }

    toggleLayerVisibility(id) {
        const layer = this.layers.find(l => l.id === id);
        if (layer) {
            layer.visible = !layer.visible;
            this.recomposite();
            this.renderUI();
            if (this.onUpdate) this.onUpdate();
        }
    }

    isolateLayer(id) {
        const otherLayers = this.layers.filter(l => l.id !== id);
        const allOthersHidden = otherLayers.every(l => !l.visible);

        if (allOthersHidden) {
            this.layers.forEach(l => l.visible = true);
        } else {
            this.layers.forEach(l => {
                l.visible = (l.id === id);
            });
        }

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
    }

    resize(newWidth, newHeight) {
        this.width = newWidth;
        this.height = newHeight;
        this.compositeCanvas.width = newWidth;
        this.compositeCanvas.height = newHeight;

        if (this.tempMaskCanvas) {
            this.tempMaskCanvas.width = newWidth;
            this.tempMaskCanvas.height = newHeight;
        }

        for (const layer of this.layers) {
            layer.resize(newWidth, newHeight);
        }

        this.recomposite();
        if (this.onUpdate) this.onUpdate();
    }

    /**
     * Fusión de capas acelerada por hardware con soporte para Máscaras de Capa y Pegatinas Vivas.
     */
    recomposite() {
        this.compositeCtx.clearRect(0, 0, this.width, this.height);

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            if (!layer.visible || layer.opacity <= 0) continue;

            this.compositeCtx.globalAlpha = layer.opacity;

            if (layer.hasMask && layer.maskCanvas) {
                // Buffer temporal acelerado para recortar capa con su máscara
                if (!this.tempMaskCanvas) {
                    this.tempMaskCanvas = document.createElement('canvas');
                    this.tempMaskCanvas.width = this.width;
                    this.tempMaskCanvas.height = this.height;
                    this.tempMaskCtx = this.tempMaskCanvas.getContext('2d');
                } else if (this.tempMaskCanvas.width !== this.width || this.tempMaskCanvas.height !== this.height) {
                    this.tempMaskCanvas.width = this.width;
                    this.tempMaskCanvas.height = this.height;
                }

                this.tempMaskCtx.clearRect(0, 0, this.width, this.height);
                this.tempMaskCtx.globalCompositeOperation = 'source-over';
                this.tempMaskCtx.drawImage(layer.canvas, 0, 0);

                // Aplicar máscara: el canal alfa de la máscara modula la capa de pintura base
                this.tempMaskCtx.globalCompositeOperation = 'destination-in';
                this.tempMaskCtx.drawImage(layer.maskCanvas, 0, 0);

                // Dibujar pegatinas y formas vivas de la capa SOBRE la capa ya recortada por la máscara
                this.tempMaskCtx.globalCompositeOperation = 'source-over';
                if (layer.decals && layer.decals.length > 0) {
                    layer.renderDecals(this.tempMaskCtx);
                }

                this.compositeCtx.drawImage(this.tempMaskCanvas, 0, 0);
            } else {
                this.compositeCtx.drawImage(layer.canvas, 0, 0);
                if (layer.decals && layer.decals.length > 0) {
                    layer.renderDecals(this.compositeCtx);
                }
            }
        }

        this.compositeCtx.globalAlpha = 1.0;
    }

    getLayerBoundingBox(layer) {
        const ctx = layer.ctx;
        const w = layer.width;
        const h = layer.height;
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        let minX = w, minY = h, maxX = -1, maxY = -1;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const alpha = data[(y * w + x) * 4 + 3];
                if (alpha > 5) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX < minX || maxY < minY) {
            return null;
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    }

    renderUI() {
        const container = document.getElementById('layers-list');
        if (!container) return;

        container.innerHTML = '';

        // Renderizar de arriba hacia abajo (el orden visual de apilado)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            const isSelected = layer.id === this.activeLayerId;

            const item = document.createElement('div');
            item.className = `layer-item ${isSelected ? 'active' : ''}`;
            item.dataset.id = layer.id;

            // Fila superior: Ojo, Miniatura Color, Miniatura Máscara, Nombre, Botón Máscara, Renombrar
            const headerRow = document.createElement('div');
            headerRow.className = 'layer-header-row';

            // 1. Botón de visibilidad (Ojo)
            const visBtn = document.createElement('button');
            visBtn.className = 'layer-btn-vis';
            visBtn.title = layer.visible ? 'Ocultar Capa (Alt+Clic: Aislar esta capa)' : 'Mostrar Capa (Alt+Clic: Aislar esta capa)';
            visBtn.innerHTML = layer.visible
                ? `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
                : `<svg viewBox="0 0 24 24" width="15" height="15" stroke="#888" stroke-width="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

            visBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (e.altKey) {
                    this.isolateLayer(layer.id);
                } else {
                    this.toggleLayerVisibility(layer.id);
                }
            });
            headerRow.appendChild(visBtn);

            // 2. Miniatura de Color (Estilo Substance Painter)
            const colorThumb = document.createElement('canvas');
            colorThumb.className = `layer-thumb-slot ${isSelected && !layer.isEditingMask ? 'target-active' : ''}`;
            colorThumb.width = 24;
            colorThumb.height = 18;
            colorThumb.title = 'Editar Color de la Capa';
            const cCtx = colorThumb.getContext('2d');
            cCtx.fillStyle = '#222';
            cCtx.fillRect(0, 0, 24, 18);
            try {
                cCtx.drawImage(layer.canvas, 0, 0, 24, 18);
                if (layer.decals && layer.decals.length > 0) {
                    layer.renderDecals(cCtx, 24 / layer.width, 18 / layer.height);
                }
            } catch (err) {}

            colorThumb.addEventListener('click', (e) => {
                e.stopPropagation();
                this.setEditingTarget(layer.id, 'color');
            });
            headerRow.appendChild(colorThumb);

            // 3. Miniatura de Máscara (si tiene máscara acoplada)
            if (layer.hasMask) {
                const maskThumb = document.createElement('canvas');
                maskThumb.className = `layer-thumb-slot mask-slot ${isSelected && layer.isEditingMask ? 'target-active' : ''}`;
                maskThumb.width = 24;
                maskThumb.height = 18;
                maskThumb.title = 'Editar Máscara de Capa (Pintar camuflaje en 3D)';

                const mCtx = maskThumb.getContext('2d');
                mCtx.fillStyle = '#0a0a0a';
                mCtx.fillRect(0, 0, 24, 18);
                if (layer.maskCanvas) {
                    try {
                        mCtx.fillStyle = '#ffffff';
                        mCtx.drawImage(layer.maskCanvas, 0, 0, 24, 18);
                    } catch (err) {}
                }

                maskThumb.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.setEditingTarget(layer.id, 'mask');
                });
                headerRow.appendChild(maskThumb);
            }

            // 4. Nombre de la Capa
            const nameSpan = document.createElement('span');
            nameSpan.className = 'layer-name';
            nameSpan.textContent = layer.hasMask && layer.isEditingMask ? `${layer.name} [Máscara]` : layer.name;
            nameSpan.title = 'Doble clic para renombrar';

            const startRenaming = () => {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'layer-name-input';
                input.value = layer.name;

                let finished = false;
                const finishEdit = () => {
                    if (finished) return;
                    finished = true;
                    const newName = input.value.trim();
                    if (newName) {
                        layer.name = newName;
                    }
                    this.renderUI();
                };

                input.addEventListener('blur', finishEdit);
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter') finishEdit();
                    else if (ev.key === 'Escape') { finished = true; this.renderUI(); }
                    ev.stopPropagation();
                });

                nameSpan.replaceWith(input);
                input.focus();
                input.select();
            };

            nameSpan.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                startRenaming();
            });
            headerRow.appendChild(nameSpan);

            // 5. Botón de Máscara (Añadir / Menú de Máscara)
            const maskBtn = document.createElement('button');
            maskBtn.className = `layer-btn-mask-icon ${layer.hasMask ? 'has-mask' : ''}`;
            maskBtn.title = layer.hasMask ? 'Opciones de Máscara (Invertir, Limpiar, Quitar)' : 'Añadir Máscara Negra (Substance Painter)';
            maskBtn.innerHTML = layer.hasMask ? '🎭' : '➕🎭';

            maskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!layer.hasMask) {
                    layer.addMask('black');
                    this.recomposite();
                    this.renderUI();
                    if (this.onUpdate) this.onUpdate();
                    if (this.onMaskModeChange) this.onMaskModeChange(true, layer);
                } else {
                    // Menú contextual simple / ciclado
                    const choice = confirm(
                        `Opciones de Máscara para "${layer.name}":\n\n` +
                        `• Aceptar = Invertir Máscara (cambia blanco/negro)\n` +
                        `• Cancelar = Ver más opciones (Eliminar o Limpiar)`
                    );
                    if (choice) {
                        layer.invertMask();
                        this.recomposite();
                        this.renderUI();
                        if (this.onUpdate) this.onUpdate();
                    } else {
                        const del = confirm(`¿Deseas ELIMINAR la máscara de "${layer.name}"?`);
                        if (del) {
                            layer.removeMask();
                            this.recomposite();
                            this.renderUI();
                            if (this.onUpdate) this.onUpdate();
                            if (this.onMaskModeChange) this.onMaskModeChange(false, layer);
                        }
                    }
                }
            });
            headerRow.appendChild(maskBtn);

            // 6. Badge de Objetos Vivos en la capa (Calcas, Formas, Texto)
            if (layer.decals && layer.decals.length > 0) {
                const decalBadge = document.createElement('span');
                decalBadge.className = 'layer-decal-badge';
                decalBadge.title = `${layer.decals.length} objeto(s) vivo(s) en esta capa (calcas, formas, texto). Clic para estampar a pintura fija.`;
                decalBadge.textContent = `🎨 ${layer.decals.length}`;
                decalBadge.style.cursor = 'pointer';
                decalBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const doBake = confirm(`¿Deseas estampar/rasterizar los ${layer.decals.length} objetos vivos de la capa "${layer.name}" a pintura fija?`);
                    if (doBake) {
                        if (window.painter) window.painter.saveUndoState();
                        layer.bakeDecals();
                        if (window.decalSystem) window.decalSystem.deselectDecal();
                        this.recomposite();
                        this.renderUI();
                        if (window.painter) {
                            window.painter.needsUpdate = true;
                            window.painter.forceUpdate = true;
                        }
                    }
                });
                headerRow.appendChild(decalBadge);
            }

            // 7. Botón de renombrar
            const renameBtn = document.createElement('button');
            renameBtn.className = 'layer-btn-rename';
            renameBtn.title = 'Cambiar nombre';
            renameBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startRenaming();
            });
            headerRow.appendChild(renameBtn);

            // 8. Botón de eliminar capa (accesible directamente en cada fila)
            if (!layer.isBackground) {
                const delLayerBtn = document.createElement('button');
                delLayerBtn.type = 'button';
                delLayerBtn.className = 'layer-btn-delete';
                delLayerBtn.title = `Eliminar capa "${layer.name}"`;
                delLayerBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                delLayerBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const confirmed = confirm(`¿Estás seguro de que deseas eliminar la capa "${layer.name}"?`);
                    if (confirmed) {
                        this.removeLayer(layer.id);
                    }
                });
                headerRow.appendChild(delLayerBtn);
            }

            item.appendChild(headerRow);

            // 8. Control de Opacidad si la capa está seleccionada
            if (isSelected) {
                const opacContainer = document.createElement('div');
                opacContainer.className = 'layer-opac-container';
                
                const opacLabel = document.createElement('span');
                opacLabel.className = 'layer-opac-label';
                opacLabel.textContent = `${Math.round(layer.opacity * 100)}%`;

                const opacSlider = document.createElement('input');
                opacSlider.type = 'range';
                opacSlider.min = '0';
                opacSlider.max = '100';
                opacSlider.value = Math.round(layer.opacity * 100);
                opacSlider.className = 'layer-opac-slider';
                
                opacSlider.addEventListener('input', (e) => {
                    e.stopPropagation();
                    const val = parseInt(e.target.value, 10) / 100;
                    opacLabel.textContent = `${e.target.value}%`;
                    this.setLayerOpacity(layer.id, val);
                });

                opacContainer.appendChild(opacSlider);
                opacContainer.appendChild(opacLabel);
                item.appendChild(opacContainer);
            }

            // 9. Lista de Objetos Vivos de la Capa (Calcomanías, Formas y Texto estilo Photoshop / Illustrator)
            if (layer.decals && layer.decals.length > 0) {
                const decalsContainer = document.createElement('div');
                decalsContainer.className = 'layer-decals-list';

                const iconMap = {
                    text: '🔤',
                    rect: '🟦',
                    circle: '⭕',
                    triangle: '🔺',
                    star: '⭐',
                    polygon: '⬡',
                    arrow: '➡️',
                    badge: '🛡️',
                    line: '📏',
                    decal: '🏷️'
                };

                layer.decals.forEach((decal, dIndex) => {
                    const isDecalSelected = window.decalSystem && window.decalSystem.selectedDecalId === decal.id;
                    const typeIcon = iconMap[decal.type] || '🏷️';

                    const decalRow = document.createElement('div');
                    decalRow.className = `layer-decal-subitem ${isDecalSelected ? 'active' : ''}`;
                    decalRow.title = `${typeIcon} ${decal.name || 'Objeto'} (Clic para seleccionar, mover o transformar)`;

                    // Conector en árbol
                    const branchIcon = document.createElement('span');
                    branchIcon.className = 'layer-decal-branch';
                    branchIcon.textContent = '└─';
                    decalRow.appendChild(branchIcon);

                    // Miniatura / Icono del objeto
                    const dThumb = document.createElement('div');
                    dThumb.className = 'layer-decal-thumb';
                    if (decal.dataUrl) {
                        dThumb.style.backgroundImage = `url(${decal.dataUrl})`;
                    } else if (decal.img && decal.img.src) {
                        dThumb.style.backgroundImage = `url(${decal.img.src})`;
                    } else if (decal.img instanceof HTMLCanvasElement) {
                        try {
                            dThumb.style.backgroundImage = `url(${decal.img.toDataURL()})`;
                        } catch (_) {
                            dThumb.textContent = typeIcon;
                        }
                    } else {
                        dThumb.textContent = typeIcon;
                    }
                    decalRow.appendChild(dThumb);

                    // Nombre del objeto con opción de doble clic para renombrar
                    const dName = document.createElement('span');
                    dName.className = 'layer-decal-name';
                    dName.textContent = decal.name || `${typeIcon} Objeto ${dIndex + 1}`;
                    
                    const startDecalRename = () => {
                        const renameInput = document.createElement('input');
                        renameInput.type = 'text';
                        renameInput.className = 'layer-name-input';
                        renameInput.value = decal.name || `${typeIcon} Objeto ${dIndex + 1}`;
                        let done = false;
                        const finish = () => {
                            if (done) return;
                            done = true;
                            if (renameInput.value.trim()) {
                                decal.name = renameInput.value.trim();
                            }
                            this.renderUI();
                        };
                        renameInput.addEventListener('blur', finish);
                        renameInput.addEventListener('keydown', (ev) => {
                            if (ev.key === 'Enter') finish();
                            else if (ev.key === 'Escape') { done = true; this.renderUI(); }
                            ev.stopPropagation();
                        });
                        dName.replaceWith(renameInput);
                        renameInput.focus();
                        renameInput.select();
                    };
                    dName.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        startDecalRename();
                    });
                    decalRow.appendChild(dName);

                    // Botón Ojo de Visibilidad del objeto
                    const dVisBtn = document.createElement('button');
                    dVisBtn.type = 'button';
                    dVisBtn.className = 'layer-decal-btn-vis';
                    dVisBtn.title = decal.visible !== false ? 'Ocultar este objeto' : 'Mostrar este objeto';
                    dVisBtn.innerHTML = decal.visible !== false
                        ? `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
                        : `<svg viewBox="0 0 24 24" width="13" height="13" stroke="#888" stroke-width="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

                    dVisBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        decal.visible = (decal.visible === false) ? true : false;
                        this.recomposite();
                        this.renderUI();
                        if (this.onUpdate) this.onUpdate();
                        if (window.painter) {
                            window.painter.needsUpdate = true;
                            window.painter.forceUpdate = true;
                        }
                        if (window.state && window.state.texture) {
                            window.state.texture.needsUpdate = true;
                        }
                    });
                    decalRow.appendChild(dVisBtn);

                    // Botón Estampar Objeto Individual a Pintura Fija
                    const dBakeBtn = document.createElement('button');
                    dBakeBtn.type = 'button';
                    dBakeBtn.className = 'layer-decal-btn-bake';
                    dBakeBtn.title = 'Estampar solo este objeto a pintura fija en la capa';
                    dBakeBtn.innerHTML = '📄';
                    dBakeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (window.painter) window.painter.saveUndoState();
                        layer.bakeDecal(decal.id);
                        if (window.decalSystem && window.decalSystem.selectedDecalId === decal.id) {
                            window.decalSystem.deselectDecal();
                        }
                        this.recomposite();
                        this.renderUI();
                        if (this.onUpdate) this.onUpdate();
                        if (window.painter) {
                            window.painter.needsUpdate = true;
                            window.painter.forceUpdate = true;
                        }
                        if (window.state && window.state.texture) {
                            window.state.texture.needsUpdate = true;
                        }
                    });
                    decalRow.appendChild(dBakeBtn);

                    // Botón Borrar Objeto
                    const dDelBtn = document.createElement('button');
                    dDelBtn.type = 'button';
                    dDelBtn.className = 'layer-decal-btn-del';
                    dDelBtn.title = 'Eliminar este objeto (Supr)';
                    dDelBtn.innerHTML = '🗑️';
                    dDelBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        layer.removeDecal(decal.id);
                        if (window.decalSystem && window.decalSystem.selectedDecalId === decal.id) {
                            window.decalSystem.deselectDecal();
                        }
                        this.recomposite();
                        this.renderUI();
                        if (this.onUpdate) this.onUpdate();
                        if (window.painter) {
                            window.painter.needsUpdate = true;
                            window.painter.forceUpdate = true;
                        }
                        if (window.state && window.state.texture) {
                            window.state.texture.needsUpdate = true;
                        }
                    });
                    decalRow.appendChild(dDelBtn);

                    // Clic en la fila del objeto -> SELECCIONARLO
                    decalRow.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.setActiveLayer(layer.id);
                        if (window.decalSystem) {
                            window.decalSystem.setMode('2d');
                            window.decalSystem.selectDecal(decal);
                        }
                        this.renderUI();
                    });

                    decalsContainer.appendChild(decalRow);
                });

                // Fila de acción: Estampar todos los objetos vivos a la capa
                const bakeRow = document.createElement('div');
                bakeRow.className = 'layer-decal-subitem';
                bakeRow.style.cssText = 'padding: 3px 6px; font-size: 10px; color: #4dabf7; cursor: pointer; display: flex; align-items: center; gap: 5px; opacity: 0.85; margin-left: 12px; margin-top: 2px;';
                bakeRow.title = 'Estampar todos los objetos vivos de esta capa a pintura fija';
                bakeRow.innerHTML = '<span>📄</span><span style="text-decoration: underline;">Estampar objetos a la capa</span>';
                bakeRow.addEventListener('mouseenter', () => { bakeRow.style.opacity = '1.0'; });
                bakeRow.addEventListener('mouseleave', () => { bakeRow.style.opacity = '0.85'; });
                bakeRow.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (window.painter) window.painter.saveUndoState();
                    layer.bakeDecals();
                    if (window.decalSystem) window.decalSystem.deselectDecal();
                    this.recomposite();
                    this.renderUI();
                    if (window.painter) {
                        window.painter.needsUpdate = true;
                        window.painter.forceUpdate = true;
                    }
                    if (window.state && window.state.texture) {
                        window.state.texture.needsUpdate = true;
                    }
                });
                decalsContainer.appendChild(bakeRow);

                item.appendChild(decalsContainer);
            }

            item.addEventListener('click', () => {
                this.setActiveLayer(layer.id);
            });

            container.appendChild(item);
        }
    }
}
