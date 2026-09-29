// ==============================================================================
// SELECTION & MASKING MANAGER (CINTAS DE ENMASCARAR PARA MODELISMO)
// ==============================================================================

export class SelectionManager {
    constructor(canvasWidth = 2048, canvasHeight = 2048) {
        this.width = canvasWidth;
        this.height = canvasHeight;

        this.active = false;          // ¿Existe una máscara de selección activa?
        this.creating = false;        // ¿El usuario está arrastrando para definirla?
        this.toolMode = null;         // 'select_rect' | 'select_lasso'
        
        this.rect = null;             // { x, y, w, h }
        this.points = [];             // [{x, y}, ...] para lazo/forma libre
        this.inverted = false;        // ¿Máscara invertida?
        
        this.path2D = null;
        this.invertPath2D = null;
        
        this.dashOffset = 0;
        this.onSelectionChange = null;
    }

    resize(newWidth, newHeight) {
        const scaleX = newWidth / this.width;
        const scaleY = newHeight / this.height;
        this.width = newWidth;
        this.height = newHeight;

        if (this.rect) {
            this.rect.x *= scaleX;
            this.rect.y *= scaleY;
            this.rect.w *= scaleX;
            this.rect.h *= scaleY;
        }
        if (this.points && this.points.length > 0) {
            this.points = this.points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
        }
        if (this.active) {
            this.buildPaths();
        }
    }

    // Iniciar creación de selección al presionar el ratón en vista 2D
    startCreation(mode, startX, startY) {
        this.toolMode = mode;
        this.creating = true;
        this.inverted = false;

        const x = Math.max(0, Math.min(this.width, Math.round(startX)));
        const y = Math.max(0, Math.min(this.height, Math.round(startY)));

        if (mode === 'select_rect') {
            this.rect = { startX: x, startY: y, x, y, w: 0, h: 0 };
            this.points = [];
        } else if (mode === 'select_lasso') {
            this.points = [{ x, y }];
            this.rect = null;
        }
        this.notifyChange();
    }

    // Actualizar mientras se arrastra
    updateCreation(currentX, currentY) {
        if (!this.creating) return;

        const x = Math.max(0, Math.min(this.width, Math.round(currentX)));
        const y = Math.max(0, Math.min(this.height, Math.round(currentY)));

        if (this.toolMode === 'select_rect' && this.rect) {
            this.rect.x = Math.min(this.rect.startX, x);
            this.rect.y = Math.min(this.rect.startY, y);
            this.rect.w = Math.abs(x - this.rect.startX);
            this.rect.h = Math.abs(y - this.rect.startY);
        } else if (this.toolMode === 'select_lasso') {
            const last = this.points[this.points.length - 1];
            // Optimización: evitar puntos duplicados a menos de 3px
            if (!last || Math.hypot(x - last.x, y - last.y) >= 3) {
                this.points.push({ x, y });
            }
        }
    }

    // Confirmar la selección al soltar el ratón
    commitCreation() {
        if (!this.creating) return;
        this.creating = false;

        let valid = false;
        if (this.toolMode === 'select_rect' && this.rect) {
            if (this.rect.w >= 4 && this.rect.h >= 4) {
                valid = true;
            }
        } else if (this.toolMode === 'select_lasso' && this.points.length >= 3) {
            valid = true;
        }

        if (valid) {
            this.active = true;
            this.buildPaths();
            this.notifyChange();
        } else {
            this.deselect();
        }
    }

    // Seleccionar todo el lienzo (Ctrl + A)
    selectAll() {
        this.rect = { startX: 0, startY: 0, x: 0, y: 0, w: this.width, h: this.height };
        this.points = [];
        this.toolMode = 'select_rect';
        this.inverted = false;
        this.active = true;
        this.buildPaths();
        this.notifyChange();
    }

    // Invertir la selección actual (Ctrl + Shift + I)
    invert() {
        if (!this.active) return;
        this.inverted = !this.inverted;
        this.buildPaths();
        this.notifyChange();
    }

    // Deseleccionar / Quitar máscara (Esc / Ctrl + D)
    deselect() {
        this.active = false;
        this.creating = false;
        this.rect = null;
        this.points = [];
        this.inverted = false;
        this.path2D = null;
        this.invertPath2D = null;
        this.notifyChange();
    }

