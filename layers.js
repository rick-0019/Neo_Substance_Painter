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
    }

    clear() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        if (this.isBackground) {
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(0, 0, this.width, this.height);
        }
    }

    resize(newWidth, newHeight) {
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
    }
}

export class LayerManager {
    constructor(compositeCanvas, initialWidth = 2048, initialHeight = 2048, onUpdate = null) {
        this.compositeCanvas = compositeCanvas;
        this.compositeCtx = compositeCanvas.getContext('2d');
        this.width = initialWidth;
        this.height = initialHeight;
        this.onUpdate = onUpdate;

        this.layers = [];
        this.nextId = 1;
        this.activeLayerId = null;

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
        if (this.activeLayerId === id) return;
        if (this.layers.some(l => l.id === id)) {
            this.activeLayerId = id;
            this.renderUI();
        }
    }

    addLayer(name = null) {
        const layerName = name || `Capa ${this.nextId}`;
        const newLayer = new Layer(this.nextId++, layerName, this.width, this.height, false);
        this.layers.push(newLayer);
        this.activeLayerId = newLayer.id;

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
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

        // Insertar justo encima de la capa original
        this.layers.splice(index + 1, 0, newLayer);
        this.activeLayerId = newLayer.id;

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
        return newLayer;
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

    removeLayer(id) {
        if (this.layers.length <= 1) {
            alert('No puedes eliminar todas las capas.');
            return;
        }
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;

        this.layers.splice(index, 1);
        if (this.activeLayerId === id) {
            const nextActive = this.layers[Math.max(0, index - 1)];
            this.activeLayerId = nextActive ? nextActive.id : null;
        }

        this.recomposite();
        this.renderUI();
        if (this.onUpdate) this.onUpdate();
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

    resize(newWidth, newHeight) {
        this.width = newWidth;
        this.height = newHeight;
        this.compositeCanvas.width = newWidth;
        this.compositeCanvas.height = newHeight;

        for (const layer of this.layers) {
            layer.resize(newWidth, newHeight);
        }

        this.recomposite();
        if (this.onUpdate) this.onUpdate();
    }

    /**
     * Fusión de capas de alto rendimiento acelerada por GPU (RTX).
     * Utiliza drawImage nativo con globalAlpha por hardware sin tocar la CPU.
     */
    recomposite() {
        this.compositeCtx.clearRect(0, 0, this.width, this.height);

        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            if (!layer.visible || layer.opacity <= 0) continue;

            this.compositeCtx.globalAlpha = layer.opacity;
            this.compositeCtx.drawImage(layer.canvas, 0, 0);
        }

        this.compositeCtx.globalAlpha = 1.0;
    }

    renderUI() {
        const container = document.getElementById('layers-list');
        if (!container) return;

        container.innerHTML = '';

        // Renderizar de arriba hacia abajo (el orden visual del usuario)
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            const isSelected = layer.id === this.activeLayerId;

            const item = document.createElement('div');
            item.className = `layer-item ${isSelected ? 'active' : ''}`;
            item.dataset.id = layer.id;

            // Botón de visibilidad (Ojo)
            const visBtn = document.createElement('button');
            visBtn.className = 'layer-btn-vis';
            visBtn.title = layer.visible ? 'Ocultar Capa' : 'Mostrar Capa';
            visBtn.innerHTML = layer.visible
                ? `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
                : `<svg viewBox="0 0 24 24" width="16" height="16" stroke="#888" stroke-width="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

            visBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleLayerVisibility(layer.id);
            });

            // Fila superior de la capa (Visibilidad, Nombre, Renombrar)
            const headerRow = document.createElement('div');
            headerRow.className = 'layer-header-row';

            // Nombre de la capa
            const nameSpan = document.createElement('span');
            nameSpan.className = 'layer-name';
            nameSpan.textContent = layer.name;
            nameSpan.title = 'Doble clic para cambiar nombre';

            // Botón de lápiz para renombrar
            const renameBtn = document.createElement('button');
            renameBtn.className = 'layer-btn-rename';
            renameBtn.title = 'Cambiar nombre de la capa';
            renameBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;

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
                    if (ev.key === 'Enter') {
                        finishEdit();
                    } else if (ev.key === 'Escape') {
                        finished = true;
                        this.renderUI();
                    }
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

            headerRow.addEventListener('dblclick', (e) => {
                if (e.target.closest('button')) return;
                e.stopPropagation();
                startRenaming();
            });

            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                startRenaming();
            });

            headerRow.appendChild(visBtn);
            headerRow.appendChild(nameSpan);
            headerRow.appendChild(renameBtn);
            item.appendChild(headerRow);

            // Si está seleccionada, añadir control de opacidad
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

            item.addEventListener('click', () => {
                this.setActiveLayer(layer.id);
            });

            container.appendChild(item);
        }
    }
}
