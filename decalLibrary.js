// decalLibrary.js - Catálogo y Biblioteca Interna de Calcas / Pegatinas para Neo Substance Painter
// Permite elegir calcomanías organizadas por categorías (Insignias, Avisos Técnicos, Mecánica, Mis Calcas)
// con buscador instantáneo, sin abrir el explorador de Windows, y con soporte para importar nuevas calcas.

export const BUILTIN_DECALS = [
    // --- INSIGNIAS & LOGOS ---
    {
        id: 'un_spacy',
        name: 'U.N. Spacy (Cometa)',
        category: 'insignias',
        tags: ['spacy', 'cometa', 'macross', 'un', 'logo', 'insignia', 'valkyrie'],
        src: './texturas/UN_Spacy.png'
    },
    {
        id: 'skull_squadron',
        name: 'Calavera Skull Squadron',
        category: 'insignias',
        tags: ['skull', 'calavera', 'roy', 'focker', 'escuadron', 'insignia'],
        src: './texturas/Calabera chica.png'
    },
    {
        id: 'robotech_logo',
        name: 'Robotech Defense Force',
        category: 'insignias',
        tags: ['robotech', 'rdf', 'logo', 'defensa'],
        src: './texturas/Logo_Robotech.png'
    },
    {
        id: 'mars_base',
        name: 'Mars Base (Base Marte)',
        category: 'insignias',
        tags: ['mars', 'base', 'marte', 'sara', 'logo'],
        src: './texturas/Mars_Base.png'
    },
    {
        id: 'zentradi_logo',
        name: 'Emblema Zentradi',
        category: 'insignias',
        tags: ['zentradi', 'zentran', 'enemigo', 'logo'],
        src: './texturas/logo_zentran.png'
    },
    {
        id: 'destroid_raidar_x',
        name: 'Destroid Raidar-X',
        category: 'insignias',
        tags: ['raidar', 'destroid', 'logo'],
        src: './texturas/logo_Raidar-x.png'
    },
    {
        id: 'cruz_balkenkreuz',
        name: 'Balkenkreuz Militar',
        category: 'insignias',
        tags: ['balkenkreuz', 'cruz', 'camo', 'militar', 'ww2'],
        src: './texturas/cruz_balkenkreuz_ww2.png'
    },
    {
        id: 'cruz_hierro_blanca',
        name: 'Cruz de Hierro (Borde Blanco)',
        category: 'insignias',
        tags: ['cruz', 'hierro', 'militar', 'blanco'],
        src: './texturas/cruz_hierro_militar_borde_blanco.png'
    },
    {
        id: 'cruz_hierro_silueta',
        name: 'Cruz de Hierro (Silueta)',
        category: 'insignias',
        tags: ['cruz', 'hierro', 'silueta', 'negro'],
        src: './texturas/cruz_hierro_silueta.png'
    },

    // --- AVISOS & STENCILS TÉCNICOS ---
    {
        id: 'danger_jet',
        name: 'Danger (Peligro Turbina)',
        category: 'avisos',
        tags: ['danger', 'peligro', 'turbina', 'rojo', 'stencil'],
        src: './texturas/Danger.png'
    },
    {
        id: 'warning_sign',
        name: 'Warning (Advertencia)',
        category: 'avisos',
        tags: ['warning', 'advertencia', 'amarillo', 'stencil'],
        src: './texturas/Warning.png'
    },
    {
        id: 'caution_panel',
        name: 'Caution (Precaución)',
        category: 'avisos',
        tags: ['caution', 'precaucion', 'amarillo', 'panel'],
        src: './texturas/Caution-2k.png'
    },
    {
        id: 'ejection_seat',
        name: 'Ejection Seat (Triángulo Cabina)',
        category: 'avisos',
        tags: ['ejection', 'seat', 'asiento', 'cabina', 'cockpit', 'escape'],
        src: './texturas/Ejection Seat.png'
    },
    {
        id: 'rescue_arrow',
        name: 'Rescue (Flecha Rescate)',
        category: 'avisos',
        tags: ['rescue', 'rescate', 'flecha', 'cabina', 'cockpit'],
        src: './texturas/Rescue.png'
    },
    {
        id: 'no_step',
        name: 'No Step (No Pisar)',
        category: 'avisos',
        tags: ['no step', 'pisar', 'ala', 'aleron', 'lomo'],
        src: './texturas/No Step.png'
    },
    {
        id: 'jet_fuel_only',
        name: 'Jet Fuel Only (Combustible)',
        category: 'avisos',
        tags: ['fuel', 'combustible', 'tanque', 'ala', 'jet'],
        src: './texturas/jet fuel only.png'
    },
    {
        id: 'beware_of_blast',
        name: 'Beware of Blast (Chorro Escape)',
        category: 'avisos',
        tags: ['blast', 'exhaust', 'escape', 'tobera', 'peligro'],
        src: './texturas/Beware of blast.png'
    },
    {
        id: 'beware_of_blast_white',
        name: 'Beware of Blast (Blanco)',
        category: 'avisos',
        tags: ['blast', 'blanco', 'exhaust', 'escape', 'tobera'],
        src: './texturas/Beware of blastBLANCO.png'
    },
    {
        id: 'push_open_close',
        name: 'Push / Open / Close (Pestillo)',
        category: 'avisos',
        tags: ['push', 'open', 'close', 'pestillo', 'puerta', 'cabina'],
        src: './texturas/push-open.close.png'
    },

    // --- MECÁNICA & PANELES ---
    {
        id: 'regilla_circular',
        name: 'Rejilla Circular (Ventilación)',
        category: 'mecanica',
        tags: ['rejilla', 'ventilacion', 'panel', 'tobera', 'mecanica'],
        src: './texturas/regilla circular.png'
    },
    {
        id: 'valvula_circulo',
        name: 'Válvula / Tapa de Presión',
        category: 'mecanica',
        tags: ['valvula', 'tapa', 'presion', 'circulo', 'mecanica'],
        src: './texturas/valvula-circulo.png'
    },
    {
        id: 'armament_panel',
        name: 'Armament (Bahía de Armas)',
        category: 'mecanica',
        tags: ['armament', 'armas', 'misiles', 'bahia', 'mecanica'],
        src: './texturas/Armament.png'
    }
];

