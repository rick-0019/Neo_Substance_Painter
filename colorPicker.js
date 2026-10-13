// colorPicker.js - Selector de Color Profesional para Neo Substance Painter
// Soporta gradiente 2D Sat/Val, barra Hue, valores numéricos RGB (0-255), HEX (#), HSV,
// comparación de color, muestras temáticas (Macross VF-1, Militar, Básicos), recientes y personalizadas.

export class ColorPickerManager {
    constructor() {
        this.currentColor = '#FF0000';
        this.previousColor = '#FF0000';
        this.rgb = { r: 255, g: 0, b: 0 };
        this.hsv = { h: 0, s: 1, v: 1 };
        this.isOpen = false;
        this.activeTab = 'recents';

        this.presetPalettes = {
            macross: [
                { name: 'Blanco Fuselaje', hex: '#F2EFE9' },
                { name: 'Negro Antirreflejo / Goma', hex: '#1C1C1C' },
                { name: 'Rojo U.N. Spacy', hex: '#D32F2F' },
                { name: 'Amarillo Rescate / Alerta', hex: '#FBC02D' },
                { name: 'Gris Turbinas / Mecánica', hex: '#455A64' },
                { name: 'Gris Interior Cockpit', hex: '#78909C' },
                { name: 'Celeste Canard Roy Focker', hex: '#0288D1' },
                { name: 'Verde Sensores / HUD', hex: '#388E3C' },
                { name: 'Gris Claro Fuselaje', hex: '#D6D6D6' },
                { name: 'Grafito Oscuro Paneles', hex: '#37474F' },
                { name: 'Ámbar Luces Navegación', hex: '#FF8F00' },
                { name: 'Azul Escuadrón Skull', hex: '#3949AB' }
            ],
            military: [
                { name: 'Verde Oliva (Olive Drab)', hex: '#4B5320' },
                { name: 'Gris Neutro Caza', hex: '#6E7166' },
                { name: 'Arena Desierto (Desert Tan)', hex: '#C2B280' },
                { name: 'Tierra Oscura (Dark Earth)', hex: '#5C4033' },
                { name: 'Azul Cielo Caza (Sky Blue)', hex: '#4682B4' },
                { name: 'Gris Pizarra Marina', hex: '#2F4F4F' },
                { name: 'Verde Bosque Militar', hex: '#355E3B' },
                { name: 'Gunmetal Cañón', hex: '#2C3539' },
                { name: 'Verde Interior Cabina', hex: '#708238' },
                { name: 'Blanco Nieve Camo', hex: '#F5F5F5' },
                { name: 'Negro Mate Exhaust', hex: '#111111' },
                { name: 'Marrón Camo OTAN', hex: '#4A3B32' }
            ]
        };

        this.recentColors = this.loadRecentColors();
        this.customSwatches = this.loadCustomSwatches();

        this.isDraggingSV = false;
        this.isDraggingHue = false;
    }

