import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

export class DecalSystem {
    constructor(scene, camera, renderer, canvas2d, texture, layerManager = null, painter = null) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.canvas = canvas2d;
        this.texture = texture;
        this.layerManager = layerManager;
        this.painter = painter;
        this.mesh = null;

        this.canvasUI = document.getElementById('canvas-ui');
        this.ctxUI = this.canvasUI ? this.canvasUI.getContext('2d') : null;

        // Modo actual: '3d' o '2d'
        this.mode = '3d';

        this.currentDecalImage = null;
        this.decalTexture = null;
        this.isActive = false;
        this.isLocked = false;
        this.isTextMode = false;
        this.textOptions = null;

        // Parámetros del proyector 3D
        this.projectorPosition = new THREE.Vector3();
        this.projectorNormal = new THREE.Vector3(0, 0, 1);
        this.projectorRotation = 0; // en radianes
        this.projectorScale = 100;  // 100% por defecto
        this.currentProjectorOrientation = new THREE.Euler();
        this.currentProjectorSize = new THREE.Vector3(1, 1, 1);
        this.allowPassthrough = false; // false = solo cara frontal (por defecto), true = atravesar caras opuestas

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.lastHit = null;

        // Parámetros de la calcomanía en Modo 2D
        this.decal2D = {
            x: 1024,
            y: 1024,
            width: 300,
            height: 300,
            baseWidth: 300,
            baseHeight: 300,
            rotation: 0,
            isDragging: false,
            dragHandle: null,
            dragOffset: { x: 0, y: 0 },
            initialDecal: null
        };

        // Objeto 3D de previsualización
        this.previewGroup = new THREE.Group();
        this.previewGroup.visible = false;
        this.scene.add(this.previewGroup);