export class DecalLibraryManager {
    constructor() {
        this.isOpen = false;
        this.activeCategory = 'all';
        this.searchQuery = '';
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
            console.warn('Error cargando calcas de usuario:', e);
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

    init() {
        this.cacheDom();
        if (!this.dom.popup) return;
        this.bindEvents();
        this.renderTabsCount();
        this.renderGrid();
    }

    cacheDom() {
        this.dom = {
            popup: document.getElementById('decal-library-popup'),
            trigger: document.getElementById('btn-load-decal'),
            btnClose: document.getElementById('btn-close-decal-library'),
            searchInput: document.getElementById('decal-library-search'),
            categoryTabs: document.getElementById('decal-library-tabs'),
            grid: document.getElementById('decal-library-grid'),
            btnImportPC: document.getElementById('btn-decal-import-pc'),
            fileInput: document.getElementById('input-decal'),
            previewThumb: document.getElementById('decal-preview-thumb')
        };
    }

    bindEvents() {
        // Abrir biblioteca al pulsar "Pegatina" en el Ribbon
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

        // Cerrar al hacer clic fuera del panel
        document.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;
            if (!this.dom.popup?.contains(e.target) && 
                !this.dom.trigger?.contains(e.target) &&
                !this.dom.previewThumb?.contains(e.target)) {
                this.close();
            }
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

    importFile(file) {
        const decalName = file.name.replace(/\.[^/.]+$/, '');
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            const newDecal = {
                id: 'custom_' + Date.now(),
                name: decalName,
                category: 'custom',
                tags: [decalName.toLowerCase(), 'custom', 'importada'],
                src: dataUrl,
                isUser: true
            };

            this.userDecals.unshift(newDecal);
            this.saveUserDecals();
            this.renderTabsCount();
            this.switchCategory('custom');

            // Cargar y activar inmediatamente en el canvas
            this.applyDecal(newDecal);
        };
        reader.readAsDataURL(file);
    }

    getAllDecals() {
        return [...this.userDecals, ...BUILTIN_DECALS];
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
            insignias: BUILTIN_DECALS.filter(d => d.category === 'insignias').length,
            avisos: BUILTIN_DECALS.filter(d => d.category === 'avisos').length,
            mecanica: BUILTIN_DECALS.filter(d => d.category === 'mecanica').length,
            custom: this.userDecals.length
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
            const matchesCat = this.activeCategory === 'all' || item.category === this.activeCategory;
            if (!matchesCat) return false;

            if (!q) return true;
            const nameMatch = item.name.toLowerCase().includes(q);
            const tagsMatch = item.tags && item.tags.some(t => t.includes(q));
            return nameMatch || tagsMatch;
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
            card.title = `${item.name}\nClic para elegir y colocar en el modelo`;

            card.innerHTML = `
                <div class="decal-card-thumb decal-checker-bg">
                    <img src="${item.src}" alt="${item.name}" loading="lazy">
                </div>
                <div class="decal-card-info">
                    <span class="decal-card-title">${item.name}</span>
                </div>
            `;

            // Botón de eliminar si es personalizada
            if (item.isUser) {
                card.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (confirm(`¿Eliminar la pegatina "${item.name}" de Mis Calcas?`)) {
                        this.userDecals = this.userDecals.filter(d => d.id !== item.id);
                        this.saveUserDecals();
                        this.renderTabsCount();
                        this.renderGrid();
                    }
                });
            }

            // Click para seleccionar y estampar
            card.addEventListener('click', () => {
                this.applyDecal(item);
                this.close();
            });

            grid.appendChild(card);
        });
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

    open() {
        if (!this.dom.popup) return;

        // Posicionar debajo del botón en el ribbon
        const trigger = this.dom.trigger || this.dom.previewThumb;
        if (trigger) {
            const rect = trigger.getBoundingClientRect();
            this.dom.popup.style.top = `${rect.bottom + 6}px`;

            const panelWidth = 600;
            let left = rect.left - 80;
            if (left + panelWidth > window.innerWidth - 10) {
                left = window.innerWidth - panelWidth - 10;
            }
            if (left < 10) left = 10;
            this.dom.popup.style.left = `${left}px`;
        }

        this.dom.popup.style.display = 'block';
        this.isOpen = true;
        this.renderTabsCount();
        this.renderGrid();

        // Enfocar el buscador para teclear de inmediato si se desea
        setTimeout(() => {
            this.dom.searchInput?.focus();
        }, 50);
    }

    close() {
        if (!this.dom.popup) return;
        this.dom.popup.style.display = 'none';
        this.isOpen = false;
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }
}
