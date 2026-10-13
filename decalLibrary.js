// decalLibrary.js - Catálogo y Biblioteca Interna de Calcas / Pegatinas para Neo Substance Painter
// Soporta escaneo dinámico de carpetas locales (calcas/insignias, avisos, mecanica, mis_calcas),
// sincronización en vivo con el servidor local, subida con respaldo físico en disco y categorización.

export class DecalLibraryManager {
    constructor() {
        this.isOpen = false;
        this.activeCategory = 'all';
        this.searchQuery = '';
        this.serverDecals = [];
        this.userDecals = this.loadUserDecals();
        this.dom = {};
    }

    loadUserDecals() {
        try {
            const saved = localStorage.getItem('nsp_user_decals');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch (e) {
            console.warn('Error cargando calcas de usuario locales:', e);
        }
        return [];
    }

    saveUserDecals() {
        try {
            localStorage.setItem('nsp_user_decals', JSON.stringify(this.userDecals));
        } catch (e) {
            console.warn('Error guardando calcas de usuario:', e);
        }
    }

    async init() {
        this.cacheDom();
        if (!this.dom.popup) return;
        this.bindEvents();
        await this.syncDecalsFromServer();
        this.renderTabsCount();
        this.renderGrid();
    }

    cacheDom() {
        this.dom = {
            popup: document.getElementById('decal-library-popup'),
            trigger: document.getElementById('btn-load-decal'),
            btnClose: document.getElementById('btn-close-decal-library'),
            btnRefresh: document.getElementById('btn-decal-refresh'),
            searchInput: document.getElementById('decal-library-search'),
            categoryTabs: document.getElementById('decal-library-tabs'),
            grid: document.getElementById('decal-library-grid'),
            btnImportPC: document.getElementById('btn-decal-import-pc'),
            fileInput: document.getElementById('input-decal'),
            previewThumb: document.getElementById('decal-preview-thumb')
        };
    }

    async syncDecalsFromServer() {
        try {
            const res = await fetch('/api/decals');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    this.serverDecals = data;
                    return;
                }
            }
        } catch (e) {
            // Servidor no disponible o modo estático (ej: GitHub Pages)
        }

