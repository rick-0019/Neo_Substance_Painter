/**
 * Neo Substance Painter - Papercraft & Unfold Engine (v2.0)
 * Arquitectura de Piezas Independientes + Auto-Acomodado en Hojas A4 + Arrastre Interactivo
 * Basado e integrado con los algoritmos paramétricos de Paper Alfa
 */

export class PapercraftEngine {
    constructor() {
        this.active = false;
        this.showFlaps = true;
        this.tabHeightMm = 5.0;
        this.tabAngleDeg = 45.0;
        this.showTabNumbers = false; // Desactivado por defecto para que las piezas se impriman 100% limpias
        this.numberPlacement = 'flaps'; // 'flaps' (solo en solapas ocultas bajo pegamento), 'outside' (fuera en descarte), 'none' (limpio)
        this.hideSmoothLines = true;
        this.creaseThresholdDeg = 25.0;
        this.lineMode = 'clean'; // 'clean' (pliegues vivos), 'outlines' (solo contornos), 'full' (malla), 'none' (ocultar)

        // Fase 2: Gestión de Costuras y Solapas Dinámicas (Flip Flap + Edge Matching)
        this.seams = [];
        this.seamByNumber = new Map();
        this.seamByEdgeKey = new Map();
        this.seamOverrides = new Map();
        this.junctions = new Map();
        this.junctionOverrides = new Map();
        this.hoveredSeamNumber = null;
        this.hoveredJunctionKey = null;

        // Fase 3: Rastreo Interactivo 3D <-> 2D (Hover Tracker)
        this.hoveredPart = null;
        this.hoveredSource = null; // '3d' o '2d'
        this.faceToPart = new Map();

        // Configuración de líneas de corte y pliegue profesionales (Hairline fino / tono tenue)
        this.cutLineWidthMm = 0.10; // Hairline 0.10 mm para corte limpio sin bordes negros gruesos
        this.cutLineColor = '#666666'; // Gris tenue profesional
        this.foldLineWidthMm = 0.08;
        this.foldLineColor = '#999999';

        // Acabado de Museo: Sangrado de Color Perimetral (Texture Bleed / Padding)
        this.bleedMm = 1.5; // 1.5 mm de dilatación hacia los márgenes y solapas para evitar bordes blancos al cortar
        
        // Dimensiones físicas del modelo armado (por defecto 1:1 nativo con el OBJ)
        this.modelLengthMm = null;
        this.baseModelLengthMm = null;
        this.scalePct = 100.0;
        this.wingspanMm = 0;
        this.heightMm = 0;
        this.ratioX = 1.0;
        this.ratioY = 1.0;
        this.currentScale = '1:1';
        this.objUnit = 'mm'; // 'mm' (milímetros directos), 'm' (metros x1000), 'cm' (centímetros x10)
        this.unitMultiplier = 1.0;

        // Herramienta de medición interactiva (Regla 2D)
        this.measureMode = false;
        this.activeMeasurement = null;

        // Dimensiones estándar A4 en mm
        this.A4_W = 210.0;
        this.A4_H = 297.0;
        this.A4_MARGIN = 5.0;

        // Estado del modelo y piezas
        this.mesh = null;
        this.texSize = 2048;
        this.uvSheetSizeMm = 210.0;
        this.pixelsPerMm = 10.0;
        this.parts = [];
        this.pagesCount = 1;

        // Interacción: selección y arrastre de piezas
        this.selectedPart = null;
        this.isDraggingPart = false;
        this.dragOffset = { x: 0, y: 0 };

        // Transformación de la vista del banco de trabajo A4
        this.zoom = 1.0;
        this.panX = 40;
        this.panY = 40;

        // Anotaciones técnicas y guías de ensamblaje en Hojas A4
        this.annotations = [];
        this.selectedAnnotation = null;
        this.activeAnnotationTool = 'select'; // 'select', 'text', 'arrow', 'badge', 'cut', 'glue'
        this.nextBadgeNumber = 1;
        this.drawingArrow = null;
        this.isDraggingAnnotation = false;
        this.annotationDragHandle = null;

        this.onRedraw = null;
    }

    setRedrawCallback(cb) {
        this.onRedraw = cb;
    }

    notifyChange() {
        if (this.onRedraw) this.onRedraw();
    }

    /**
     * Analiza la malla 3D, separa las islas UV en piezas independientes y genera las solapas
     */
    analyzeMesh(mesh, texSize = 2048) {
        this.mesh = mesh;
        this.texSize = texSize;
        if (!mesh) {
            this.parts = [];
            return;
        }

        const positions = [];
        const uvs = [];
        const faces = [];
        let globalFaceOffset = 0;

        mesh.traverse(child => {
            if (child.isMesh && !child.userData?.isSelectionOverlay && !child.userData?.isWireframeOverlay && child.geometry && child.geometry.attributes.position && child.geometry.attributes.uv) {
                const geo = child.geometry;
                const posAttr = geo.attributes.position;
                const uvAttr = geo.attributes.uv;
                const index = geo.index;
                const baseV = positions.length;

                // Correlación exacta con el raycaster 3D de Three.js (soporte multi-malla / multi-material)
                child.userData._papercraftBaseFaceIdx = globalFaceOffset;

                for (let i = 0; i < posAttr.count; i++) {
                    positions.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
                    uvs.push([uvAttr.getX(i), uvAttr.getY(i)]);
                }

                const numFaces = index ? index.count / 3 : posAttr.count / 3;
                if (index) {
                    for (let i = 0; i < index.count; i += 3) {
                        faces.push([baseV + index.getX(i), baseV + index.getX(i + 1), baseV + index.getX(i + 2)]);
                    }
                } else {
                    for (let i = 0; i < posAttr.count; i += 3) {
                        faces.push([baseV + i, baseV + i + 1, baseV + i + 2]);
                    }
                }
                globalFaceOffset += numFaces;
            }
        });

        if (faces.length === 0) {
            this.parts = [];
            return;
        }

        // 1. Escala física del modelo
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const p of positions) {
            minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
            minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
            minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
        }
        const sizeX = Math.max(0.001, maxX - minX);
        const sizeY = Math.max(0.001, maxY - minY);
        const sizeZ = Math.max(0.001, maxZ - minZ);
        const ref3dLen = sizeZ > 0.01 ? sizeZ : Math.max(sizeX, sizeY);

        this.raw3dSize = { sizeX, sizeY, sizeZ, ref3dLen };
        this.ratioX = sizeX / ref3dLen;
        this.ratioY = sizeY / ref3dLen;
        this.ratioZ = sizeZ / ref3dLen;

        const unitMult = this.objUnit === 'm' ? 1000.0 : (this.objUnit === 'cm' ? 10.0 : 1.0);
        this.unitMultiplier = unitMult;

        if (!this.baseModelLengthMm) {
            // Escala nativa desde el archivo OBJ según la unidad seleccionada (m x1000, cm x10, mm x1)
            this.baseModelLengthMm = Math.max(0.1, Math.round(ref3dLen * unitMult * 10) / 10);
            this.scalePct = 100.0;
            this.modelLengthMm = this.baseModelLengthMm;
            this.currentScale = '1:1';
        }

        this.wingspanMm = Math.round(this.modelLengthMm * this.ratioX * 10) / 10;
        this.heightMm = Math.round(this.modelLengthMm * this.ratioY * 10) / 10;
        const mmPer3D = this.modelLengthMm / ref3dLen;

