/**
 * Neo Substance Painter - Multi-Piece 3D Assembler & Final Album PDF Engine (v6.0)
 * Permite cargar y ensamblar múltiples piezas (.nsp y .obj), sincronizar la pieza activa
 * en la vista 2D (UV, capas, pintura) y 3D, y compilar todas las plantillas A4 en un único Álbum PDF consolidado.
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PapercraftEngine } from './papercraft.js?v=7.0';

export class ModelAssembler {
    constructor() {
        this.pieces = [];
        this.activePieceId = null;
        this.editorLoadedPieceId = null;
        this.is3DMode = false;
        this.includeCover = true;
        this.albumTitle = 'Super VF-1 Valkyrie';
        
        this.initDOM();
        this.setupEvents();
    }

    get group() {
        return window.assemblerGroup;
    }

    initDOM() {
        // Modal Ensamblador
        let modal = document.getElementById('modal-assembler');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-assembler';
            modal.className = 'modal-overlay hidden';
            modal.innerHTML = `
                <div class="modal-card assembler-modal-card" style="width: 92vw; max-width: 1050px; height: 88vh; max-height: 850px; display: flex; flex-direction: column; background: #1e1e1e; border: 1px solid #444; border-radius: 8px; box-shadow: 0 14px 45px rgba(0,0,0,0.85); overflow: hidden; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                    <!-- Cabecera -->
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #252525; border-bottom: 1px solid #383838;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 24px;">📦</span>
                            <div>
                                <h2 style="margin: 0; font-size: 16px; font-weight: bold; color: #fff; letter-spacing: 0.5px;">Ensamblador 3D y Generador de Álbum PDF</h2>
                                <p style="margin: 2px 0 0 0; font-size: 11px; color: #aaa;">Suma todas las piezas (.nsp y .obj), visualiza el modelo terminado en 3D y compila las plantillas en un solo PDF.</p>
                            </div>
                        </div>
                        <button id="btn-assembler-close" class="ribbon-btn" style="background: #333; border-color: #555; padding: 4px 10px; font-size: 12px; cursor: pointer;" title="Cerrar ventana">✕ Cerrar</button>
                    </div>

                    <!-- Barra de Acciones Principales -->
                    <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 20px; background: #2a2a2a; border-bottom: 1px solid #383838;">
                        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">
                            <input type="file" id="input-assembler-files" accept=".nsp,.json,.obj,.nspp" multiple style="display: none;">
                            <button type="button" id="btn-assembler-add-file" class="ribbon-btn" style="background: #0288d1; border-color: #0277bd; font-weight: bold; padding: 6px 14px; font-size: 12px; display: flex; align-items: center; gap: 6px;" title="Cargar una o más piezas (.nsp pintadas o .obj)">
                                <span>➕</span> Cargar Pieza (.nsp / .obj)
                            </button>
                            <button type="button" id="btn-assembler-add-current" class="ribbon-btn" style="background: #e65100; border-color: #bf360c; font-weight: bold; padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px;" title="Añadir la pieza que tienes abierta actualmente en el editor">
                                <span>📌</span> Sumar Pieza Actual del Editor
                            </button>
                            <button type="button" id="btn-assembler-save-project" class="ribbon-btn" style="background: #1565c0; border-color: #0d47a1; font-weight: bold; padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px;" title="Guardar todo el proyecto ensamblado con todas las piezas y hojas (.nspp)">
                                <span>💾</span> Guardar Proyecto (.nspp)
                            </button>
                            <input type="file" id="input-assembler-project-file" accept=".nspp,.json" style="display: none;">
                            <button type="button" id="btn-assembler-load-project" class="ribbon-btn" style="background: #37474f; border-color: #263238; font-weight: bold; padding: 6px 12px; font-size: 12px; display: flex; align-items: center; gap: 6px;" title="Abrir un proyecto ensamblado completo (.nspp)">
                                <span>📂</span> Abrir Proyecto (.nspp)
                            </button>
                            <button type="button" id="btn-assembler-clear" class="ribbon-btn" style="background: #444; border-color: #555; padding: 6px 10px; font-size: 11px;" title="Vaciar la lista de piezas">
                                🗑️ Vaciar
                            </button>
                        </div>

                        <div style="display: flex; align-items: center; gap: 10px;">
                            <button type="button" id="btn-assembler-toggle-3d" class="ribbon-btn" style="background: #6a1b9a; border-color: #4a148c; font-weight: bold; padding: 6px 14px; font-size: 12px; display: flex; align-items: center; gap: 6px;" title="Ver todas las piezas montadas juntas en el visor 3D">
                                <span id="assembler-3d-icon">👁️</span> <span id="assembler-3d-text">Ver Ensamblado 3D</span>
                            </button>
                            <button type="button" id="btn-assembler-export-album" class="ribbon-btn" style="background: #2e7d32; border-color: #1b5e20; font-weight: bold; padding: 6px 16px; font-size: 12px; display: flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(46,125,50,0.4);" title="Compilar todas las piezas en un único PDF A4">
                                <span>📄</span> Exportar Álbum PDF Final
                            </button>
                        </div>
                    </div>

                    <!-- Barra de Escala Global y Configuración de Álbum -->
                    <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 20px; background: #222; border-bottom: 1px solid #333; font-size: 11.5px;">
                        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px;">
                            <div style="display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: rgba(0, 229, 255, 0.08); border: 1px solid rgba(0, 229, 255, 0.25); border-radius: 4px;">
                                <span style="color: #00e5ff; font-weight: bold; font-size: 11px;">🌐 Escala Global:</span>
                                <input type="number" id="assembler-global-scale-input" value="100" min="5" max="1000" step="5" style="width: 50px; background: #111; border: 1px solid #555; color: #fff; font-size: 11px; padding: 2px 4px; border-radius: 3px; text-align: center;">
                                <span style="color: #888; font-size: 10px;">%</span>
                                <button type="button" id="btn-assembler-scale-apply" class="ribbon-btn" style="background: #00838f; border-color: #00e5ff; font-size: 11px; padding: 2px 8px;" title="Aplicar escala a todas las piezas">Aplicar</button>
                                <div style="display: flex; gap: 2px;">
                                    <button type="button" class="btn-assembler-quick-scale" data-pct="20" style="background: #222; border: 1px solid #444; color: #ccc; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer;">20%</button>
                                    <button type="button" class="btn-assembler-quick-scale" data-pct="50" style="background: #222; border: 1px solid #444; color: #ccc; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer;">50%</button>
                                    <button type="button" class="btn-assembler-quick-scale" data-pct="75" style="background: #222; border: 1px solid #444; color: #ccc; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer;">75%</button>
                                    <button type="button" class="btn-assembler-quick-scale" data-pct="100" style="background: #222; border: 1px solid #444; color: #00e5ff; font-weight: bold; font-size: 10px; padding: 1px 5px; border-radius: 3px; cursor: pointer;">100%</button>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #aaa;">Título del Álbum:</span>
                                <input type="text" id="assembler-album-title" value="Super VF-1 Valkyrie" style="background: #181818; border: 1px solid #444; border-radius: 4px; padding: 3px 8px; color: #fff; font-size: 11.5px; width: 170px;" placeholder="Ej: Super VF-1 Valkyrie">
                                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer; color: #bbb;">
                                    <input type="checkbox" id="assembler-include-cover" checked> Incluir Portada
                                </label>
                            </div>
                        </div>
                        <div id="assembler-stats-badge" style="color: #00e5ff; font-weight: 500; font-size: 11.5px;">
                            0 Piezas cargadas • 0 Hojas A4 totales
                        </div>
                    </div>

                    <!-- Cuerpo: Lista de Piezas -->
                    <div id="assembler-pieces-container" style="flex: 1; overflow-y: auto; padding: 16px 20px; background: #181818;">
                        <div id="assembler-pieces-list" style="display: flex; flex-direction: column; gap: 10px;">
                            <!-- Elementos generados dinámicamente -->
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Badge flotante en el Viewport 3D para indicar que el modo ensamblado está activo
        let badge = document.getElementById('assembler-viewport-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'assembler-viewport-badge';
            badge.style.display = 'none';
            badge.style.position = 'absolute';
            badge.style.top = '12px';
            badge.style.left = '50%';
            badge.style.transform = 'translateX(-50%)';
            badge.style.zIndex = '50';
            badge.style.backgroundColor = 'rgba(26, 10, 48, 0.94)';
            badge.style.border = '1px solid #ab47bc';
            badge.style.boxShadow = '0 6px 20px rgba(0,0,0,0.7)';
            badge.style.borderRadius = '20px';
            badge.style.padding = '5px 14px';
            badge.style.alignItems = 'center';
            badge.style.gap = '10px';
            badge.style.fontSize = '12px';
            badge.style.color = '#fff';
            badge.style.pointerEvents = 'auto';
            badge.innerHTML = `
                <span style="display: flex; align-items: center; gap: 6px; font-weight: bold; color: #e1bee7;">
                    <span>📦</span> Ensamblado 3D (<span id="assembler-badge-count">0</span> piezas)
                </span>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span style="color: #ce93d8; font-size: 11px;">Pieza 2D:</span>
                    <select id="assembler-badge-piece-select" style="background: #111; border: 1px solid #ab47bc; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; max-width: 140px; cursor: pointer;"></select>
                </div>
                <button type="button" id="btn-badge-export-album" class="ribbon-btn" style="background: #2e7d32; border-color: #1b5e20; font-weight: bold; padding: 2px 10px; font-size: 11px; box-shadow: 0 2px 6px rgba(46,125,50,0.4);" title="Exportar Álbum PDF con todas las piezas y texturas">📄 Exportar Álbum PDF</button>
                <button type="button" id="btn-badge-open-assembler" class="ribbon-btn" style="background: #7b1fa2; border-color: #ba68c8; padding: 2px 10px; font-size: 11px;">⚙️ Panel</button>
                <button type="button" id="btn-badge-exit-assembler" class="ribbon-btn" style="background: #333; border-color: #666; padding: 2px 10px; font-size: 11px;">✕ Volver a Pintar</button>
            `;
            const view3d = document.getElementById('view-3d');
            if (view3d) view3d.appendChild(badge);
        }
    }

    setupEvents() {
        // Botones de lanzamiento del Ensamblador
        document.getElementById('btn-ribbon-assembler')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-menu-assembler')?.addEventListener('click', () => {
            const dropdown = document.getElementById('paint-file-dropdown');
            if (dropdown) dropdown.style.display = 'none';
            this.openModal();
        });

        // Botón cerrar modal
        document.getElementById('btn-assembler-close')?.addEventListener('click', () => this.closeModal());

        // Botón Cargar Pieza (abre file dialog)
        const fileInput = document.getElementById('input-assembler-files');
        document.getElementById('btn-assembler-add-file')?.addEventListener('click', () => {
            if (fileInput) {
                fileInput.value = '';
                fileInput.click();
            }
        });

        fileInput?.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            for (const file of files) {
                await this.loadPieceFromFile(file);
            }
            if (!this.activePieceId && this.pieces.length > 0) {
                this.setActivePiece(this.pieces[0].id, true);
            } else {
                this.updateActivePieceSelectors();
                this.renderUI();
            }
        });

        // Botón Sumar Pieza Actual del Editor
        document.getElementById('btn-assembler-add-current')?.addEventListener('click', () => {
            this.addCurrentPieceFromEditor();
        });

        // Botón Guardar Proyecto Ensamblado (.nspp)
        document.getElementById('btn-assembler-save-project')?.addEventListener('click', () => {
            this.exportAssemblyProject();
        });

        // Botón Abrir Proyecto Ensamblado (.nspp)
        const projectFileInput = document.getElementById('input-assembler-project-file');
        document.getElementById('btn-assembler-load-project')?.addEventListener('click', () => {
            if (projectFileInput) {
                projectFileInput.value = '';
                projectFileInput.click();
            }
        });
        projectFileInput?.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (file) {
                await this.loadAssemblyProject(file);
            }
        });

        // Botón Vaciar
        document.getElementById('btn-assembler-clear')?.addEventListener('click', () => {
            if (this.pieces.length === 0) return;
            if (confirm('¿Vaciar la lista de piezas del ensamblador?')) {
                this.clearAllPieces();
            }
        });

        // Botón Ver Ensamblado 3D
        document.getElementById('btn-assembler-toggle-3d')?.addEventListener('click', () => {
            this.toggle3DMode();
        });

        // Botón Exportar Álbum PDF Final
        document.getElementById('btn-assembler-export-album')?.addEventListener('click', () => {
            this.exportFinalAlbumPDF();
        });

        // Título del Álbum
        document.getElementById('assembler-album-title')?.addEventListener('input', (e) => {
            this.albumTitle = e.target.value.trim() || 'Álbum Papercraft';
        });

        // Checkbox Portada
        document.getElementById('assembler-include-cover')?.addEventListener('change', (e) => {
            this.includeCover = e.target.checked;
            this.updateStatsBadge();
        });

        // Controles de Escala Global en modal y barra de herramientas
        const globalScaleInput = document.getElementById('assembler-global-scale-input');
        const applyGlobalScaleBtn = document.getElementById('btn-assembler-scale-apply');
        applyGlobalScaleBtn?.addEventListener('click', () => {
            const val = parseFloat(globalScaleInput?.value) || 100;
            this.applyGlobalScale(val);
        });
        globalScaleInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = parseFloat(globalScaleInput?.value) || 100;
                this.applyGlobalScale(val);
            }
        });
        document.querySelectorAll('.btn-assembler-quick-scale').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pct = parseFloat(e.currentTarget.getAttribute('data-pct')) || 100;
                if (globalScaleInput) globalScaleInput.value = pct;
                this.applyGlobalScale(pct);
            });
        });

        // Botón Sincronizar Escala Global en el panel lateral Unfold
        document.getElementById('btn-unfold-sync-global-scale')?.addEventListener('click', () => {
            const activePct = window.papercraft?.scalePct || 100;
            this.applyGlobalScale(activePct);
        });

        // Selectores de Pieza Activa (Ribbon y Badge 3D)
        document.getElementById('ribbon-active-piece-select')?.addEventListener('change', (e) => {
            if (e.target.value) this.setActivePiece(e.target.value);
        });
        document.getElementById('assembler-badge-piece-select')?.addEventListener('change', (e) => {
            if (e.target.value) this.setActivePiece(e.target.value);
        });

        // Botones del badge flotante 3D
        document.getElementById('btn-badge-open-assembler')?.addEventListener('click', () => {
            this.openModal();
        });
        document.getElementById('btn-badge-export-album')?.addEventListener('click', () => {
            this.exportFinalAlbumPDF();
        });
        document.getElementById('btn-badge-exit-assembler')?.addEventListener('click', () => {
            this.set3DMode(false);
        });

        // Selección de pieza por clic en el Viewport 3D
        const view3d = document.getElementById('view-3d');
        if (view3d) {
            let pointerDownPos = { x: 0, y: 0 };
            view3d.addEventListener('pointerdown', (e) => {
                pointerDownPos = { x: e.clientX, y: e.clientY };
            });
            view3d.addEventListener('pointerup', (e) => {
                if (e.button !== 0) return;
                const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
                if (dist > 5) return; // Si arrastró el ratón, fue rotación de cámara, no clic
                if (!this.group || this.pieces.length <= 1) return;
                this.handle3DViewportClick(e);
            });
        }
    }

    handle3DViewportClick(e) {
        if (!window.camera || !window.renderer) return;
        const rect = window.renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, window.camera);

        const pieceMeshes = this.pieces.filter(p => p.visible && p.mesh).map(p => p.mesh);
        const intersects = raycaster.intersectObjects(pieceMeshes, true);
        if (intersects.length > 0) {
            let hitObj = intersects[0].object;
            // Subir por la jerarquía hasta encontrar la pieza dueña
            while (hitObj && hitObj.parent && hitObj.parent !== this.group) {
                hitObj = hitObj.parent;
            }
            const hitPiece = this.pieces.find(p => p.mesh === hitObj);
            if (hitPiece && hitPiece.id !== this.activePieceId) {
                this.setActivePiece(hitPiece.id);
            }
        }
    }

    openModal() {
        const modal = document.getElementById('modal-assembler');
        if (modal) {
            modal.classList.remove('hidden');
            this.renderUI();
        }
    }

    closeModal() {
        const modal = document.getElementById('modal-assembler');
        if (modal) modal.classList.add('hidden');
    }

    toggle3DMode() {
        const nextState = !this.is3DMode;
        this.set3DMode(nextState);
        if (nextState) {
            this.closeModal();
        }
    }

    set3DMode(enabled) {
        this.is3DMode = enabled;
        const icon = document.getElementById('assembler-3d-icon');
        const text = document.getElementById('assembler-3d-text');
        const badge = document.getElementById('assembler-viewport-badge');

        if (this.group) {
            this.group.visible = enabled;
        }

        if (enabled) {
            // Ocultar modelo del editor individual para evitar colisión visual
            if (window.state?.mesh) {
                window.state.mesh.visible = false;
            }
            if (icon) icon.textContent = '👁️‍🗨️';
            if (text) text.textContent = 'Ocultar Ensamblado 3D';
            if (badge) {
                badge.style.display = 'flex';
                const badgeCount = document.getElementById('assembler-badge-count');
                if (badgeCount) badgeCount.textContent = this.pieces.filter(p => p.visible).length;
            }

            // Asegurar que cada pieza del ensamble tenga su textura propia
            this.pieces.forEach(p => {
                if (p.mesh && p.texture) {
                    p.mesh.traverse(child => {
                        if (child.isMesh) {
                            child.material.map = p.texture;
                            child.material.needsUpdate = true;
                        }
                    });
                }
            });

            // Si hay piezas pero ninguna está activa, activar la primera
            if (this.pieces.length > 0 && !this.activePieceId) {
                this.setActivePiece(this.pieces[0].id, true);
            }

            // Encuadrar la cámara en todo el ensamble
            if (this.group && this.pieces.length > 0 && typeof window.frameModel === 'function') {
                window.frameModel(this.group);
            }
        } else {
            // Restaurar modelo del editor individual
            if (window.state?.mesh) {
                window.state.mesh.visible = true;
                if (typeof window.frameModel === 'function') {
                    window.frameModel(window.state.mesh);
                }
            }
            if (icon) icon.textContent = '👁️';
            if (text) text.textContent = 'Ver Ensamblado 3D';
            if (badge) badge.style.display = 'none';
        }

        // Actualizar la mesa de trabajo 2D (Unfold Workbench)
        if (typeof window.renderUnfoldWorkbench === 'function') {
            window.renderUnfoldWorkbench();
        }
    }

    /**
     * Sincroniza los selectores desplegables de Pieza Activa en el Ribbon y en el badge flotante
     */
    updateActivePieceSelectors() {
        const ribbonSelect = document.getElementById('ribbon-active-piece-select');
        const badgeSelect = document.getElementById('assembler-badge-piece-select');
        const ribbonWrapper = document.getElementById('ribbon-assembler-piece-wrapper');
        const unfoldScopeRow = document.getElementById('unfold-row-view-scope');

        const hasPieces = this.pieces.length > 0;
        if (ribbonWrapper) ribbonWrapper.style.display = hasPieces ? 'flex' : 'none';
        if (unfoldScopeRow) unfoldScopeRow.style.display = hasPieces ? 'flex' : 'none';

        const updateSelect = (selectEl) => {
            if (!selectEl) return;
            selectEl.innerHTML = '';
            this.pieces.forEach((p, idx) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${idx + 1}. ${p.name}`;
                if (p.id === this.activePieceId) opt.selected = true;
                selectEl.appendChild(opt);
            });
        };

        updateSelect(ribbonSelect);
        updateSelect(badgeSelect);

        const badgeCount = document.getElementById('assembler-badge-count');
        if (badgeCount) badgeCount.textContent = this.pieces.filter(p => p.visible).length;
    }

    /**
     * Devuelve la pieza actualmente activa en el ensamblador
     */
    getActivePiece() {
        if (!this.activePieceId || !this.pieces) return null;
        return this.pieces.find(p => p.id === this.activePieceId) || null;
    }

    /**
     * Guarda el estado actual del lienzo (textura, capas, papercraft) en la pieza activa
     */
    saveActivePieceToCache() {
        if (!this.editorLoadedPieceId) return;
        const piece = this.pieces.find(p => p.id === this.editorLoadedPieceId);
        if (!piece) return;

        // 1. Guardar textura plana actualizada desde canvas-2d SOLO si coincide con la pieza cargada
        const currentCanvas = document.getElementById('canvas-2d');
        if (currentCanvas && piece.textureCanvas) {
            const ctx = piece.textureCanvas.getContext('2d');
            ctx.clearRect(0, 0, piece.textureCanvas.width, piece.textureCanvas.height);
            ctx.drawImage(currentCanvas, 0, 0, piece.textureCanvas.width, piece.textureCanvas.height);
            if (piece.texture) piece.texture.needsUpdate = true;
        }

        // 2. Guardar estado completo de capas y calcas
        if (typeof window.getProjectNSPData === 'function') {
            const currentProj = window.getProjectNSPData();
            if (currentProj) {
                currentProj.modelOBJ = piece.rawOBJText || currentProj.modelOBJ;
                piece.projectData = currentProj;
            }
        }

        // 3. Sincronizar papercraft layout persistente
        if (piece.papercraft && piece.papercraft.parts) {
            if (window.papercraft && window.papercraft.parts) {
                window.papercraft.parts.forEach(srcPart => {
                    const destPart = piece.papercraft.parts.find(p => p.id === srcPart.id);
                    if (destPart && srcPart.layout) {
                        destPart.layout = { ...srcPart.layout };
                    }
                });
            }
            if (piece.projectData && piece.projectData.papercraft) {
                piece.projectData.papercraft.pagesCount = piece.papercraft.pagesCount;
                piece.projectData.papercraft.partsLayout = piece.papercraft.parts.map(p => ({
                    id: p.id,
                    layout: { ...p.layout }
                }));
            }
        }
    }

    /**
     * Copia en caliente el canvas-2d a la pieza activa para que la textura 3D del ensamble se mantenga al día
     */
    syncActivePieceTexture() {
        if (!this.editorLoadedPieceId) return;
        const piece = this.pieces.find(p => p.id === this.editorLoadedPieceId);
        if (!piece || !piece.textureCanvas) return;
        const canvas2d = document.getElementById('canvas-2d');
        if (!canvas2d) return;

        const ctx = piece.textureCanvas.getContext('2d');
        ctx.clearRect(0, 0, piece.textureCanvas.width, piece.textureCanvas.height);
        ctx.drawImage(canvas2d, 0, 0, piece.textureCanvas.width, piece.textureCanvas.height);
        if (piece.texture) piece.texture.needsUpdate = true;
    }

    /**
     * Selecciona una pieza como ACTIVA: la carga en el editor principal de forma silenciosa e instantánea
     */
    async setActivePiece(id, isInitial = false) {
        if (!id) return;
        if (this.editorLoadedPieceId === id && !isInitial) return;

        // Guardar cambios de la pieza anterior que estaba cargada en el editor
        if (!isInitial && this.editorLoadedPieceId) {
            this.saveActivePieceToCache();
        }

        const piece = this.pieces.find(p => p.id === id);
        if (!piece) return;

        this.activePieceId = id;

        // Cargar en el editor principal silenciosamente (sin alerts ni prompts)
        if (piece.projectData && typeof window.loadProjectNSP === 'function') {
            await window.loadProjectNSP(piece.projectData, true);
        } else if (piece.rawOBJText && typeof window.loadOBJContents === 'function') {
            window.loadOBJContents(piece.rawOBJText);
            const mainCanvas = document.getElementById('canvas-2d');
            if (mainCanvas && piece.textureCanvas) {
                const ctx = mainCanvas.getContext('2d');
                ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
                ctx.drawImage(piece.textureCanvas, 0, 0, mainCanvas.width, mainCanvas.height);
                if (window.state?.texture) window.state.texture.needsUpdate = true;
            }
        }

        this.editorLoadedPieceId = id;

        // Sincronizar parámetros de escala y layout de la pieza activa al motor del editor
        if (piece.papercraft && window.papercraft) {
            if (piece.papercraft.baseModelLengthMm) window.papercraft.baseModelLengthMm = piece.papercraft.baseModelLengthMm;
            if (piece.papercraft.modelLengthMm) window.papercraft.modelLengthMm = piece.papercraft.modelLengthMm;
            if (piece.papercraft.scalePct !== undefined) window.papercraft.scalePct = piece.papercraft.scalePct;
            if (piece.papercraft.currentScale) window.papercraft.currentScale = piece.papercraft.currentScale;
            if (piece.papercraft.pagesCount) window.papercraft.pagesCount = piece.papercraft.pagesCount;

            if (piece.papercraft.parts && window.papercraft.parts) {
                piece.papercraft.parts.forEach(srcPart => {
                    const destPart = window.papercraft.parts.find(p => p.id === srcPart.id);
                    if (destPart && srcPart.layout) {
                        destPart.layout = { ...srcPart.layout };
                    }
                });
            }

            if (typeof window.updatePapercraftUI === 'function') {
                window.updatePapercraftUI();
            }
        }

        // Actualizar etiqueta del panel 2D
        const label2d = document.getElementById('view-2d-label');
        if (label2d) {
            label2d.textContent = `Vista 2D (UV) • Pieza Activa: ${piece.name}`;
        }

        // Si estamos en modo 3D ensamblado, asegurar que state.mesh esté invisible para ver solo el ensamble
        if (this.is3DMode && window.state?.mesh) {
            window.state.mesh.visible = false;
        }

        // En 3D: asegurar que CADA pieza del ensamble conserve su propia textura CanvasTexture independiente
        // para que ninguna pieza se contamine con la textura de otra pieza.
        this.pieces.forEach(p => {
            if (p.mesh && p.texture) {
                p.mesh.traverse(child => {
                    if (child.isMesh) {
                        child.material.map = p.texture;
                        child.material.needsUpdate = true;
                    }
                });
            }
        });

        // Sincronizar en caliente la textura de la pieza activa recién cargada
        this.syncActivePieceTexture();

        // Actualizar selectores en UI
        this.updateActivePieceSelectors();
        this.renderUI();

        // Actualizar mesa de trabajo Unfold si está abierta
        if (typeof window.renderUnfoldWorkbench === 'function') {
            window.renderUnfoldWorkbench();
        }
    }

    /**
     * Aplica un escalado porcentual global sincronizado a TODAS las piezas ensambladas
     * @param {number} scalePct Porcentaje de escala (ej. 20, 50, 100, 150)
     */
    applyGlobalScale(scalePct) {
        const pct = Math.max(5, Math.min(1000, parseFloat(scalePct) || 100));
        this.globalScalePct = pct;

        // 1. Sincronizar todas las piezas en el ensamblador
        this.pieces.forEach(piece => {
            if (piece.papercraft) {
                if (!piece.papercraft.baseModelLengthMm) {
                    piece.papercraft.baseModelLengthMm = piece.papercraft.modelLengthMm || 200.0;
                }
                piece.papercraft.scalePct = pct;
                piece.papercraft.currentScale = `${Math.round(pct)}%`;
                const newLen = Math.max(1, piece.papercraft.baseModelLengthMm * (pct / 100));
                piece.papercraft.setModelLength(newLen);
                piece.papercraft.autoPackA4();
            }
        });

        // 2. Sincronizar el motor papercraft global del editor principal
        if (window.papercraft) {
            if (!window.papercraft.baseModelLengthMm) {
                window.papercraft.baseModelLengthMm = window.papercraft.modelLengthMm || 200.0;
            }
            window.papercraft.scalePct = pct;
            window.papercraft.currentScale = `${Math.round(pct)}%`;
            const newLen = Math.max(1, window.papercraft.baseModelLengthMm * (pct / 100));
            window.papercraft.setModelLength(newLen);
            window.papercraft.autoPackA4();
        }

        // 3. Sincronizar campo en el modal del ensamblador
        const globalScaleInput = document.getElementById('assembler-global-scale-input');
        if (globalScaleInput) globalScaleInput.value = Math.round(pct);

        document.querySelectorAll('.btn-assembler-quick-scale').forEach(b => {
            const bPct = parseFloat(b.getAttribute('data-pct'));
            if (bPct === Math.round(pct)) {
                b.style.color = '#00e5ff';
                b.style.fontWeight = 'bold';
                b.style.borderColor = '#00e5ff';
            } else {
                b.style.color = '#ccc';
                b.style.fontWeight = 'normal';
                b.style.borderColor = '#444';
            }
        });

        if (typeof window.updatePapercraftUI === 'function') window.updatePapercraftUI();
        if (typeof window.drawUVWireframe === 'function') window.drawUVWireframe();
        if (typeof window.renderUnfoldWorkbench === 'function') window.renderUnfoldWorkbench();
        this.renderUI();
    }

    /**
     * Obtiene el número total de hojas A4 globales del ensamble
     */
    getTotalSheets() {
        const activePieces = this.pieces.filter(p => p.visible !== false);
        let maxIdx = -1;
        activePieces.forEach(p => {
            if (p.papercraft && p.papercraft.parts) {
                p.papercraft.parts.forEach(pt => {
                    if (pt.layout && typeof pt.layout.pageIndex === 'number') {
                        if (pt.layout.pageIndex > maxIdx) maxIdx = pt.layout.pageIndex;
                    }
                });
            }
        });
        const minNeeded = maxIdx + 1;
        if (this.sheetsCount === undefined || this.sheetsCount === null || this.sheetsCount < minNeeded) {
            this.sheetsCount = Math.max(1, minNeeded);
        }
        return this.sheetsCount;
    }

    /**
     * Añade una nueva hoja A4 vacía al final del ensamble
     */
    addSheet() {
        this.sheetsCount = this.getTotalSheets() + 1;
        this.updateStatsBadge();
        this.renderUI();
    }

    /**
     * Limpia y compacta las hojas A4 vacías en todo el ensamble
     */
    cleanEmptySheets() {
        this.saveActivePieceToCache();

        const activePieces = this.pieces.filter(p => p.visible !== false);
        if (activePieces.length === 0) return 0;

        const currentTotal = this.getTotalSheets();
        const usedSheets = new Set();
        activePieces.forEach(p => {
            if (p.papercraft && p.papercraft.parts) {
                p.papercraft.parts.forEach(pt => {
                    if (pt.layout && typeof pt.layout.pageIndex === 'number') {
                        usedSheets.add(pt.layout.pageIndex);
                    }
                });
            }
        });

        const sortedUsed = Array.from(usedSheets).sort((a, b) => a - b);
        const remap = new Map();
        sortedUsed.forEach((oldIdx, newIdx) => {
            remap.set(oldIdx, newIdx);
        });

        activePieces.forEach(p => {
            if (p.papercraft && p.papercraft.parts) {
                p.papercraft.parts.forEach(pt => {
                    if (pt.layout && typeof pt.layout.pageIndex === 'number') {
                        pt.layout.pageIndex = remap.get(pt.layout.pageIndex) ?? 0;
                    }
                });
                const pieceSheets = new Set(p.papercraft.parts.map(pt => pt.layout.pageIndex));
                p.papercraft.pagesCount = Math.max(1, pieceSheets.size);
                p.papercraft.notifyChange();
            }
        });

        this.sheetsCount = Math.max(1, sortedUsed.length);

        // Sincronizar también con el motor global window.papercraft
        if (window.papercraft) {
            if (window.papercraft.parts) {
                window.papercraft.parts.forEach(pt => {
                    if (pt.layout && typeof pt.layout.pageIndex === 'number') {
                        pt.layout.pageIndex = remap.get(pt.layout.pageIndex) ?? 0;
                    }
                });
            }
            window.papercraft.pagesCount = this.sheetsCount;
            if (typeof window.papercraft.notifyChange === 'function') window.papercraft.notifyChange();
        }

        const removed = Math.max(0, currentTotal - this.sheetsCount);
        this.updateStatsBadge();
        this.renderUI();
        if (typeof window.updatePapercraftUI === 'function') window.updatePapercraftUI();
        if (typeof window.renderUnfoldWorkbench === 'function') window.renderUnfoldWorkbench();
        return removed;
    }

    /**
     * Detecta qué pieza de qué modelo ensamblado está debajo del cursor del ratón
     */
    getPartAt(canvasX, canvasY, viewScale = 4.0) {
        const activePieces = this.pieces.filter(p => p.visible !== false);
        if (activePieces.length === 0) return null;

        const panX = window.papercraft?.panX || 40;
        const panY = window.papercraft?.panY || 40;
        const zoom = window.papercraft?.zoom || 1.0;
        const A4_W = 210.0;
        const sheetGapMm = 20.0;
        const pagePitchMm = A4_W + sheetGapMm;

        const mouseMmX = (canvasX - panX) / (zoom * viewScale);
        const mouseMmY = (canvasY - panY) / (zoom * viewScale);

        // Búsqueda en orden inverso priorizando la pieza seleccionada
        const sel = window.papercraft?.selectedPart;
        for (let pi = activePieces.length - 1; pi >= 0; pi--) {
            const piece = activePieces[pi];
            if (!piece.papercraft || !piece.papercraft.parts) continue;

            const searchOrder = [...piece.papercraft.parts];
            if (sel && searchOrder.includes(sel)) {
                const idx = searchOrder.indexOf(sel);
                if (idx > -1) {
                    searchOrder.splice(idx, 1);
                    searchOrder.push(sel);
                }
            }

            for (let i = searchOrder.length - 1; i >= 0; i--) {
                const part = searchOrder[i];
                const s = part.layout.pageIndex || 0;
                const pageOffsetMmX = s * pagePitchMm;
                const pageMmX = mouseMmX - pageOffsetMmX;
                const pageMmY = mouseMmY;

                const dx = pageMmX - part.layout.x;
                const dy = pageMmY - part.layout.y;
                const rad = (-part.layout.rotation * Math.PI) / 180;
                const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

                const b = part.bounds;
                if (lx >= b.minX - 4 && lx <= b.maxX + 4 && ly >= b.minY - 4 && ly <= b.maxY + 4) {
                    return {
                        part,
                        piece,
                        pageIndex: s,
                        localPageIndex: s,
                        globalPageIndex: s,
                        pieceStartSheet: 0,
                        localX: lx,
                        localY: ly
                    };
                }
            }
        }

        return null;
    }

    /**
     * Renderiza todas las hojas A4 de todas las piezas ensambladas en la Mesa de Trabajo 2D
     */
    renderWorkbench(ctx, canvasW, canvasH) {
        try {
            ctx.clearRect(0, 0, canvasW, canvasH);
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, canvasW, canvasH);

            const activePieces = this.pieces.filter(p => p.visible !== false);
            if (activePieces.length === 0) {
                ctx.fillStyle = '#777777';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No hay piezas cargadas o visibles en el Ensamblador.', canvasW / 2, canvasH / 2);
                return;
            }

            ctx.save();
            const panX = window.papercraft?.panX || 40;
            const panY = window.papercraft?.panY || 40;
            const zoom = window.papercraft?.zoom || 1.0;
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);

            const mmToPx = 4.0;
            const sheetGapMm = 20.0;
            const A4_W = 210.0;
            const pagePitchMm = A4_W + sheetGapMm;
            const totalSheets = this.getTotalSheets();
            const totalAlbumPages = totalSheets + (this.includeCover ? 1 : 0);

            // Auto-sanitizar coordenadas desfasadas o negativas en piezas
            activePieces.forEach(piece => {
                if (piece.papercraft && piece.papercraft.parts) {
                    piece.papercraft.parts.forEach(part => {
                        if (part.layout) {
                            if (part.layout.x < 0 || part.layout.x > A4_W) {
                                const sheetShift = Math.floor(part.layout.x / pagePitchMm);
                                if (sheetShift !== 0) {
                                    part.layout.pageIndex = Math.max(0, (part.layout.pageIndex || 0) + sheetShift);
                                    part.layout.x = Math.max(10, Math.min(A4_W - 10, part.layout.x - sheetShift * pagePitchMm));
                                }
                            }
                        }
                    });
                }
            });

            // PASADA 1: Dibujar cada hoja A4 con sus piezas
            for (let s = 0; s < totalSheets; s++) {
                const pageX_px = s * pagePitchMm * mmToPx;
                const piecesOnSheet = activePieces.filter(p => p.papercraft && p.papercraft.parts.some(pt => pt.layout.pageIndex === s));
                const title = piecesOnSheet.length > 0 ? piecesOnSheet.map(p => p.name).join(', ') : 'HOJA VACÍA';
                const albumPageNum = s + (this.includeCover ? 2 : 1);
                const header = `📦 [${title}] • HOJA ${s + 1} DE ${totalSheets} • (ÁLBUM: PÁG. ${albumPageNum} DE ${totalAlbumPages})`;

                const refEngine = activePieces[0]?.papercraft || window.papercraft;
                if (refEngine) {
                    refEngine.renderSheetBackgroundOnCanvas(ctx, pageX_px, 0, mmToPx, header);
                }

                for (const piece of activePieces) {
                    if (!piece.papercraft) continue;
                    const partsOnSheet = piece.papercraft.parts.filter(pt => pt.layout.pageIndex === s);
                    for (const part of partsOnSheet) {
                        try {
                            piece.papercraft.drawPartOnCanvas(ctx, part, piece.textureCanvas, pageX_px, 0, mmToPx, false);
                        } catch (sheetErr) {
                            console.warn(`Error al renderizar pieza de ${piece.name} en hoja ${s + 1}:`, sheetErr);
                        }
                    }
                }
            }

            // PASADA 2: Dibujar pieza seleccionada en primer plano con sus cotas de selección
            const selPart = window.papercraft?.selectedPart;
            if (selPart) {
                const targetSheet = selPart.layout.pageIndex || 0;
                const pageX_px = targetSheet * pagePitchMm * mmToPx;
                const owningPiece = activePieces.find(p => p.papercraft && p.papercraft.parts.includes(selPart));
                if (owningPiece) {
                    try {
                        owningPiece.papercraft.drawPartOnCanvas(ctx, selPart, owningPiece.textureCanvas, pageX_px, 0, mmToPx, true);
                    } catch (e) {}
                }
            }

            // PASADA 3: Dibujar medición interactiva de la Regla (si está activa)
            if (window.papercraft && typeof window.papercraft.drawMeasurementOnCanvas === 'function') {
                window.papercraft.drawMeasurementOnCanvas(ctx, mmToPx);
            }

            ctx.restore();
        } catch (err) {
            console.error('Error general en assembler.renderWorkbench:', err);
        }
    }

    /**
     * Carga una pieza desde un archivo (.nsp o .obj)
     */
    async loadPieceFromFile(file) {
        try {
            const fileName = file.name;
            const ext = fileName.split('.').pop().toLowerCase();
            const rawText = await file.text();
            const pieceName = fileName.replace(/\.[^/.]+$/, '');

            if (ext === 'nspp') {
                return await this.loadAssemblyProject(rawText);
            } else if (ext === 'nsp' || ext === 'json') {
                if (rawText.includes('"neo_substance_assembler_project"')) {
                    return await this.loadAssemblyProject(rawText);
                }
                return await this.loadNSPPiece(rawText, pieceName);
            } else if (ext === 'obj') {
                return await this.loadOBJPiece(rawText, pieceName);
            } else {
                alert(`Formato .${ext} no compatible. Por favor sube un archivo .nsp, .obj o .nspp.`);
                return null;
            }
        } catch (err) {
            console.error('Error al cargar pieza en ensamblador:', err);
            alert(`Error al cargar el archivo: ${err.message}`);
            return null;
        }
    }

    /**
     * Procesa un proyecto completo .nsp con textura de capas y topología papercraft
     */
    async loadNSPPiece(jsonText, defaultName) {
        const project = JSON.parse(jsonText);
        if (!project.modelOBJ) {
            throw new Error('El archivo .nsp no contiene geometría 3D (modelOBJ).');
        }

        // 1. Recomponer el canvas de textura a partir de las capas y pegatinas del proyecto
        const size = project.resolution || 2048;
        const textureCanvas = await this.compositeNspLayers(project, size);

        // 2. Crear textura Three.js
        const texture = new THREE.CanvasTexture(textureCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;

        // 3. Crear Malla 3D en Three.js
        const mesh = this.buildMeshFromOBJ(project.modelOBJ, texture);

        // 4. Instanciar y configurar su motor Papercraft individual
        const piecePapercraft = new PapercraftEngine();
        if (project.papercraft) {
            const pp = project.papercraft;
            if (pp.baseModelLengthMm) piecePapercraft.baseModelLengthMm = pp.baseModelLengthMm;
            if (pp.scalePct) piecePapercraft.scalePct = pp.scalePct;
            if (pp.modelLengthMm) piecePapercraft.modelLengthMm = pp.modelLengthMm;
            if (pp.scalePreset) piecePapercraft.currentScale = pp.scalePreset;
            if (pp.showFlaps !== undefined) piecePapercraft.showFlaps = pp.showFlaps;
            if (pp.tabHeightMm) piecePapercraft.tabHeightMm = pp.tabHeightMm;
            if (pp.tabAngleDeg) piecePapercraft.tabAngleDeg = pp.tabAngleDeg;
            if (pp.cutLineColor) piecePapercraft.cutLineColor = pp.cutLineColor;
            if (pp.cutLineWidthMm) piecePapercraft.cutLineWidthMm = pp.cutLineWidthMm;
            if (pp.foldLineColor) piecePapercraft.foldLineColor = pp.foldLineColor;
            if (pp.foldLineWidthMm) piecePapercraft.foldLineWidthMm = pp.foldLineWidthMm;
            if (pp.hideSmoothLines !== undefined) piecePapercraft.hideSmoothLines = pp.hideSmoothLines;
            if (pp.showTabNumbers !== undefined) piecePapercraft.showTabNumbers = pp.showTabNumbers;
            if (pp.numberPlacement) piecePapercraft.numberPlacement = pp.numberPlacement;
        }

        piecePapercraft.analyzeMesh(mesh, size);

        // Si ya hay una escala global establecida en el ensamblador, sincronizar
        if (this.globalScalePct) {
            piecePapercraft.scalePct = this.globalScalePct;
            piecePapercraft.currentScale = `${Math.round(this.globalScalePct)}%`;
            const baseLen = piecePapercraft.baseModelLengthMm || piecePapercraft.modelLengthMm || 0.1;
            piecePapercraft.setModelLength(Math.max(0.1, baseLen * (this.globalScalePct / 100)));
            piecePapercraft.autoPackA4();
        }

        // Restaurar disposición exacta de piezas si venía guardada y no fue escalada
        if (!this.globalScalePct && project.papercraft?.partsLayout && Array.isArray(project.papercraft.partsLayout)) {
            project.papercraft.partsLayout.forEach(pl => {
                const part = piecePapercraft.parts.find(p => p.id === pl.id);
                if (part && pl.layout) {
                    Object.assign(part.layout, pl.layout);
                }
            });
            if (project.papercraft.pagesCount) {
                piecePapercraft.pagesCount = project.papercraft.pagesCount;
            }
        }

        const piece = {
            id: 'piece_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: defaultName,
            fileType: 'nsp',
            rawOBJText: project.modelOBJ,
            projectData: project,
            mesh: mesh,
            textureCanvas: textureCanvas,
            texture: texture,
            papercraft: piecePapercraft,
            visible: true
        };

        this.addPiece(piece);
        return piece;
    }

    /**
     * Procesa una pieza directa desde archivo .obj (sin pintar aún o pintada con color base)
     */
    async loadOBJPiece(objText, defaultName) {
        const size = 2048;
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = size;
        textureCanvas.height = size;
        const ctx = textureCanvas.getContext('2d');
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.CanvasTexture(textureCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const mesh = this.buildMeshFromOBJ(objText, texture);

        const piecePapercraft = new PapercraftEngine();
        if (window.papercraft?.objUnit) {
            piecePapercraft.objUnit = window.papercraft.objUnit;
        }

        // Si ya hay piezas en el ensamble, calcular proporción física relativa a la pieza base
        const refPiece = this.pieces.find(p => p.papercraft && p.papercraft.raw3dSize);
        if (refPiece && refPiece.papercraft.raw3dSize.ref3dLen > 0.001) {
            const mmPerUnit = (refPiece.papercraft.baseModelLengthMm || refPiece.papercraft.modelLengthMm) / refPiece.papercraft.raw3dSize.ref3dLen;
            piecePapercraft.analyzeMesh(mesh, size);
            if (piecePapercraft.raw3dSize && piecePapercraft.raw3dSize.ref3dLen > 0.001) {
                const proportionalBase = Math.max(0.1, Math.round(piecePapercraft.raw3dSize.ref3dLen * mmPerUnit * 10) / 10);
                piecePapercraft.baseModelLengthMm = proportionalBase;
                const activePct = this.globalScalePct || refPiece.papercraft.scalePct || 100;
                piecePapercraft.scalePct = activePct;
                piecePapercraft.currentScale = `${Math.round(activePct)}%`;
                piecePapercraft.setModelLength(Math.max(0.1, proportionalBase * (activePct / 100)));
                piecePapercraft.autoPackA4();
            }
        } else {
            piecePapercraft.analyzeMesh(mesh, size);
            if (this.globalScalePct) {
                piecePapercraft.scalePct = this.globalScalePct;
                piecePapercraft.currentScale = `${Math.round(this.globalScalePct)}%`;
                piecePapercraft.setModelLength(Math.max(0.1, (piecePapercraft.baseModelLengthMm || 0.1) * (this.globalScalePct / 100)));
                piecePapercraft.autoPackA4();
            }
        }
        const piece = {
            id: 'piece_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: defaultName,
            fileType: 'obj',
            rawOBJText: objText,
            projectData: null,
            mesh: mesh,
            textureCanvas: textureCanvas,
            texture: texture,
            papercraft: piecePapercraft,
            visible: true
        };

        this.addPiece(piece);
        return piece;
    }

    /**
     * Suma la pieza que el usuario tiene abierta actualmente en el editor
     */
    addCurrentPieceFromEditor() {
        if (!window.state?.mesh || !window.state?.rawOBJText) {
            alert('No hay ninguna pieza cargada actualmente en el editor principal.');
            return null;
        }

        // Clonar textura actual de capas (canvas-2d)
        const currentCanvas = document.getElementById('canvas-2d');
        const size = currentCanvas ? currentCanvas.width : 2048;
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = size;
        textureCanvas.height = size;
        const ctx = textureCanvas.getContext('2d');
        if (currentCanvas) {
            ctx.drawImage(currentCanvas, 0, 0);
        }

        const texture = new THREE.CanvasTexture(textureCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;

        const mesh = this.buildMeshFromOBJ(window.state.rawOBJText, texture);

        // Clonar configuración actual de Papercraft
        const piecePapercraft = new PapercraftEngine();
        if (window.papercraft) {
            const src = window.papercraft;
            piecePapercraft.modelLengthMm = src.modelLengthMm;
            piecePapercraft.currentScale = src.currentScale;
            piecePapercraft.showFlaps = src.showFlaps;
            piecePapercraft.tabHeightMm = src.tabHeightMm;
            piecePapercraft.tabAngleDeg = src.tabAngleDeg;
            piecePapercraft.cutLineColor = src.cutLineColor;
            piecePapercraft.cutLineWidthMm = src.cutLineWidthMm;
            piecePapercraft.foldLineColor = src.foldLineColor;
            piecePapercraft.foldLineWidthMm = src.foldLineWidthMm;
            piecePapercraft.hideSmoothLines = src.hideSmoothLines;
            piecePapercraft.showTabNumbers = src.showTabNumbers;
            piecePapercraft.numberPlacement = src.numberPlacement;
        }

        piecePapercraft.analyzeMesh(mesh, size);

        // Copiar posiciones de piezas acomodadas si existen
        if (window.papercraft?.parts && window.papercraft.parts.length > 0) {
            window.papercraft.parts.forEach(srcPart => {
                const targetPart = piecePapercraft.parts.find(p => p.id === srcPart.id);
                if (targetPart && srcPart.layout) {
                    targetPart.layout = { ...srcPart.layout };
                }
            });
            piecePapercraft.pagesCount = window.papercraft.pagesCount;
        }

        const currentProj = typeof window.getProjectNSPData === 'function' ? window.getProjectNSPData() : null;

        const defaultName = window.currentProjectFileName || `Pieza Editor (${this.pieces.length + 1})`;
        const piece = {
            id: 'piece_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: defaultName,
            fileType: 'editor',
            rawOBJText: window.state.rawOBJText,
            projectData: currentProj,
            mesh: mesh,
            textureCanvas: textureCanvas,
            texture: texture,
            papercraft: piecePapercraft,
            visible: true
        };

        this.addPiece(piece);
        this.activePieceId = piece.id;
        this.editorLoadedPieceId = piece.id;
        this.updateActivePieceSelectors();
        return piece;
    }

    addPiece(piece) {
        if (this.group) {
            this.group.add(piece.mesh);
        }

        // Si ya hay piezas existentes en el ensamble, colocar las piezas nuevas en la siguiente hoja disponible
        if (this.pieces.length > 0 && !piece._skipAutoSheetOffset && piece.papercraft && piece.papercraft.parts) {
            const offset = this.getTotalSheets();
            piece.papercraft.parts.forEach(pt => {
                pt.layout.pageIndex = (pt.layout.pageIndex || 0) + offset;
            });
            this.sheetsCount = offset + (piece.papercraft.pagesCount || 1);
        }

        this.pieces.push(piece);

        if (!this.activePieceId) {
            this.activePieceId = piece.id;
        }
        this.updateActivePieceSelectors();
        this.updateStatsBadge();
        this.renderUI();

        if (this.is3DMode && this.group && typeof window.frameModel === 'function') {
            window.frameModel(this.group);
        }
    }

    removePiece(id) {
        const idx = this.pieces.findIndex(p => p.id === id);
        if (idx === -1) return;

        const piece = this.pieces[idx];
        if (this.group && piece.mesh) {
            this.group.remove(piece.mesh);
            piece.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
            if (piece.texture) piece.texture.dispose();
        }

        this.pieces.splice(idx, 1);

        if (this.activePieceId === id) {
            this.activePieceId = this.pieces.length > 0 ? this.pieces[0].id : null;
            if (this.activePieceId) {
                this.setActivePiece(this.activePieceId);
            }
        }

        this.updateActivePieceSelectors();
        this.renderUI();

        if (this.is3DMode && this.group && typeof window.frameModel === 'function') {
            window.frameModel(this.group);
        }
    }

    movePiece(id, direction) {
        const idx = this.pieces.findIndex(p => p.id === id);
        if (idx === -1) return;
        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= this.pieces.length) return;

        const temp = this.pieces[idx];
        this.pieces[idx] = this.pieces[targetIdx];
        this.pieces[targetIdx] = temp;
        this.updateActivePieceSelectors();
        this.renderUI();
    }

    togglePieceVisibility(id, visible) {
        const piece = this.pieces.find(p => p.id === id);
        if (!piece) return;
        piece.visible = visible;
        if (piece.mesh) {
            piece.mesh.visible = visible;
        }
        this.updateActivePieceSelectors();
        this.renderUI();
        if (this.is3DMode) {
            const badgeCount = document.getElementById('assembler-badge-count');
            if (badgeCount) badgeCount.textContent = this.pieces.filter(p => p.visible).length;
        }
    }

    clearAllPieces() {
        if (this.group) {
            while (this.group.children.length > 0) {
                const child = this.group.children[0];
                this.group.remove(child);
                child.traverse(c => {
                    if (c.geometry) c.geometry.dispose();
                    if (c.material) {
                        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
                        else c.material.dispose();
                    }
                });
            }
        }
        this.pieces.forEach(p => {
            if (p.texture) p.texture.dispose();
        });
        this.pieces = [];
        this.activePieceId = null;
        this.updateActivePieceSelectors();
        this.renderUI();
    }

    /**
     * Construye un Object3D de Three.js desde texto OBJ con el material y bordes técnicos
     */
    buildMeshFromOBJ(objText, texture) {
        const cleanContents = window.triangulateConcaveNGons 
            ? window.triangulateConcaveNGons(objText) 
            : objText;
        const loader = new OBJLoader();
        const object = loader.parse(cleanContents);

        object.traverse((child) => {
            if (child.isMesh) {
                if ((!child.geometry.attributes.uv || child.geometry.attributes.uv.count === 0) && window.generateAutomaticUVs) {
                    window.generateAutomaticUVs(child.geometry);
                }
                child.material = new THREE.MeshBasicMaterial({
                    map: texture,
                    side: THREE.DoubleSide
                });

                // Aristas técnicas sutiles para ver los paneles con nitidez
                const childEdges = new THREE.EdgesGeometry(child.geometry, 25);
                const childLine = new THREE.LineSegments(
                    childEdges,
                    new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.25, transparent: true })
                );
                child.add(childLine);
            }
        });

        return object;
    }

    /**
     * Compone un canvas 2D a partir de las capas y pegatinas del proyecto .nsp
     */
    async compositeNspLayers(project, size) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);

        if (project.layers && Array.isArray(project.layers)) {
            for (const lData of project.layers) {
                if (lData.visible === false) continue;

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = size;
                tempCanvas.height = size;
                const tempCtx = tempCanvas.getContext('2d');

                // Imagen de píxeles de la capa
                if (lData.imageData) {
                    await new Promise(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            tempCtx.drawImage(img, 0, 0);
                            resolve();
                        };
                        img.onerror = resolve;
                        img.src = lData.imageData;
                    });
                }

                // Calcomanías / Textos de la capa
                if (lData.decals && Array.isArray(lData.decals)) {
                    for (const d of lData.decals) {
                        if (d.visible === false || !d.dataUrl) continue;
                        await new Promise(resolve => {
                            const dImg = new Image();
                            dImg.onload = () => {
                                tempCtx.save();
                                tempCtx.imageSmoothingEnabled = true;
                                tempCtx.imageSmoothingQuality = 'high';
                                tempCtx.globalAlpha = d.opacity !== undefined ? d.opacity : 1.0;
                                tempCtx.translate(d.x, d.y);
                                tempCtx.rotate(d.rotation || 0);
                                const scaleX = d.flipH ? -1 : 1;
                                const scaleY = d.flipV ? -1 : 1;
                                tempCtx.scale(scaleX, scaleY);
                                tempCtx.drawImage(dImg, -d.width / 2, -d.height / 2, d.width, d.height);
                                tempCtx.restore();
                                resolve();
                            };
                            dImg.onerror = resolve;
                            dImg.src = d.dataUrl;
                        });
                    }
                }

                ctx.save();
                ctx.globalAlpha = lData.opacity !== undefined ? lData.opacity : 1.0;
                ctx.globalCompositeOperation = lData.blendMode || 'source-over';
                ctx.drawImage(tempCanvas, 0, 0);
                ctx.restore();
            }
        }

        return canvas;
    }

    /**
     * Compila todas las piezas cargadas en un único Álbum PDF consolidado
     */
    async exportFinalAlbumPDF() {
        try {
            // Guardar primero el estado actual del lienzo en la pieza activa
            this.saveActivePieceToCache();

            const activePieces = this.pieces.filter(p => p.visible !== false);
            if (activePieces.length === 0) {
                alert('No hay piezas visibles para exportar. Carga o activa al menos una pieza en el ensamblador.');
                return;
            }

            const jsPDFClass = window.jspdf?.jsPDF || window.jsPDF;
            if (!jsPDFClass) {
                alert('La librería jsPDF no se encuentra cargada.');
                return;
            }

            const totalPartSheets = this.getTotalSheets();
            const totalAlbumPages = (this.includeCover ? 1 : 0) + totalPartSheets;

            const doc = new jsPDFClass({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const A4_W = 210.0;
            const A4_H = 297.0;
            const margin = 5.0;

            let currentGlobalPageIndex = 1;

            // 1. Portada e Índice General (si está activado)
            if (this.includeCover) {
                doc.saveGraphicsState();
                
                // Marco exterior azul técnico
                doc.setDrawColor(0, 120, 215);
                doc.setLineWidth(0.8);
                doc.rect(margin, margin, A4_W - margin * 2, A4_H - margin * 2);

                // Marco interior fino
                doc.setDrawColor(0, 120, 215);
                doc.setLineWidth(0.2);
                doc.rect(margin + 2, margin + 2, A4_W - margin * 2 - 4, A4_H - margin * 2 - 4);

                // Encabezado técnico
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(0, 120, 215);
                doc.text('NEO SUBSTANCE PAINTER • ÁLBUM COMPLETO PAPERCRAFT (1:1)', A4_W / 2, margin + 14, { align: 'center' });

                // Título Principal del Álbum
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(22);
                doc.setTextColor(20, 20, 20);
                doc.text((this.albumTitle || 'SUPER VF-1 VALKYRIE').toUpperCase(), A4_W / 2, margin + 30, { align: 'center' });

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(100, 100, 100);
                doc.text('PLANTILLAS TÉCNICAS VECTORIALES DE CORTE Y MONTAJE A4', A4_W / 2, margin + 37, { align: 'center' });

                // Cuadro resumen de datos
                doc.setFillColor(245, 248, 252);
                doc.setDrawColor(180, 205, 230);
                doc.setLineWidth(0.3);
                doc.roundedRect(margin + 12, margin + 46, A4_W - (margin + 12) * 2, 28, 3, 3, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(27, 94, 32);
                doc.text(`PIEZAS INCLUIDAS: ${activePieces.length}`, margin + 20, margin + 56);
                doc.text(`HOJAS DE CORTE A4: ${totalPartSheets}`, margin + 20, margin + 63);
                doc.text(`TOTAL PÁGINAS ÁLBUM: ${totalAlbumPages}`, margin + 20, margin + 70);

                doc.setFont('helvetica', 'normal');
                doc.setTextColor(60, 60, 60);
                doc.text(`Escala General: ${activePieces[0]?.papercraft?.currentScale || '1:33'}`, A4_W - margin - 80, margin + 56);
                doc.text(`Gramaje Sugerido: 160g - 200g`, A4_W - margin - 80, margin + 63);
                doc.text(`Impresión: 100% Sin Escalar`, A4_W - margin - 80, margin + 70);

                // Tabla / Índice de Piezas
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(0, 120, 215);
                doc.text('ÍNDICE Y DISTRIBUCIÓN DE PIEZAS', margin + 14, margin + 90);

                let tableY = margin + 98;

                doc.setFillColor(235, 240, 245);
                doc.rect(margin + 12, tableY - 5, A4_W - (margin + 12) * 2, 7, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8.5);
                doc.setTextColor(40, 40, 40);
                doc.text('#', margin + 16, tableY);
                doc.text('NOMBRE DE LA PIEZA', margin + 26, tableY);
                doc.text('HOJAS', margin + 115, tableY);
                doc.text('PÁGINAS DEL ÁLBUM', margin + 145, tableY);
                tableY += 8;

                activePieces.forEach((p, idx) => {
                    const pSheets = Array.from(new Set(p.papercraft?.parts?.map(pt => pt.layout.pageIndex) || []))
                        .filter(s => s >= 0 && s < totalPartSheets)
                        .sort((a, b) => a - b);
                    const count = pSheets.length;
                    let pageRangeStr = 'Sin piezas';
                    let sheetCountStr = '0 hojas';
                    if (count > 0) {
                        sheetCountStr = `${count} hoja${count > 1 ? 's' : ''}`;
                        if (count === 1) {
                            pageRangeStr = `Página ${pSheets[0] + (this.includeCover ? 2 : 1)}`;
                        } else {
                            pageRangeStr = `Páginas ${pSheets.map(s => s + (this.includeCover ? 2 : 1)).join(', ')}`;
                        }
                    }

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8.5);
                    doc.setTextColor(30, 30, 30);
                    doc.text(String(idx + 1), margin + 16, tableY);

                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(20, 20, 20);
                    doc.text(p.name, margin + 26, tableY);

                    doc.setTextColor(80, 80, 80);
                    doc.text(sheetCountStr, margin + 115, tableY);

                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(0, 120, 215);
                    doc.text(pageRangeStr, margin + 145, tableY);

                    // Línea separadora suave
                    doc.setDrawColor(220, 220, 220);
                    doc.setLineWidth(0.15);
                    doc.line(margin + 12, tableY + 2.5, A4_W - margin - 12, tableY + 2.5);

                    tableY += 7.5;
                });

                // Consejos técnicos de armado al pie de la portada
                const tipBoxY = A4_H - margin - 42;
                doc.setFillColor(250, 250, 250);
                doc.setDrawColor(210, 210, 210);
                doc.setLineWidth(0.3);
                doc.roundedRect(margin + 12, tipBoxY, A4_W - (margin + 12) * 2, 32, 2, 2, 'FD');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(183, 28, 28);
                doc.text('CONSEJOS DE MONTAJE Y CORTE:', margin + 16, tipBoxY + 7);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(70, 70, 70);
                doc.text('1. Imprime las plantillas seleccionando en tu impresora escala "Tamaño Real" o "100%" (sin ajustar a página).', margin + 16, tipBoxY + 13);
                doc.text('2. Las líneas grises continuas exteriores corresponden al corte de piezas y solapas.', margin + 16, tipBoxY + 19);
                doc.text('3. Las solapas de pegado incluyen pestañas recortadas para evitar colisiones y montajes.', margin + 16, tipBoxY + 25);

                // Pie de página de la portada
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.setTextColor(120, 120, 120);
                doc.text(`PORTADA • HOJA 1 DE ${totalAlbumPages} • NEO SUBSTANCE PAINTER`, A4_W / 2, A4_H - margin - 3, { align: 'center' });

                doc.restoreGraphicsState();
                currentGlobalPageIndex = 2;
            }

            // 2. Renderizado de cada hoja A4 del ensamble
            for (let s = 0; s < totalPartSheets; s++) {
                if (this.includeCover || currentGlobalPageIndex > 1) {
                    doc.addPage('a4', 'portrait');
                }

                const piecesOnSheet = activePieces.filter(p => p.papercraft && p.papercraft.parts.some(pt => pt.layout.pageIndex === s));
                const sheetPieceNames = piecesOnSheet.map(p => p.name).join(', ') || 'Varios';

                let isFirstPieceOnSheet = true;
                for (const piece of activePieces) {
                    if (!piece.papercraft) continue;
                    const partsOnSheet = piece.papercraft.parts.filter(pt => pt.layout.pageIndex === s);
                    if (partsOnSheet.length === 0) continue;

                    piece.papercraft.renderPageToPDF(doc, s, piece.textureCanvas, {
                        pieceName: sheetPieceNames,
                        globalPageIndex: currentGlobalPageIndex,
                        totalGlobalPages: totalAlbumPages,
                        skipHeader: !isFirstPieceOnSheet
                    });
                    isFirstPieceOnSheet = false;
                }

                // Si la hoja estaba vacía, dibujar el marco y encabezado
                if (isFirstPieceOnSheet && activePieces[0]?.papercraft) {
                    activePieces[0].papercraft.renderPageToPDF(doc, s, null, {
                        pieceName: 'Hoja Vacía',
                        globalPageIndex: currentGlobalPageIndex,
                        totalGlobalPages: totalAlbumPages
                    });
                }

                currentGlobalPageIndex++;
            }

            // 3. Abrir en la ventana de previsualización con descarga e impresión
            const safeTitle = (this.albumTitle || 'Album_Papercraft_Completo').replace(/[^a-zA-Z0-9_-]/g, '_');
            const filename = `${safeTitle}_1-1.pdf`;
            
            if (window.papercraft && typeof window.papercraft.showPdfPreviewModal === 'function') {
                window.papercraft.showPdfPreviewModal(doc, filename, totalAlbumPages);
            } else {
                doc.save(filename);
            }
        } catch (err) {
            console.error('Error al compilar el Álbum PDF:', err);
            alert('Ocurrió un error al generar el Álbum PDF: ' + (err.message || err));
        }
    }

    /**
     * Guarda el proyecto de ensamblado completo con todas las piezas en un archivo .nspp
     */
    async exportAssemblyProject() {
        this.saveActivePieceToCache();

        const activePieces = this.pieces;
        if (activePieces.length === 0) {
            alert('No hay piezas en el ensamblador para guardar.');
            return;
        }

        const totalSheets = this.getTotalSheets();

        const projectData = {
            version: '6.0',
            type: 'neo_substance_assembler_project',
            createdAt: new Date().toISOString(),
            albumTitle: this.albumTitle || 'Proyecto Ensamblado',
            globalScalePct: this.globalScalePct || 100,
            includeCover: this.includeCover !== false,
            totalSheets: totalSheets,
            activePieceId: this.activePieceId,
            pieces: activePieces.map(piece => {
                let textureDataUrl = null;
                if (piece.textureCanvas) {
                    try {
                        textureDataUrl = piece.textureCanvas.toDataURL('image/png');
                    } catch (e) {
                        console.warn('Error al exportar textura de pieza a base64:', piece.name, e);
                    }
                }
                return {
                    id: piece.id,
                    name: piece.name,
                    fileType: piece.fileType,
                    rawOBJText: piece.rawOBJText,
                    visible: piece.visible !== false,
                    projectData: piece.projectData || null,
                    textureDataUrl: textureDataUrl,
                    papercraftState: piece.papercraft ? {
                        modelLengthMm: piece.papercraft.modelLengthMm,
                        baseModelLengthMm: piece.papercraft.baseModelLengthMm,
                        scalePct: piece.papercraft.scalePct,
                        currentScale: piece.papercraft.currentScale,
                        pagesCount: piece.papercraft.pagesCount,
                        tabHeightMm: piece.papercraft.tabHeightMm,
                        tabAngleDeg: piece.papercraft.tabAngleDeg,
                        cutLineColor: piece.papercraft.cutLineColor,
                        cutLineWidthMm: piece.papercraft.cutLineWidthMm,
                        foldLineColor: piece.papercraft.foldLineColor,
                        foldLineWidthMm: piece.papercraft.foldLineWidthMm,
                        hideSmoothLines: piece.papercraft.hideSmoothLines,
                        showTabNumbers: piece.papercraft.showTabNumbers,
                        numberPlacement: piece.papercraft.numberPlacement,
                        partsLayout: (piece.papercraft.parts || []).map(p => ({
                            id: p.id,
                            layout: { ...p.layout }
                        }))
                    } : null
                };
            })
        };

        const json = JSON.stringify(projectData);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeTitle = (this.albumTitle || 'Proyecto_Ensamblado').replace(/\s+/g, '_');
        a.href = url;
        a.download = `${safeTitle}.nspp`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Carga un proyecto de ensamblado completo (.nspp o JSON)
     */
    async loadAssemblyProject(fileOrData) {
        try {
            let jsonText = '';
            if (typeof fileOrData === 'string') {
                jsonText = fileOrData;
            } else if (fileOrData instanceof Blob) {
                jsonText = await fileOrData.text();
            } else if (typeof fileOrData === 'object') {
                jsonText = JSON.stringify(fileOrData);
            }

            const project = JSON.parse(jsonText);
            if (project.type !== 'neo_substance_assembler_project' && !Array.isArray(project.pieces)) {
                throw new Error('El archivo no es un proyecto de ensamblado válido (.nspp).');
            }

            // Vaciar ensamble actual
            this.clearAllPieces();

            // Restaurar opciones globales
            if (project.albumTitle) {
                this.albumTitle = project.albumTitle;
                const titleInput = document.getElementById('assembler-album-title');
                if (titleInput) titleInput.value = project.albumTitle;
            }
            if (project.globalScalePct) {
                this.globalScalePct = project.globalScalePct;
                const scaleInput = document.getElementById('assembler-global-scale-input');
                if (scaleInput) scaleInput.value = project.globalScalePct;
            }
            if (project.includeCover !== undefined) {
                this.includeCover = project.includeCover;
                const coverCheck = document.getElementById('assembler-include-cover');
                if (coverCheck) coverCheck.checked = project.includeCover;
            }
            if (project.totalSheets) {
                this.sheetsCount = project.totalSheets;
            }

            // Reconstruir piezas
            for (const pData of project.pieces) {
                const size = 2048;
                const textureCanvas = document.createElement('canvas');
                textureCanvas.width = size;
                textureCanvas.height = size;
                const ctx = textureCanvas.getContext('2d');

                if (pData.textureDataUrl) {
                    await new Promise((resolve) => {
                        const img = new Image();
                        img.onload = () => {
                            ctx.drawImage(img, 0, 0, size, size);
                            resolve();
                        };
                        img.onerror = resolve;
                        img.src = pData.textureDataUrl;
                    });
                } else if (pData.projectData) {
                    const comp = await this.compositeNspLayers(pData.projectData, size);
                    ctx.drawImage(comp, 0, 0, size, size);
                } else {
                    ctx.fillStyle = '#f0f0f0';
                    ctx.fillRect(0, 0, size, size);
                }

                const texture = new THREE.CanvasTexture(textureCanvas);
                texture.colorSpace = THREE.SRGBColorSpace;
                const mesh = this.buildMeshFromOBJ(pData.rawOBJText, texture);

                const piecePapercraft = new PapercraftEngine();
                const ps = pData.papercraftState;
                if (ps) {
                    if (ps.baseModelLengthMm) piecePapercraft.baseModelLengthMm = ps.baseModelLengthMm;
                    if (ps.modelLengthMm) piecePapercraft.modelLengthMm = ps.modelLengthMm;
                    if (ps.scalePct !== undefined) piecePapercraft.scalePct = ps.scalePct;
                    if (ps.currentScale) piecePapercraft.currentScale = ps.currentScale;
                    if (ps.pagesCount) piecePapercraft.pagesCount = ps.pagesCount;
                    if (ps.tabHeightMm !== undefined) piecePapercraft.tabHeightMm = ps.tabHeightMm;
                    if (ps.tabAngleDeg !== undefined) piecePapercraft.tabAngleDeg = ps.tabAngleDeg;
                    if (ps.cutLineColor) piecePapercraft.cutLineColor = ps.cutLineColor;
                    if (ps.cutLineWidthMm) piecePapercraft.cutLineWidthMm = ps.cutLineWidthMm;
                    if (ps.foldLineColor) piecePapercraft.foldLineColor = ps.foldLineColor;
                    if (ps.foldLineWidthMm) piecePapercraft.foldLineWidthMm = ps.foldLineWidthMm;
                    if (ps.hideSmoothLines !== undefined) piecePapercraft.hideSmoothLines = ps.hideSmoothLines;
                    if (ps.showTabNumbers !== undefined) piecePapercraft.showTabNumbers = ps.showTabNumbers;
                    if (ps.numberPlacement) piecePapercraft.numberPlacement = ps.numberPlacement;
                }

                piecePapercraft.analyzeMesh(mesh, size);

                if (ps && Array.isArray(ps.partsLayout)) {
                    ps.partsLayout.forEach(savedPart => {
                        const part = piecePapercraft.parts.find(pt => pt.id === savedPart.id);
                        if (part && savedPart.layout) {
                            Object.assign(part.layout, savedPart.layout);
                        }
                    });
                }

                const piece = {
                    id: pData.id || ('piece_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
                    name: pData.name || 'Pieza',
                    fileType: pData.fileType || 'nsp',
                    rawOBJText: pData.rawOBJText,
                    projectData: pData.projectData,
                    mesh: mesh,
                    textureCanvas: textureCanvas,
                    texture: texture,
                    papercraft: piecePapercraft,
                    visible: pData.visible !== false,
                    _skipAutoSheetOffset: true
                };

                this.pieces.push(piece);
                if (this.group) this.group.add(mesh);
            }

            if (this.pieces.length > 0) {
                const firstId = project.activePieceId || this.pieces[0].id;
                this.setActivePiece(firstId, true);
            }

            this.updateActivePieceSelectors();
            this.updateStatsBadge();
            this.renderUI();

            if (this.is3DMode && this.group && typeof window.frameModel === 'function') {
                window.frameModel(this.group);
            }

            if (typeof window.renderUnfoldWorkbench === 'function') {
                window.renderUnfoldWorkbench();
            }

            alert(`✓ Proyecto ensamblado "${this.albumTitle}" cargado con éxito (${this.pieces.length} piezas).`);
        } catch (err) {
            console.error('Error al cargar proyecto ensamblado:', err);
            alert(`Error al cargar el proyecto ensamblado: ${err.message}`);
        }
    }

    updateStatsBadge() {
        const badge = document.getElementById('assembler-stats-badge');
        if (!badge) return;

        const activePieces = this.pieces.filter(p => p.visible !== false);
        const totalSheets = this.getTotalSheets();
        const totalPages = (this.includeCover ? 1 : 0) + totalSheets;

        badge.textContent = `${activePieces.length} de ${this.pieces.length} Piezas activas • ${totalSheets} Hojas A4 (${totalPages} páginas con portada)`;
    }

    renderUI() {
        this.updateStatsBadge();
        const list = document.getElementById('assembler-pieces-list');
        if (!list) return;

        if (this.pieces.length === 0) {
            list.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: #777; text-align: center; border: 2px dashed #333; border-radius: 8px;">
                    <span style="font-size: 42px; margin-bottom: 12px; opacity: 0.5;">📦</span>
                    <h3 style="margin: 0 0 6px 0; color: #ccc; font-size: 15px;">No hay piezas cargadas en el ensamblador</h3>
                    <p style="margin: 0 0 16px 0; font-size: 12px; max-width: 440px; line-height: 1.4;">
                        Carga archivos <b>.nsp</b> (piezas ya pintadas con sus calcas y solapas) o archivos <b>.obj</b> directamente desde tu carpeta de Blender.
                    </p>
                    <div style="display: flex; gap: 10px;">
                        <button type="button" onclick="document.getElementById('btn-assembler-add-file').click()" class="ribbon-btn" style="background: #0288d1; font-weight: bold; padding: 6px 14px;">
                            ➕ Cargar Piezas (.nsp o .obj)
                        </button>
                        <button type="button" onclick="document.getElementById('btn-assembler-add-current').click()" class="ribbon-btn" style="background: #e65100; font-weight: bold; padding: 6px 14px;">
                            📌 Sumar Pieza Actual del Editor
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        list.innerHTML = '';
        this.pieces.forEach((piece, idx) => {
            const card = document.createElement('div');
            card.className = 'assembler-piece-card';
            card.style.display = 'flex';
            card.style.alignItems = 'center';
            card.style.justifyContent = 'space-between';
            const isActive = piece.id === this.activePieceId;
            card.style.background = isActive ? '#2d1840' : '#222';
            card.style.border = isActive ? '2px solid #ab47bc' : (piece.visible ? '1px solid #383838' : '1px dashed #444');
            card.style.boxShadow = isActive ? '0 0 10px rgba(171, 71, 188, 0.4)' : 'none';
            card.style.opacity = piece.visible ? '1.0' : '0.55';
            card.style.borderRadius = '6px';
            card.style.padding = '8px 14px';
            card.style.gap = '14px';
            card.style.transition = 'all 0.15s ease';

            // Miniatura
            const thumbUrl = piece.textureCanvas ? piece.textureCanvas.toDataURL('image/jpeg', 0.6) : '';
            const typeBadgeColor = piece.fileType === 'nsp' ? '#00897b' : (piece.fileType === 'editor' ? '#ef6c00' : '#1565c0');
            const typeBadgeLabel = piece.fileType === 'nsp' ? 'NSP' : (piece.fileType === 'editor' ? 'EDITOR' : 'OBJ');

            card.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; cursor: pointer;" class="card-select-area" title="Haz clic para activar esta pieza en el visor 2D">
                    <!-- Botones Reordenar -->
                    <div style="display: flex; flex-direction: column; gap: 2px;" onclick="event.stopPropagation();">
                        <button class="btn-piece-up" style="background: #333; border: 1px solid #444; color: #ccc; border-radius: 3px; font-size: 9px; width: 20px; height: 18px; cursor: pointer;" title="Subir orden" ${idx === 0 ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>▲</button>
                        <button class="btn-piece-down" style="background: #333; border: 1px solid #444; color: #ccc; border-radius: 3px; font-size: 9px; width: 20px; height: 18px; cursor: pointer;" title="Bajar orden" ${idx === this.pieces.length - 1 ? 'disabled style="opacity:0.3;cursor:default;"' : ''}>▼</button>
                    </div>

                    <!-- Miniatura -->
                    <div style="width: 44px; height: 44px; border-radius: 4px; overflow: hidden; background: #111; border: 1px solid ${isActive ? '#ce93d8' : '#444'}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        ${thumbUrl ? `<img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;">` : '<span style="font-size: 18px;">📦</span>'}
                    </div>

                    <!-- Información de la pieza -->
                    <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="background: ${typeBadgeColor}; color: #fff; font-size: 9px; font-weight: bold; padding: 1px 5px; border-radius: 3px;">${typeBadgeLabel}</span>
                            ${isActive ? '<span style="background: #8e24aa; color: #fff; font-size: 9px; font-weight: bold; padding: 1px 6px; border-radius: 10px; box-shadow: 0 0 6px #ab47bc;">⭐ ACTIVA EN 2D</span>' : ''}
                            <input type="text" class="piece-name-input" value="${piece.name}" onclick="event.stopPropagation();" style="background: transparent; border: 1px solid transparent; color: #fff; font-size: 13px; font-weight: bold; width: 100%; max-width: 280px; border-radius: 3px; padding: 2px 4px;" title="Haz clic para renombrar la pieza">
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px; font-size: 11px; color: #999;">
                            <span>📄 <b>${piece.papercraft?.pagesCount || 1}</b> hoja(s) A4</span>
                            <span>•</span>
                            <span>Escala: ${piece.papercraft?.currentScale || '1:33'}</span>
                            <span>•</span>
                            <span>Longitud: ${Math.round(piece.papercraft?.modelLengthMm || 200)} mm</span>
                        </div>
                    </div>
                </div>

                <!-- Botones de Acción -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="btn-piece-toggle-vis ribbon-btn" style="background: ${piece.visible ? '#2e7d32' : '#444'}; border-color: ${piece.visible ? '#1b5e20' : '#555'}; font-size: 11px; padding: 4px 8px;" title="${piece.visible ? 'Ocultar del 3D y Álbum' : 'Mostrar en 3D y Álbum'}">
                        ${piece.visible ? '👁️ Visible' : '👁️‍🗨️ Oculta'}
                    </button>
                    <button class="btn-piece-select-active ribbon-btn" style="background: ${isActive ? '#7b1fa2' : '#e65100'}; border-color: ${isActive ? '#ba68c8' : '#bf360c'}; font-size: 11px; padding: 4px 10px; font-weight: bold;" title="Cargar esta pieza en el visor 2D para pintarla">
                        ${isActive ? '✓ En Pintura' : '🎨 Pintar en 2D'}
                    </button>
                    <button class="btn-piece-delete ribbon-btn" style="background: #b71c1c; border-color: #880e4f; font-size: 11px; padding: 4px 8px;" title="Eliminar pieza del ensamblador">
                        🗑️
                    </button>
                </div>
            `;

            // Eventos de la tarjeta
            card.querySelector('.card-select-area')?.addEventListener('click', () => this.setActivePiece(piece.id));
            card.querySelector('.btn-piece-select-active')?.addEventListener('click', () => {
                this.setActivePiece(piece.id);
                this.closeModal();
            });
            card.querySelector('.btn-piece-up')?.addEventListener('click', () => this.movePiece(piece.id, -1));
            card.querySelector('.btn-piece-down')?.addEventListener('click', () => this.movePiece(piece.id, 1));
            card.querySelector('.btn-piece-toggle-vis')?.addEventListener('click', () => this.togglePieceVisibility(piece.id, !piece.visible));
            card.querySelector('.btn-piece-delete')?.addEventListener('click', () => this.removePiece(piece.id));

            const nameInput = card.querySelector('.piece-name-input');
            if (nameInput) {
                nameInput.addEventListener('focus', () => {
                    nameInput.style.background = '#111';
                    nameInput.style.borderColor = '#00e5ff';
                });
                nameInput.addEventListener('blur', () => {
                    nameInput.style.background = 'transparent';
                    nameInput.style.borderColor = 'transparent';
                    piece.name = nameInput.value.trim() || piece.name;
                    this.updateActivePieceSelectors();
                });
                nameInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') nameInput.blur();
                });
            }

            list.appendChild(card);
        });
    }
}

// Inicializar el Ensamblador una vez cargado el DOM o inmediatamente si ya está listo
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
        if (!window.modelAssembler) window.modelAssembler = new ModelAssembler();
    });
} else {
    if (!window.modelAssembler) window.modelAssembler = new ModelAssembler();
}