    // --- Carga y Guardado en LocalStorage ---
    loadRecentColors() {
        try {
            const saved = localStorage.getItem('nsp_recent_colors');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 16);
            }
        } catch (e) {
            console.warn('Error loading recent colors:', e);
        }
        return ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000', '#808080', '#FFFF00', '#00FFFF', '#FF00FF', '#F2EFE9', '#D32F2F', '#455A64'];
    }

    saveRecentColors() {
        try {
            localStorage.setItem('nsp_recent_colors', JSON.stringify(this.recentColors.slice(0, 16)));
        } catch (e) {}
    }

    loadCustomSwatches() {
        try {
            const saved = localStorage.getItem('nsp_custom_swatches');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {}
        return ['#F2EFE9', '#D32F2F', '#1C1C1C', '#FBC02D', '#78909C'];
    }

    saveCustomSwatches() {
        try {
            localStorage.setItem('nsp_custom_swatches', JSON.stringify(this.customSwatches));
        } catch (e) {}
    }

    addRecentColor(hex) {
        if (!hex) return;
        hex = hex.toUpperCase();
        this.recentColors = [hex, ...this.recentColors.filter(c => c.toUpperCase() !== hex)].slice(0, 16);
        this.saveRecentColors();
        if (this.activeTab === 'recents') {
            this.renderSwatches();
        }
    }

    // --- Conversión Matemática de Color ---
    static hsvToRgb(h, s, v) {
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        let r1 = 0, g1 = 0, b1 = 0;
        if (h >= 0 && h < 60) { r1 = c; g1 = x; b1 = 0; }
        else if (h >= 60 && h < 120) { r1 = x; g1 = c; b1 = 0; }
        else if (h >= 120 && h < 180) { r1 = 0; g1 = c; b1 = x; }
        else if (h >= 180 && h < 240) { r1 = 0; g1 = x; b1 = c; }
        else if (h >= 240 && h < 300) { r1 = x; g1 = 0; b1 = c; }
        else { r1 = c; g1 = 0; b1 = x; }
        return {
            r: Math.max(0, Math.min(255, Math.round((r1 + m) * 255))),
            g: Math.max(0, Math.min(255, Math.round((g1 + m) * 255))),
            b: Math.max(0, Math.min(255, Math.round((b1 + m) * 255)))
        };
    }

    static rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        let h = 0;
        if (delta !== 0) {
            if (max === r) h = 60 * (((g - b) / delta) % 6);
            else if (max === g) h = 60 * (((b - r) / delta) + 2);
            else h = 60 * (((r - g) / delta) + 4);
        }
        if (h < 0) h += 360;
        const s = max === 0 ? 0 : delta / max;
        const v = max;
        return {
            h: Math.round(h) % 360,
            s: Math.max(0, Math.min(1, s)),
            v: Math.max(0, Math.min(1, v))
        };
    }

    static rgbToHex(r, g, b) {
        const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
    }

    static hexToRgb(hex) {
        if (!hex) return { r: 255, g: 0, b: 0 };
        hex = hex.replace(/^#/, '').trim();
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        if (hex.length !== 6) return { r: 255, g: 0, b: 0 };
        const num = parseInt(hex, 16);
        if (isNaN(num)) return { r: 255, g: 0, b: 0 };
        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255
        };
    }

    // --- Inicialización del Sistema UI ---
    init() {
        this.cacheDom();
        if (!this.dom.popup) return;

        this.initCanvases();
        this.bindEvents();

        // Leer color inicial desde el input existente
        const initialHex = this.dom.brushColorInput?.value || '#FF0000';
        this.setColor(initialHex, false);
    }

    cacheDom() {
        this.dom = {
            popup: document.getElementById('color-picker-popup'),
            trigger: document.getElementById('btn-open-color-picker'),
            previewBox: document.getElementById('brush-color-preview'),
            hexLabel: document.getElementById('brush-color-hex-label'),
            brushColorInput: document.getElementById('brush-color'),
            btnClose: document.getElementById('btn-close-color-picker'),
            btnApply: document.getElementById('cp-btn-apply'),
            
            // Canvases
            svCanvas: document.getElementById('cp-sv-canvas'),
            svHandle: document.getElementById('cp-sv-handle'),
            hueCanvas: document.getElementById('cp-hue-canvas'),
            hueHandle: document.getElementById('cp-hue-handle'),

            // Previews
            previewNew: document.getElementById('cp-preview-new'),
            previewCurrent: document.getElementById('cp-preview-current'),
            btnEyedropper: document.getElementById('cp-btn-eyedropper'),
            btnAddSwatch: document.getElementById('cp-btn-add-swatch'),

            // Inputs numéricos
            inputR: document.getElementById('cp-input-r'),
            inputG: document.getElementById('cp-input-g'),
            inputB: document.getElementById('cp-input-b'),
            inputH: document.getElementById('cp-input-h'),
            inputS: document.getElementById('cp-input-s'),
            inputV: document.getElementById('cp-input-v'),
            inputHex: document.getElementById('cp-input-hex'),
            btnCopyHex: document.getElementById('cp-btn-copy-hex'),

            // Paletas
            tabsContainer: document.getElementById('cp-palette-tabs'),
            swatchesGrid: document.getElementById('cp-swatches-grid'),
            paletteHint: document.getElementById('cp-palette-hint')
        };
    }

    initCanvases() {
        this.drawHueCanvas();
        this.drawSVCanvas();
    }

    drawHueCanvas() {
        const canvas = this.dom.hueCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0 / 6, '#ff0000');
        grad.addColorStop(1 / 6, '#ffff00');
        grad.addColorStop(2 / 6, '#00ff00');
        grad.addColorStop(3 / 6, '#00ffff');
        grad.addColorStop(4 / 6, '#0000ff');
        grad.addColorStop(5 / 6, '#ff00ff');
        grad.addColorStop(6 / 6, '#ff0000');

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    drawSVCanvas() {
        const canvas = this.dom.svCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        // Base de tono puro
        ctx.fillStyle = `hsl(${this.hsv.h}, 100%, 50%)`;
        ctx.fillRect(0, 0, w, h);

        // Blanco de izquierda a derecha
        const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        whiteGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = whiteGrad;
        ctx.fillRect(0, 0, w, h);

        // Negro de arriba a abajo
        const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        blackGrad.addColorStop(1, 'rgba(0, 0, 0, 1)');
        ctx.fillStyle = blackGrad;
        ctx.fillRect(0, 0, w, h);
    }

    updateHandlesPositions() {
        if (this.dom.svCanvas && this.dom.svHandle) {
            const w = this.dom.svCanvas.width;
            const h = this.dom.svCanvas.height;
            const x = Math.round(this.hsv.s * w);
            const y = Math.round((1 - this.hsv.v) * h);
            this.dom.svHandle.style.left = `${x}px`;
            this.dom.svHandle.style.top = `${y}px`;
        }

        if (this.dom.hueCanvas && this.dom.hueHandle) {
            const h = this.dom.hueCanvas.height;
            const y = Math.round((this.hsv.h / 360) * h);
            this.dom.hueHandle.style.top = `${y}px`;
        }
    }

    // --- Establecer y Sincronizar Color ---
    setColor(hexOrRgb, notify = true, source = '') {
        let rgb;
        if (typeof hexOrRgb === 'string') {
            rgb = ColorPickerManager.hexToRgb(hexOrRgb);
        } else if (hexOrRgb && typeof hexOrRgb === 'object') {
            rgb = hexOrRgb;
        } else {
            rgb = { r: 255, g: 0, b: 0 };
        }

        this.rgb = rgb;
        this.currentColor = ColorPickerManager.rgbToHex(rgb.r, rgb.g, rgb.b);
        this.hsv = ColorPickerManager.rgbToHsv(rgb.r, rgb.g, rgb.b);

        this.updateUI(source);

        if (notify) {
            this.broadcastColor(this.currentColor);
        }
    }

    setColorFromHSV(h, s, v, notify = true, source = '') {
        this.hsv = {
            h: Math.max(0, Math.min(360, Math.round(h))),
            s: Math.max(0, Math.min(1, s)),
            v: Math.max(0, Math.min(1, v))
        };
        this.rgb = ColorPickerManager.hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
        this.currentColor = ColorPickerManager.rgbToHex(this.rgb.r, this.rgb.g, this.rgb.b);

        this.updateUI(source);

        if (notify) {
            this.broadcastColor(this.currentColor);
        }
    }

    updateUI(source = '') {
        // Redibujar lienzo SV si cambió el Hue
        this.drawSVCanvas();
        this.updateHandlesPositions();

        // Actualizar previsualización en el popover
        if (this.dom.previewNew) {
            this.dom.previewNew.style.backgroundColor = this.currentColor;
        }

        // Actualizar botón del ribbon
        if (this.dom.previewBox) {
            this.dom.previewBox.style.backgroundColor = this.currentColor;
        }
        if (this.dom.hexLabel) {
            this.dom.hexLabel.textContent = this.currentColor;
        }
        if (this.dom.brushColorInput) {
            this.dom.brushColorInput.value = this.currentColor;
        }

        // Actualizar inputs numéricos si no son la fuente activa de escritura
        if (source !== 'rgb') {
            if (this.dom.inputR) this.dom.inputR.value = this.rgb.r;
            if (this.dom.inputG) this.dom.inputG.value = this.rgb.g;
            if (this.dom.inputB) this.dom.inputB.value = this.rgb.b;
        }
        if (source !== 'hsv') {
            if (this.dom.inputH) this.dom.inputH.value = this.hsv.h;
            if (this.dom.inputS) this.dom.inputS.value = Math.round(this.hsv.s * 100);
            if (this.dom.inputV) this.dom.inputV.value = Math.round(this.hsv.v * 100);
        }
        if (source !== 'hex') {
            if (this.dom.inputHex) this.dom.inputHex.value = this.currentColor.replace('#', '');
        }

        // Marcar swatch activo si existe en la grilla
        const swatches = this.dom.swatchesGrid?.querySelectorAll('.cp-swatch-item');
        swatches?.forEach(sw => {
            const hex = sw.getAttribute('data-hex')?.toUpperCase();
            sw.classList.toggle('active', hex === this.currentColor.toUpperCase());
        });
    }

    broadcastColor(hex) {
        if (typeof window.updateActiveQuickColor === 'function') {
            window.updateActiveQuickColor(hex);
        }
        if (window.decalSystem && window.decalSystem.selectedDecalId) {
            window.decalSystem.updateSelectedShapeFillFromColor(hex);
        }
    }

    // --- Apertura y Cierre del Popover ---
    open() {
        if (!this.dom.popup) return;
        this.previousColor = this.currentColor;
        if (this.dom.previewCurrent) {
            this.dom.previewCurrent.style.backgroundColor = this.previousColor;
        }

        // Posicionar el panel debajo de la caja de color del ribbon
        const rect = (this.dom.trigger || this.dom.previewBox).getBoundingClientRect();
        this.dom.popup.style.top = `${rect.bottom + 6}px`;

        const panelWidth = 440;
        let left = rect.left - 40;
        if (left + panelWidth > window.innerWidth - 10) {
            left = window.innerWidth - panelWidth - 10;
        }
        if (left < 10) left = 10;

        this.dom.popup.style.left = `${left}px`;
        this.dom.popup.style.display = 'block';
        this.isOpen = true;

        this.renderSwatches();
        this.updateHandlesPositions();
    }

    close(apply = true) {
        if (!this.dom.popup) return;
        if (!apply) {
            // Cancelar y restaurar color anterior
            this.setColor(this.previousColor, true);
        } else {
            // Guardar en recientes al confirmar
            this.addRecentColor(this.currentColor);
        }
        this.dom.popup.style.display = 'none';
        this.isOpen = false;
    }

    toggle() {
        if (this.isOpen) this.close(true);
        else this.open();
    }

    // --- Renderizado de Paletas ---
    renderSwatches() {
        const grid = this.dom.swatchesGrid;
        if (!grid) return;
        grid.innerHTML = '';

        let colors = [];
        if (this.activeTab === 'recents') {
            colors = this.recentColors.map(hex => ({ hex, name: hex }));
            if (this.dom.paletteHint) this.dom.paletteHint.textContent = 'Historial automático';
        } else if (this.activeTab === 'macross') {
            colors = this.presetPalettes.macross;
            if (this.dom.paletteHint) this.dom.paletteHint.textContent = 'Esquema oficial VF-1 / Mecha';
        } else if (this.activeTab === 'military') {
            colors = this.presetPalettes.military;
            if (this.dom.paletteHint) this.dom.paletteHint.textContent = 'Colores de camuflaje y aviación';
        } else if (this.activeTab === 'custom') {
            colors = this.customSwatches.map(hex => ({ hex, name: hex }));
            if (this.dom.paletteHint) this.dom.paletteHint.textContent = 'Clic derecho para borrar muestra';
        }

        if (colors.length === 0) {
            grid.innerHTML = '<span style="grid-column: 1 / -1; font-size: 10px; color: #777; text-align: center; padding: 4px;">Sin muestras guardadas</span>';
            return;
        }

        colors.forEach((item) => {
            const sw = document.createElement('div');
            sw.className = 'cp-swatch-item';
            sw.style.backgroundColor = item.hex;
            sw.setAttribute('data-hex', item.hex);
            sw.title = item.name ? `${item.name} (${item.hex})` : item.hex;

            if (item.hex.toUpperCase() === this.currentColor.toUpperCase()) {
                sw.classList.add('active');
            }

            sw.addEventListener('click', () => {
                this.setColor(item.hex, true, 'swatch');
            });

            if (this.activeTab === 'custom') {
                sw.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.customSwatches = this.customSwatches.filter(c => c.toUpperCase() !== item.hex.toUpperCase());
                    this.saveCustomSwatches();
                    this.renderSwatches();
                });
            }

            grid.appendChild(sw);
        });
    }

    // --- Event Listeners e Interacción ---
    bindEvents() {
        // Abrir/Cerrar
        this.dom.trigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        this.dom.btnClose?.addEventListener('click', () => this.close(false));
        this.dom.btnApply?.addEventListener('click', () => this.close(true));

        // Cerrar si hace clic fuera
        document.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            if (!this.dom.popup?.contains(e.target) && !this.dom.trigger?.contains(e.target)) {
                this.close(true);
            }
        });

        // Click en color actual para revertir
        this.dom.previewCurrent?.addEventListener('click', () => {
            this.setColor(this.previousColor, true);
        });

        // Gotero interno
        this.dom.btnEyedropper?.addEventListener('click', () => {
            document.getElementById('btn-eyedropper')?.click();
            this.close(true);
        });

        // Botón Guardar en Mis Muestras
        this.dom.btnAddSwatch?.addEventListener('click', () => {
            const hex = this.currentColor.toUpperCase();
            if (!this.customSwatches.includes(hex)) {
                this.customSwatches.unshift(hex);
                this.saveCustomSwatches();
            }
            this.switchTab('custom');
        });

        // Pestañas de paletas
        this.dom.tabsContainer?.querySelectorAll('.cp-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                this.switchTab(tab);
            });
        });

        // Canvas SV Drag
        const handleSVMouse = (e) => {
            const rect = this.dom.svCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
            const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

            const s = x / rect.width;
            const v = 1 - (y / rect.height);
            this.setColorFromHSV(this.hsv.h, s, v, true, 'sv');
        };

        this.dom.svCanvas?.addEventListener('mousedown', (e) => {
            this.isDraggingSV = true;
            handleSVMouse(e);
        });
        this.dom.svCanvas?.addEventListener('touchstart', (e) => {
            this.isDraggingSV = true;
            handleSVMouse(e);
        }, { passive: true });

        // Canvas Hue Drag
        const handleHueMouse = (e) => {
            const rect = this.dom.hueCanvas.getBoundingClientRect();
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const y = Math.max(0, Math.min(rect.height, clientY - rect.top));

            const h = (y / rect.height) * 360;
            this.setColorFromHSV(h, this.hsv.s, this.hsv.v, true, 'hue');
        };

        this.dom.hueCanvas?.addEventListener('mousedown', (e) => {
            this.isDraggingHue = true;
            handleHueMouse(e);
        });
        this.dom.hueCanvas?.addEventListener('touchstart', (e) => {
            this.isDraggingHue = true;
            handleHueMouse(e);
        }, { passive: true });

        // Arrastre global en ventana
        window.addEventListener('mousemove', (e) => {
            if (this.isDraggingSV) handleSVMouse(e);
            else if (this.isDraggingHue) handleHueMouse(e);
        });
        window.addEventListener('touchmove', (e) => {
            if (this.isDraggingSV) handleSVMouse(e);
            else if (this.isDraggingHue) handleHueMouse(e);
        }, { passive: true });

        window.addEventListener('mouseup', () => {
            this.isDraggingSV = false;
            this.isDraggingHue = false;
        });
        window.addEventListener('touchend', () => {
            this.isDraggingSV = false;
            this.isDraggingHue = false;
        });

        // Entradas RGB
        const handleRgbInput = () => {
            const r = parseInt(this.dom.inputR.value, 10) || 0;
            const g = parseInt(this.dom.inputG.value, 10) || 0;
            const b = parseInt(this.dom.inputB.value, 10) || 0;
            this.setColor({
                r: Math.max(0, Math.min(255, r)),
                g: Math.max(0, Math.min(255, g)),
                b: Math.max(0, Math.min(255, b))
            }, true, 'rgb');
        };
        this.dom.inputR?.addEventListener('input', handleRgbInput);
        this.dom.inputG?.addEventListener('input', handleRgbInput);
        this.dom.inputB?.addEventListener('input', handleRgbInput);

        // Entradas HSV
        const handleHsvInput = () => {
            const h = parseInt(this.dom.inputH.value, 10) || 0;
            const s = (parseInt(this.dom.inputS.value, 10) || 0) / 100;
            const v = (parseInt(this.dom.inputV.value, 10) || 0) / 100;
            this.setColorFromHSV(h, s, v, true, 'hsv');
        };
        this.dom.inputH?.addEventListener('input', handleHsvInput);
        this.dom.inputS?.addEventListener('input', handleHsvInput);
        this.dom.inputV?.addEventListener('input', handleHsvInput);

        // Entrada HEX
        this.dom.inputHex?.addEventListener('input', (e) => {
            let val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
            if (val.length === 6 || val.length === 3) {
                this.setColor('#' + val, true, 'hex');
            }
        });
        this.dom.inputHex?.addEventListener('change', (e) => {
            let val = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
            if (val.length === 6 || val.length === 3) {
                this.setColor('#' + val, true, 'hex');
            } else {
                e.target.value = this.currentColor.replace('#', '');
            }
        });

        // Copiar HEX
        this.dom.btnCopyHex?.addEventListener('click', () => {
            navigator.clipboard.writeText(this.currentColor).then(() => {
                const prev = this.dom.btnCopyHex.textContent;
                this.dom.btnCopyHex.textContent = '✓';
                setTimeout(() => { this.dom.btnCopyHex.textContent = prev; }, 1200);
            }).catch(() => {});
        });
    }

    switchTab(tab) {
        this.activeTab = tab;
        this.dom.tabsContainer?.querySelectorAll('.cp-tab-btn').forEach(btn => {
            const isTarget = btn.getAttribute('data-tab') === tab;
            btn.classList.toggle('active', isTarget);
            btn.style.background = isTarget ? '#333' : '#222';
            btn.style.color = isTarget ? '#fff' : '#aaa';
            btn.style.borderColor = isTarget ? '#ff9800' : '#444';
        });
        this.renderSwatches();
    }
}