        this.setupPreviewMesh();
        this.setupEvents();
    }

    setMesh(mesh) {
        this.mesh = mesh;
    }

    setLayerManager(lm) {
        this.layerManager = lm;
    }

    setPainter(painter) {
        this.painter = painter;
    }

    setMode(mode) {
        this.mode = mode;
        const btnMode3D = document.getElementById('btn-decal-mode-3d');
        const btnMode2D = document.getElementById('btn-decal-mode-2d');
        if (btnMode3D) btnMode3D.classList.toggle('active', mode === '3d');
        if (btnMode2D) btnMode2D.classList.toggle('active', mode === '2d');

        const btnTextMode3D = document.getElementById('btn-text-mode-3d');
        const btnTextMode2D = document.getElementById('btn-text-mode-2d');
        if (btnTextMode3D) btnTextMode3D.classList.toggle('active', mode === '3d');
        if (btnTextMode2D) btnTextMode2D.classList.toggle('active', mode === '2d');

        const passGroup = document.getElementById('decal-passthrough-group');
        if (passGroup) passGroup.style.display = mode === '3d' ? 'flex' : 'none';

        if (mode === '2d') {
            this.previewGroup.visible = false;
            if (this.isActive) {
                // Sincronizar sliders con valores 2D
                const scaleInput = document.getElementById('decal-scale');
                const rotInput = document.getElementById('decal-rotation');
                const rotLabel = document.getElementById('decal-rot-label');
                const currentScalePct = Math.round((this.decal2D.width / this.decal2D.baseWidth) * 100);
                if (scaleInput) scaleInput.value = Math.min(300, Math.max(10, currentScalePct));
                const deg = Math.round((this.decal2D.rotation * 180 / Math.PI) % 360);
                const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
                if (rotInput) rotInput.value = normDeg;
                if (rotLabel) rotLabel.textContent = `${normDeg}°`;

                if (this.isTextMode) {
                    const textRot = document.getElementById('text-rotation');
                    const textRotLabel = document.getElementById('text-rot-val');
                    if (textRot) textRot.value = normDeg;
                    if (textRotLabel) textRotLabel.textContent = `${normDeg}°`;
                    if (this.textOptions) this.textOptions.rotation = normDeg;
                }

                this.render2DPreview();
            }
        } else {
            if (this.isActive) {
                this.previewGroup.visible = true;
                const scaleInput = document.getElementById('decal-scale');
                const rotInput = document.getElementById('decal-rotation');
                const rotLabel = document.getElementById('decal-rot-label');
                if (scaleInput) scaleInput.value = this.projectorScale;
                const deg = Math.round((this.projectorRotation * 180 / Math.PI) % 360);
                if (rotInput) rotInput.value = deg;
                if (rotLabel) rotLabel.textContent = `${deg}°`;

                if (this.isTextMode) {
                    const textRot = document.getElementById('text-rotation');
                    const textRotLabel = document.getElementById('text-rot-val');
                    if (textRot) textRot.value = deg;
                    if (textRotLabel) textRotLabel.textContent = `${deg}°`;
                    if (this.textOptions) this.textOptions.rotation = deg;
                }

                this.updatePreviewTransform();
                this.render2DPreview();
            }
        }
    }

    setupPreviewMesh() {
        this.previewMaterial = new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
            side: THREE.DoubleSide
        });

        // Malla adaptativa DecalGeometry (se amolda a la curvatura 3D)
        this.previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.previewMaterial);
        this.previewGroup.add(this.previewMesh);

        // Borde azul adaptativo a la superficie
        const lineMat = new THREE.LineBasicMaterial({ color: 0x00a2ff, linewidth: 2 });
        this.previewBorder = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
        this.previewGroup.add(this.previewBorder);

        // Plano de respaldo (fallback si el cursor sale del modelo)
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        this.fallbackPlane = new THREE.Mesh(planeGeo, this.previewMaterial);
        this.fallbackBorder = new THREE.LineSegments(new THREE.EdgesGeometry(planeGeo), lineMat);
        this.previewGroup.add(this.fallbackPlane);
        this.previewGroup.add(this.fallbackBorder);
        this.fallbackPlane.visible = false;
        this.fallbackBorder.visible = false;
    }

    setupEvents() {
        const inputDecal = document.getElementById('input-decal');
        const btnLoad = document.getElementById('btn-load-decal');
        const btnBake = document.getElementById('btn-bake-decal');
        const btnBake2D = document.getElementById('btn-bake-decal-2d');
        const btnBake3D = document.getElementById('btn-bake-decal-3d');
        const btnCancel = document.getElementById('btn-cancel-decal');
        const scaleInput = document.getElementById('decal-scale');
        const rotInput = document.getElementById('decal-rotation');
        const rotLabel = document.getElementById('decal-rot-label');
        const btnScaleDec = document.getElementById('btn-decal-scale-dec');
        const btnScaleInc = document.getElementById('btn-decal-scale-inc');

        const btnMode3D = document.getElementById('btn-decal-mode-3d');
        const btnMode2D = document.getElementById('btn-decal-mode-2d');

        btnMode3D?.addEventListener('click', () => this.setMode('3d'));
        btnMode2D?.addEventListener('click', () => this.setMode('2d'));

        btnLoad?.addEventListener('click', () => inputDecal?.click());

        inputDecal?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    this.setDecalImage(img);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
            inputDecal.value = '';
        });

        scaleInput?.addEventListener('input', (e) => {
            if (this.mode === '2d') {
                const scale = parseFloat(e.target.value) / 100;
                this.decal2D.width = this.decal2D.baseWidth * scale;
                this.decal2D.height = this.decal2D.baseHeight * scale;
                this.render2DPreview();
            } else {
                this.projectorScale = parseFloat(e.target.value);
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        });

        btnScaleDec?.addEventListener('click', () => {
            if (!scaleInput) return;
            scaleInput.value = Math.max(10, parseInt(scaleInput.value, 10) - 10);
            if (this.mode === '2d') {
                const scale = parseFloat(scaleInput.value) / 100;
                this.decal2D.width = this.decal2D.baseWidth * scale;
                this.decal2D.height = this.decal2D.baseHeight * scale;
                this.render2DPreview();
            } else {
                this.projectorScale = parseFloat(scaleInput.value);
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        });

        btnScaleInc?.addEventListener('click', () => {
            if (!scaleInput) return;
            scaleInput.value = Math.min(300, parseInt(scaleInput.value, 10) + 10);
            if (this.mode === '2d') {
                const scale = parseFloat(scaleInput.value) / 100;
                this.decal2D.width = this.decal2D.baseWidth * scale;
                this.decal2D.height = this.decal2D.baseHeight * scale;
                this.render2DPreview();
            } else {
                this.projectorScale = parseFloat(scaleInput.value);
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        });

        const btnRotDec = document.getElementById('btn-decal-rot-dec');
        const btnRotInc = document.getElementById('btn-decal-rot-inc');

        const updateRotation = (deg) => {
            deg = Math.max(-180, Math.min(180, deg));
            if (rotInput) rotInput.value = deg;
            if (rotLabel) rotLabel.textContent = `${deg}°`;
            if (this.mode === '2d') {
                this.decal2D.rotation = (deg * Math.PI) / 180;
                this.render2DPreview();
            } else {
                this.projectorRotation = (deg * Math.PI) / 180;
                this.updatePreviewTransform();
                if (this.lastHit) this.sync2DFrom3D(this.lastHit);
            }
        };

        rotInput?.addEventListener('input', (e) => {
            const deg = parseInt(e.target.value, 10);
            updateRotation(deg);
        });

        btnRotDec?.addEventListener('click', () => {
            const current = parseInt(rotInput?.value || 0, 10);
            updateRotation(current - 1);
        });

        btnRotInc?.addEventListener('click', () => {
            const current = parseInt(rotInput?.value || 0, 10);
            updateRotation(current + 1);
        });

        const chkPassthrough = document.getElementById('decal-passthrough');
        chkPassthrough?.addEventListener('change', (e) => {
            this.allowPassthrough = e.target.checked;
            if (this.mode === '3d' && this.isActive) {
                this.updatePreviewTransform();
            }
        });

        btnBake?.addEventListener('click', () => {
            this.bakeToActiveLayer();
        });

        btnBake2D?.addEventListener('click', () => {
            this.bake2DToActiveLayer();
        });

        btnBake3D?.addEventListener('click', () => {
            this.bake3DToActiveLayer();
        });

        btnCancel?.addEventListener('click', () => {
            this.cancelDecal();
        });

        // Controles de Modo Texto integrados
        const btnTextMode3D = document.getElementById('btn-text-mode-3d');
        const btnTextMode2D = document.getElementById('btn-text-mode-2d');
        btnTextMode3D?.addEventListener('click', () => this.setMode('3d'));
        btnTextMode2D?.addEventListener('click', () => this.setMode('2d'));

        const btnTextBake2D = document.getElementById('btn-text-bake-2d');
        const btnTextBake3D = document.getElementById('btn-text-bake-3d');
        const btnTextCancel = document.getElementById('btn-text-cancel');
        btnTextBake2D?.addEventListener('click', () => this.bake2DToActiveLayer());
        btnTextBake3D?.addEventListener('click', () => this.bake3DToActiveLayer());
        btnTextCancel?.addEventListener('click', () => this.cancelDecal());

        // Eventos del Viewport 3D para posicionar la calcomanía
        const view3d = this.renderer.domElement;

        view3d.addEventListener('pointermove', (e) => {
            if (!this.isActive || this.mode === '2d' || this.isLocked) return;
            this.raycastSurface(e);
        });

        view3d.addEventListener('pointerdown', (e) => {
            if (!this.isActive || this.mode === '2d' || e.button !== 0) return;
            this.raycastSurface(e);
            this.isLocked = !this.isLocked;
        });

        // Eventos del Canvas 2D para interactuar con la calcomanía en Modo 2D
        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown2D(e));
        window.addEventListener('pointermove', (e) => this.onPointerMove2D(e));
        window.addEventListener('pointerup', (e) => this.onPointerUp2D(e));
    }

    setDecalImage(img) {
        this.currentDecalImage = img;
        this.decalTexture = new THREE.Texture(img);
        this.decalTexture.colorSpace = THREE.SRGBColorSpace;
        this.decalTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.decalTexture.magFilter = THREE.LinearFilter;
        this.decalTexture.generateMipmaps = true;
        if (this.renderer && this.renderer.capabilities) {
            this.decalTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        }
        this.decalTexture.needsUpdate = true;

        this.previewMaterial.map = this.decalTexture;
        this.previewMaterial.needsUpdate = true;

        this.isActive = true;
        this.isLocked = false;

        // Inicializar dimensiones 2D con fidelidad 1:1 y aspecto original
        const baseDim = 400;
        let w = baseDim;
        let h = baseDim;
        if (img.width > 0 && img.height > 0) {
            if (img.width >= img.height) {
                h = baseDim * (img.height / img.width);
            } else {
                w = baseDim * (img.width / img.height);
            }
        }

        this.decal2D = {
            x: this.canvas.width / 2,
            y: this.canvas.height / 2,
            width: w,
            height: h,
            baseWidth: w,
            baseHeight: h,
            rotation: 0,
            isDragging: false,
            dragHandle: null,
            dragOffset: { x: 0, y: 0 },
            initialDecal: null
        };

        // Mostrar controles en UI
        this.isTextMode = false;
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'none';

        const controls = document.getElementById('decal-controls');
        const thumb = document.getElementById('decal-preview-thumb');
        if (controls) controls.style.display = 'flex';
        if (thumb) {
            thumb.style.display = 'block';
            thumb.style.backgroundImage = `url(${img.src})`;
        }

        // Resetear controles a valores predeterminados
        const scaleInput = document.getElementById('decal-scale');
        const rotInput = document.getElementById('decal-rotation');
        const rotLabel = document.getElementById('decal-rot-label');
        const chkPassthrough = document.getElementById('decal-passthrough');
        if (scaleInput) scaleInput.value = 100;
        if (rotInput) rotInput.value = 0;
        if (rotLabel) rotLabel.textContent = '0°';
        if (chkPassthrough) chkPassthrough.checked = this.allowPassthrough;
        this.projectorScale = 100;
        this.projectorRotation = 0;

        // Posicionar por defecto al centro del modelo en 3D
        if (this.mesh) {
            const box = new THREE.Box3().setFromObject(this.mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            this.projectorPosition.set(center.x, center.y, center.z + size.z * 0.5);
            this.projectorNormal.set(0, 0, 1);

            // Raycast automático frontal para registrar en 2D desde el primer milisegundo
            const rayOrigin = new THREE.Vector3(center.x, center.y + size.y * 0.3, center.z + size.z * 1.5);
            const rayDir = new THREE.Vector3(0, 0, -1);
            this.raycaster.set(rayOrigin, rayDir);
            const intersects = this.raycaster.intersectObject(this.mesh, true);
            const hit = intersects.find(i => i.object.isMesh && i.uv && i.face);
            if (hit) {
                this.lastHit = hit;
                this.projectorPosition.copy(hit.point);
                const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                this.projectorNormal.copy(worldNormal);
                this.sync2DFrom3D(hit);
            }
        }

        if (this.mode === '2d') {
            this.previewGroup.visible = false;
        } else {
            this.previewGroup.visible = true;
            this.updatePreviewTransform();
        }
        this.render2DPreview();
    }

    startTextMode(opts = {}) {
        this.isTextMode = true;
        this.textOptions = Object.assign({
            text: document.getElementById('text-input-value')?.value || 'TEXTO',
            fontFamily: document.getElementById('text-font-family')?.value || 'Arial',
            fontSize: parseInt(document.getElementById('text-font-size')?.value || 48, 10),
            rotation: parseInt(document.getElementById('text-rotation')?.value || 0, 10),
            isBold: document.getElementById('btn-text-bold')?.classList.contains('active') ?? true,
            isItalic: document.getElementById('btn-text-italic')?.classList.contains('active') ?? false,
            color: document.getElementById('text-color')?.value || '#111111',
            mode: '3d'
        }, opts);

        const decalControls = document.getElementById('decal-controls');
        if (decalControls) decalControls.style.display = 'none';
        const textControls = document.getElementById('text-controls');
        if (textControls) textControls.style.display = 'flex';

        this.updateTextDecal();
    }

    updateTextDecal(opts = {}) {
        if (!this.isTextMode) return;
        if (opts) Object.assign(this.textOptions, opts);
        const o = this.textOptions;

        // Renderizado vectorial de texto en canvas offscreen de alta fidelidad
        const offscreen = document.createElement('canvas');
        const ctx = offscreen.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const renderFontSize = 256;
        let style = '';
        if (o.isItalic) style += 'italic ';
        if (o.isBold) style += 'bold ';
        ctx.font = `${style}${renderFontSize}px "${o.fontFamily}", sans-serif`;

        const txt = (o.text !== undefined && o.text !== null && o.text.length > 0) ? o.text : ' ';
        const metrics = ctx.measureText(txt);
        const textW = Math.max(20, Math.ceil(metrics.width));
        const textH = Math.max(20, Math.ceil(renderFontSize * 1.25));
        const pad = 24;
        offscreen.width = textW + pad * 2;
        offscreen.height = textH + pad * 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.font = `${style}${renderFontSize}px "${o.fontFamily}", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = o.color || '#111111';
        ctx.fillText(txt, offscreen.width / 2, offscreen.height / 2);

        this.currentDecalImage = offscreen;

        if (this.decalTexture) {
            this.decalTexture.dispose();
        }
        this.decalTexture = new THREE.CanvasTexture(offscreen);
        this.decalTexture.colorSpace = THREE.SRGBColorSpace;
        this.decalTexture.minFilter = THREE.LinearMipmapLinearFilter;
        this.decalTexture.magFilter = THREE.LinearFilter;
        this.decalTexture.generateMipmaps = true;
        if (this.renderer && this.renderer.capabilities) {
            this.decalTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        }
        this.decalTexture.needsUpdate = true;
        this.previewMaterial.map = this.decalTexture;
        this.previewMaterial.needsUpdate = true;

        this.isActive = true;

        // Dimensiones proporcionales en 2D
        const aspect = offscreen.width / offscreen.height;
        const target2DHeight = Math.max(20, o.fontSize * 2.5);
        const target2DWidth = target2DHeight * aspect;

        if (!this.decal2D || !this.decal2D.x) {
            this.decal2D = {
                x: this.canvas.width / 2,
                y: this.canvas.height / 2,
                width: target2DWidth,
                height: target2DHeight,
                baseWidth: target2DWidth,
                baseHeight: target2DHeight,
                rotation: (o.rotation * Math.PI) / 180,
                isDragging: false,
                dragHandle: null,
                dragOffset: { x: 0, y: 0 },
                initialDecal: null
            };
        } else {
            this.decal2D.width = target2DWidth;
            this.decal2D.height = target2DHeight;
            this.decal2D.baseWidth = target2DWidth;
            this.decal2D.baseHeight = target2DHeight;
            this.decal2D.rotation = (o.rotation * Math.PI) / 180;
        }

        this.projectorRotation = (o.rotation * Math.PI) / 180;
        this.projectorScale = Math.max(10, Math.min(300, (o.fontSize / 48) * 100));

        // Posicionamiento 3D inicial si aún no se ha proyectado
        if (!this.lastHit && this.mesh) {
            const box = new THREE.Box3().setFromObject(this.mesh);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            this.projectorPosition.set(center.x, center.y, center.z + size.z * 0.5);
            this.projectorNormal.set(0, 0, 1);

            const rayOrigin = new THREE.Vector3(center.x, center.y + size.y * 0.3, center.z + size.z * 1.5);
            const rayDir = new THREE.Vector3(0, 0, -1);
            this.raycaster.set(rayOrigin, rayDir);
            const intersects = this.raycaster.intersectObject(this.mesh, true);
            const hit = intersects.find(i => i.object.isMesh && i.uv && i.face);
            if (hit) {
                this.lastHit = hit;
                this.projectorPosition.copy(hit.point);
                const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
                this.projectorNormal.copy(worldNormal);
                this.sync2DFrom3D(hit);
            }
        } else if (this.lastHit) {
            this.sync2DFrom3D(this.lastHit);
        }

        this.setMode(this.textOptions.mode || this.mode || '3d');
        this.updatePreviewTransform();
        this.render2DPreview();
    }

    cancelDecal() {
        this.isActive = false;
        this.isLocked = false;
        this.previewGroup.visible = false;
        this.clear2DUI();
        const controls = document.getElementById('decal-controls');
        const thumb = document.getElementById('decal-preview-thumb');
        if (controls) controls.style.display = 'none';
        if (thumb) thumb.style.display = 'none';

        if (this.isTextMode) {
            this.isTextMode = false;
            const textControls = document.getElementById('text-controls');
            if (textControls) textControls.style.display = 'none';
            document.querySelectorAll('.tool-btn[data-mode]').forEach(b => b.classList.remove('active'));
            const paintBtn = document.querySelector('.tool-btn[data-mode="paint"]');
            if (paintBtn) paintBtn.classList.add('active');
            const brushMode = document.getElementById('brush-mode');
            if (brushMode) brushMode.value = 'paint';
        }

        this.canvas.style.cursor = 'default';
    }

    raycastSurface(event) {
        if (!this.mesh) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.mesh, true);
        const hit = intersects.find(i => i.object.isMesh && i.uv && i.face);

        if (hit) {
            this.lastHit = hit;
            this.projectorPosition.copy(hit.point);
            const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
            this.projectorNormal.copy(worldNormal);
            this.updatePreviewTransform();
            this.sync2DFrom3D(hit);
        }
    }

    sync2DFrom3D(hit) {
        if (!hit || !hit.uv || !this.currentDecalImage) return;

        const w = this.canvas.width;
        const h = this.canvas.height;
        this.decal2D.x = hit.uv.x * w;
        this.decal2D.y = (1 - hit.uv.y) * h;

        let syncDone = false;

        if (hit.face && hit.object && hit.object.geometry) {
            const geom = hit.object.geometry;
            const pos = geom.attributes.position;
            const uvs = geom.attributes.uv;
            const a = hit.face.a, b = hit.face.b, c = hit.face.c;

            if (pos && uvs && a !== undefined && b !== undefined && c !== undefined) {
                const pA = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(hit.object.matrixWorld);
                const pB = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(hit.object.matrixWorld);
                const pC = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(hit.object.matrixWorld);

                const uvA = new THREE.Vector2(uvs.getX(a) * w, (1 - uvs.getY(a)) * h);
                const uvB = new THREE.Vector2(uvs.getX(b) * w, (1 - uvs.getY(b)) * h);
                const uvC = new THREE.Vector2(uvs.getX(c) * w, (1 - uvs.getY(c)) * h);

                const e1 = new THREE.Vector3().subVectors(pB, pA);
                const e2 = new THREE.Vector3().subVectors(pC, pA);

                const u1 = new THREE.Vector2().subVectors(uvB, uvA);
                const u2 = new THREE.Vector2().subVectors(uvC, uvA);

                const orientation = this.currentProjectorOrientation || new THREE.Euler();
                const projX = new THREE.Vector3(1, 0, 0).applyEuler(orientation);

                const e11 = e1.dot(e1);
                const e12 = e1.dot(e2);
                const e22 = e2.dot(e2);
                const det = e11 * e22 - e12 * e12;

                if (Math.abs(det) > 1e-8) {
                    const d1 = projX.dot(e1);
                    const d2 = projX.dot(e2);
                    const alpha = (d1 * e22 - d2 * e12) / det;
                    const beta = (e11 * d2 - e12 * d1) / det;

                    const v2D = new THREE.Vector2(
                        alpha * u1.x + beta * u2.x,
                        alpha * u1.y + beta * u2.y
                    );

                    const len2D = v2D.length();
                    if (len2D > 0.0001) {
                        this.decal2D.rotation = Math.atan2(v2D.y, v2D.x);

                        const size3DX = this.currentProjectorSize ? this.currentProjectorSize.x : (this.getModelBaseSize() * (this.projectorScale / 100));
                        const pxWidth = size3DX * len2D;
                        if (pxWidth > 15 && pxWidth < w * 0.9) {
                            const aspect = (this.decal2D.baseWidth && this.decal2D.baseHeight) ? (this.decal2D.baseWidth / this.decal2D.baseHeight) : 1;
                            this.decal2D.width = Math.round(pxWidth);
                            this.decal2D.height = Math.round(pxWidth / aspect);
                            syncDone = true;
                        }
                    }
                }
            }
        }

        if (!syncDone) {
            const scale = (this.projectorScale || 100) / 100;
            this.decal2D.width = this.decal2D.baseWidth * scale;
            this.decal2D.height = this.decal2D.baseHeight * scale;
            this.decal2D.rotation = this.projectorRotation || 0;
        }

        this.render2DPreview();
    }

    getModelBaseSize() {
        if (!this.mesh) return 1.0;
        const box = new THREE.Box3().setFromObject(this.mesh);
        const size = box.getSize(new THREE.Vector3());
        return Math.max(0.1, Math.max(size.x, size.y, size.z) * 0.25);
    }

    updatePreviewTransform() {
        if (!this.previewGroup || !this.isActive) return;

        // 1. Orientación alineada con la normal de la superficie
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(this.projectorNormal.dot(up)) > 0.95) {
            up.set(1, 0, 0);
        }

        const zAxis = this.projectorNormal.clone().normalize();
        const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
        const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

        const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const baseQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

        // Giro del usuario alrededor de la normal
        const angleQuat = new THREE.Quaternion().setFromAxisAngle(this.projectorNormal, this.projectorRotation);
        const finalQuat = angleQuat.multiply(baseQuat);

        // 2. Escala con relación de aspecto
        const baseSize = this.getModelBaseSize();
        const finalScale = baseSize * (this.projectorScale / 100);

        let aspect = 1;
        if (this.currentDecalImage && this.currentDecalImage.height > 0) {
            aspect = this.currentDecalImage.width / this.currentDecalImage.height;
        }

        let scaleX = finalScale;
        let scaleY = finalScale;
        if (aspect >= 1) {
            scaleY = finalScale / aspect;
        } else {
            scaleX = finalScale * aspect;
        }

        // Profundidad óptima: suficiente para abrazar la curvatura del fuselaje sin atravesar el objeto
        const depth = Math.min(scaleX, scaleY) * 0.8;
        const size = new THREE.Vector3(scaleX, scaleY, depth);
        const orientation = new THREE.Euler().setFromQuaternion(finalQuat);

        this.currentProjectorOrientation = orientation;
        this.currentProjectorSize = size;

        // 3. Generar DecalGeometry adaptada a la curvatura 3D
        let targetMesh = null;
        if (this.mesh) {
            this.mesh.traverse(c => {
                if (c.isMesh && !targetMesh) targetMesh = c;
            });
        }

        if (targetMesh) {
            try {
                let decalGeo = new DecalGeometry(targetMesh, this.projectorPosition, orientation, size);
                decalGeo = this.filterDecalGeometry(decalGeo, this.projectorNormal, this.allowPassthrough);
                if (decalGeo.attributes.position && decalGeo.attributes.position.count > 0) {
                    this.previewMesh.geometry.dispose();
                    this.previewMesh.geometry = decalGeo;
                    this.previewMesh.visible = true;

                    const edges = new THREE.EdgesGeometry(decalGeo);
                    this.previewBorder.geometry.dispose();
                    this.previewBorder.geometry = edges;
                    this.previewBorder.visible = true;

                    this.fallbackPlane.visible = false;
                    this.fallbackBorder.visible = false;

                    this.previewGroup.position.set(0, 0, 0);
                    this.previewGroup.quaternion.identity();
                    this.previewGroup.scale.set(1, 1, 1);
                    return;
                }
            } catch (err) {
                console.warn('Error en DecalGeometry:', err);
            }
        }

        // Respaldo plano si el cursor sale de la malla
        const offsetPoint = this.projectorPosition.clone().addScaledVector(this.projectorNormal, 0.003);
        this.previewGroup.position.copy(offsetPoint);
        this.previewGroup.quaternion.copy(finalQuat);
        this.previewGroup.scale.set(scaleX, scaleY, 1);
        this.previewMesh.visible = false;
        this.previewBorder.visible = false;
        this.fallbackPlane.visible = true;
        this.fallbackBorder.visible = true;
    }

    /**
     * Filtra los triángulos generados por DecalGeometry.
     * Si allowPassthrough es false, elimina los triángulos cuyas normales apuntan en sentido contrario
     * al proyector (dot < 0.08), evitando que la calca se proyecte en la cara inferior de alas delgadas o caras opuestas.
     */
    filterDecalGeometry(decalGeo, projectorNormal, allowPassthrough) {
        if (allowPassthrough) return decalGeo;

        const pos = decalGeo.attributes.position;
        const norm = decalGeo.attributes.normal;
        const uv = decalGeo.attributes.uv;
        if (!pos || pos.count === 0) return decalGeo;

        const filteredPos = [];
        const filteredNorm = [];
        const filteredUv = [];

        const v0 = new THREE.Vector3();
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();
        const faceNormal = new THREE.Vector3();

        for (let i = 0; i < pos.count; i += 3) {
            v0.set(pos.getX(i), pos.getY(i), pos.getZ(i));
            v1.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
            v2.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

            edge1.subVectors(v1, v0);
            edge2.subVectors(v2, v0);
            faceNormal.crossVectors(edge1, edge2).normalize();

            // Descartar caras opuestas al proyector
            if (faceNormal.dot(projectorNormal) >= 0.08) {
                for (let j = 0; j < 3; j++) {
                    const idx = i + j;
                    filteredPos.push(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
                    if (norm) filteredNorm.push(norm.getX(idx), norm.getY(idx), norm.getZ(idx));
                    if (uv) filteredUv.push(uv.getX(idx), uv.getY(idx));
                }
            }
        }

        if (filteredPos.length === 0) {
            return decalGeo;
        }

        const filteredGeo = new THREE.BufferGeometry();
        filteredGeo.setAttribute('position', new THREE.Float32BufferAttribute(filteredPos, 3));
        if (filteredNorm.length > 0) {
            filteredGeo.setAttribute('normal', new THREE.Float32BufferAttribute(filteredNorm, 3));
        }
        if (filteredUv.length > 0) {
            filteredGeo.setAttribute('uv', new THREE.Float32BufferAttribute(filteredUv, 2));
        }

        decalGeo.dispose();
        return filteredGeo;
    }

    // ==========================================
    // SISTEMA DE CALCOMANÍAS 2D (Fidelidad 1:1)
    // ==========================================

    getCanvas2DCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    clear2DUI() {
        if (this.ctxUI && this.canvasUI) {
            this.ctxUI.clearRect(0, 0, this.canvasUI.width, this.canvasUI.height);
        }
    }

    render2DPreview() {
        if (!this.isActive || !this.currentDecalImage || !this.ctxUI) return;
        this.clear2DUI();

        const d = this.decal2D;
        const ctx = this.ctxUI;
        const halfW = d.width / 2;
        const halfH = d.height / 2;

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rotation);

        // 1. Dibujar imagen de calcomanía nítida
        ctx.drawImage(this.currentDecalImage, -halfW, -halfH, d.width, d.height);

        if (this.mode === '3d') {
            // Modo 3D: Mostrar caja y cruceta de REGISTRO simultáneo en 2D
            ctx.strokeStyle = '#00f3ff';
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 2.5;
            ctx.strokeRect(-halfW, -halfH, d.width, d.height);
            ctx.setLineDash([]);

            // Cruceta de centro de impacto
            ctx.strokeStyle = '#00f3ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-14, 0); ctx.lineTo(14, 0);
            ctx.moveTo(0, -14); ctx.lineTo(0, 14);
            ctx.stroke();

            // Etiqueta indicadora
            ctx.fillStyle = '#00f3ff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('📍 Registro 3D (2D Listo)', 0, halfH + 18);
        } else {
            // Modo 2D: Controles interactivos con nodos de escala y rotación
            ctx.strokeStyle = '#00a2ff';
            ctx.setLineDash([6, 6]);
            ctx.lineWidth = 2;
            ctx.strokeRect(-halfW, -halfH, d.width, d.height);
            ctx.setLineDash([]);

            const maxDim = Math.max(d.width, d.height);
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

            // Bordes (ajuste de anchura o altura)
            drawHandle(0, -halfH, false, true);
            drawHandle(0,  halfH, false, true);
            drawHandle(-halfW, 0, false, true);
            drawHandle( halfW, 0, false, true);

            // Palo de rotación
            const stemLength = Math.max(30, handleRadius * 3);
            ctx.beginPath();
            ctx.moveTo(0, -halfH);
            ctx.lineTo(0, -halfH - stemLength);
            ctx.strokeStyle = '#00a2ff';
            ctx.lineWidth = 2;
            ctx.stroke();

            drawHandle(0, -halfH - stemLength, true);
        }

        ctx.restore();
    }

    hitTest2D(canvasX, canvasY) {
        if (!this.isActive || this.mode !== '2d') return null;

        const d = this.decal2D;
        const dx = canvasX - d.x;
        const dy = canvasY - d.y;
        const cos = Math.cos(-d.rotation);
        const sin = Math.sin(-d.rotation);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;

        const halfW = d.width / 2;
        const halfH = d.height / 2;
        const maxDim = Math.max(d.width, d.height);
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

        // 4. Interior de la calcomanía (mover)
        if (Math.abs(lx) <= halfW && Math.abs(ly) <= halfH) {
            return 'move';
        }

        return null;
    }

    onPointerDown2D(e) {
        if (!this.isActive || this.mode !== '2d' || e.button !== 0) return;
        const { x, y } = this.getCanvas2DCoords(e);
        const hit = this.hitTest2D(x, y);
        if (hit) {
            this.decal2D.isDragging = true;
            this.decal2D.dragHandle = hit;
            this.decal2D.dragOffset = { x: x - this.decal2D.x, y: y - this.decal2D.y };
            this.decal2D.initialDecal = { ...this.decal2D };
            this.decal2D.dragStart = { x, y };
            e.stopPropagation();
        }
    }

    onPointerMove2D(e) {
        if (!this.isActive || this.mode !== '2d') return;
        const { x, y } = this.getCanvas2DCoords(e);

        if (!this.decal2D.isDragging) {
            const hit = this.hitTest2D(x, y);
            if (hit === 'rotate') this.canvas.style.cursor = 'grab';
            else if (hit === 'move') this.canvas.style.cursor = 'move';
            else if (['nw', 'se'].includes(hit)) this.canvas.style.cursor = 'nwse-resize';
            else if (['ne', 'sw'].includes(hit)) this.canvas.style.cursor = 'nesw-resize';
            else if (['n', 's'].includes(hit)) this.canvas.style.cursor = 'ns-resize';
            else if (['e', 'w'].includes(hit)) this.canvas.style.cursor = 'ew-resize';
            else this.canvas.style.cursor = 'default';
            return;
        }

        const h = this.decal2D.dragHandle;
        const d = this.decal2D;
        const init = this.decal2D.initialDecal;

        if (h === 'move') {
            d.x = x - d.dragOffset.x;
            d.y = y - d.dragOffset.y;
        } else if (h === 'rotate') {
            const angle = Math.atan2(y - d.y, x - d.x) + Math.PI / 2;
            d.rotation = angle;
            const deg = Math.round((d.rotation * 180 / Math.PI) % 360);
            const normDeg = deg > 180 ? deg - 360 : (deg < -180 ? deg + 360 : deg);
            const rotInput = document.getElementById('decal-rotation');
            const rotLabel = document.getElementById('decal-rot-label');
            if (rotInput) rotInput.value = normDeg;
            if (rotLabel) rotLabel.textContent = `${normDeg}°`;

            if (this.isTextMode) {
                const textRot = document.getElementById('text-rotation');
                const textRotLabel = document.getElementById('text-rot-val');
                if (textRot) textRot.value = normDeg;
                if (textRotLabel) textRotLabel.textContent = `${normDeg}°`;
                if (this.textOptions) this.textOptions.rotation = normDeg;
            }
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

            d.width = Math.max(20, newHalfW * 2);
            d.height = Math.max(20, newHalfH * 2);

            const scalePct = Math.round((d.width / d.baseWidth) * 100);
            const scaleInput = document.getElementById('decal-scale');
            if (scaleInput) scaleInput.value = Math.min(300, Math.max(10, scalePct));

            if (this.isTextMode) {
                const textFontSize = document.getElementById('text-font-size');
                const textSizeVal = document.getElementById('text-size-val');
                const approxFont = Math.max(14, Math.min(250, Math.round(d.height / 2.5)));
                if (textFontSize) textFontSize.value = approxFont;
                if (textSizeVal) textSizeVal.textContent = `${approxFont} px`;
                if (this.textOptions) this.textOptions.fontSize = approxFont;
            }
        } else if (['n', 's'].includes(h)) {
            const dx = x - init.x;
            const dy = y - init.y;
            const cos = Math.cos(-init.rotation);
            const sin = Math.sin(-init.rotation);
            const ly = dx * sin + dy * cos;
            d.height = Math.max(20, Math.abs(ly) * 2);
        } else if (['e', 'w'].includes(h)) {
            const dx = x - init.x;
            const dy = y - init.y;
            const cos = Math.cos(-init.rotation);
            const sin = Math.sin(-init.rotation);
            const lx = dx * cos - dy * sin;
            d.width = Math.max(20, Math.abs(lx) * 2);
        }

        this.render2DPreview();
    }

    onPointerUp2D(e) {
        if (this.decal2D && this.decal2D.isDragging) {
            this.decal2D.isDragging = false;
            this.decal2D.dragHandle = null;
        }
    }

    bakeToActiveLayer() {
        if (this.mode === '2d') {
            this.bake2DToActiveLayer();
        } else {
            this.bake3DToActiveLayer();
        }
    }

    bake2DToActiveLayer() {
        if (!this.isActive || !this.currentDecalImage) {
            alert(this.isTextMode ? 'Introduce un texto para estampar.' : 'Carga primero una imagen de calcomanía.');
            return;
        }

        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        const targetCtx = activeLayer ? activeLayer.ctx : this.canvas.getContext('2d');

        // 1. Guardar historial Deshacer (Ctrl + Z)
        if (this.painter) {
            this.painter.saveUndoState();
        }

        // 2. Dibujar directamente en la capa activa con máxima fidelidad 1:1
        const d = this.decal2D;
        targetCtx.save();
        targetCtx.imageSmoothingEnabled = true;
        targetCtx.imageSmoothingQuality = 'high';
        targetCtx.translate(d.x, d.y);
        targetCtx.rotate(d.rotation);
        targetCtx.drawImage(this.currentDecalImage, -d.width / 2, -d.height / 2, d.width, d.height);
        targetCtx.restore();

        // 3. Recomponer capas y actualizar texturas 3D
        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
        }
        if (this.texture) {
            this.texture.needsUpdate = true;
        }

        // Feedback visual en botón
        const btn2D = this.isTextMode ? document.getElementById('btn-text-bake-2d') : document.getElementById('btn-bake-decal-2d');
        if (btn2D) {
            const oldText = btn2D.textContent;
            btn2D.textContent = '✅ ¡Estampado!';
            btn2D.style.backgroundColor = '#1e7e34';
            setTimeout(() => { 
                btn2D.textContent = oldText; 
                btn2D.style.backgroundColor = '#28a745';
            }, 1200);
        }

        // Dejar la calca visible para seguir editando o estampando más copias
        this.render2DPreview();
    }

    /**
     * Horneado ultrarrápido por GPU (RTX) en espacio de textura UV.
     * Despliega la geometría directamente en un WebGLRenderTarget y fusiona el resultado en la capa activa.
     */
    bake3DToActiveLayer() {
        if (!this.isActive || !this.currentDecalImage || !this.mesh) {
            alert(this.isTextMode ? 'Introduce un texto para estampar.' : 'Carga primero una imagen de calcomanía.');
            return;
        }

        const activeLayer = this.layerManager ? this.layerManager.getActiveLayer() : null;
        const targetCanvas = activeLayer ? activeLayer.canvas : this.canvas;
        const targetCtx = activeLayer ? activeLayer.ctx : this.canvas.getContext('2d');
        const width = targetCanvas.width;
        const height = targetCanvas.height;

        // 1. Guardar historial Deshacer (Ctrl + Z)
        if (this.painter) {
            this.painter.saveUndoState();
        }

        // 2. Matriz inversa del proyector en espacio mundo (idéntica a DecalGeometry)
        const orientation = this.currentProjectorOrientation || new THREE.Euler();
        const size = this.currentProjectorSize || new THREE.Vector3(1, 1, 1);

        const projectorWorldMatrix = new THREE.Matrix4();
        projectorWorldMatrix.makeRotationFromEuler(orientation);
        projectorWorldMatrix.setPosition(this.projectorPosition);
        projectorWorldMatrix.multiply(new THREE.Matrix4().makeScale(size.x, size.y, size.z));
        const inverseProjectorMatrix = projectorWorldMatrix.clone().invert();

        // 3. Mallas objetivo a proyectar
        const meshesToBake = [];
        this.mesh.traverse(c => {
            if (c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.uv) {
                meshesToBake.push(c);
            }
        });

        if (meshesToBake.length === 0) return;

        // 4. Shader de Despliegue UV por Hardware (RTX)
        const bakeMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uProjectorMatrix: { value: inverseProjectorMatrix },
                uProjectorNormal: { value: this.projectorNormal },
                uDecalTexture: { value: this.decalTexture },
                uModelMatrix: { value: new THREE.Matrix4() },
                uAllowPassthrough: { value: this.allowPassthrough ? 1.0 : 0.0 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;
                uniform mat4 uModelMatrix;

                void main() {
                    vec4 worldPos = uModelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPos.xyz;
                    vWorldNormal = normalize((uModelMatrix * vec4(normal, 0.0)).xyz);
                    // Mapeo directo de UV al espacio NDC de la GPU
                    // (Invertido en Y para que coincida 1:1 con el sistema de coordenadas de Canvas2D)
                    gl_Position = vec4(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform mat4 uProjectorMatrix;
                uniform vec3 uProjectorNormal;
                uniform sampler2D uDecalTexture;
                uniform float uAllowPassthrough;

                varying vec3 vWorldPosition;
                varying vec3 vWorldNormal;

                void main() {
                    // Si no está habilitado traspasar, descartar caras perpendiculares o que apuntan en sentido contrario
                    // (Evita manchar caras a 90° o el otro lado del fuselaje / alas finas, pero abraza suavemente curvas de hasta ~75°)
                    if (uAllowPassthrough < 0.5) {
                        if (dot(vWorldNormal, uProjectorNormal) < 0.20) discard;
                    }

                    vec4 p = uProjectorMatrix * vec4(vWorldPosition, 1.0);

                    // Verificar límites de la caja proyectora [-0.5, 0.5]
                    if (abs(p.x) > 0.5 || abs(p.y) > 0.5 || abs(p.z) > 0.5) discard;

                    // Muestrear textura de la calca
                    vec2 decalUV = vec2(p.x + 0.5, p.y + 0.5);
                    vec4 col = texture2D(uDecalTexture, decalUV);
                    if (col.a < 0.01) discard;

                    gl_FragColor = col;
                }
            `,
            side: THREE.DoubleSide,
            transparent: true
        });

        // 5. Renderizar en WebGLRenderTarget con antialiasing MSAA (4x)
        const renderTarget = new THREE.WebGLRenderTarget(width, height, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            samples: 4
        });

        const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const bakeScene = new THREE.Scene();

        meshesToBake.forEach(m => {
            const meshClone = new THREE.Mesh(m.geometry, bakeMaterial.clone());
            meshClone.material.uniforms.uModelMatrix.value.copy(m.matrixWorld);
            meshClone.material.uniforms.uProjectorMatrix.value = inverseProjectorMatrix;
            meshClone.material.uniforms.uProjectorNormal.value = this.projectorNormal;
            meshClone.material.uniforms.uDecalTexture.value = this.decalTexture;
            meshClone.material.uniforms.uAllowPassthrough.value = this.allowPassthrough ? 1.0 : 0.0;
            bakeScene.add(meshClone);
        });

        const prevTarget = this.renderer.getRenderTarget();
        const prevClearAlpha = this.renderer.getClearAlpha();
        const prevClearColor = this.renderer.getClearColor(new THREE.Color());

        this.renderer.setRenderTarget(renderTarget);
        this.renderer.setClearColor(0x000000, 0.0);
        this.renderer.clear(true, true, true);
        this.renderer.render(bakeScene, orthoCamera);
        this.renderer.setRenderTarget(prevTarget);
        this.renderer.setClearColor(prevClearColor, prevClearAlpha);

        // 6. Leer búfer horneado y fusionar en la capa activa con aceleración de hardware
        const pixelData = new Uint8Array(width * height * 4);
        this.renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixelData);

        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;
        const offCtx = offscreen.getContext('2d');
        const clamped = new Uint8ClampedArray(pixelData.buffer);
        const imgData = new ImageData(clamped, width, height);
        offCtx.putImageData(imgData, 0, 0);

        targetCtx.save();
        targetCtx.imageSmoothingEnabled = true;
        targetCtx.imageSmoothingQuality = 'high';
        targetCtx.globalCompositeOperation = 'source-over';
        targetCtx.drawImage(offscreen, 0, 0);
        targetCtx.restore();

        // 7. Limpiar recursos GPU
        renderTarget.dispose();
        bakeMaterial.dispose();

        // 8. Recomponer capas y actualizar vistas
        if (this.layerManager) {
            this.layerManager.recomposite();
        }
        if (this.painter) {
            this.painter.needsUpdate = true;
            this.painter.forceUpdate = true;
        }
        if (this.texture) {
            this.texture.needsUpdate = true;
        }

        // Feedback visual en botón
        const btn3D = this.isTextMode ? document.getElementById('btn-text-bake-3d') : document.getElementById('btn-bake-decal-3d');
        if (btn3D) {
            const oldText = btn3D.textContent;
            btn3D.textContent = '✅ ¡Estampado!';
            btn3D.style.backgroundColor = '#0a58ca';
            setTimeout(() => { 
                btn3D.textContent = oldText; 
                btn3D.style.backgroundColor = '#0d6efd';
            }, 1200);
        }

        // Dejar fijada la calca por si quiere moverla o estampar en otro lugar
        this.isLocked = true;
    }
}