        let tot3D = 0, totUV = 0;
        faces.forEach(f => {
            for (let i = 0; i < 3; i++) {
                const next = (i + 1) % 3;
                const pA = positions[f[i]];
                const pB = positions[f[next]];
                const uA = uvs[f[i]];
                const uB = uvs[f[next]];
                const d3 = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]);
                const dU = Math.hypot(uB[0] - uA[0], uB[1] - uA[1]);
                if (d3 > 1e-4 && dU > 1e-4) {
                    tot3D += d3;
                    totUV += dU;
                }
            }
        });
        this.uvSheetSizeMm = Math.max(10, (tot3D / Math.max(1e-4, totUV)) * mmPer3D);
        this.pixelsPerMm = texSize / this.uvSheetSizeMm;
        this.texSize = texSize;

        // 2. Normales 3D de cada cara
        function cross(a, b) { return [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]]; }
        function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0]/l, v[1]/l, v[2]/l] : [0,0,1]; }
        function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }

        const faceNormals = faces.map(f => {
            const p0 = positions[f[0]];
            const p1 = positions[f[1]];
            const p2 = positions[f[2]];
            return norm(cross([p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]], [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]]));
        });

        function hash3D(p) { return `${Math.round(p[0]*1000)},${Math.round(p[1]*1000)},${Math.round(p[2]*1000)}`; }
        function hashUV(uv) { return `${Math.round(uv[0]*10000)},${Math.round(uv[1]*10000)}`; }

        // 3. Extracción de Islas UV Conectadas (Piezas reales basadas en aristas UV compartidas)
        const edgeToFaces = new Map();
        faces.forEach((f, fIdx) => {
            for (let i = 0; i < 3; i++) {
                const next = (i + 1) % 3;
                const k1 = hashUV(uvs[f[i]]);
                const k2 = hashUV(uvs[f[next]]);
                const edgeKey = [k1, k2].sort().join('--');
                if (!edgeToFaces.has(edgeKey)) edgeToFaces.set(edgeKey, []);
                edgeToFaces.get(edgeKey).push(fIdx);
            }
        });

        const adj = faces.map(() => []);
        for (const fList of edgeToFaces.values()) {
            if (fList.length === 2) {
                adj[fList[0]].push(fList[1]);
                adj[fList[1]].push(fList[0]);
            }
        }

        const visited = new Set();
        const rawIslands = [];
        for (let i = 0; i < faces.length; i++) {
            if (!visited.has(i)) {
                const comp = [];
                const q = [i];
                visited.add(i);
                while (q.length > 0) {
                    const cur = q.pop();
                    comp.push(cur);
                    for (let n of adj[cur]) {
                        if (!visited.has(n)) {
                            visited.add(n);
                            q.push(n);
                        }
                    }
                }
                rawIslands.push(comp);
            }
        }

        // 4. Emparejamiento de costuras 3D y registro de costuras maestras
        const uvHalfEdges = new Map();
        const allHalfEdges = [];

        faces.forEach((face, fIdx) => {
            for (let i = 0; i < 3; i++) {
                const next = (i + 1) % 3;
                const opp = (i + 2) % 3;
                const vA = face[i];
                const vB = face[next];
                const vOpp = face[opp];
                const posA = positions[vA];
                const posB = positions[vB];
                const uvA = uvs[vA];
                const uvB = uvs[vB];
                const uvOpp = uvs[vOpp];

                const edge = {
                    faceIdx: fIdx,
                    posA, posB, uvA, uvB, uvOpp,
                    uvEdgeKey: `${hashUV(uvA)}->${hashUV(uvB)}`,
                    uvTwinKey: `${hashUV(uvB)}->${hashUV(uvA)}`,
                    pos3dKey: [hash3D(posA), hash3D(posB)].sort().join('<->')
                };
                allHalfEdges.push(edge);
                uvHalfEdges.set(edge.uvEdgeKey, edge);
            }
        });

        const faceToIsland = new Int32Array(faces.length);
        rawIslands.forEach((comp, islandIdx) => {
            comp.forEach(fIdx => { faceToIsland[fIdx] = islandIdx; });
        });

        const boundaryEdges = allHalfEdges.filter(e => !uvHalfEdges.has(e.uvTwinKey));
        boundaryEdges.forEach(b => {
            b.islandIdx = faceToIsland[b.faceIdx];
        });

        const seamGroups = new Map();
        for (const b of boundaryEdges) {
            if (!seamGroups.has(b.pos3dKey)) seamGroups.set(b.pos3dKey, []);
            seamGroups.get(b.pos3dKey).push(b);
        }

        this.seams = [];
        this.seamByNumber = new Map();
        this.seamByEdgeKey = new Map();
        this.junctions = new Map(); // junctionKey -> { key, islandA, islandB, activeSide, seams: [] }
        if (!this.junctionOverrides) {
            this.junctionOverrides = new Map();
        }
        if (!this.seamOverrides) {
            this.seamOverrides = new Map();
        }

        let seamCounter = 1;
        for (const [key, pair] of seamGroups.entries()) {
            if (pair.length === 2) {
                // Ordenar consistentemente pair[0] y pair[1] según islandIdx para que TODAS las aristas
                // de la unión entre la Pieza A y la Pieza B queden en la misma pieza (sin alternar)
                const is0 = pair[0].islandIdx;
                const is1 = pair[1].islandIdx;
                if (is0 > is1 || (is0 === is1 && pair[0].faceIdx > pair[1].faceIdx)) {
                    const tmp = pair[0];
                    pair[0] = pair[1];
                    pair[1] = tmp;
                }

                const minIs = pair[0].islandIdx;
                const maxIs = pair[1].islandIdx;
                const junctionKey = (minIs !== maxIs)
                    ? `j_${minIs}_${maxIs}`
                    : `j_self_${minIs}_${key}`;

                if (!this.junctions.has(junctionKey)) {
                    const jOverride = this.junctionOverrides.get(junctionKey);
                    this.junctions.set(junctionKey, {
                        key: junctionKey,
                        islandA: minIs,
                        islandB: maxIs,
                        activeSide: jOverride !== undefined ? jOverride : 'A',
                        seams: []
                    });
                }
                const junction = this.junctions.get(junctionKey);

                const sOverride = this.seamOverrides.get(key);
                const activeSide = sOverride !== undefined ? sOverride : junction.activeSide;

                const seam = {
                    seamNumber: seamCounter,
                    pos3dKey: key,
                    junctionKey: junctionKey,
                    edgeA: pair[0],
                    edgeB: pair[1],
                    activeSide: activeSide,
                    defaultSide: 'A'
                };
                junction.seams.push(seam);

                this.seams.push(seam);
                this.seamByNumber.set(seamCounter, seam);
                this.seamByEdgeKey.set(pair[0].uvEdgeKey, { seam, side: 'A' });
                this.seamByEdgeKey.set(pair[1].uvEdgeKey, { seam, side: 'B' });
                seamCounter++;
            }
        }

        // 5. Construir objetos completos para cada pieza independiente (Part)
        this.parts = rawIslands.map((faceIndices, islandIdx) => {
            let minU = Infinity, maxU = -Infinity;
            let minV = Infinity, maxV = -Infinity;
            let islandTot3D = 0, islandTotUV = 0;

            faceIndices.forEach(fIdx => {
                for (let i = 0; i < 3; i++) {
                    const next = (i + 1) % 3;
                    const vA = faces[fIdx][i];
                    const vB = faces[fIdx][next];
                    const pA = positions[vA];
                    const pB = positions[vB];
                    const uA = uvs[vA];
                    const uB = uvs[vB];
                    const d3 = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]);
                    const du = Math.hypot(uB[0] - uA[0], uB[1] - uA[1]);
                    if (d3 > 1e-5 && du > 1e-5) {
                        islandTot3D += d3;
                        islandTotUV += du;
                    }
                    minU = Math.min(minU, uA[0]); maxU = Math.max(maxU, uA[0]);
                    minV = Math.min(minV, uA[1]); maxV = Math.max(maxV, uA[1]);
                }
            });

            const centerU = (minU + maxU) / 2;
            const centerV = (minV + maxV) / 2;

            // Escala física real calculada individualmente por pieza desde sus caras 3D
            const islandMmPerUV = (islandTotUV > 1e-5 && islandTot3D > 1e-5)
                ? (islandTot3D / islandTotUV) * mmPer3D
                : this.uvSheetSizeMm;

            const toLocalMm = (uv) => ({
                x: (uv[0] - centerU) * islandMmPerUV,
                y: (centerV - uv[1]) * islandMmPerUV
            });

            const localTriangles = faceIndices.map(fIdx => {
                return faces[fIdx].map(v => toLocalMm(uvs[v]));
            });

            const islandBoundaryEdges = [];
            const islandInternalEdges = [];

            faceIndices.forEach(fIdx => {
                for (let i = 0; i < 3; i++) {
                    const next = (i + 1) % 3;
                    const opp = (i + 2) % 3;
                    const uvA = uvs[faces[fIdx][i]];
                    const uvB = uvs[faces[fIdx][next]];
                    const uvOpp = uvs[faces[fIdx][opp]];
                    const edgeKey = `${hashUV(uvA)}->${hashUV(uvB)}`;
                    const twinKey = `${hashUV(uvB)}->${hashUV(uvA)}`;

                    const p1 = toLocalMm(uvA);
                    const p2 = toLocalMm(uvB);
                    const pOpp = toLocalMm(uvOpp);

                    if (!uvHalfEdges.has(twinKey)) {
                        const seamInfo = this.seamByEdgeKey.get(edgeKey);
                        const seamNum = seamInfo ? seamInfo.seam.seamNumber : null;
                        const side = seamInfo ? seamInfo.side : null;

                        const dx = p2.x - p1.x;
                        const dy = p2.y - p1.y;
                        const len = Math.hypot(dx, dy);
                        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                        let nx = len > 0.0001 ? -dy / len : 0;
                        let ny = len > 0.0001 ? dx / len : 0;
                        if (nx * (pOpp.x - mid.x) + ny * (pOpp.y - mid.y) > 0) {
                            nx = -nx; ny = -ny;
                        }

                        // Verificación geométrica definitiva: Si mid + n * 0.15mm cae dentro de los triángulos de la pieza,
                        // la normal estaba apuntando hacia el interior. Invertir para que apunte estrictamente hacia afuera.
                        const testX = mid.x + nx * 0.15;
                        const testY = mid.y + ny * 0.15;
                        let isInside = false;
                        for (let t = 0; t < localTriangles.length; t++) {
                            const tri = localTriangles[t];
                            if (tri && tri.length >= 3 && this._isPointInTriangle(testX, testY, tri[0], tri[1], tri[2])) {
                                isInside = true;
                                break;
                            }
                        }
                        if (isInside) {
                            nx = -nx;
                            ny = -ny;
                        }

                        islandBoundaryEdges.push({
                            p1, p2, len, mid, nx, ny, edgeKey,
                            seamNumber: seamNum,
                            junctionKey: seamInfo ? seamInfo.seam.junctionKey : null,
                            side,
                            hasTab: false,
                            isTarget: false
                        });
                    } else {
                        const twin = uvHalfEdges.get(twinKey);
                        if (fIdx < twin.faceIdx) {
                            const d = Math.max(-1, Math.min(1, dot(faceNormals[fIdx], faceNormals[twin.faceIdx])));
                            const angleDeg = Math.acos(d) * (180 / Math.PI);
                            if (angleDeg >= this.creaseThresholdDeg) {
                                islandInternalEdges.push({ p1, p2, angleDeg });
                            }
                        }
                    }
                }
            });

            // Bounding box inicial en mm
            let bMinX = Infinity, bMaxX = -Infinity;
            let bMinY = Infinity, bMaxY = -Infinity;
            localTriangles.forEach(tri => {
                tri.forEach(p => {
                    bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
                    bMinY = Math.min(bMinY, p.y); bMaxY = Math.max(bMaxY, p.y);
                });
            });

            const wMm = Math.max(1, bMaxX - bMinX);
            const hMm = Math.max(1, bMaxY - bMinY);

            return {
                id: islandIdx,
                faceIndices,
                centerU,
                centerV,
                islandMmPerUV,
                localTriangles,
                boundaryEdges: islandBoundaryEdges,
                internalEdges: islandInternalEdges,
                tabs: [],
                bounds: { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY },
                wMm,
                hMm,
                layout: { pageIndex: 0, x: 105, y: 148, rotation: 0 }
            };
        });

        // 5.5 Construir geometría 3D directa, mapa O(1) de cara a pieza y límites UV para Rastreo 3D <-> 2D
        this.faceToPart = new Map();
        for (const part of this.parts) {
            const partIndices = [];
            const part3DCoords = [];
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

            for (let f = 0; f < part.faceIndices.length; f++) {
                const fIdx = part.faceIndices[f];
                this.faceToPart.set(fIdx, part);
                const tri = faces[fIdx];
                if (tri) {
                    partIndices.push(tri[0], tri[1], tri[2]);
                    const p0 = positions[tri[0]];
                    const p1 = positions[tri[1]];
                    const p2 = positions[tri[2]];
                    if (p0 && p1 && p2) {
                        part3DCoords.push(
                            p0[0], p0[1], p0[2],
                            p1[0], p1[1], p1[2],
                            p2[0], p2[1], p2[2]
                        );
                    }
                    for (let vi = 0; vi < 3; vi++) {
                        const uv = uvs[tri[vi]];
                        if (uv) {
                            minU = Math.min(minU, uv[0]); maxU = Math.max(maxU, uv[0]);
                            minV = Math.min(minV, uv[1]); maxV = Math.max(maxV, uv[1]);
                        }
                    }
                }
            }
            part.trackerIndices = (positions.length > 65535) ? new Uint32Array(partIndices) : new Uint16Array(partIndices);
            part.tracker3DPositions = new Float32Array(part3DCoords);
            part.uvBounds = { minU, maxU, minV, maxV };
        }

        // 6. Construir solapas considerando las costuras y overrides
        this.rebuildAllTabs();

        // 7. Auto-acomodar automáticamente en hojas A4 respetando márgenes
        this.autoPackA4();
        this.notifyChange();
    }

    /**
     * Algoritmo de empaquetado automático de piezas en hojas A4 (Bin-Packing sin solapamientos)
     */
    autoPackA4(gapMm = 8) {
        if (!this.parts || this.parts.length === 0) return;

        const margin = this.A4_MARGIN; // 5 mm
        const printableW = this.A4_W - margin * 2; // 200 mm
        const printableH = this.A4_H - margin * 2; // 287 mm

        // Ordenar piezas de mayor a menor para empaquetado eficiente
        const sorted = [...this.parts].sort((a, b) => Math.max(b.wMm, b.hMm) - Math.max(a.wMm, a.hMm));

        let currentPage = 0;
        let curX = margin + 4;
        let curY = margin + 18; // Dejar espacio para cartela superior
        let rowMaxH = 0;

        for (const part of sorted) {
            let w = part.wMm;
            let h = part.hMm;
            let rot = 0;

            // Si la pieza es más ancha que alta y conviene girarla 90°
            if (w > h && w > printableW * 0.6 && h < printableW) {
                [w, h] = [h, w];
                rot = 90;
            }

            // Si se pasa del ancho de la hoja, pasar a la siguiente fila
            if (curX + w > this.A4_W - margin) {
                curX = margin + 4;
                curY += rowMaxH + gapMm;
                rowMaxH = 0;
            }

            // Si se pasa del alto de la hoja, pasar a la siguiente página A4
            if (curY + h > this.A4_H - margin) {
                currentPage++;
                curX = margin + 4;
                curY = margin + 18;
                rowMaxH = 0;
            }

            part.layout.pageIndex = currentPage;
            part.layout.x = Math.round((curX + w / 2) * 10) / 10;
            part.layout.y = Math.round((curY + h / 2) * 10) / 10;
            part.layout.rotation = rot;

            curX += w + gapMm;
            if (h > rowMaxH) rowMaxH = h;
        }

        this.pagesCount = currentPage + 1;
        this.notifyChange();
    }

    /**
     * Añade una nueva página A4 vacía
     */
    addPage() {
        this.pagesCount++;
        this.notifyChange();
    }

    /**
     * Limpia y compacta las hojas A4 vacías o sobrantes que no contengan piezas
     * @returns {number} Cantidad de hojas eliminadas
     */
    cleanEmptyPages() {
        if (!this.parts || this.parts.length === 0) {
            const removed = Math.max(0, this.pagesCount - 1);
            this.pagesCount = 1;
            this.notifyChange();
            return removed;
        }

        const oldPagesCount = this.pagesCount;
        // Identificar qué páginas contienen piezas
        const usedPages = new Set();
        this.parts.forEach(p => {
            if (p.layout && typeof p.layout.pageIndex === 'number') {
                usedPages.add(p.layout.pageIndex);
            }
        });

        const sortedUsedPages = Array.from(usedPages).sort((a, b) => a - b);
        
        // Mapear páginas viejas a índices continuos 0, 1, 2...
        const pageRemap = new Map();
        sortedUsedPages.forEach((oldIdx, newIdx) => {
            pageRemap.set(oldIdx, newIdx);
        });

        this.parts.forEach(p => {
            if (p.layout) {
                p.layout.pageIndex = pageRemap.get(p.layout.pageIndex) ?? 0;
            }
        });

        this.pagesCount = Math.max(1, sortedUsedPages.length);
        const removed = Math.max(0, oldPagesCount - this.pagesCount);
        this.notifyChange();
        return removed;
    }

    /**
     * Rota la pieza actualmente seleccionada por deltaDeg grados (ej. 1°, 45° o -1°)
     */
    rotateSelectedPart(deltaDeg = 1) {
        if (!this.selectedPart) return;
        const curRot = this.selectedPart.layout.rotation || 0;
        this.selectedPart.layout.rotation = Math.round(((curRot + deltaDeg) % 360 + 360) % 360 * 10) / 10;
        this.invalidateBleedCache();
        this.notifyChange();
    }

    /**
     * Aplica espejo horizontal (X) o vertical (Y) a la pieza seleccionada
     */
    flipSelectedPart(axis = 'x') {
        if (!this.selectedPart) return;
        if (axis === 'x') {
            this.selectedPart.layout.flipX = !this.selectedPart.layout.flipX;
        } else if (axis === 'y') {
            this.selectedPart.layout.flipY = !this.selectedPart.layout.flipY;
        }
        this.invalidateBleedCache();
        this.notifyChange();
    }

    /**
     * Duplica la pieza seleccionada creando una copia exacta con su propio ID en la mesa A4
     */
    duplicateSelectedPart() {
        if (!this.selectedPart) return null;
        const src = this.selectedPart;
        const newId = this.parts.reduce((max, p) => Math.max(max, p.id), -1) + 1;

        const clonedTriangles = (src.localTriangles || []).map(tri => tri.map(pt => ({ ...pt })));
        const clonedBoundaryEdges = (src.boundaryEdges || []).map(e => ({
            ...e,
            p1: { ...e.p1 },
            p2: { ...e.p2 },
            mid: e.mid ? { ...e.mid } : undefined
        }));
        const clonedInternalEdges = (src.internalEdges || []).map(e => ({
            ...e,
            p1: { ...e.p1 },
            p2: { ...e.p2 }
        }));
        const clonedTabs = (src.tabs || []).map(t => ({
            ...t,
            baseP1: { ...t.baseP1 },
            baseP2: { ...t.baseP2 },
            tabP1: { ...t.tabP1 },
            tabP2: { ...t.tabP2 },
            tabCenter: { ...t.tabCenter }
        }));

        const newPart = {
            id: newId,
            sourcePartId: src.id,
            faceIndices: [...(src.faceIndices || [])],
            centerU: src.centerU,
            centerV: src.centerV,
            islandMmPerUV: src.islandMmPerUV,
            localTriangles: clonedTriangles,
            boundaryEdges: clonedBoundaryEdges,
            internalEdges: clonedInternalEdges,
            tabs: clonedTabs,
            bounds: { ...src.bounds },
            wMm: src.wMm,
            hMm: src.hMm,
            isDuplicate: true,
            layout: {
                pageIndex: src.layout.pageIndex,
                x: Math.min(this.A4_W - src.wMm / 2, src.layout.x + 8),
                y: Math.min(this.A4_H - src.hMm / 2, src.layout.y + 8),
                rotation: src.layout.rotation || 0,
                flipX: !!src.layout.flipX,
                flipY: !!src.layout.flipY
            }
        };

        this.parts.push(newPart);
        this.selectedPart = newPart;
        this.invalidateBleedCache();
        this.notifyChange();
        return newPart;
    }

    /**
     * Elimina la pieza seleccionada de la mesa de trabajo (útil para descartar duplicados)
     */
    deleteSelectedPart() {
        if (!this.selectedPart) return false;
        const idx = this.parts.indexOf(this.selectedPart);
        if (idx !== -1) {
            this.parts.splice(idx, 1);
            this.selectedPart = null;
            this.invalidateBleedCache();
            this.notifyChange();
            return true;
        }
        return false;
    }

    /**
     * Reconstruye instantáneamente (<1ms) las solapas de todas las piezas respetando
     * las costuras y los estados asignados (A, B o none) sin recalcular la malla 3D.
     */
    rebuildAllTabs() {
        if (!this.parts || this.parts.length === 0) return;

        const defaultAlphaRad = ((90 - (this.tabAngleDeg || 45)) * Math.PI) / 180;
        const tabHeightMm = this.tabHeightMm;

        for (const part of this.parts) {
            // 1. Actualizar banderas en cada boundaryEdge según activeSide de su junction o costura
            for (const bEdge of part.boundaryEdges) {
                if (bEdge.seamNumber) {
                    const seam = this.seamByNumber.get(bEdge.seamNumber);
                    if (seam) {
                        const jKey = seam.junctionKey;
                        const junction = jKey ? this.junctions.get(jKey) : null;
                        const jActive = junction ? junction.activeSide : null;
                        const sOverride = this.seamOverrides.get(seam.pos3dKey);
                        const effectiveSide = sOverride !== undefined ? sOverride : (jActive !== null ? jActive : seam.activeSide);
                        seam.activeSide = effectiveSide;

                        bEdge.hasTab = (effectiveSide === bEdge.side);
                        bEdge.isTarget = (effectiveSide !== 'none' && effectiveSide !== bEdge.side);
                    }
                }
            }

            // 2. Construir solapas profesionales:
            // A lo largo de curvas suaves continuas, las solapas mantienen la altura completa deseada (tabHeightMm),
            // con ranuras radiales (slits) para flexión entre facetas adyacentes, y bisel a 45° solo en los extremos.
            const islandTabs = [];
            const targetH = Math.max(3.0, tabHeightMm);

            part.boundaryEdges.forEach((bEdge) => {
                if (!bEdge.hasTab) return;
                const len = bEdge.len;
                if (len <= 0.3) return;

                const p1 = bEdge.p1;
                const p2 = bEdge.p2;
                const mid = bEdge.mid || { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
                const ux = (p2.x - p1.x) / len;
                const uy = (p2.y - p1.y) / len;
                const nx = bEdge.nx;
                const ny = bEdge.ny;

                // Buscar aristas adyacentes en el perímetro de la misma pieza
                const prevEdge = part.boundaryEdges.find(e => e !== bEdge && Math.hypot(e.p2.x - p1.x, e.p2.y - p1.y) < 0.1);
                const nextEdge = part.boundaryEdges.find(e => e !== bEdge && Math.hypot(e.p1.x - p2.x, e.p1.y - p2.y) < 0.1);

                const prevHasTab = !!(prevEdge && prevEdge.hasTab);
                const nextHasTab = !!(nextEdge && nextEdge.hasTab);

                let tabH = targetH;

                // --- Cálculo de Biseles e Insets Anticolisión (Prevención de Solapamiento entre Solapas) ---
                let inset1 = 0;
                let isConcave1 = false;
                let tanMiter1 = 1.0;
                let slitHalfAngle1 = 0.05;

                if (prevHasTab && prevEdge) {
                    const dotN1 = Math.max(-1, Math.min(1, prevEdge.nx * nx + prevEdge.ny * ny));
                    // Esquina cóncava (hacia adentro en el exterior: las normales convergen hacia el espacio de la otra solapa)
                    isConcave1 = (prevEdge.nx * ux + prevEdge.ny * uy) > 0.001;

                    if (isConcave1) {
                        // Esquina interior cóncava: biselado estricto a lo largo de la bisectriz del ángulo
                        // para que las dos solapas adyacentes jamás choquen ni se tapen entre sí
                        const phi1 = Math.acos(dotN1); // Ángulo entre normales (p.ej. 90° = 1.57 rad)
                        const miterAngle1 = phi1 / 2;
                        const alphaCut1 = Math.min(1.45, miterAngle1 + 0.035); // Bisectriz + 2° de holgura
                        tanMiter1 = Math.tan(alphaCut1);

                        // Si la solapa es muy alta para el ancho de la arista, reducir la altura de la solapa
                        // para que el corte a 45°/bisectriz no sobrepase la mitad de la arista
                        const maxH1 = (len * 0.45) / Math.max(0.1, tanMiter1);
                        if (targetH > maxH1) {
                            tabH = Math.min(tabH, maxH1);
                        }
                        inset1 = tabH * tanMiter1;
                    } else {
                        // Curva convexa o faceteado exterior: ranura radial fina de alivio (slits)
                        const turnAngle1 = Math.acos(dotN1);
                        slitHalfAngle1 = Math.max(0.04, Math.min(0.20, turnAngle1 / 2 + 0.02));
                        inset1 = targetH * Math.tan(slitHalfAngle1);
                    }
                } else {
                    // Extremo libre de la cadena de solapas: bisel clásico a 45°
                    inset1 = targetH / Math.tan(defaultAlphaRad);
                }

                // --- Vértice Final (p2) ---
                let inset2 = 0;
                let isConcave2 = false;
                let tanMiter2 = 1.0;
                let slitHalfAngle2 = 0.05;

                if (nextHasTab && nextEdge) {
                    const nextUx = (nextEdge.p2.x - nextEdge.p1.x) / (nextEdge.len || 1);
                    const nextUy = (nextEdge.p2.y - nextEdge.p1.y) / (nextEdge.len || 1);
                    const dotN2 = Math.max(-1, Math.min(1, nx * nextEdge.nx + ny * nextEdge.ny));
                    isConcave2 = (nx * nextUx + ny * nextUy) > 0.001;

                    if (isConcave2) {
                        const phi2 = Math.acos(dotN2);
                        const miterAngle2 = phi2 / 2;
                        const alphaCut2 = Math.min(1.45, miterAngle2 + 0.035);
                        tanMiter2 = Math.tan(alphaCut2);

                        const maxH2 = (len * 0.45) / Math.max(0.1, tanMiter2);
                        if (targetH > maxH2) {
                            tabH = Math.min(tabH, maxH2);
                        }
                        inset2 = tabH * tanMiter2;
                    } else {
                        const turnAngle2 = Math.acos(dotN2);
                        slitHalfAngle2 = Math.max(0.04, Math.min(0.20, turnAngle2 / 2 + 0.02));
                        inset2 = targetH * Math.tan(slitHalfAngle2);
                    }
                } else {
                    // Extremo libre de la cadena de solapas: bisel clásico a 45°
                    inset2 = targetH / Math.tan(defaultAlphaRad);
                }

                // Sincronizar ambos insets a la altura tabH actual
                if (prevHasTab && prevEdge) {
                    inset1 = isConcave1 ? tabH * tanMiter1 : tabH * Math.tan(slitHalfAngle1);
                } else {
                    inset1 = tabH / Math.tan(defaultAlphaRad);
                }
                if (nextHasTab && nextEdge) {
                    inset2 = isConcave2 ? tabH * tanMiter2 : tabH * Math.tan(slitHalfAngle2);
                } else {
                    inset2 = tabH / Math.tan(defaultAlphaRad);
                }

                // En los extremos libres o biseles, acotar para no sobrepasar el 45% del segmento
                const maxAllowedInset = len * 0.45;
                if (inset1 > maxAllowedInset) inset1 = maxAllowedInset;
                if (inset2 > maxAllowedInset) inset2 = maxAllowedInset;

                // 1. Detección de colisión contra otras aristas de la pieza (concavidades, hendiduras y vanos internos)
                // Se proyecta un rayo desde el punto medio a lo largo de la normal para comprobar si choca contra otra arista de la pieza
                let minObstacleDist = Infinity;
                let obstacleHasTab = false;
                for (let oe = 0; oe < part.boundaryEdges.length; oe++) {
                    const other = part.boundaryEdges[oe];
                    if (other === bEdge) continue;
                    if (Math.hypot(other.p1.x - p1.x, other.p1.y - p1.y) < 0.1 ||
                        Math.hypot(other.p2.x - p1.x, other.p2.y - p1.y) < 0.1 ||
                        Math.hypot(other.p1.x - p2.x, other.p1.y - p2.y) < 0.1 ||
                        Math.hypot(other.p2.x - p2.x, other.p2.y - p2.y) < 0.1) {
                        continue;
                    }
                    const hitDist = this._raySegmentIntersect(mid.x, mid.y, nx, ny, other.p1.x, other.p1.y, other.p2.x, other.p2.y);
                    if (hitDist !== null && hitDist > 0.05 && hitDist < minObstacleDist) {
                        minObstacleDist = hitDist;
                        obstacleHasTab = !!other.hasTab;
                    }
                }

                if (minObstacleDist < Infinity) {
                    // Si la arista opuesta también tiene solapa, se reparten el espacio disponible (42% cada una)
                    // para que jamás se toquen ni se monten frente a frente
                    const maxRatio = obstacleHasTab ? 0.42 : 0.75;
                    const maxAllowedH = Math.max(0, minObstacleDist * maxRatio - 0.2);
                    if (maxAllowedH < 1.0) {
                        // El vano o corte interior es demasiado estrecho: no colocar solapa aquí para no invadir la pieza
                        return;
                    }
                    if (tabH > maxAllowedH) {
                        tabH = maxAllowedH;
                        if (prevHasTab && prevEdge) {
                            inset1 = isConcave1 ? tabH * tanMiter1 : tabH * Math.tan(slitHalfAngle1);
                        } else {
                            inset1 = tabH / Math.tan(defaultAlphaRad);
                        }
                        if (nextHasTab && nextEdge) {
                            inset2 = isConcave2 ? tabH * tanMiter2 : tabH * Math.tan(slitHalfAngle2);
                        } else {
                            inset2 = tabH / Math.tan(defaultAlphaRad);
                        }
                        if (inset1 > maxAllowedInset) inset1 = maxAllowedInset;
                        if (inset2 > maxAllowedInset) inset2 = maxAllowedInset;
                    }
                }

                // Asegurar que el ancho superior de la solapa mantenga al menos un 15% de la base
                if (inset1 + inset2 > len * 0.85) {
                    const scale = (len * 0.85) / (inset1 + inset2);
                    inset1 *= scale;
                    inset2 *= scale;
                }

                // 2. Verificación estricta: asegurar que los vértices jamás penetren la pieza NI solapen otra solapa ya creada
                let attempts = 0;
                let valid = false;
                let tabP1 = null, tabP2 = null, tabCenter = null;

                while (attempts < 5) {
                    tabP1 = {
                        x: p1.x + ux * inset1 + nx * tabH,
                        y: p1.y + uy * inset1 + ny * tabH
                    };
                    tabP2 = {
                        x: p2.x - ux * inset2 + nx * tabH,
                        y: p2.y - uy * inset2 + ny * tabH
                    };
                    tabCenter = {
                        x: (p1.x + p2.x + tabP1.x + tabP2.x) / 4,
                        y: (p1.y + p2.y + tabP1.y + tabP2.y) / 4
                    };

                    let insidePiece = false;
                    for (let t = 0; t < part.localTriangles.length; t++) {
                        const tri = part.localTriangles[t];
                        if (tri && tri.length >= 3) {
                            if (this._isPointInTriangle(tabP1.x, tabP1.y, tri[0], tri[1], tri[2]) ||
                                this._isPointInTriangle(tabP2.x, tabP2.y, tri[0], tri[1], tri[2]) ||
                                this._isPointInTriangle(tabCenter.x, tabCenter.y, tri[0], tri[1], tri[2])) {
                                insidePiece = true;
                                break;
                            }
                        }
                    }

                    let overlapsOtherTab = false;
                    for (let ot = 0; ot < islandTabs.length; ot++) {
                        const otherTab = islandTabs[ot];
                        // Comprobar si el borde superior de esta solapa cruza el borde superior de otra solapa
                        if (this._segmentsIntersect(tabP1.x, tabP1.y, tabP2.x, tabP2.y, otherTab.tabP1.x, otherTab.tabP1.y, otherTab.tabP2.x, otherTab.tabP2.y)) {
                            overlapsOtherTab = true;
                            break;
                        }
                        // Comprobar cruce de bordes con solapas no adyacentes
                        const isAdjacent = (Math.hypot(otherTab.baseP1.x - p2.x, otherTab.baseP1.y - p2.y) < 0.1 ||
                                            Math.hypot(otherTab.baseP2.x - p1.x, otherTab.baseP2.y - p1.y) < 0.1);
                        if (!isAdjacent) {
                            if (this._segmentsIntersect(p1.x, p1.y, tabP1.x, tabP1.y, otherTab.tabP1.x, otherTab.tabP1.y, otherTab.tabP2.x, otherTab.tabP2.y) ||
                                this._segmentsIntersect(p2.x, p2.y, tabP2.x, tabP2.y, otherTab.tabP1.x, otherTab.tabP1.y, otherTab.tabP2.x, otherTab.tabP2.y) ||
                                this._segmentsIntersect(tabP1.x, tabP1.y, tabP2.x, tabP2.y, otherTab.baseP1.x, otherTab.baseP1.y, otherTab.tabP1.x, otherTab.tabP1.y) ||
                                this._segmentsIntersect(tabP1.x, tabP1.y, tabP2.x, tabP2.y, otherTab.baseP2.x, otherTab.baseP2.y, otherTab.tabP2.x, otherTab.tabP2.y)) {
                                overlapsOtherTab = true;
                                break;
                            }
                        }
                    }

                    if (!insidePiece && !overlapsOtherTab) {
                        valid = true;
                        break;
                    }

                    // Si invade la pieza o solapa a otra solapa, reducir altura progresivamente
                    tabH *= 0.65;
                    if (prevHasTab && prevEdge) {
                        inset1 = isConcave1 ? tabH * tanMiter1 : tabH * Math.tan(slitHalfAngle1);
                    } else {
                        inset1 = tabH / Math.tan(defaultAlphaRad);
                    }
                    if (nextHasTab && nextEdge) {
                        inset2 = isConcave2 ? tabH * tanMiter2 : tabH * Math.tan(slitHalfAngle2);
                    } else {
                        inset2 = tabH / Math.tan(defaultAlphaRad);
                    }
                    if (inset1 > maxAllowedInset) inset1 = maxAllowedInset;
                    if (inset2 > maxAllowedInset) inset2 = maxAllowedInset;
                    attempts++;
                }

                if (!valid || tabH < 0.8) {
                    // Si aún reduciendo la altura la solapa invade la pieza o solapa a otra solapa, se descarta para proteger el modelo
                    return;
                }

                islandTabs.push({
                    baseP1: p1,
                    baseP2: p2,
                    tabP1,
                    tabP2,
                    tabCenter,
                    baseLen: len,
                    seamNumber: bEdge.seamNumber,
                    junctionKey: bEdge.junctionKey,
                    edgeKey: bEdge.edgeKey,
                    side: bEdge.side
                });
            });

            part.tabs = islandTabs;

            // 3. Recalcular bounding box en mm incluyendo solapas
            let bMinX = Infinity, bMaxX = -Infinity;
            let bMinY = Infinity, bMaxY = -Infinity;
            part.localTriangles.forEach(tri => {
                tri.forEach(p => {
                    bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
                    bMinY = Math.min(bMinY, p.y); bMaxY = Math.max(bMaxY, p.y);
                });
            });
            part.tabs.forEach(tab => {
                [tab.tabP1, tab.tabP2].forEach(p => {
                    bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
                    bMinY = Math.min(bMinY, p.y); bMaxY = Math.max(bMaxY, p.y);
                });
            });

            part.bounds = { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
            part.wMm = Math.max(1, bMaxX - bMinX);
            part.hMm = Math.max(1, bMaxY - bMinY);
        }

        this.invalidateBleedCache();
        this.notifyChange();
    }

    /**
     * Invierte la solapa al borde gemelo de la costura (A <-> B)
     * Si la costura pertenece a una unión completa (junction), invierte toda la unión
     */
    flipSeam(seamNumber) {
        const seam = this.seamByNumber.get(seamNumber);
        if (!seam) return false;
        if (seam.junctionKey && this.junctions && this.junctions.has(seam.junctionKey)) {
            return this.flipJunction(seam.junctionKey);
        }
        seam.activeSide = (seam.activeSide === 'A') ? 'B' : 'A';
        this.seamOverrides.set(seam.pos3dKey, seam.activeSide);
        this.rebuildAllTabs();
        return true;
    }

    /**
     * Oculta o restaura la solapa en la costura especificada (none <-> activa)
     * Si pertenece a una unión completa, oculta o restaura toda la unión
     */
    toggleSeam(seamNumber) {
        const seam = this.seamByNumber.get(seamNumber);
        if (!seam) return false;
        if (seam.junctionKey && this.junctions && this.junctions.has(seam.junctionKey)) {
            return this.toggleJunction(seam.junctionKey);
        }
        seam.activeSide = (seam.activeSide === 'none') ? 'A' : 'none';
        this.seamOverrides.set(seam.pos3dKey, seam.activeSide);
        this.rebuildAllTabs();
        return seam.activeSide !== 'none';
    }

    /**
     * Invierte todas las solapas de una unión continua entre dos piezas
     */
    flipJunction(junctionKey) {
        const j = this.junctions.get(junctionKey);
        if (!j) return false;
        j.activeSide = (j.activeSide === 'A') ? 'B' : 'A';
        this.junctionOverrides.set(junctionKey, j.activeSide);
        for (const s of j.seams) {
            s.activeSide = j.activeSide;
            this.seamOverrides.set(s.pos3dKey, s.activeSide);
        }
        this.rebuildAllTabs();
        return true;
    }

    /**
     * Oculta o restaura todas las solapas de una unión continua entre dos piezas
     */
    toggleJunction(junctionKey) {
        const j = this.junctions.get(junctionKey);
        if (!j) return false;
        j.activeSide = (j.activeSide === 'none') ? 'A' : 'none';
        this.junctionOverrides.set(junctionKey, j.activeSide);
        for (const s of j.seams) {
            s.activeSide = j.activeSide;
            this.seamOverrides.set(s.pos3dKey, s.activeSide);
        }
        this.rebuildAllTabs();
        return j.activeSide !== 'none';
    }

    /**
     * Asigna la solapa a una arista específica de la costura o unión
     */
    setSeamActiveEdge(edge) {
        if (!edge || !edge.seamNumber) return false;
        const seam = this.seamByNumber.get(edge.seamNumber);
        if (!seam) return false;
        const side = edge.side || 'A';
        if (edge.junctionKey && this.junctions && this.junctions.has(edge.junctionKey)) {
            const j = this.junctions.get(edge.junctionKey);
            j.activeSide = side;
            this.junctionOverrides.set(edge.junctionKey, side);
            for (const s of j.seams) {
                s.activeSide = side;
                this.seamOverrides.set(s.pos3dKey, side);
            }
        } else {
            seam.activeSide = side;
            this.seamOverrides.set(seam.pos3dKey, side);
        }
        this.rebuildAllTabs();
        return true;
    }

    _isPointInPolygon(px, py, vertices) {
        if (!vertices || vertices.length < 3) return false;
        let inside = false;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;
            const intersect = ((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    _isPointInTriangle(px, py, t0, t1, t2) {
        if (!t0 || !t1 || !t2) return false;
        const dX = px - t2.x;
        const dY = py - t2.y;
        const dX21 = t2.x - t1.x;
        const dY12 = t1.y - t2.y;
        const D = dY12 * (t0.x - t2.x) + dX21 * (t0.y - t2.y);
        const s = dY12 * dX + dX21 * dY;
        const t = (t2.y - t0.y) * dX + (t0.x - t2.x) * dY;
        if (D > 0) return s >= 0 && t >= 0 && s + t <= D;
        return s <= 0 && t <= 0 && s + t >= D;
    }

    _raySegmentIntersect(ox, oy, dx, dy, x1, y1, x2, y2) {
        const v1x = ox - x1;
        const v1y = oy - y1;
        const v2x = x2 - x1;
        const v2y = y2 - y1;
        const v3x = -dy;
        const v3y = dx;

        const dot = v2x * v3x + v2y * v3y;
        if (Math.abs(dot) < 1e-6) return null;

        const t1 = (v2x * v1y - v2y * v1x) / dot;
        const t2 = (v1x * v3x + v1y * v3y) / dot;

        if (t1 >= 0 && t2 >= 0 && t2 <= 1) {
            return t1;
        }
        return null;
    }

    _segmentsIntersect(p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
        const ccw = (ax, ay, bx, by, cx, cy) => (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
        return (ccw(p1x, p1y, p3x, p3y, p4x, p4y) !== ccw(p2x, p2y, p3x, p3y, p4x, p4y)) &&
               (ccw(p1x, p1y, p2x, p2y, p3x, p3y) !== ccw(p1x, p1y, p2x, p2y, p4x, p4y));
    }

    /**
     * Detecta si el cursor está sobre una solapa o sobre una arista perimetral con costura
     */
    getTabOrEdgeAt(canvasX, canvasY, viewScale = 4.0) {
        if (!this.parts || this.parts.length === 0) return null;

        const sheetGapMm = 20.0;
        const pagePitchMm = this.A4_W + sheetGapMm;
        const mouseMmX = (canvasX - this.panX) / (this.zoom * viewScale);
        const mouseMmY = (canvasY - this.panY) / (this.zoom * viewScale);

        const searchOrder = [...this.parts];
        if (this.selectedPart) {
            const idx = searchOrder.indexOf(this.selectedPart);
            if (idx > -1) {
                searchOrder.splice(idx, 1);
                searchOrder.push(this.selectedPart);
            }
        }

        // 1. Prioridad: Verificar si se tocó directamente una solapa
        for (let i = searchOrder.length - 1; i >= 0; i--) {
            const part = searchOrder[i];
            const p = part.layout.pageIndex;
            const pageOffsetMmX = p * pagePitchMm;
            const pageMmX = mouseMmX - pageOffsetMmX;
            const pageMmY = mouseMmY;

            const dx = pageMmX - part.layout.x;
            const dy = pageMmY - part.layout.y;
            const rad = (-part.layout.rotation * Math.PI) / 180;
            let lx = dx * Math.cos(rad) - dy * Math.sin(rad);
            let ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            if (part.layout.flipX) lx = -lx;
            if (part.layout.flipY) ly = -ly;

            const b = part.bounds;
            if (lx < b.minX - 6 || lx > b.maxX + 6 || ly < b.minY - 6 || ly > b.maxY + 6) continue;

            if (this.showFlaps && part.tabs) {
                for (const tab of part.tabs) {
                    const quad = [tab.baseP1, tab.tabP1, tab.tabP2, tab.baseP2];
                    const distToCenter = Math.hypot(lx - tab.tabCenter.x, ly - tab.tabCenter.y);
                    if (this._isPointInPolygon(lx, ly, quad) || distToCenter <= 3.0) {
                        return {
                            type: 'tab',
                            tab,
                            part,
                            pageIndex: p,
                            seamNumber: tab.seamNumber,
                            junctionKey: tab.junctionKey,
                            side: tab.side,
                            seam: this.seamByNumber.get(tab.seamNumber),
                            junction: tab.junctionKey ? this.junctions?.get(tab.junctionKey) : null
                        };
                    }
                }
            }
        }

        // 2. Segunda pasada: Verificar si se tocó una arista con costura (borde receptor o solapa oculta)
        for (let i = searchOrder.length - 1; i >= 0; i--) {
            const part = searchOrder[i];
            const p = part.layout.pageIndex;
            const pageOffsetMmX = p * pagePitchMm;
            const pageMmX = mouseMmX - pageOffsetMmX;
            const pageMmY = mouseMmY;

            const dx = pageMmX - part.layout.x;
            const dy = pageMmY - part.layout.y;
            const rad = (-part.layout.rotation * Math.PI) / 180;
            let lx = dx * Math.cos(rad) - dy * Math.sin(rad);
            let ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            if (part.layout.flipX) lx = -lx;
            if (part.layout.flipY) ly = -ly;

            const b = part.bounds;
            if (lx < b.minX - 4 || lx > b.maxX + 4 || ly < b.minY - 4 || ly > b.maxY + 4) continue;

            for (const edge of part.boundaryEdges) {
                if (!edge.seamNumber) continue;
                const dist = this._distToSegment(lx, ly, edge.p1.x, edge.p1.y, edge.p2.x, edge.p2.y);
                if (dist <= 2.2) {
                    return {
                        type: 'edge',
                        edge,
                        part,
                        pageIndex: p,
                        seamNumber: edge.seamNumber,
                        junctionKey: edge.junctionKey,
                        side: edge.side,
                        seam: this.seamByNumber.get(edge.seamNumber),
                        junction: edge.junctionKey ? this.junctions?.get(edge.junctionKey) : null
                    };
                }
            }
        }

        return null;
    }

    /**
     * Detecta qué pieza está debajo del cursor del ratón en coordenadas del lienzo Unfold
     */
    getPartAt(canvasX, canvasY, viewScale = 4.0) {
        if (!this.parts || this.parts.length === 0) return null;

        const sheetGapMm = 20.0;
        const pagePitchMm = this.A4_W + sheetGapMm;

        // Convertir de coordenadas del canvas a mm continuos del banco de trabajo
        const mouseMmX = (canvasX - this.panX) / (this.zoom * viewScale);
        const mouseMmY = (canvasY - this.panY) / (this.zoom * viewScale);

        // Buscar piezas en orden visual inverso (la pieza seleccionada se chequea primero por estar arriba)
        const searchOrder = [...this.parts];
        if (this.selectedPart) {
            const idx = searchOrder.indexOf(this.selectedPart);
            if (idx > -1) {
                searchOrder.splice(idx, 1);
                searchOrder.push(this.selectedPart);
            }
        }

        for (let i = searchOrder.length - 1; i >= 0; i--) {
            const part = searchOrder[i];
            const p = part.layout.pageIndex;
            const pageOffsetMmX = p * pagePitchMm;
            const pageMmX = mouseMmX - pageOffsetMmX;
            const pageMmY = mouseMmY;

            // Proyectar el punto al espacio local rotado de la pieza
            const dx = pageMmX - part.layout.x;
            const dy = pageMmY - part.layout.y;
            const rad = (-part.layout.rotation * Math.PI) / 180;
            let lx = dx * Math.cos(rad) - dy * Math.sin(rad);
            let ly = dx * Math.sin(rad) + dy * Math.cos(rad);
            if (part.layout.flipX) lx = -lx;
            if (part.layout.flipY) ly = -ly;

            // Comprobar bounding box con holgura para seleccionar fácilmente
            const b = part.bounds;
            if (lx >= b.minX - 3 && lx <= b.maxX + 3 && ly >= b.minY - 3 && ly <= b.maxY + 3) {
                return { part, pageIndex: p, localX: lx, localY: ly };
            }
        }
        return null;
    }

    /**
     * Obtiene la pieza que contiene una faceta 3D determinada (Rastreo 3D -> 2D instantáneo O(1))
     */
    getPartByFaceIndex(faceIndex) {
        if (!this.faceToPart) return null;
        return this.faceToPart.get(faceIndex) || null;
    }

    /**
     * Obtiene la pieza según coordenadas UV de impacto 3D (Respaldo infalible)
     */
    getPartAtUV(u, v) {
        if (!this.parts || this.parts.length === 0) return null;
        for (const part of this.parts) {
            if (part.uvBounds &&
                u >= part.uvBounds.minU - 0.003 && u <= part.uvBounds.maxU + 0.003 &&
                v >= part.uvBounds.minV - 0.003 && v <= part.uvBounds.maxV + 0.003) {
                return part;
            }
        }
        return null;
    }

    /**
     * Establece o limpia la pieza resaltada por hover interactivo
     */
    setHoveredPart(part, source = '2d') {
        if (this.hoveredPart === part) return false;
        this.hoveredPart = part;
        this.hoveredSource = source;
        return true;
    }

    /**
     * Gestión de Anotaciones e Indicadores en el Banco de Trabajo A4
     */
    addAnnotation(ann) {
        if (!ann) return null;
        if (!ann.id) {
            ann.id = 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        if (ann.pageIndex === undefined) ann.pageIndex = 0;
        if (ann.x === undefined) ann.x = 20;
        if (ann.y === undefined) ann.y = 20;
        if (!ann.color) ann.color = '#d32f2f';
        if (ann.fontSize === undefined) ann.fontSize = 9;
        if (ann.rotation === undefined) ann.rotation = 0;

        this.annotations.push(ann);
        this.notifyChange();
        return ann;
    }

    removeAnnotation(id) {
        if (!id) return;
        const idx = this.annotations.findIndex(a => a.id === id);
        if (idx !== -1) {
            this.annotations.splice(idx, 1);
            if (this.selectedAnnotation && this.selectedAnnotation.id === id) {
                this.selectedAnnotation = null;
            }
            this.notifyChange();
        }
    }

    clearAnnotations(pageIndex = null) {
        if (pageIndex === null) {
            this.annotations = [];
            this.selectedAnnotation = null;
        } else {
            this.annotations = this.annotations.filter(a => a.pageIndex !== pageIndex);
            if (this.selectedAnnotation && this.selectedAnnotation.pageIndex === pageIndex) {
                this.selectedAnnotation = null;
            }
        }
        this.notifyChange();
    }

    _distToSegment(px, py, x1, y1, x2, y2) {
        const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
        if (l2 === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
    }

    getAnnotationAt(canvasX, canvasY, viewScale = 4.0) {
        if (!this.annotations || this.annotations.length === 0) return null;

        const sheetGapMm = 20.0;
        const pagePitchMm = this.A4_W + sheetGapMm;
        const mouseMmX = (canvasX - this.panX) / (this.zoom * viewScale);
        const mouseMmY = (canvasY - this.panY) / (this.zoom * viewScale);

        // Búsqueda en orden inverso (las más recientes arriba)
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const ann = this.annotations[i];
            const p = ann.pageIndex || 0;
            const pageOffsetMmX = p * pagePitchMm;
            const pageMmX = mouseMmX - pageOffsetMmX;
            const pageMmY = mouseMmY;

            if (pageMmX < -10 || pageMmX > this.A4_W + 10 || pageMmY < -10 || pageMmY > this.A4_H + 10) {
                continue;
            }

            if (ann.type === 'badge') {
                const dist = Math.hypot(pageMmX - ann.x, pageMmY - ann.y);
                if (dist <= 6.0) {
                    return { annotation: ann, handle: 'body' };
                }
            } else if (ann.type === 'arrow') {
                const endX = (ann.endX !== undefined ? ann.endX : ann.x + 20);
                const endY = (ann.endY !== undefined ? ann.endY : ann.y + 20);
                
                // Comprobar nodo de la punta
                if (Math.hypot(pageMmX - endX, pageMmY - endY) <= 6.5) {
                    return { annotation: ann, handle: 'end' };
                }
                // Comprobar nodo de origen
                if (Math.hypot(pageMmX - ann.x, pageMmY - ann.y) <= 6.5) {
                    return { annotation: ann, handle: 'start' };
                }
                // Comprobar cuerpo de la flecha
                if (this._distToSegment(pageMmX, pageMmY, ann.x, ann.y, endX, endY) <= 5.5) {
                    return { annotation: ann, handle: 'body' };
                }
            } else {
                // 'text', 'cut', 'glue'
                const dx = pageMmX - ann.x;
                const dy = pageMmY - ann.y;
                const rad = (-(ann.rotation || 0) * Math.PI) / 180;
                const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
                const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

                let w = 24, h = 10;
                if (ann.type === 'text') {
                    const txtLen = (ann.text || 'Texto').length;
                    w = Math.max(16, txtLen * (ann.fontSize || 9) * 0.32 + 6);
                    h = Math.max(8, (ann.fontSize || 9) * 0.45 + 4);
                } else if (ann.type === 'cut') {
                    if (lx >= -1.5 && lx <= 27 && ly >= -4 && ly <= 4) {
                        return { annotation: ann, handle: 'body' };
                    }
                    continue;
                } else if (ann.type === 'glue') {
                    if (lx >= -5 && lx <= 5 && ly >= -5 && ly <= 5) {
                        return { annotation: ann, handle: 'body' };
                    }
                    continue;
                }

                if (lx >= -4 && lx <= w + 4 && ly >= -h - 2 && ly <= 6) {
                    return { annotation: ann, handle: 'body' };
                }
            }
        }
        return null;
    }

    drawAnnotationsOnCanvas(ctx, pageIndex, pageX_px, pageY_px, mmToPx = 4.0) {
        if (!this.annotations || this.annotations.length === 0) return;
        const pageAnns = this.annotations.filter(a => (a.pageIndex || 0) === pageIndex);
        for (const ann of pageAnns) {
            if (this.selectedAnnotation && this.selectedAnnotation.id === ann.id) continue;
            this.drawAnnotationOnCanvas(ctx, ann, pageX_px, pageY_px, mmToPx, false);
        }
    }

    drawAnnotationOnCanvas(ctx, ann, pageX_px, pageY_px, mmToPx = 4.0, isSelected = false) {
        const xPx = pageX_px + ann.x * mmToPx;
        const yPx = pageY_px + ann.y * mmToPx;
        const color = ann.color || '#d32f2f';
        const rotRad = ((ann.rotation || 0) * Math.PI) / 180;

        ctx.save();

        if (ann.type === 'text') {
            ctx.translate(xPx, yPx);
            ctx.rotate(rotRad);

            const fontSizePt = ann.fontSize || 9;
            const fontSizePx = Math.max(10, fontSizePt * 0.3528 * mmToPx);
            ctx.font = `bold ${Math.round(fontSizePx)}px Helvetica, Arial, sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';

            const txt = ann.text || 'Nota';
            const tm = ctx.measureText(txt);
            const padX = 4;
            const padY = 2;
            const textH = fontSizePx * 0.85;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.strokeStyle = isSelected ? '#00e5ff' : color;
            ctx.lineWidth = isSelected ? 1.8 : 0.8;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(-padX, -textH - padY, tm.width + padX * 2, textH + padY * 2 + 2, 3);
            } else {
                ctx.rect(-padX, -textH - padY, tm.width + padX * 2, textH + padY * 2 + 2);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.fillText(txt, 0, 0);

            if (isSelected) {
                this._drawSelectionCorners(ctx, -padX, -textH - padY, tm.width + padX * 2, textH + padY * 2 + 2);
            }

        } else if (ann.type === 'arrow') {
            const endXPx = pageX_px + (ann.endX !== undefined ? ann.endX : ann.x + 20) * mmToPx;
            const endYPx = pageY_px + (ann.endY !== undefined ? ann.endY : ann.y + 20) * mmToPx;

            ctx.strokeStyle = isSelected ? '#00e5ff' : color;
            ctx.fillStyle = isSelected ? '#00e5ff' : color;
            ctx.lineWidth = Math.max(2, (ann.lineWidthMm || 0.4) * mmToPx);
            ctx.lineCap = 'round';

            ctx.beginPath();
            ctx.moveTo(xPx, yPx);
            ctx.lineTo(endXPx, endYPx);
            ctx.stroke();

            const angle = Math.atan2(endYPx - yPx, endXPx - xPx);
            const headLen = Math.max(10, 3.2 * mmToPx);
            ctx.beginPath();
            ctx.moveTo(endXPx, endYPx);
            ctx.lineTo(endXPx - headLen * Math.cos(angle - Math.PI / 6), endYPx - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(endXPx - headLen * Math.cos(angle + Math.PI / 6), endYPx - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();

            if (ann.text) {
                const midX = (xPx + endXPx) / 2;
                const midY = (yPx + endYPx) / 2;
                const fontSizePt = ann.fontSize || 8;
                const fontSizePx = Math.max(9, fontSizePt * 0.3528 * mmToPx);
                ctx.font = `bold ${Math.round(fontSizePx)}px Helvetica, Arial, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.strokeText(ann.text, midX, midY - 3);
                ctx.fillStyle = color;
                ctx.fillText(ann.text, midX, midY - 3);
            }

            if (isSelected) {
                ctx.fillStyle = '#00e5ff';
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(xPx, yPx, 4.5, 0, Math.PI * 2);
                ctx.arc(endXPx, endYPx, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }

        } else if (ann.type === 'badge') {
            const radiusPx = Math.max(12, 3.5 * mmToPx);
            ctx.translate(xPx, yPx);

            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = isSelected ? '#00e5ff' : color;
            ctx.lineWidth = isSelected ? 3 : 2;
            ctx.beginPath();
            ctx.arc(0, 0, radiusPx, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            const badgeStr = String(ann.text || ann.badgeNumber || 1);
            const fontSizePx = Math.max(11, radiusPx * 1.05);
            ctx.font = `bold ${Math.round(fontSizePx)}px Helvetica, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = color;
            ctx.fillText(badgeStr, 0, 1);

            if (isSelected) {
                ctx.strokeStyle = '#00e5ff';
                ctx.setLineDash([3, 3]);
                ctx.lineWidth = 1;
                ctx.strokeRect(-radiusPx - 3, -radiusPx - 3, (radiusPx + 3) * 2, (radiusPx + 3) * 2);
                ctx.setLineDash([]);
            }

        } else if (ann.type === 'cut') {
            ctx.translate(xPx, yPx);
            ctx.rotate(rotRad);

            const scissorColor = isSelected ? '#00e5ff' : '#222222';
            const cutLineColor = isSelected ? '#00e5ff' : (ann.color || '#d32f2f');

            // A) Línea punteada de incisión / corte (desde punta de tijera x=6.6mm hasta x=26mm)
            ctx.save();
            ctx.strokeStyle = cutLineColor;
            ctx.lineWidth = 1.6;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(6.6 * mmToPx, 0);
            ctx.lineTo(26.0 * mmToPx, 0);
            ctx.stroke();
            ctx.restore();

            // B) Icono Vectorial Tijera ✂ (100% nativa sin fuentes)
            ctx.save();
            ctx.strokeStyle = scissorColor;
            ctx.lineWidth = 1.4;

            // 1. Aros de sujeción (mangos)
            ctx.beginPath();
            ctx.arc(0.7 * mmToPx, -1.6 * mmToPx, 1.15 * mmToPx, 0, Math.PI * 2);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(0.7 * mmToPx, 1.6 * mmToPx, 1.15 * mmToPx, 0, Math.PI * 2);
            ctx.stroke();

            // 2. Hojas de corte cruzadas desde los mangos a las puntas
            ctx.beginPath();
            ctx.moveTo(0.7 * mmToPx, 1.6 * mmToPx);
            ctx.lineTo(2.4 * mmToPx, 0);
            ctx.lineTo(6.4 * mmToPx, -1.3 * mmToPx);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0.7 * mmToPx, -1.6 * mmToPx);
            ctx.lineTo(2.4 * mmToPx, 0);
            ctx.lineTo(6.4 * mmToPx, 1.3 * mmToPx);
            ctx.stroke();

            // 3. Remache / pivote central
            ctx.fillStyle = scissorColor;
            ctx.beginPath();
            ctx.arc(2.4 * mmToPx, 0, 0.45 * mmToPx, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            if (isSelected) {
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.strokeRect(-0.8 * mmToPx, -3.2 * mmToPx, 27.6 * mmToPx, 6.4 * mmToPx);
                ctx.setLineDash([]);
            }

        } else if (ann.type === 'glue') {
            ctx.translate(xPx, yPx);
            ctx.rotate(rotRad);

            const badgeSizePx = 8.0 * mmToPx;
            const rCornerPx = 2.0 * mmToPx;

            // A) Badge / placa redondeada (alta legibilidad y contraste)
            ctx.fillStyle = 'rgba(255, 250, 205, 0.96)';
            ctx.strokeStyle = isSelected ? '#00e5ff' : '#e68200';
            ctx.lineWidth = isSelected ? 2 : 1.2;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(-badgeSizePx / 2, -badgeSizePx / 2, badgeSizePx, badgeSizePx, rCornerPx);
            } else {
                ctx.rect(-badgeSizePx / 2, -badgeSizePx / 2, badgeSizePx, badgeSizePx);
            }
            ctx.fill();
            ctx.stroke();

            // B) Gota de pegamento vectorial 💧 (sin texto)
            const cyPx = 0.25 * mmToPx;
            const dropColor = ann.color || '#0288d1';
            ctx.fillStyle = dropColor;

            // 1. Vientre redondeado inferior
            ctx.beginPath();
            ctx.arc(0, cyPx + 0.4 * mmToPx, 1.45 * mmToPx, 0, Math.PI * 2);
            ctx.fill();

            // 2. Punta cónica superior
            ctx.beginPath();
            ctx.moveTo(0, cyPx - 2.4 * mmToPx);
            ctx.lineTo(-1.4 * mmToPx, cyPx + 0.35 * mmToPx);
            ctx.lineTo(1.4 * mmToPx, cyPx + 0.35 * mmToPx);
            ctx.closePath();
            ctx.fill();

            // 3. Brillo de volumen / reflejo blanco
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.beginPath();
            ctx.arc(-0.5 * mmToPx, cyPx - 0.25 * mmToPx, 0.42 * mmToPx, 0, Math.PI * 2);
            ctx.fill();

            if (isSelected) {
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.strokeRect(-badgeSizePx / 2 - 2, -badgeSizePx / 2 - 2, badgeSizePx + 4, badgeSizePx + 4);
                ctx.setLineDash([]);
            }
        }

        ctx.restore();
    }

    _drawSelectionCorners(ctx, x, y, w, h) {
        ctx.strokeStyle = '#00e5ff';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.fillStyle = '#00e5ff';
        const s = 4;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        ctx.fillRect(x + w - s / 2, y - s / 2, s, s);
        ctx.fillRect(x - s / 2, y + h - s / 2, s, s);
        ctx.fillRect(x + w - s / 2, y + h - s / 2, s, s);
    }

    drawArrowPreview(ctx, arrow, pageX_px, pageY_px, mmToPx = 4.0) {
        if (!arrow) return;
        const xPx = pageX_px + arrow.startX * mmToPx;
        const yPx = pageY_px + arrow.startY * mmToPx;
        const endXPx = pageX_px + arrow.endX * mmToPx;
        const endYPx = pageY_px + arrow.endY * mmToPx;

        ctx.save();
        ctx.strokeStyle = '#00e5ff';
        ctx.fillStyle = '#00e5ff';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 3]);

        ctx.beginPath();
        ctx.moveTo(xPx, yPx);
        ctx.lineTo(endXPx, endYPx);
        ctx.stroke();
        ctx.setLineDash([]);

        const angle = Math.atan2(endYPx - yPx, endXPx - xPx);
        const headLen = Math.max(10, 3.2 * mmToPx);
        ctx.beginPath();
        ctx.moveTo(endXPx, endYPx);
        ctx.lineTo(endXPx - headLen * Math.cos(angle - Math.PI / 6), endYPx - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(endXPx - headLen * Math.cos(angle + Math.PI / 6), endYPx - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    /**
     * Dibuja una previsualización de las piezas y solapas sobre el lienzo UV estándar si es requerido
     */
    renderOverlay(ctx, w, h) {
        ctx.clearRect(0, 0, w, h);
        if (!this.parts || this.parts.length === 0) return;

        ctx.save();
        ctx.strokeStyle = this.cutLineColor || 'rgba(0, 0, 0, 0.6)';
        const cutWidthMm = parseFloat(this.cutLineWidthMm || 0.10) || 0.10;
        ctx.lineWidth = Math.max(0.6, (cutWidthMm / 0.10) * 1.4);
        ctx.beginPath();
        const mmToUV = 1.0 / (this.uvSheetSizeMm || 210.0);
        for (const part of this.parts) {
            for (const edge of part.boundaryEdges) {
                const u1 = part.centerU + edge.p1.x * mmToUV;
                const v1 = part.centerV + edge.p1.y * mmToUV;
                const u2 = part.centerU + edge.p2.x * mmToUV;
                const v2 = part.centerV + edge.p2.y * mmToUV;
                ctx.moveTo(u1 * w, (1 - v1) * h);
                ctx.lineTo(u2 * w, (1 - v2) * h);
            }
        }
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Renderiza el banco de trabajo interactivo de Hojas A4
     */
    renderUnfoldWorkbench(ctx, canvasW, canvasH, canvas2d) {
        ctx.clearRect(0, 0, canvasW, canvasH);

        // Fondo del taller de diseño (Drafting Desk)
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, canvasW, canvasH);

        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.zoom, this.zoom);

        // Escala fija de visualización: 4.0 píxeles por milímetro en el banco
        const mmToPx = 4.0;
        const sheetGapMm = 20.0;

        // Dibujar cada hoja A4 con su fondo, reglas y piezas correspondientes
        for (let p = 0; p < this.pagesCount; p++) {
            const pageX_px = p * (this.A4_W + sheetGapMm) * mmToPx;
            this.renderSheetOnCanvas(ctx, p, canvas2d, pageX_px, 0, mmToPx);
            this.drawAnnotationsOnCanvas(ctx, p, pageX_px, 0, mmToPx);
        }

        // Si hay una pieza seleccionada, redibujarla sobre su hoja para que sus cotas y marcas queden encima
        if (this.selectedPart) {
            const pageX_px = this.selectedPart.layout.pageIndex * (this.A4_W + sheetGapMm) * mmToPx;
            this.drawPartOnCanvas(ctx, this.selectedPart, canvas2d, pageX_px, 0, mmToPx, true);
        }

        // Si hay una anotación seleccionada, redibujarla encima con sus tiradores activos
        if (this.selectedAnnotation) {
            const p = this.selectedAnnotation.pageIndex || 0;
            const pageX_px = p * (this.A4_W + sheetGapMm) * mmToPx;
            this.drawAnnotationOnCanvas(ctx, this.selectedAnnotation, pageX_px, 0, mmToPx, true);
        }

        // Si se está trazando una flecha interactiva en vivo
        if (this.drawingArrow) {
            const p = this.drawingArrow.pageIndex || 0;
            const pageX_px = p * (this.A4_W + sheetGapMm) * mmToPx;
            this.drawArrowPreview(ctx, this.drawingArrow, pageX_px, 0, mmToPx);
        }

        // PASADA 3: Dibujar medición interactiva de la Regla (si está activa)
        this.drawMeasurementOnCanvas(ctx, mmToPx);

        ctx.restore();
    }

    /**
     * Dibuja la línea de cota y medición activa de la regla sobre el canvas
     */
    drawMeasurementOnCanvas(ctx, mmToPx = 4.0) {
        if (!this.activeMeasurement) return;
        const m = this.activeMeasurement;
        const x1 = m.start.x * mmToPx;
        const y1 = m.start.y * mmToPx;
        const x2 = m.end.x * mmToPx;
        const y2 = m.end.y * mmToPx;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = '#ffb300';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Puntos extremos (puntos de anclaje)
        ctx.fillStyle = '#ffb300';
        ctx.beginPath();
        ctx.arc(x1, y1, 4, 0, Math.PI * 2);
        ctx.arc(x2, y2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Cartela / Badge con la medida exacta en milímetros
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const labelText = `📏 ${m.distMm.toFixed(1)} mm (ΔX: ${m.dx.toFixed(1)}, ΔY: ${m.dy.toFixed(1)})`;
        ctx.font = 'bold 12px sans-serif';
        const tm = ctx.measureText(labelText);
        const bw = tm.width + 16;
        const bh = 22;

        ctx.fillStyle = 'rgba(20, 20, 20, 0.92)';
        ctx.strokeStyle = '#ffb300';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(midX - bw / 2, midY - bh / 2 - 14, bw, bh, 4);
        } else {
            ctx.rect(midX - bw / 2, midY - bh / 2 - 14, bw, bh);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffecb3';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, midX, midY - 14);
        ctx.restore();
    }

    /**
     * Dibuja el marco, fondo blanco puro, margen de seguridad y regla de calibración de una hoja A4
     */
    renderSheetBackgroundOnCanvas(ctx, pageX_px, pageY_px = 0, mmToPx = 4.0, customHeader = null) {
        const pageW_px = this.A4_W * mmToPx;
        const pageH_px = this.A4_H * mmToPx;
        const margin_px = this.A4_MARGIN * mmToPx;

        // 1. Sombra de la hoja A4
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 16;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 6;

        // 2. Fondo blanco puro de papel A4
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(pageX_px, pageY_px, pageW_px, pageH_px);
        ctx.shadowColor = 'transparent';

        // 3. Encabezado de página
        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#0288d1';
        ctx.textAlign = 'left';
        const header = customHeader || `📄 HOJA (A4 1:1) • ${this.currentScale} (${this.modelLengthMm} mm)`;
        ctx.fillText(header, pageX_px + margin_px + 4, pageY_px + 16);

        // 4. Margen de seguridad de impresión de 5 mm
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(pageX_px + margin_px, pageY_px + margin_px, pageW_px - margin_px * 2, pageH_px - margin_px * 2);
        ctx.setLineDash([]);

        // 5. Regla de calibración de 50 mm en cada hoja
        this.drawRulerOnCanvas(ctx, pageX_px + margin_px + 4, pageY_px + 32, mmToPx);
    }

    /**
     * Renderiza una hoja A4 individual sobre un canvas 2D dado en una posición (pageX_px, pageY_px)
     */
    renderSheetOnCanvas(ctx, p, canvas2d, pageX_px, pageY_px = 0, mmToPx = 4.0, customHeader = null) {
        const header = customHeader || `📄 HOJA ${p + 1} DE ${this.pagesCount} (A4 1:1) • ${this.currentScale} (${this.modelLengthMm} mm)`;
        this.renderSheetBackgroundOnCanvas(ctx, pageX_px, pageY_px, mmToPx, header);

        // Dibujar las piezas que pertenecen a esta hoja
        const partsOnPage = (this.parts || []).filter(pt => pt.layout.pageIndex === p);
        for (const part of partsOnPage) {
            this.drawPartOnCanvas(ctx, part, canvas2d, pageX_px, pageY_px, mmToPx, false);
        }
    }

    /**
     * Invalida la caché de canvases dilatados (Texture Bleed) para que se regeneren
     */
    invalidateBleedCache() {
        if (this.parts && this.parts.length > 0) {
            for (const p of this.parts) {
                p._bleedCanvas = null;
            }
        }
    }

    /**
     * Aplica Sangrado de Color Perimetral (Texture Bleed / Padding)
     * Extiende los píxeles opacos del contorno hacia el exterior transparente
     * por un radio de bleedPx píxeles usando propagación BFS por capas.
     */
    applyTextureBleed(canvas, bleedPx) {
        if (!bleedPx || bleedPx <= 0) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        if (w <= 0 || h <= 0) return;

        const imgData = ctx.getImageData(0, 0, w, h);
        const data32 = new Uint32Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength / 4);
        const total = w * h;

        const dist = new Int16Array(total);
        for (let i = 0; i < total; i++) {
            dist[i] = ((data32[i] >>> 24) >= 128) ? 0 : -1;
        }

        let frontier = new Int32Array(total);
        let frontierLen = 0;

        for (let y = 0; y < h; y++) {
            const row = y * w;
            for (let x = 0; x < w; x++) {
                const idx = row + x;
                if (dist[idx] !== -1) continue;

                let neighborIdx = -1;
                if (x > 0 && dist[idx - 1] === 0) neighborIdx = idx - 1;
                else if (x < w - 1 && dist[idx + 1] === 0) neighborIdx = idx + 1;
                else if (y > 0 && dist[idx - w] === 0) neighborIdx = idx - w;
                else if (y < h - 1 && dist[idx + w] === 0) neighborIdx = idx + w;
                else if (x > 0 && y > 0 && dist[idx - 1 - w] === 0) neighborIdx = idx - 1 - w;
                else if (x < w - 1 && y > 0 && dist[idx + 1 - w] === 0) neighborIdx = idx + 1 - w;
                else if (x > 0 && y < h - 1 && dist[idx - 1 + w] === 0) neighborIdx = idx - 1 + w;
                else if (x < w - 1 && y < h - 1 && dist[idx + 1 + w] === 0) neighborIdx = idx + 1 + w;

                if (neighborIdx !== -1) {
                    frontier[frontierLen++] = idx;
                    dist[idx] = 1;
                    data32[idx] = (data32[neighborIdx] & 0x00FFFFFF) | 0xFF000000;
                }
            }
        }

        let nextFrontier = new Int32Array(total);
        for (let step = 1; step < bleedPx; step++) {
            if (frontierLen === 0) break;
            let nextLen = 0;
            const nextDist = step + 1;

            for (let i = 0; i < frontierLen; i++) {
                const idx = frontier[i];
                const x = idx % w;
                const y = (idx / w) | 0;
                const col = data32[idx];

                if (x > 0 && dist[idx - 1] === -1) { dist[idx - 1] = nextDist; data32[idx - 1] = col; nextFrontier[nextLen++] = idx - 1; }
                if (x < w - 1 && dist[idx + 1] === -1) { dist[idx + 1] = nextDist; data32[idx + 1] = col; nextFrontier[nextLen++] = idx + 1; }
                if (y > 0 && dist[idx - w] === -1) { dist[idx - w] = nextDist; data32[idx - w] = col; nextFrontier[nextLen++] = idx - w; }
                if (y < h - 1 && dist[idx + w] === -1) { dist[idx + w] = nextDist; data32[idx + w] = col; nextFrontier[nextLen++] = idx + w; }
            }

            const tmp = frontier;
            frontier = nextFrontier;
            nextFrontier = tmp;
            frontierLen = nextLen;
        }

        ctx.putImageData(imgData, 0, 0);
    }

    /**
     * Obtiene o genera el canvas individual de una pieza con Sangrado de Textura perimetral
     */
    getPartBleedCanvas(part, canvas2d, bleedMm = 1.5) {
        if (part._bleedCanvas && part._bleedCanvas._bleedMm === bleedMm) {
            return part._bleedCanvas;
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (const tri of part.localTriangles) {
            if (!tri || tri.length < 3) continue;
            for (const pt of tri) {
                minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
                minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
            }
        }
        if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) return null;

        const pxPerMm = 6.0;
        const bleedPx = Math.round(bleedMm * pxPerMm);
        const padPx = bleedPx + 4;
        const bW_px = Math.max(16, Math.ceil((maxX - minX) * pxPerMm) + padPx * 2);
        const bH_px = Math.max(16, Math.ceil((maxY - minY) * pxPerMm) + padPx * 2);

        const canvas = document.createElement('canvas');
        canvas.width = bW_px;
        canvas.height = bH_px;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        ctx.translate(-minX * pxPerMm + padPx, -minY * pxPerMm + padPx);

        ctx.beginPath();
        for (const tri of part.localTriangles) {
            if (!tri || tri.length < 3) continue;
            ctx.moveTo(tri[0].x * pxPerMm, tri[0].y * pxPerMm);
            ctx.lineTo(tri[1].x * pxPerMm, tri[1].y * pxPerMm);
            ctx.lineTo(tri[2].x * pxPerMm, tri[2].y * pxPerMm);
            ctx.closePath();
        }
        ctx.clip();

        const partDrawSize = (part.islandMmPerUV || this.uvSheetSizeMm || 210.0) * pxPerMm;
        ctx.drawImage(
            canvas2d,
            -part.centerU * partDrawSize,
            -(1 - part.centerV) * partDrawSize,
            partDrawSize,
            partDrawSize
        );

        if (bleedPx > 0) {
            this.applyTextureBleed(canvas, bleedPx);
        }

        canvas._bleedMm = bleedMm;
        canvas._pxPerMm = pxPerMm;
        canvas._padMm = padPx / pxPerMm;
        canvas._originMinX = minX;
        canvas._originMinY = minY;

        part._bleedCanvas = canvas;
        return canvas;
    }

    /**
     * Dibuja una pieza de papercraft individual con su textura, pliegues, solapas y cotas
     */
    drawPartOnCanvas(ctx, part, canvas2d, pageX_px, pageY_px, mmToPx, isSelectedOverlay = false) {
        const originPxX = pageX_px + part.layout.x * mmToPx;
        const originPxY = pageY_px + part.layout.y * mmToPx;
        const rotRad = (part.layout.rotation * Math.PI) / 180;
        const flipX = part.layout.flipX ? -1 : 1;
        const flipY = part.layout.flipY ? -1 : 1;

        ctx.save();
        ctx.translate(originPxX, originPxY);
        ctx.rotate(rotRad);
        if (flipX !== 1 || flipY !== 1) {
            ctx.scale(flipX, flipY);
        }

        // A) Recorte y textura de la pieza en la mesa de trabajo A4 (renderizado instantáneo GPU)
        if (canvas2d && part.localTriangles && part.localTriangles.length > 0) {
            try {
                ctx.save();
                ctx.beginPath();
                for (const tri of part.localTriangles) {
                    if (!tri || tri.length < 3) continue;
                    ctx.moveTo(tri[0].x * mmToPx, tri[0].y * mmToPx);
                    ctx.lineTo(tri[1].x * mmToPx, tri[1].y * mmToPx);
                    ctx.lineTo(tri[2].x * mmToPx, tri[2].y * mmToPx);
                }
                ctx.closePath();
                ctx.clip();

                const partDrawSize = (part.islandMmPerUV || this.uvSheetSizeMm || 210.0) * mmToPx;
                ctx.drawImage(
                    canvas2d,
                    -part.centerU * partDrawSize,
                    -(1 - part.centerV) * partDrawSize,
                    partDrawSize,
                    partDrawSize
                );
                ctx.restore();
            } catch (drawErr) {
                console.warn('Error dibujando textura de pieza en canvas:', drawErr);
            }
        }

        // B) Líneas de pliegue interiores
        const lineMode = this.lineMode || (window.state && window.state.uvWireframeMode) || 'clean';
        const showInternalFolds = (lineMode !== 'outlines' && lineMode !== 'none');
        if (lineMode === 'full' && part.localTriangles && part.localTriangles.length > 0) {
            ctx.strokeStyle = this.foldLineColor || 'rgba(120, 120, 120, 0.7)';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            for (const tri of part.localTriangles) {
                if (!tri || tri.length < 3) continue;
                ctx.moveTo(tri[0].x * mmToPx, tri[0].y * mmToPx);
                ctx.lineTo(tri[1].x * mmToPx, tri[1].y * mmToPx);
                ctx.lineTo(tri[2].x * mmToPx, tri[2].y * mmToPx);
                ctx.lineTo(tri[0].x * mmToPx, tri[0].y * mmToPx);
            }
            ctx.stroke();
        } else if (showInternalFolds && part.internalEdges && part.internalEdges.length > 0) {
            ctx.strokeStyle = this.foldLineColor || 'rgba(120, 120, 120, 0.7)';
            ctx.lineWidth = 0.6;
            ctx.setLineDash([]);
            ctx.beginPath();
            for (const edge of part.internalEdges) {
                ctx.moveTo(edge.p1.x * mmToPx, edge.p1.y * mmToPx);
                ctx.lineTo(edge.p2.x * mmToPx, edge.p2.y * mmToPx);
            }
            ctx.stroke();
        }

        // C) Solapas (Flaps)
        const currentHoveredSeam = this.hoveredSeamNumber || (typeof window !== 'undefined' && window.papercraft && window.papercraft.hoveredSeamNumber);
        const currentHoveredJunction = this.hoveredJunctionKey || (typeof window !== 'undefined' && window.papercraft && window.papercraft.hoveredJunctionKey);

        if (this.showFlaps && part.tabs && part.tabs.length > 0) {
            for (const tab of part.tabs) {
                const isHovered = (currentHoveredJunction && tab.junctionKey === currentHoveredJunction) ||
                                  (currentHoveredSeam && tab.seamNumber === currentHoveredSeam);

                ctx.fillStyle = isHovered ? 'rgba(0, 229, 255, 0.42)' : 'rgba(235, 235, 235, 0.7)';
                ctx.beginPath();
                ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                ctx.lineTo(tab.tabP1.x * mmToPx, tab.tabP1.y * mmToPx);
                ctx.lineTo(tab.tabP2.x * mmToPx, tab.tabP2.y * mmToPx);
                ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = isHovered ? '#00e5ff' : (this.cutLineColor || '#666666');
                const flapCutMm = parseFloat(this.cutLineWidthMm || 0.10) || 0.10;
                ctx.lineWidth = isHovered ? 2.2 : Math.max(0.4, (flapCutMm / 0.10) * 0.85);
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                ctx.lineTo(tab.tabP1.x * mmToPx, tab.tabP1.y * mmToPx);
                ctx.lineTo(tab.tabP2.x * mmToPx, tab.tabP2.y * mmToPx);
                ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                ctx.stroke();

                ctx.strokeStyle = this.foldLineColor || 'rgba(120, 120, 120, 0.7)';
                ctx.lineWidth = 0.6;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                ctx.stroke();

                // Números en solapas (ocultos bajo el pegamento al ensamblar)
                if (this.showTabNumbers && this.numberPlacement !== 'none' && tab.seamNumber && (tab.baseLen || 10) >= 4.0) {
                    ctx.font = 'bold 9px sans-serif';
                    ctx.fillStyle = isHovered ? '#004d40' : '#1b5e20';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`${tab.seamNumber}`, tab.tabCenter.x * mmToPx, tab.tabCenter.y * mmToPx);
                }
            }
        }

        // D) Líneas de corte perimetrales
        ctx.strokeStyle = this.cutLineColor || '#666666';
        const cutMm = parseFloat(this.cutLineWidthMm || 0.10) || 0.10;
        ctx.lineWidth = Math.max(0.5, (cutMm / 0.10) * 1.0);
        ctx.beginPath();
        for (const cut of part.boundaryEdges) {
            ctx.moveTo(cut.p1.x * mmToPx, cut.p1.y * mmToPx);
            ctx.lineTo(cut.p2.x * mmToPx, cut.p2.y * mmToPx);
        }
        ctx.stroke();

        // Resaltar arista receptora gemela cuando su costura o unión completa está en hover
        if (currentHoveredJunction || currentHoveredSeam) {
            for (const cut of part.boundaryEdges) {
                const isHoverMatch = (currentHoveredJunction && cut.junctionKey === currentHoveredJunction) ||
                                      (currentHoveredSeam && cut.seamNumber === currentHoveredSeam);
                if (isHoverMatch && !cut.hasTab) {
                    ctx.save();
                    ctx.strokeStyle = '#00e5ff';
                    ctx.lineWidth = 2.4;
                    ctx.setLineDash([4, 3]);
                    ctx.beginPath();
                    ctx.moveTo(cut.p1.x * mmToPx, cut.p1.y * mmToPx);
                    ctx.lineTo(cut.p2.x * mmToPx, cut.p2.y * mmToPx);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        // Números solo si se eligen expresamente fuera de las piezas en la zona de descarte (NUNCA sobre el modelo)
        if (this.showTabNumbers && this.numberPlacement === 'outside') {
            for (const cut of part.boundaryEdges) {
                if (cut.isTarget && cut.seamNumber && (cut.len || 10) >= 4.0) {
                    const midX = cut.mid ? cut.mid.x : (cut.p1.x + cut.p2.x) * 0.5;
                    const midY = cut.mid ? cut.mid.y : (cut.p1.y + cut.p2.y) * 0.5;
                    const nx = cut.nx || 0;
                    const ny = cut.ny || 0;
                    const distMm = 2.5;
                    const ox = (midX + nx * distMm) * mmToPx;
                    const oy = (midY + ny * distMm) * mmToPx;
                    ctx.save();
                    ctx.font = 'bold 8px sans-serif';
                    ctx.fillStyle = '#b71c1c';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`[${cut.seamNumber}]`, ox, oy);
                    ctx.restore();
                }
            }
        }

        // E) Selección / Cotas CAD
        if (isSelectedOverlay || this.selectedPart === part) {
            const b = part.bounds;
            const bx = b.minX * mmToPx - 4;
            const by = b.minY * mmToPx - 4;
            const bw = part.wMm * mmToPx + 8;
            const bh = part.hMm * mmToPx + 8;

            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 2]);
            ctx.strokeRect(bx, by, bw, bh);
            ctx.setLineDash([]);

            const dimOffsetY = 14;
            const lineY = by + bh + dimOffsetY;
            ctx.strokeStyle = '#00e5ff';
            ctx.fillStyle = '#00e5ff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(bx, lineY);
            ctx.lineTo(bx + bw, lineY);
            ctx.moveTo(bx, lineY - 3); ctx.lineTo(bx, lineY + 3);
            ctx.moveTo(bx + bw, lineY - 3); ctx.lineTo(bx + bw, lineY + 3);
            ctx.stroke();

            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`↔ ${part.wMm.toFixed(1)} mm`, bx + bw / 2, lineY + 3);

            const dimOffsetX = 14;
            const lineX = bx + bw + dimOffsetX;
            ctx.beginPath();
            ctx.moveTo(lineX, by);
            ctx.lineTo(lineX, by + bh);
            ctx.moveTo(lineX - 3, by); ctx.lineTo(lineX + 3, by);
            ctx.moveTo(lineX - 3, by + bh); ctx.lineTo(lineX + 3, by + bh);
            ctx.stroke();

            ctx.save();
            ctx.translate(lineX + 4, by + bh / 2);
            ctx.rotate(Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`↕ ${part.hMm.toFixed(1)} mm`, 0, 0);
            ctx.restore();

            const badgeText = `📐 Pieza #${part.id + 1}: ${part.wMm.toFixed(1)} × ${part.hMm.toFixed(1)} mm  (Hoja ${part.layout.pageIndex + 1})`;
            ctx.font = 'bold 11px sans-serif';
            const textMetrics = ctx.measureText(badgeText);
            const badgeW = textMetrics.width + 16;
            const badgeH = 20;
            const badgeX = bx + bw / 2 - badgeW / 2;
            const badgeY = by - badgeH - 8;

            ctx.fillStyle = 'rgba(10, 25, 35, 0.92)';
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            } else {
                ctx.rect(badgeX, badgeY, badgeW, badgeH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#00f3ff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(badgeText, bx + bw / 2, badgeY + badgeH / 2);
        } else if (this.hoveredPart === part) {
            // Fase 3: Resalte visual de pieza bajo Hover (Rastreo Inteligente 3D <-> 2D)
            const b = part.bounds;
            const bx = b.minX * mmToPx - 4;
            const by = b.minY * mmToPx - 4;
            const bw = part.wMm * mmToPx + 8;
            const bh = part.hMm * mmToPx + 8;

            ctx.save();
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 2.0;
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 10;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(bx, by, bw, bh);
            ctx.restore();

            const hoverBadge = `🧩 Pieza #${part.id + 1} (Hoja ${(part.layout?.pageIndex || 0) + 1})`;
            ctx.save();
            ctx.font = 'bold 10px sans-serif';
            const badgeW = ctx.measureText(hoverBadge).width + 14;
            const badgeH = 18;
            const badgeX = bx + bw / 2 - badgeW / 2;
            const badgeY = by - badgeH - 6;

            ctx.fillStyle = 'rgba(0, 229, 255, 0.92)';
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
            } else {
                ctx.rect(badgeX, badgeY, badgeW, badgeH);
            }
            ctx.fill();

            ctx.fillStyle = '#0a192f';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(hoverBadge, badgeX + badgeW / 2, badgeY + badgeH / 2);
            ctx.restore();
        }

        ctx.restore();
    }

    drawRulerOnCanvas(ctx, x, y, mmToPx) {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 50 * mmToPx, y);
        for (let i = 0; i <= 50; i++) {
            const h = (i % 10 === 0) ? 8 : (i % 5 === 0 ? 5 : 2.5);
            ctx.moveTo(x + i * mmToPx, y);
            ctx.lineTo(x + i * mmToPx, y - h);
        }
        ctx.stroke();
        ctx.font = '8px sans-serif';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.fillText('0', x, y + 10);
        ctx.fillText('50 mm (Regla 1:1)', x + 25 * mmToPx, y + 10);
        ctx.fillText('50', x + 50 * mmToPx, y + 10);
        ctx.restore();
    }

    setModelLength(lengthMm) {
        this.modelLengthMm = Math.max(0.1, Math.min(5000, Number(lengthMm) || 0.1));
        if (this.baseModelLengthMm && this.baseModelLengthMm > 0) {
            this.scalePct = Math.round((this.modelLengthMm / this.baseModelLengthMm) * 1000) / 10;
        }
        if (this.mesh) {
            this.analyzeMesh(this.mesh, this.texSize);
        }
    }

    /**
     * Exporta el PDF Multi-página en A4 1:1 con todas las hojas organizadas
     */
    exportA4PDF(canvas2d, filename = 'Neo_Papercraft_A4_1-1.pdf') {
        const jsPDFClass = window.jspdf?.jsPDF || window.jsPDF;
        if (!jsPDFClass) {
            alert('Error: Librería jsPDF no disponible.');
            return;
        }

        const doc = new jsPDFClass({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const margin = this.A4_MARGIN;

        for (let p = 0; p < this.pagesCount; p++) {
            if (p > 0) doc.addPage('a4', 'portrait');
            this.renderPageToPDF(doc, p, canvas2d);
        }

        this.showPdfPreviewModal(doc, filename);
    }

    /**
     * Renderiza una página individual a un documento jsPDF existente con cartela técnica, reglas y vectorizado
     */
    renderPageToPDF(doc, p, canvas2d, pageInfo = {}) {
        const margin = this.A4_MARGIN;

        const pieceTag = pageInfo.pieceName ? ` • ${pageInfo.pieceName.toUpperCase()}` : '';
        const globalTag = pageInfo.globalPageIndex !== undefined 
            ? ` • (ÁLBUM: PÁGINA ${pageInfo.globalPageIndex} DE ${pageInfo.totalGlobalPages})` 
            : '';

        // Cartela técnica y regla en cada página (se omite si la hoja ya fue iniciada por otra pieza)
        if (!pageInfo.skipHeader) {
            doc.saveGraphicsState();
            doc.setDrawColor(0, 120, 215);
            doc.setLineWidth(0.3);
            doc.rect(margin, margin, this.A4_W - margin * 2, this.A4_H - margin * 2);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(0, 120, 215);
            doc.text(`NEO SUBSTANCE PAINTER${pieceTag} • HOJA ${p + 1} DE ${this.pagesCount}${globalTag}`, margin + 60, margin + 6);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(80, 80, 80);
            doc.text(`Escala: ${this.currentScale} • Longitud: ${this.modelLengthMm} mm • Envergadura: ${this.wingspanMm} mm`, margin + 60, margin + 10);

            // Regla de 50 mm
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.2);
            doc.line(margin + 4, 15, margin + 54, 15);
            for (let i = 0; i <= 50; i++) {
                const h = (i % 10 === 0) ? 3.5 : (i % 5 === 0 ? 2.5 : 1.2);
                doc.line(margin + 4 + i, 15, margin + 4 + i, 15 - h);
            }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(5);
            doc.text('0', margin + 4, 18, { align: 'center' });
            doc.text('50 mm', margin + 54, 18, { align: 'center' });
            doc.restoreGraphicsState();
        }

        // Renderizar cada pieza de esta página
        for (const part of this.parts) {
            if (part.layout.pageIndex !== p) continue;

            const originX = part.layout.x;
            const originY = part.layout.y;
            const rotDeg = part.layout.rotation;
            const rotRad = (rotDeg * Math.PI) / 180;
            const flipX = part.layout.flipX ? -1 : 1;
            const flipY = part.layout.flipY ? -1 : 1;

            const toPageMm = (pt) => {
                const px = pt.x * flipX;
                const py = pt.y * flipY;
                const rx = px * Math.cos(rotRad) - py * Math.sin(rotRad);
                const ry = px * Math.sin(rotRad) + py * Math.cos(rotRad);
                return { x: originX + rx, y: originY + ry };
            };
            const toPageDir = (dir) => {
                const px = dir.x * flipX;
                const py = dir.y * flipY;
                const rx = px * Math.cos(rotRad) - py * Math.sin(rotRad);
                const ry = px * Math.sin(rotRad) + py * Math.cos(rotRad);
                return { x: rx, y: ry };
            };

            // A) Textura raster de la pieza con Sangrado Perimetral (Texture Bleed)
            if (canvas2d && part.localTriangles && part.localTriangles.length > 0) {
                try {
                    const bleedMm = (typeof this.bleedMm === 'number') ? this.bleedMm : 1.5;
                    const pxPerMm = (this.pixelsPerMm && this.pixelsPerMm > 0) ? this.pixelsPerMm : 10.0;
                    const bleedPx = Math.round(bleedMm * pxPerMm);
                    const padPx = bleedPx + 4;
                    const cosR = Math.cos(rotRad);
                    const sinR = Math.sin(rotRad);

                    // Bounding box rotado exacto de los triángulos de la pieza
                    let minRx = Infinity, maxRx = -Infinity;
                    let minRy = Infinity, maxRy = -Infinity;
                    for (const tri of part.localTriangles) {
                        if (!tri || tri.length < 3) continue;
                        for (const pt of tri) {
                            const px = pt.x * flipX;
                            const py = pt.y * flipY;
                            const rx = px * cosR - py * sinR;
                            const ry = px * sinR + py * cosR;
                            minRx = Math.min(minRx, rx); maxRx = Math.max(maxRx, rx);
                            minRy = Math.min(minRy, ry); maxRy = Math.max(maxRy, ry);
                        }
                    }

                    if (isFinite(minRx) && isFinite(maxRx) && isFinite(minRy) && isFinite(maxRy)) {
                        const bW_px = Math.max(16, Math.ceil((maxRx - minRx) * pxPerMm) + padPx * 2);
                        const bH_px = Math.max(16, Math.ceil((maxRy - minRy) * pxPerMm) + padPx * 2);
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = bW_px;
                        tempCanvas.height = bH_px;
                        const tCtx = tempCanvas.getContext('2d');
                        tCtx.imageSmoothingEnabled = true;
                        tCtx.imageSmoothingQuality = 'high';

                        // Situar origen y rotar directamente dentro del canvas antes de dibujar
                        tCtx.translate(-minRx * pxPerMm + padPx, -minRy * pxPerMm + padPx);
                        tCtx.rotate(rotRad);
                        if (flipX !== 1 || flipY !== 1) {
                            tCtx.scale(flipX, flipY);
                        }

                        // Recorte vectorial de triángulos
                        tCtx.beginPath();
                        for (const tri of part.localTriangles) {
                            if (!tri || tri.length < 3) continue;
                            tCtx.moveTo(tri[0].x * pxPerMm, tri[0].y * pxPerMm);
                            tCtx.lineTo(tri[1].x * pxPerMm, tri[1].y * pxPerMm);
                            tCtx.lineTo(tri[2].x * pxPerMm, tri[2].y * pxPerMm);
                        }
                        tCtx.clip();

                        const partDrawSize = (part.islandMmPerUV || this.uvSheetSizeMm || 210.0) * pxPerMm;

                        tCtx.drawImage(
                            canvas2d,
                            -part.centerU * partDrawSize,
                            -(1 - part.centerV) * partDrawSize,
                            partDrawSize,
                            partDrawSize
                        );

                        // Aplicar dilatación perimetral (Sangrado de corte 1 a 2 mm para Acabado de Museo)
                        if (bleedPx > 0) {
                            this.applyTextureBleed(tempCanvas, bleedPx);
                        }

                        const partImgData = tempCanvas.toDataURL('image/png', 0.95);
                        const drawW_mm = bW_px / pxPerMm;
                        const drawH_mm = bH_px / pxPerMm;
                        const drawX_mm = originX + minRx - padPx / pxPerMm;
                        const drawY_mm = originY + minRy - padPx / pxPerMm;

                        if (isFinite(drawX_mm) && isFinite(drawY_mm) && isFinite(drawW_mm) && isFinite(drawH_mm) && drawW_mm > 0 && drawH_mm > 0) {
                            doc.addImage(
                                partImgData,
                                'PNG',
                                drawX_mm,
                                drawY_mm,
                                drawW_mm,
                                drawH_mm,
                                undefined,
                                'FAST',
                                0
                            );
                        }
                    }
                } catch (texErr) {
                    console.warn('Error rasterizando textura de pieza para PDF:', texErr);
                }
            }

            // B) Pliegues vivos interiores
            const lineMode = this.lineMode || (window.state && window.state.uvWireframeMode) || 'clean';
            const showInternalFolds = (lineMode !== 'outlines' && lineMode !== 'none');
            if (lineMode === 'full' && part.localTriangles && part.localTriangles.length > 0) {
                doc.setDrawColor(120, 120, 120);
                doc.setLineWidth(0.08);
                doc.setLineDash([], 0);
                for (const tri of part.localTriangles) {
                    if (!tri || tri.length < 3) continue;
                    const p1 = toPageMm(tri[0]);
                    const p2 = toPageMm(tri[1]);
                    const p3 = toPageMm(tri[2]);
                    doc.line(p1.x, p1.y, p2.x, p2.y);
                    doc.line(p2.x, p2.y, p3.x, p3.y);
                    doc.line(p3.x, p3.y, p1.x, p1.y);
                }
            } else if (showInternalFolds && part.internalEdges && part.internalEdges.length > 0) {
                doc.setDrawColor(80, 80, 80);
                doc.setLineWidth(0.12);
                doc.setLineDash([], 0);
                for (const edge of part.internalEdges) {
                    const pA = toPageMm(edge.p1);
                    const pB = toPageMm(edge.p2);
                    doc.line(pA.x, pA.y, pB.x, pB.y);
                }
            }

            const hex = this.cutLineColor || '#666666';
            const r = parseInt(hex.slice(1, 3), 16) || 100;
            const g = parseInt(hex.slice(3, 5), 16) || 100;
            const b = parseInt(hex.slice(5, 7), 16) || 100;

            // C) Solapas vectoriales
            if (this.showFlaps && part.tabs && part.tabs.length > 0) {
                for (const tab of part.tabs) {
                    const b1 = toPageMm(tab.baseP1);
                    const t1 = toPageMm(tab.tabP1);
                    const t2 = toPageMm(tab.tabP2);
                    const b2 = toPageMm(tab.baseP2);
                    const tc = toPageMm(tab.tabCenter);

                    doc.setDrawColor(r, g, b);
                    doc.setLineWidth(parseFloat(this.cutLineWidthMm || 0.10) || 0.10);
                    doc.setLineDash([], 0);
                    doc.line(b1.x, b1.y, t1.x, t1.y);
                    doc.line(t1.x, t1.y, t2.x, t2.y);
                    doc.line(t2.x, t2.y, b2.x, b2.y);

                    doc.setDrawColor(140, 140, 140);
                    doc.setLineWidth(this.foldLineWidthMm || 0.08);
                    doc.setLineDash([], 0);
                    doc.line(b1.x, b1.y, b2.x, b2.y);

                    if (this.showTabNumbers && this.numberPlacement !== 'none' && tab.seamNumber && (tab.baseLen || 10) >= 4.0) {
                        doc.setFont('helvetica', 'bold');
                        doc.setFontSize(6);
                        doc.setTextColor(27, 94, 32);
                        doc.text(`${tab.seamNumber}`, tc.x, tc.y, { align: 'center', baseline: 'middle' });
                    }
                }
            }

            // D) Cortes exteriores (Hairline ultra-fino y tono tenue profesional)
            doc.setDrawColor(r, g, b);
            doc.setLineWidth(parseFloat(this.cutLineWidthMm || 0.10) || 0.10);
            doc.setLineDash([], 0);
            for (const cut of part.boundaryEdges) {
                const pA = toPageMm(cut.p1);
                const pB = toPageMm(cut.p2);
                doc.line(pA.x, pA.y, pB.x, pB.y);

                if (this.showTabNumbers && this.numberPlacement === 'outside' && cut.isTarget && cut.seamNumber && (cut.len || 10) >= 4.0) {
                    const midLocal = cut.mid || { x: (cut.p1.x + cut.p2.x) * 0.5, y: (cut.p1.y + cut.p2.y) * 0.5 };
                    const nx = cut.nx || 0;
                    const ny = cut.ny || 0;
                    const midPage = toPageMm(midLocal);
                    const normPage = toPageDir({ x: nx, y: ny });
                    const distMm = 2.5;
                    const ox = midPage.x + normPage.x * distMm;
                    const oy = midPage.y + normPage.y * distMm;

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(5.5);
                    doc.setTextColor(183, 28, 28);
                    doc.text(`[${cut.seamNumber}]`, ox, oy, { align: 'center', baseline: 'middle' });
                }
            }
        } // Fin de for (const part of this.parts)

        // E) Renderizar Anotaciones e Indicadores Vectoriales en el PDF
        this.renderAnnotationsToPDF(doc, p);

        if (!pageInfo.skipHeader) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(100, 100, 100);
            doc.text(
                `NEO SUBSTANCE PAINTER • PLANTILLA 1:1 (A4) • HOJA ${p + 1} DE ${this.pagesCount}${globalTag} • MARGEN: 5mm • NO REESCALAR (100%)`,
                this.A4_W / 2,
                this.A4_H - 4,
                { align: 'center' }
            );
        }
    } // Fin de renderPageToPDF

    /**
     * Renderiza vectorialmente las anotaciones de la página p al documento jsPDF
     */
    renderAnnotationsToPDF(doc, p) {
        let allAnns = Array.isArray(this.annotations) ? [...this.annotations] : [];
        if (typeof window !== 'undefined' && window.papercraft && window.papercraft !== this && Array.isArray(window.papercraft.annotations)) {
            for (const a of window.papercraft.annotations) {
                if (!allAnns.some(existing => existing.id === a.id)) {
                    allAnns.push(a);
                }
            }
        }
        if (allAnns.length === 0) return;
        const pageAnnotations = allAnns.filter(a => (a.pageIndex || 0) === p);
        if (pageAnnotations.length === 0) return;

        const hexToRgb = (hex) => {
            if (!hex) return { r: 211, g: 47, b: 47 };
            let c = hex.replace('#', '');
            if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
            const num = parseInt(c, 16);
            return {
                r: (num >> 16) & 255,
                g: (num >> 8) & 255,
                b: num & 255
            };
        };

        for (const ann of pageAnnotations) {
            try {
                doc.saveGraphicsState();
                const rgb = hexToRgb(ann.color || '#d32f2f');

                if (ann.type === 'text') {
                    doc.setFont('helvetica', 'bold');
                    const fontPt = ann.fontSize || 9;
                    doc.setFontSize(fontPt);
                    doc.setTextColor(rgb.r, rgb.g, rgb.b);

                    const txt = ann.text || 'Nota';
                    const fontHeightMm = fontPt * 0.3528;
                    const textWidth = doc.getTextWidth(txt);

                    // Si no está rotado, dibujar fondo blanco de protección
                    if (!ann.rotation) {
                        doc.setFillColor(255, 255, 255);
                        doc.setDrawColor(rgb.r, rgb.g, rgb.b);
                        doc.setLineWidth(0.2);
                        if (typeof doc.roundedRect === 'function') {
                            doc.roundedRect(ann.x - 1, ann.y - fontHeightMm - 0.5, textWidth + 2, fontHeightMm + 2, 0.5, 0.5, 'FD');
                        } else {
                            doc.rect(ann.x - 1, ann.y - fontHeightMm - 0.5, textWidth + 2, fontHeightMm + 2, 'FD');
                        }
                    }

                    const textOptions = {};
                    if (ann.rotation) {
                        textOptions.angle = ann.rotation;
                    }
                    doc.text(txt, ann.x, ann.y, textOptions);

                } else if (ann.type === 'arrow') {
                    doc.setDrawColor(rgb.r, rgb.g, rgb.b);
                    doc.setFillColor(rgb.r, rgb.g, rgb.b);
                    doc.setLineWidth(ann.lineWidthMm || 0.35);
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
                    else if (typeof doc.setLineDash === 'function') doc.setLineDash([], 0);

                    const endX = (ann.endX !== undefined ? ann.endX : ann.x + 20);
                    const endY = (ann.endY !== undefined ? ann.endY : ann.y + 20);

                    doc.line(ann.x, ann.y, endX, endY);

                    // Punta triangular de la flecha
                    const angle = Math.atan2(endY - ann.y, endX - ann.x);
                    const headLenMm = 3.0;
                    const p1X = endX - headLenMm * Math.cos(angle - Math.PI / 6);
                    const p1Y = endY - headLenMm * Math.sin(angle - Math.PI / 6);
                    const p2X = endX - headLenMm * Math.cos(angle + Math.PI / 6);
                    const p2Y = endY - headLenMm * Math.sin(angle + Math.PI / 6);

                    if (typeof doc.triangle === 'function') {
                        doc.triangle(endX, endY, p1X, p1Y, p2X, p2Y, 'FD');
                    } else {
                        doc.line(endX, endY, p1X, p1Y);
                        doc.line(p1X, p1Y, p2X, p2Y);
                        doc.line(p2X, p2Y, endX, endY);
                    }

                    if (ann.text) {
                        doc.setFont('helvetica', 'bold');
                        doc.setFontSize(ann.fontSize || 7.5);
                        doc.setTextColor(rgb.r, rgb.g, rgb.b);
                        const midX = (ann.x + endX) / 2;
                        const midY = (ann.y + endY) / 2;
                        doc.text(ann.text, midX, midY - 1, { align: 'center' });
                    }

                } else if (ann.type === 'badge') {
                    const rMm = 3.2; // ~6.4 mm diámetro
                    doc.setDrawColor(rgb.r, rgb.g, rgb.b);
                    doc.setFillColor(255, 255, 255);
                    doc.setLineWidth(0.4);
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
                    else if (typeof doc.setLineDash === 'function') doc.setLineDash([], 0);

                    doc.circle(ann.x, ann.y, rMm, 'FD');

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(ann.fontSize || 8);
                    doc.setTextColor(rgb.r, rgb.g, rgb.b);
                    const badgeStr = String(ann.text || ann.badgeNumber || 1);
                    doc.text(badgeStr, ann.x, ann.y + 0.9, { align: 'center', baseline: 'middle' });

                } else if (ann.type === 'cut') {
                    const rad = ((ann.rotation || 0) * Math.PI) / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    const rX = (lx, ly) => ann.x + lx * cos - ly * sin;
                    const rY = (lx, ly) => ann.y + lx * sin + ly * cos;

                    // 1. Línea discontinua de corte desde punta de tijera (6.6mm a 26mm)
                    doc.setDrawColor(rgb.r, rgb.g, rgb.b);
                    doc.setLineWidth(0.25);
                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([1.8, 1.2], 0);
                    else if (typeof doc.setLineDash === 'function') doc.setLineDash([1.8, 1.2], 0);

                    doc.line(rX(6.6, 0), rY(6.6, 0), rX(26.0, 0), rY(26.0, 0));

                    if (typeof doc.setLineDashPattern === 'function') doc.setLineDashPattern([], 0);
                    else if (typeof doc.setLineDash === 'function') doc.setLineDash([], 0);

                    // 2. Tijera Vectorial ✂ en jsPDF (100% nativa sin fuentes de texto)
                    doc.setDrawColor(30, 30, 30);
                    doc.setFillColor(30, 30, 30);
                    doc.setLineWidth(0.35);

                    // Aros de agarre
                    doc.circle(rX(0.7, -1.6), rY(0.7, -1.6), 1.15, 'D');
                    doc.circle(rX(0.7, 1.6), rY(0.7, 1.6), 1.15, 'D');

                    // Hojas cruzadas
                    doc.line(rX(0.7, 1.6), rY(0.7, 1.6), rX(6.4, -1.3), rY(6.4, -1.3));
                    doc.line(rX(0.7, -1.6), rY(0.7, -1.6), rX(6.4, 1.3), rY(6.4, 1.3));

                    // Remache central
                    doc.circle(rX(2.4, 0), rY(2.4, 0), 0.45, 'F');

                } else if (ann.type === 'glue') {
                    const badgeSize = 8.0;
                    const half = badgeSize / 2;

                    // 1. Placa / badge redondeada (amarillo suave con borde ámbar)
                    doc.setDrawColor(230, 130, 0);
                    doc.setFillColor(255, 250, 205);
                    doc.setLineWidth(0.3);
                    if (typeof doc.roundedRect === 'function') {
                        doc.roundedRect(ann.x - half, ann.y - half, badgeSize, badgeSize, 1.8, 1.8, 'FD');
                    } else {
                        doc.rect(ann.x - half, ann.y - half, badgeSize, badgeSize, 'FD');
                    }

                    // 2. Gota Vectorial 💧 de pegamento (100% nativa sin fuentes de texto)
                    const dropRgb = hexToRgb(ann.color || '#0288d1');
                    doc.setFillColor(dropRgb.r, dropRgb.g, dropRgb.b);
                    doc.setDrawColor(dropRgb.r, dropRgb.g, dropRgb.b);

                    const cy = ann.y + 0.25;
                    // Vientre redondeado inferior
                    doc.circle(ann.x, cy + 0.4, 1.45, 'F');
                    // Punta cónica superior
                    doc.triangle(ann.x, cy - 2.4, ann.x - 1.4, cy + 0.35, ann.x + 1.4, cy + 0.35, 'F');

                    // Reflejo blanco de brillo
                    doc.setFillColor(255, 255, 255);
                    doc.circle(ann.x - 0.5, cy - 0.25, 0.42, 'F');
                }

                doc.restoreGraphicsState();
            } catch (errAnn) {
                console.warn('Error renderizando anotación a PDF:', errAnn);
            }
        }
    }

    showPdfPreviewModal(doc, filename, totalPages = null) {
        const blob = doc.output('blob');
        const blobUrl = URL.createObjectURL(blob);

        let modal = document.getElementById('modal-pdf-preview');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-pdf-preview';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-card" style="width: 88vw; max-width: 1100px; height: 90vh; max-height: 90vh; display: flex; flex-direction: column; padding: 16px; background: #222; border: 1px solid #444; border-radius: 8px; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444; padding-bottom: 10px; margin-bottom: 10px;">
                        <div>
                            <h3 style="margin: 0; font-size: 16px; color: #fff;">📄 Previsualización Papercraft A4 (1:1)</h3>
                            <div id="pdf-preview-filename" style="font-size: 11px; color: #00bcd4; margin-top: 2px;"></div>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button id="btn-pdf-preview-open" class="ribbon-btn" style="background-color: #0288d1; min-width: 100px; cursor: pointer;" title="Abrir en pestaña nueva para imprimir a tamaño 100%">🖨️ Imprimir</button>
                            <button id="btn-pdf-preview-download" class="ribbon-btn" style="background-color: #2e7d32; min-width: 110px; cursor: pointer;" title="Descargar PDF a tu computadora">📥 Guardar PDF</button>
                            <button id="btn-pdf-preview-close" class="ribbon-btn" style="background-color: #d32f2f; min-width: 70px; cursor: pointer;" title="Cerrar ventana">✕ Cerrar</button>
                        </div>
                    </div>
                    <div style="flex: 1; width: 100%; background: #525659; border-radius: 4px; overflow: hidden; border: 1px solid #333;">
                        <iframe id="pdf-preview-iframe" style="width: 100%; height: 100%; border: none;"></iframe>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('btn-pdf-preview-close').addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }

        const pagesText = totalPages ? `${totalPages} Páginas` : `${this.pagesCount} Hojas A4 (1:1)`;
        document.getElementById('pdf-preview-filename').textContent = `Archivo: ${filename} • ${pagesText} • Modelo: ${Math.round(this.modelLengthMm)} mm`;
        document.getElementById('pdf-preview-iframe').src = blobUrl;

        const btnDownload = document.getElementById('btn-pdf-preview-download');
        const btnOpen = document.getElementById('btn-pdf-preview-open');

        const newDownload = btnDownload.cloneNode(true);
        btnDownload.parentNode.replaceChild(newDownload, btnDownload);
        newDownload.addEventListener('click', () => doc.save(filename));

        const newOpen = btnOpen.cloneNode(true);
        btnOpen.parentNode.replaceChild(newOpen, btnOpen);
        newOpen.addEventListener('click', () => window.open(blobUrl, '_blank'));

        modal.classList.remove('hidden');
    }

    /**
     * Comprueba si la malla 3D tiene islas UV que se superponen entre sí en el espacio de textura [0, 1].
     */
    checkMeshUVOverlaps(mesh = this.mesh) {
        if (!mesh) return false;
        const targetMeshes = [];
        mesh.traverse(child => {
            if (child.isMesh && !child.userData?.isSelectionOverlay && !child.userData?.isHelper && child.geometry && child.geometry.attributes.position && child.geometry.attributes.uv) {
                targetMeshes.push(child);
            }
        });
        if (targetMeshes.length === 0) return false;

        const allBoxes = [];

        for (const child of targetMeshes) {
            const geo = child.geometry;
            const uvAttr = geo.attributes.uv;
            const posAttr = geo.attributes.position;
            const index = geo.index;

            const uvs = [];
            for (let i = 0; i < uvAttr.count; i++) {
                uvs.push([uvAttr.getX(i), uvAttr.getY(i)]);
            }

            const faces = [];
            if (index) {
                for (let i = 0; i < index.count; i += 3) {
                    faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
                }
            } else {
                for (let i = 0; i < posAttr.count; i += 3) {
                    faces.push([i, i + 1, i + 2]);
                }
            }

            function hashUV(uv) { return `${Math.round(uv[0] * 10000)},${Math.round(uv[1] * 10000)}`; }

            const edgeToFaces = new Map();
            faces.forEach((f, fIdx) => {
                for (let i = 0; i < 3; i++) {
                    const next = (i + 1) % 3;
                    const k1 = hashUV(uvs[f[i]]);
                    const k2 = hashUV(uvs[f[next]]);
                    const edgeKey = [k1, k2].sort().join('--');
                    if (!edgeToFaces.has(edgeKey)) edgeToFaces.set(edgeKey, []);
                    edgeToFaces.get(edgeKey).push(fIdx);
                }
            });

            const adj = faces.map(() => []);
            for (const fList of edgeToFaces.values()) {
                if (fList.length === 2) {
                    adj[fList[0]].push(fList[1]);
                    adj[fList[1]].push(fList[0]);
                }
            }

            const visited = new Set();
            for (let i = 0; i < faces.length; i++) {
                if (!visited.has(i)) {
                    const comp = [];
                    const q = [i];
                    visited.add(i);
                    while (q.length > 0) {
                        const cur = q.pop();
                        comp.push(cur);
                        for (let n of adj[cur]) {
                            if (!visited.has(n)) {
                                visited.add(n);
                                q.push(n);
                            }
                        }
                    }

                    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
                    comp.forEach(fIdx => {
                        for (let v of faces[fIdx]) {
                            minU = Math.min(minU, uvs[v][0]); maxU = Math.max(maxU, uvs[v][0]);
                            minV = Math.min(minV, uvs[v][1]); maxV = Math.max(maxV, uvs[v][1]);
                        }
                    });
                    allBoxes.push({ minU, maxU, minV, maxV });
                }
            }
        }

        if (allBoxes.length <= 1) return false;

        // Comprobar si dos islas cualesquiera (del mismo objeto o entre objetos distintos) se superponen
        for (let a = 0; a < allBoxes.length; a++) {
            for (let b = a + 1; b < allBoxes.length; b++) {
                const b1 = allBoxes[a];
                const b2 = allBoxes[b];
                const overlapX = Math.max(0, Math.min(b1.maxU, b2.maxU) - Math.max(b1.minU, b2.minU));
                const overlapY = Math.max(0, Math.min(b1.maxV, b2.maxV) - Math.max(b1.minV, b2.minV));
                if (overlapX > 0.005 && overlapY > 0.005) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Auto-empaqueta y separa todas las islas UV de la malla en el espacio [0, 1] sin superposición,
     * coordinando de forma unificada todos los objetos/partes que comparten la misma textura.
     */
    packMeshUVs(mesh = this.mesh, margin = 0.02) {
        if (!mesh) return { success: false, reason: 'no mesh' };

        const targetMeshes = [];
        mesh.traverse(child => {
            if (child.isMesh && !child.userData?.isSelectionOverlay && !child.userData?.isHelper && child.geometry && child.geometry.attributes.position && child.geometry.attributes.uv) {
                targetMeshes.push(child);
            }
        });
        if (targetMeshes.length === 0) return { success: false, reason: 'no meshes' };

        const allIslands = [];

        for (const child of targetMeshes) {
            const geo = child.geometry;
            const uvAttr = geo.attributes.uv;
            const posAttr = geo.attributes.position;
            const index = geo.index;

            // Guardar coordenadas originales para permitir deshacer
            if (!child.userData._originalUVs) {
                child.userData._originalUVs = new Float32Array(uvAttr.array);
            }

            const uvs = [];
            for (let i = 0; i < uvAttr.count; i++) {
                uvs.push([uvAttr.getX(i), uvAttr.getY(i)]);
            }

            const faces = [];
            if (index) {
                for (let i = 0; i < index.count; i += 3) {
                    faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
                }
            } else {
                for (let i = 0; i < posAttr.count; i += 3) {
                    faces.push([i, i + 1, i + 2]);
                }
            }

            function hashUV(uv) { return `${Math.round(uv[0] * 10000)},${Math.round(uv[1] * 10000)}`; }

            const edgeToFaces = new Map();
            faces.forEach((f, fIdx) => {
                for (let i = 0; i < 3; i++) {
                    const next = (i + 1) % 3;
                    const k1 = hashUV(uvs[f[i]]);
                    const k2 = hashUV(uvs[f[next]]);
                    const edgeKey = [k1, k2].sort().join('--');
                    if (!edgeToFaces.has(edgeKey)) edgeToFaces.set(edgeKey, []);
                    edgeToFaces.get(edgeKey).push(fIdx);
                }
            });

            const adj = faces.map(() => []);
            for (const fList of edgeToFaces.values()) {
                if (fList.length === 2) {
                    adj[fList[0]].push(fList[1]);
                    adj[fList[1]].push(fList[0]);
                }
            }

            const visited = new Set();
            for (let i = 0; i < faces.length; i++) {
                if (!visited.has(i)) {
                    const comp = [];
                    const q = [i];
                    visited.add(i);
                    while (q.length > 0) {
                        const cur = q.pop();
                        comp.push(cur);
                        for (let n of adj[cur]) {
                            if (!visited.has(n)) {
                                visited.add(n);
                                q.push(n);
                            }
                        }
                    }

                    let minU = Infinity, maxU = -Infinity;
                    let minV = Infinity, maxV = -Infinity;
                    const vertSet = new Set();
                    comp.forEach(fIdx => {
                        for (let v of faces[fIdx]) {
                            vertSet.add(v);
                            const u = uvs[v][0];
                            const vCoord = uvs[v][1];
                            minU = Math.min(minU, u); maxU = Math.max(maxU, u);
                            minV = Math.min(minV, vCoord); maxV = Math.max(maxV, vCoord);
                        }
                    });

                    allIslands.push({
                        id: allIslands.length,
                        child,
                        uvAttr,
                        uvs,
                        vertices: Array.from(vertSet),
                        minU, maxU, minV, maxV,
                        w: Math.max(0.001, maxU - minU),
                        h: Math.max(0.001, maxV - minV)
                    });
                }
            }
        }

        if (allIslands.length <= 1) return { success: false, reason: '1 or 0 islands' };

        // Shelf Bin-Packing paramétrico global en [margin, 1-margin] x [margin, 1-margin]
        let low = 0.001, high = 1.5;
        let bestPacking = null;

        function tryPack(scale) {
            const rects = allIslands.map(isl => ({
                id: isl.id,
                w: isl.w * scale + margin,
                h: isl.h * scale + margin
            }));

            // Ordenar de mayor a menor altura para empaquetado uniforme
            rects.sort((a, b) => b.h - a.h);

            let curX = margin;
            let curY = margin;
            let rowH = 0;
            const posMap = new Map();

            for (const r of rects) {
                if (curX + r.w > 1.0 - margin + 0.0001) {
                    curX = margin;
                    curY += rowH;
                    rowH = 0;
                }
                if (curY + r.h > 1.0 - margin + 0.0001) {
                    return null; // No cupo con esta escala
                }
                posMap.set(r.id, {
                    x: curX + margin * 0.5,
                    y: curY + margin * 0.5,
                    scale
                });
                curX += r.w;
                rowH = Math.max(rowH, r.h);
            }
            return posMap;
        }

        for (let iter = 0; iter < 32; iter++) {
            const mid = (low + high) / 2;
            const res = tryPack(mid);
            if (res) {
                bestPacking = res;
                low = mid;
            } else {
                high = mid;
            }
        }

        if (!bestPacking) {
            bestPacking = tryPack(low);
        }

        if (bestPacking) {
            for (const isl of allIslands) {
                const placement = bestPacking.get(isl.id);
                if (!placement) continue;
                for (const vIdx of isl.vertices) {
                    const oldU = isl.uvs[vIdx][0];
                    const oldV = isl.uvs[vIdx][1];
                    const newU = placement.x + (oldU - isl.minU) * placement.scale;
                    const newV = placement.y + (oldV - isl.minV) * placement.scale;
                    isl.uvAttr.setXY(vIdx, newU, newV);
                }
            }

            for (const child of targetMeshes) {
                child.geometry.attributes.uv.needsUpdate = true;
                if (child.userData) {
                    delete child.userData._uvEdges;
                }
            }

            mesh.traverse(c => {
                if (c.userData) delete c.userData._uvEdges;
            });

            this.analyzeMesh(mesh, this.texSize);
            return { success: true, count: allIslands.length };
        }

        return { success: false, reason: 'could not pack' };
    }
}
