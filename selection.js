// ==============================================================================
// SELECTION & MASKING MANAGER (CINTAS DE ENMASCARAR PARA MODELISMO)
// Soporte Multi-Región, Lazo Poligonal 3D y Acumulación de Máscaras
// ==============================================================================

export class SelectionManager {
    constructor(canvasWidth = 2048, canvasHeight = 2048) {
        this.width = canvasWidth;
        this.height = canvasHeight;

        this.active = false;          // ¿Existe una máscara de selección activa?
        this.creating = false;        // ¿El usuario está arrastrando para definirla?
        this.toolMode = null;         // 'select_rect' | 'select_lasso' | 'select_polylasso'
        
        this.rect = null;             // { x, y, w, h }
        this.points = [];             // [{x, y}, ...] para lazo/forma libre
        this.regions = [];            // Múltiples regiones activas [{ type: 'rect'|'polygon', ... }]
        this.inverted = false;        // ¿Máscara invertida?
        this.combineMode = 'replace'; // 'replace' | 'add'

        // Modo Lazo Poligonal 3D (Punto a Punto con Rotación Libre)
        this.isPolyLasso = false;
        this.polyPoints = [];
        this.polyHover = null;
        
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
        if (this.regions && this.regions.length > 0) {
            this.regions = this.regions.map(r => {
                if (r.type === 'rect') {
                    return { ...r, x: r.x * scaleX, y: r.y * scaleY, w: r.w * scaleX, h: r.h * scaleY };
                } else if (r.type === 'polygon' && r.points) {
                    return { ...r, points: r.points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY })) };
                }
                return r;
            });
        }
        if (this.polyPoints && this.polyPoints.length > 0) {
            this.polyPoints = this.polyPoints.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
        }
        if (this.active) {
            this.buildPaths();
        }
    }

    // Iniciar creación de selección al presionar el ratón
    startCreation(mode, startX, startY) {
        this.toolMode = mode;
        this.creating = true;

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
            // Evitar puntos duplicados a menos de 3px
            if (!last || Math.hypot(x - last.x, y - last.y) >= 3) {
                this.points.push({ x, y });
            }
        }
    }

    // Confirmar la selección al soltar el ratón (soporta modo acumular con Shift o combineMode 'add')
    commitCreation(isAdd = false) {
        if (!this.creating) return;
        this.creating = false;

        let valid = false;
        let newReg = null;

        if (this.toolMode === 'select_rect' && this.rect) {
            if (this.rect.w >= 4 && this.rect.h >= 4) {
                valid = true;
                newReg = { type: 'rect', x: this.rect.x, y: this.rect.y, w: this.rect.w, h: this.rect.h };
            }
        } else if (this.toolMode === 'select_lasso' && this.points.length >= 3) {
            valid = true;
            newReg = { type: 'polygon', points: [...this.points] };
        }

        if (valid && newReg) {
            if (isAdd || this.combineMode === 'add') {
                this.regions.push(newReg);
            } else {
                this.regions = [newReg];
            }
            this.active = true;
            this.buildPaths();
            this.notifyChange();
        } else if (!this.active || (!isAdd && this.combineMode !== 'add')) {
            this.deselect();
        }
    }

    // --- MODO LAZO POLIGONAL 3D (PUNTO A PUNTO CON ROTACIÓN LIBRE) ---
    startPolyLasso(startX, startY) {
        this.isPolyLasso = true;
        this.toolMode = 'select_polylasso';
        const x = Math.max(0, Math.min(this.width, Math.round(startX)));
        const y = Math.max(0, Math.min(this.height, Math.round(startY)));
        this.polyPoints = [{ x, y }];
        this.polyHover = { x, y };
        this.notifyChange();
    }

    addPolyPoint(nextX, nextY) {
        if (!this.isPolyLasso) return;
        const x = Math.max(0, Math.min(this.width, Math.round(nextX)));
        const y = Math.max(0, Math.min(this.height, Math.round(nextY)));
        const last = this.polyPoints[this.polyPoints.length - 1];
        if (!last || Math.hypot(x - last.x, y - last.y) >= 3) {
            this.polyPoints.push({ x, y });
            this.polyHover = { x, y };
            this.notifyChange();
        }
    }

    updatePolyHover(curX, curY) {
        if (!this.isPolyLasso) return;
        const x = Math.max(0, Math.min(this.width, Math.round(curX)));
        const y = Math.max(0, Math.min(this.height, Math.round(curY)));
        this.polyHover = { x, y };
    }

    removeLastPolyPoint() {
        if (!this.isPolyLasso) return;
        if (this.polyPoints.length > 1) {
            this.polyPoints.pop();
            this.polyHover = { ...this.polyPoints[this.polyPoints.length - 1] };
            this.notifyChange();
        } else {
            this.cancelPolyLasso();
        }
    }

    commitPolyLasso(isAdd = false) {
        if (!this.isPolyLasso) return;
        if (this.polyPoints.length >= 3) {
            const newReg = { type: 'polygon', points: [...this.polyPoints] };
            if (isAdd || this.combineMode === 'add') {
                this.regions.push(newReg);
            } else {
                this.regions = [newReg];
            }
            this.active = true;
            this.buildPaths();
        }
        this.isPolyLasso = false;
        this.polyPoints = [];
        this.polyHover = null;
        this.notifyChange();
    }

    cancelPolyLasso() {
        this.isPolyLasso = false;
        this.polyPoints = [];
        this.polyHover = null;
        this.notifyChange();
    }

    // Seleccionar todo el lienzo (Ctrl + A)
    selectAll() {
        this.regions = [{ type: 'rect', x: 0, y: 0, w: this.width, h: this.height }];
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
        this.isPolyLasso = false;
        this.polyPoints = [];
        this.polyHover = null;
        this.rect = null;
        this.points = [];
        this.regions = [];
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

    // Construir objetos Path2D reutilizables para recorte multi-región
    buildPaths() {
        const p = new Path2D();

        if (this.regions.length === 0) {
            if (this.rect) {
                p.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
            } else if (this.points && this.points.length > 1) {
                p.moveTo(this.points[0].x, this.points[0].y);
                for (let i = 1; i < this.points.length; i++) {
                    const prev = this.points[i - 1];
                    const cur = this.points[i];
                    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 120) {
                        p.closePath();
                        p.moveTo(cur.x, cur.y);
                    } else {
                        p.lineTo(cur.x, cur.y);
                    }
                }
                p.closePath();
            }
        } else {
            for (const reg of this.regions) {
                if (reg.type === 'rect') {
                    p.rect(reg.x, reg.y, reg.w, reg.h);
                } else if (reg.type === 'polygon' && reg.points && reg.points.length > 1) {
                    p.moveTo(reg.points[0].x, reg.points[0].y);
                    for (let i = 1; i < reg.points.length; i++) {
                        const prev = reg.points[i - 1];
                        const cur = reg.points[i];
                        if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 120) {
                            p.closePath();
                            p.moveTo(cur.x, cur.y);
                        } else {
                            p.lineTo(cur.x, cur.y);
                        }
                    }
                    p.closePath();
                }
            }
        }

        this.path2D = p;

        // Máscara invertida usando la regla evenodd: Marco exterior total + caminos interiores
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
        if (testCtx) {
            inside = testCtx.isPointInPath(this.path2D, x, y);
        } else if (this.regions.length > 0) {
            for (const r of this.regions) {
                if (r.type === 'rect') {
                    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                        inside = true;
                        break;
                    }
                } else if (r.type === 'polygon' && r.points && r.points.length >= 3) {
                    let polyInside = false;
                    for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) {
                        const xi = r.points[i].x, yi = r.points[i].y;
                        const xj = r.points[j].x, yj = r.points[j].y;
                        if (Math.hypot(xi - xj, yi - yj) > 120) continue;
                        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                        if (intersect) polyInside = !polyInside;
                    }
                    if (polyInside) {
                        inside = true;
                        break;
                    }
                }
            }
        } else if (this.rect) {
            inside = (x >= this.rect.x && x <= this.rect.x + this.rect.w &&
                      y >= this.rect.y && y <= this.rect.y + this.rect.h);
        }

        return this.inverted ? !inside : inside;
    }

    notifyChange() {
        if (typeof this.onSelectionChange === 'function') {
            this.onSelectionChange({
                active: this.active,
                creating: this.creating,
                isPolyLasso: this.isPolyLasso,
                inverted: this.inverted,
                mode: this.toolMode,
                regionsCount: this.regions.length,
                combineMode: this.combineMode
            });
        }
    }

    // Renderizado en canvas-ui: Retícula punteada bicolor (Marching Ants), sombreado y guías de poli-lazo
    renderOverlay(ctxUI) {
        if (!this.active && !this.creating && !this.isPolyLasso) return;

        ctxUI.save();

        // 1. Tinte translúcido y Marching Ants de regiones activas confirmadas
        if (this.active && this.path2D) {
            ctxUI.save();
            if (this.inverted && this.invertPath2D) {
                ctxUI.fillStyle = 'rgba(0, 162, 255, 0.22)';
                ctxUI.fill(this.invertPath2D, 'evenodd');
            } else {
                ctxUI.fillStyle = 'rgba(0, 162, 255, 0.20)';
                ctxUI.fill(this.path2D);
            }
            ctxUI.restore();

            const lineW = Math.max(3, Math.round(this.width / 500));
            ctxUI.lineWidth = lineW;
            ctxUI.lineCap = 'round';
            ctxUI.lineJoin = 'round';

            // Pase 1: Guiones negros base
            ctxUI.strokeStyle = '#000000';
            ctxUI.setLineDash([10, 8]);
            ctxUI.lineDashOffset = -this.dashOffset;
            ctxUI.stroke(this.path2D);

            // Pase 2: Guiones cian brillante
            ctxUI.strokeStyle = '#00f3ff';
            ctxUI.setLineDash([10, 8]);
            ctxUI.lineDashOffset = -this.dashOffset + 9;
            ctxUI.stroke(this.path2D);
        }

        // 2. Previsualización de arrastre en vivo (Rectángulo o Lazo libre mientras se mantiene presionado)
        if (this.creating) {
            const dragPath = new Path2D();
            if (this.toolMode === 'select_rect' && this.rect) {
                dragPath.rect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
            } else if (this.toolMode === 'select_lasso' && this.points.length > 0) {
                dragPath.moveTo(this.points[0].x, this.points[0].y);
                for (let i = 1; i < this.points.length; i++) {
                    const prev = this.points[i - 1];
                    const cur = this.points[i];
                    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 120) {
                        dragPath.closePath();
                        dragPath.moveTo(cur.x, cur.y);
                    } else {
                        dragPath.lineTo(cur.x, cur.y);
                    }
                }
                dragPath.closePath();
            }

            ctxUI.save();
            ctxUI.fillStyle = 'rgba(0, 243, 255, 0.15)';
            ctxUI.fill(dragPath);
            ctxUI.lineWidth = Math.max(2, Math.round(this.width / 600));
            ctxUI.strokeStyle = '#00f3ff';
            ctxUI.setLineDash([6, 6]);
            ctxUI.stroke(dragPath);
            ctxUI.restore();
        }

        // 3. Previsualización interactiva de Lazo Poligonal 3D (Punto a Punto con Nodos y Guía)
        if (this.isPolyLasso && this.polyPoints.length > 0) {
            ctxUI.save();

            // Dibujar segmentos poligonales ya marcados
            ctxUI.beginPath();
            ctxUI.moveTo(this.polyPoints[0].x, this.polyPoints[0].y);
            for (let i = 1; i < this.polyPoints.length; i++) {
                ctxUI.lineTo(this.polyPoints[i].x, this.polyPoints[i].y);
            }

            // Si hay hover dinámico, trazar línea guía punteada hasta el puntero
            if (this.polyHover) {
                ctxUI.lineTo(this.polyHover.x, this.polyHover.y);
            }

            ctxUI.lineWidth = Math.max(2, Math.round(this.width / 600));
            ctxUI.strokeStyle = '#ffaa00';
            ctxUI.setLineDash([8, 6]);
            ctxUI.stroke();

            // Dibujar nodos/vértices circulares interactivos
            for (let i = 0; i < this.polyPoints.length; i++) {
                const pt = this.polyPoints[i];
                const isStart = (i === 0);
                const r = isStart ? 6 : 4;

                ctxUI.beginPath();
                ctxUI.arc(pt.x, pt.y, r, 0, Math.PI * 2);
                ctxUI.fillStyle = isStart ? '#00f3ff' : '#ffffff';
                ctxUI.fill();
                ctxUI.lineWidth = 1.5;
                ctxUI.strokeStyle = '#000000';
                ctxUI.setLineDash([]);
                ctxUI.stroke();

                // Si es el nodo inicial y el cursor está cerca, mostrar indicador de cerrar anillo
                if (isStart && this.polyHover && this.polyPoints.length >= 3) {
                    const distToStart = Math.hypot(this.polyHover.x - pt.x, this.polyHover.y - pt.y);
                    if (distToStart < 25) {
                        ctxUI.beginPath();
                        ctxUI.arc(pt.x, pt.y, 11, 0, Math.PI * 2);
                        ctxUI.strokeStyle = '#00ff88';
                        ctxUI.lineWidth = 2.5;
                        ctxUI.stroke();
                    }
                }
            }

            ctxUI.restore();
        }

        ctxUI.restore();
    }
}