    // Borrar el contenido dentro de la selección en la capa activa (Delete / Supr)
    deleteContent(layerManager) {
        if (!this.active || !layerManager) return;
        const activeLayer = layerManager.getActiveLayer();
        if (!activeLayer) return;

        const isEditingMask = (activeLayer.hasMask && activeLayer.isEditingMask);
        const ctx = isEditingMask ? activeLayer.maskCtx : activeLayer.ctx;
        const clipApplied = this.applyClip(ctx);

        if (isEditingMask) {
            ctx.clearRect(0, 0, this.width, this.height);
        } else if (activeLayer.isBackground) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, this.width, this.height);
        } else {
            ctx.clearRect(0, 0, this.width, this.height);
        }

        if (clipApplied) ctx.restore();
        layerManager.recomposite();
        layerManager.renderUI();
    }

    // Rellenar el área seleccionada con color o máscara (Alt+Supr / Enter)
    fillContent(layerManager, color = '#ffffff') {
        if (!this.active || !layerManager) return;
        const activeLayer = layerManager.getActiveLayer();
        if (!activeLayer) return;

        const isEditingMask = (activeLayer.hasMask && activeLayer.isEditingMask);
        const ctx = isEditingMask ? activeLayer.maskCtx : activeLayer.ctx;
        const clipApplied = this.applyClip(ctx);

        ctx.fillStyle = isEditingMask ? '#FFFFFF' : color;
        ctx.fillRect(0, 0, this.width, this.height);

        if (clipApplied) ctx.restore();
        layerManager.recomposite();
        layerManager.renderUI();
    }

    // Construir objetos Path2D reutilizables para recorte súper rápido en GPU/Canvas
    buildPaths() {
        const p = new Path2D();

        if (this.rect) {
            p.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
        } else if (this.points && this.points.length > 1) {
            p.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                const prev = this.points[i - 1];
                const cur = this.points[i];
                // Si la distancia en UV es > 120px, saltó de una pieza a otra: cerrar sub-bucle y abrir nuevo
                if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 120) {
                    p.closePath();
                    p.moveTo(cur.x, cur.y);
                } else {
                    p.lineTo(cur.x, cur.y);
                }
            }
            p.closePath();
        }

        this.path2D = p;

        // Máscara invertida usando la regla evenodd: Marco exterior total + camino interior
        const inv = new Path2D();
        inv.rect(0, 0, this.width, this.height);
        inv.addPath(p);
        this.invertPath2D = inv;
    }

    // Aplicar el recorte al contexto 2D antes de pintar. Devuelve true si se aplicó clip
    applyClip(ctx) {
        if (!this.active || !this.path2D) return false;

        ctx.save();
        if (this.inverted && this.invertPath2D) {
            ctx.clip(this.invertPath2D, 'evenodd');
        } else {
            ctx.clip(this.path2D);
        }
        return true;
    }

    // Verificar si un punto (x, y) está dentro del área enmascarada permitida para pintar
    isPointSelected(x, y, testCtx) {
        if (!this.active || !this.path2D) return true;
        
        let inside = false;
        if (this.rect) {
            inside = (x >= this.rect.x && x <= this.rect.x + this.rect.w &&
                      y >= this.rect.y && y <= this.rect.y + this.rect.h);
        } else if (testCtx) {
            inside = testCtx.isPointInPath(this.path2D, x, y);
        } else if (this.points && this.points.length >= 3) {
            inside = false;
            for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
                const xi = this.points[i].x, yi = this.points[i].y;
                const xj = this.points[j].x, yj = this.points[j].y;
                if (Math.hypot(xi - xj, yi - yj) > 120) continue; // No cruzar entre piezas distintas
                const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
        }

        return this.inverted ? !inside : inside;
    }

    notifyChange() {
        if (typeof this.onSelectionChange === 'function') {
            this.onSelectionChange({
                active: this.active,
                creating: this.creating,
                inverted: this.inverted,
                mode: this.toolMode,
                rect: this.rect ? { ...this.rect } : null
            });
        }
    }

    // Renderizado en canvas-ui: Retícula punteada bicolor (Marching Ants) y sombreado
    renderOverlay(ctxUI) {
        if (!this.active && !this.creating) return;

        let currentPath = this.path2D;
        if (this.creating) {
            currentPath = new Path2D();
            if (this.toolMode === 'select_rect' && this.rect) {
                currentPath.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
            } else if (this.toolMode === 'select_lasso' && this.points.length > 0) {
                currentPath.moveTo(this.points[0].x, this.points[0].y);
                for (let i = 1; i < this.points.length; i++) {
                    const prev = this.points[i - 1];
                    const cur = this.points[i];
                    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 120) {
                        currentPath.closePath();
                        currentPath.moveTo(cur.x, cur.y);
                    } else {
                        currentPath.lineTo(cur.x, cur.y);
                    }
                }
                currentPath.closePath();
            }
        }

        if (!currentPath) return;

        ctxUI.save();

        // 1. Tinte sutil translúcido de la máscara
        if (this.active) {
            ctxUI.save();
            if (this.inverted && this.invertPath2D) {
                ctxUI.fillStyle = 'rgba(0, 162, 255, 0.22)';
                ctxUI.fill(this.invertPath2D, 'evenodd');
            } else {
                ctxUI.fillStyle = 'rgba(0, 162, 255, 0.20)';
                ctxUI.fill(currentPath);
            }
            ctxUI.restore();
        } else if (this.creating && this.toolMode === 'select_lasso' && this.points.length >= 3) {
            ctxUI.save();
            ctxUI.fillStyle = 'rgba(0, 243, 255, 0.15)';
            ctxUI.fill(currentPath);
            ctxUI.restore();
        }

        // 2. Marching Ants: Doble pase de líneas punteadas visibles en 3D y 2D
        const lineW = Math.max(3, Math.round(this.width / 500));
        ctxUI.lineWidth = lineW;
        ctxUI.lineCap = 'round';
        ctxUI.lineJoin = 'round';
        
        // Pase 1: Guiones negros base
        ctxUI.strokeStyle = '#000000';
        ctxUI.setLineDash([10, 8]);
        ctxUI.lineDashOffset = -this.dashOffset;
        ctxUI.stroke(currentPath);

        // Pase 2: Guiones cian brillante
        ctxUI.strokeStyle = '#00f3ff';
        ctxUI.setLineDash([10, 8]);
        ctxUI.lineDashOffset = -this.dashOffset + 9;
        ctxUI.stroke(currentPath);

        ctxUI.restore();
    }
}