        // Intento 2: manifest.json estático en calcas/
        try {
            const resManifest = await fetch('./calcas/manifest.json');
            if (resManifest.ok) {
                const manifestData = await resManifest.json();
                if (Array.isArray(manifestData)) {
                    this.serverDecals = manifestData;
                    return;
                }
            }
        } catch (e) {}
    }

    getAllDecals() {
        if (this.serverDecals && this.serverDecals.length > 0) {
            // Combinar calcas del servidor con calcas locales de memoria que aún no estén en disco
            const serverFilenames = new Set(this.serverDecals.map(d => d.filename || d.name));
            const extraLocal = this.userDecals.filter(d => !serverFilenames.has(d.filename || d.name));
            return [...extraLocal, ...this.serverDecals];
        }
        return this.userDecals;
    }

    bindEvents() {
        // Abrir biblioteca al pulsar "Pegatinas" en el Ribbon
        this.dom.trigger?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        });

        // Abrir biblioteca si se hace clic en la miniatura de calca activa del ribbon
        this.dom.previewThumb?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggle();
        });

        // Botón cerrar
        this.dom.btnClose?.addEventListener('click', () => this.close());

        // Botón Refrescar / Re-escanear carpeta
        this.dom.btnRefresh?.addEventListener('click', async () => {
            if (this.dom.btnRefresh) this.dom.btnRefresh.textContent = '⏳ Escaneando...';
            await this.syncDecalsFromServer();
            this.renderTabsCount();
            this.renderGrid();
            if (this.dom.btnRefresh) {
                this.dom.btnRefresh.textContent = '✓ Listo';
                setTimeout(() => { if (this.dom.btnRefresh) this.dom.btnRefresh.textContent = '🔄 Actualizar'; }, 1200);
            }
        });

        // Cerrar al hacer clic fuera del panel
        document.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            if (e.target.closest('#decal-library-popup') || 
                e.target.closest('#btn-load-decal') || 
                e.target.closest('#decal-preview-thumb') ||
                e.target.closest('.decal-context-menu')) {
                return;
            }
            this.close();
        });

        // Buscador reactivo
        this.dom.searchInput?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase().trim();
            this.renderGrid();
        });

        // Selector de Categorías (Tabs)
        this.dom.categoryTabs?.querySelectorAll('.decal-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.getAttribute('data-cat');
                this.switchCategory(cat);
            });
        });

        // Botón Importar desde PC
        this.dom.btnImportPC?.addEventListener('click', () => {
            this.dom.fileInput?.click();
        });

        // Cargar archivo nuevo y guardarlo en la biblioteca
        this.dom.fileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.importFile(file);
            }
            e.target.value = '';
        });

        // Soporte Drag & Drop sobre el panel
        const popup = this.dom.popup;
        if (popup) {
            popup.addEventListener('dragover', (e) => {
                e.preventDefault();
                popup.style.borderColor = '#00f3ff';
            });
            popup.addEventListener('dragleave', (e) => {
                e.preventDefault();
                popup.style.borderColor = '#555';
            });
            popup.addEventListener('drop', (e) => {
                e.preventDefault();
                popup.style.borderColor = '#555';
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith('image/')) {
                    this.importFile(file);
                }
            });
        }
    }

    async importFile(file) {
        const decalName = file.name.replace(/\.[^/.]+$/, '');
        const reader = new FileReader();
        reader.onload = async (event) => {
            const dataUrl = event.target.result;
            const newDecal = {
                id: 'custom_' + Date.now(),
                name: decalName,
                filename: file.name,
                category: 'mis_calcas',
                tags: [decalName.toLowerCase(), 'custom', 'importada'],
                src: dataUrl,
                isUser: true
            };

            // 1. Guardar en respaldo local del navegador
            this.userDecals.unshift(newDecal);
            this.saveUserDecals();

            // 2. Enviar al servidor para respaldo físico permanente en calcas/mis_calcas/
            try {
                const uploadRes = await fetch('/api/decals/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: decalName,
                        category: 'mis_calcas',
                        dataUrl: dataUrl
                    })
                });
                if (uploadRes.ok) {
                    const resJson = await uploadRes.json();
                    if (resJson.decals) {
                        this.serverDecals = resJson.decals;
                    }
                }
            } catch (err) {
                console.warn('No se pudo respaldar físicamente en disco por el servidor:', err);
            }

            this.renderTabsCount();
            this.switchCategory('mis_calcas');

            // Cargar y activar inmediatamente en el lienzo
            this.applyDecal(newDecal);
        };
        reader.readAsDataURL(file);
    }

    showToast(message, isSuccess = true) {
        let toast = document.getElementById('decal-library-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'decal-library-toast';
            toast.style.position = 'fixed';
            toast.style.bottom = '24px';
            toast.style.right = '24px';
            toast.style.zIndex = '10015';
            toast.style.padding = '8px 16px';
            toast.style.borderRadius = '5px';
            toast.style.fontSize = '12px';
            toast.style.fontWeight = 'bold';
            toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
            toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            toast.style.pointerEvents = 'none';
            document.body.appendChild(toast);
        }
        toast.style.background = isSuccess ? '#2e7d32' : '#c62828';
        toast.style.color = '#fff';
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            if (toast) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(8px)';
            }
        }, 2200);
    }

    async deleteDecal(item) {
        if (!confirm(`¿Eliminar la pegatina "${item.name}"?`)) return;

        const cat = (item.category === 'custom' ? 'mis_calcas' : item.category) || 'mis_calcas';
        const filename = item.filename || item.name;

        // 1. Borrar de la copia local
        this.userDecals = this.userDecals.filter(d => d.id !== item.id && (!item.filename || d.filename !== item.filename));
        this.saveUserDecals();

        // 2. Si está en el servidor, borrar del disco
        try {
            const res = await fetch('/api/decals/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category: cat,
                    filename: filename
                })
            });
            if (res.ok) {
                const resJson = await res.json();
                if (resJson.decals) {
                    this.serverDecals = resJson.decals;
                }
            }
        } catch (e) {
            console.warn('Error eliminando archivo en disco:', e);
        }

        this.renderTabsCount();
        this.renderGrid();
        this.showToast(`🗑️ Pegatina "${item.name}" eliminada`);
    }

    async recategorizeDecal(item, newCategory) {
        if (!item || !newCategory) return;
        const fromCat = (item.category === 'custom' ? 'mis_calcas' : item.category) || 'mis_calcas';
        if (fromCat === newCategory) return;

        const filename = item.filename || item.name;

        // 1. Actualizar el elemento en memoria
        item.category = newCategory;

        // 2. Si está en localStorage, actualizar su categoría
        if (this.userDecals) {
            const local = this.userDecals.find(d => d.id === item.id || (item.filename && d.filename === item.filename));
            if (local) {
                local.category = newCategory;
                this.saveUserDecals();
            }
        }

        // 3. Notificar al backend para mover el archivo físico en calcas/
        try {
            const res = await fetch('/api/decals/recategorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromCategory: fromCat,
                    toCategory: newCategory,
                    filename: filename
                })
            });
            if (res.ok) {
                const resJson = await res.json();
                if (resJson.decals) {
                    this.serverDecals = resJson.decals;
                }
            }
        } catch (e) {
            console.warn('Error reclasificando en disco:', e);
        }

        // 4. Cambiar automáticamente a la categoría destino para que el usuario vea su calca allí
        this.switchCategory(newCategory);
        this.renderTabsCount();
        this.renderGrid();

        const catNames = {
            insignias: 'Insignias & Logos',
            avisos: 'Avisos Técnicos',
            mecanica: 'Mecánica & Paneles',
            mis_calcas: 'Mis Calcas'
        };
        this.showToast(`✓ Movida a "${catNames[newCategory] || newCategory}"`);
    }

    switchCategory(cat) {
        this.activeCategory = cat;
        this.dom.categoryTabs?.querySelectorAll('.decal-tab-btn').forEach(btn => {
            const isTarget = btn.getAttribute('data-cat') === cat;
            btn.classList.toggle('active', isTarget);
            btn.style.background = isTarget ? '#1976d2' : '#252525';
            btn.style.borderColor = isTarget ? '#00f3ff' : '#444';
            btn.style.color = isTarget ? '#fff' : '#ccc';
        });
        this.renderGrid();
    }

    renderTabsCount() {
        const all = this.getAllDecals();
        const counts = {
            all: all.length,
            insignias: all.filter(d => d.category === 'insignias').length,
            avisos: all.filter(d => d.category === 'avisos').length,
            mecanica: all.filter(d => d.category === 'mecanica').length,
            mis_calcas: all.filter(d => d.category === 'mis_calcas' || d.category === 'custom').length
        };

        this.dom.categoryTabs?.querySelectorAll('.decal-tab-btn').forEach(btn => {
            const cat = btn.getAttribute('data-cat');
            const badge = btn.querySelector('.tab-count');
            if (badge && counts[cat] !== undefined) {
                badge.textContent = `(${counts[cat]})`;
            }
        });
    }

    renderGrid() {
        const grid = this.dom.grid;
        if (!grid) return;
        grid.innerHTML = '';

        const all = this.getAllDecals();
        const q = this.searchQuery;

        const filtered = all.filter(item => {
            const catMatch = (this.activeCategory === 'all') || 
                             (this.activeCategory === 'mis_calcas' && (item.category === 'mis_calcas' || item.category === 'custom')) ||
                             (item.category === this.activeCategory);
            if (!catMatch) return false;

            if (!q) return true;
            const nameMatch = item.name.toLowerCase().includes(q);
            const filenameMatch = item.filename && item.filename.toLowerCase().includes(q);
            const tagsMatch = item.tags && item.tags.some(t => t.includes(q));
            return nameMatch || filenameMatch || tagsMatch;
        });

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: #888; font-size: 12px;">
                    <span>🔍 No se encontraron pegatinas que coincidan con "${q}".</span>
                </div>
            `;
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'decal-card-item';
            card.setAttribute('data-id', item.id);
            card.title = `${item.name} (${item.filename || ''})\nClic para colocar en el modelo\nClic derecho para opciones`;

            const isCustom = item.isUser || item.category === 'mis_calcas' || item.category === 'custom';

            card.innerHTML = `
                <div class="decal-card-thumb decal-checker-bg">
                    <img src="${item.src}" alt="${item.name}" loading="lazy">
                </div>
                <div class="decal-card-info">
                    <span class="decal-card-title">${item.name}</span>
                </div>
                ${isCustom ? `<button type="button" class="decal-card-del-btn" title="Eliminar calca de la biblioteca">🗑️</button>` : ''}
            `;

            // Botón eliminar visible en la tarjeta para calcas del usuario
            if (isCustom) {
                const delBtn = card.querySelector('.decal-card-del-btn');
                delBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteDecal(item);
                });
            }

            // Menú contextual en clic derecho para opciones de administración
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showContextMenu(e.clientX, e.clientY, item);
            });

            // Click para seleccionar y colocar en el modelo
            card.addEventListener('click', () => {
                this.applyDecal(item);
                this.close();
            });

            grid.appendChild(card);
        });
    }

    showContextMenu(x, y, item) {
        // Remover menú anterior si existiera
        document.querySelectorAll('.decal-context-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'decal-context-menu';
        menu.style.position = 'fixed';
        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;
        menu.style.zIndex = '10005';
        menu.style.background = '#252525';
        menu.style.border = '1px solid #555';
        menu.style.borderRadius = '6px';
        menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.8)';
        menu.style.padding = '4px 0';
        menu.style.minWidth = '170px';
        menu.style.fontSize = '11px';
        menu.style.color = '#eee';

        const currentCategory = (item.category === 'custom' ? 'mis_calcas' : item.category) || 'mis_calcas';

        const categories = [
            { id: 'insignias', label: '🎖️ Mover a Insignias & Logos' },
            { id: 'avisos', label: '⚠️ Mover a Avisos Técnicos' },
            { id: 'mecanica', label: '⚙️ Mover a Mecánica & Paneles' },
            { id: 'mis_calcas', label: '📁 Mover a Mis Calcas' }
        ];

        let html = `<div style="padding: 6px 12px; font-weight: bold; color: #ff9800; border-bottom: 1px solid #3a3a3a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${item.name}</div>`;
        
        categories.forEach(cat => {
            if (cat.id !== currentCategory) {
                html += `<div class="decal-menu-item" data-action="move" data-cat="${cat.id}" style="padding: 7px 12px; cursor: pointer;">${cat.label}</div>`;
            }
        });

        html += `<div style="border-top: 1px solid #3a3a3a; margin: 3px 0;"></div>`;
        html += `<div class="decal-menu-item" data-action="delete" style="padding: 7px 12px; cursor: pointer; color: #ff6b6b;">🗑️ Eliminar Calca</div>`;

        menu.innerHTML = html;

        // Evitar que un clic o mousedown dentro del menú se propague a document y lo cierre antes de tiempo
        menu.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        menu.querySelectorAll('.decal-menu-item').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = '#383838');
            el.addEventListener('mouseleave', () => el.style.background = 'transparent');
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.remove();
                const action = el.getAttribute('data-action');
                if (action === 'delete') {
                    this.deleteDecal(item);
                } else if (action === 'move') {
                    const toCat = el.getAttribute('data-cat');
                    this.recategorizeDecal(item, toCat);
                }
            });
        });

        document.body.appendChild(menu);

        const closeMenu = (e) => {
            if (e && (menu.contains(e.target) || e.target.closest('.decal-context-menu'))) return;
            menu.remove();
            document.removeEventListener('mousedown', closeMenu);
        };
        setTimeout(() => document.addEventListener('mousedown', closeMenu), 20);
    }

    applyDecal(item) {
        if (!window.decalSystem) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            window.decalSystem.setDecalImage(img, item.name);

            // Asegurar que los controles de calcomanía en el ribbon sean visibles
            const decalControls = document.getElementById('decal-controls');
            if (decalControls) decalControls.style.display = 'flex';

            const previewThumb = document.getElementById('decal-preview-thumb');
            if (previewThumb) {
                previewThumb.style.display = 'block';
                previewThumb.style.backgroundImage = `url(${item.src})`;
            }
        };
        img.src = item.src;
    }

    async open() {
        if (!this.dom.popup) return;

        // Posicionar debajo del botón en el ribbon
        const trigger = this.dom.trigger || this.dom.previewThumb;
        if (trigger) {
            const rect = trigger.getBoundingClientRect();
            this.dom.popup.style.top = `${rect.bottom + 6}px`;

            const panelWidth = 620;
            let left = rect.left - 40;
            if (left + panelWidth > window.innerWidth - 10) {
                left = window.innerWidth - panelWidth - 10;
            }
            if (left < 10) left = 10;
            this.dom.popup.style.left = `${left}px`;
        }

        this.dom.popup.style.display = 'block';
        this.isOpen = true;

        // Sincronizar en vivo por si agregaron archivos en la carpeta de Windows
        await this.syncDecalsFromServer();
        this.renderTabsCount();
        this.renderGrid();

        setTimeout(() => {
            this.dom.searchInput?.focus();
        }, 50);
    }

    close() {
        if (!this.dom.popup) return;
        this.dom.popup.style.display = 'none';
        this.isOpen = false;
        document.querySelectorAll('.decal-context-menu').forEach(m => m.remove());
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }
}
