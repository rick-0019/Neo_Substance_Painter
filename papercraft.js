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
        this.numberPlacement = 'none'; // 'none' (limpio), 'flaps' (solo en solapas ocultas), 'outside' (fuera en descarte)
        this.hideSmoothLines = true;
        this.creaseThresholdDeg = 25.0;

        // Configuración de líneas de corte y pliegue profesionales (Hairline fino / tono tenue)
        this.cutLineWidthMm = 0.10; // Hairline 0.10 mm para corte limpio sin bordes negros gruesos
        this.cutLineColor = '#666666'; // Gris tenue profesional
        this.foldLineWidthMm = 0.08;
        this.foldLineColor = '#999999';
        
        // Dimensiones físicas del modelo armado
        this.modelLengthMm = 200.0;
        this.baseModelLengthMm = 200.0;
        this.wingspanMm = 134.0;
        this.heightMm = 38.0;
        this.ratioX = 0.67;
        this.ratioY = 0.19;
        this.ratioZ = 1.0;
        this.currentScale = '1:33';

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

        mesh.traverse(child => {
            if (child.isMesh && !child.userData?.isSelectionOverlay && child.geometry && child.geometry.attributes.position && child.geometry.attributes.uv) {
                const geo = child.geometry;
                const posAttr = geo.attributes.position;
                const uvAttr = geo.attributes.uv;
                const index = geo.index;
                const baseV = positions.length;

                for (let i = 0; i < posAttr.count; i++) {
                    positions.push([posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)]);
                    uvs.push([uvAttr.getX(i), uvAttr.getY(i)]);
                }

                if (index) {
                    for (let i = 0; i < index.count; i += 3) {
                        faces.push([baseV + index.getX(i), baseV + index.getX(i + 1), baseV + index.getX(i + 2)]);
                    }
                } else {
                    for (let i = 0; i < posAttr.count; i += 3) {
                        faces.push([baseV + i, baseV + i + 1, baseV + i + 2]);
                    }
                }
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

        if (!this.baseModelLengthMm) {
            this.baseModelLengthMm = this.modelLengthMm || 200.0;
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

        // 4. Emparejamiento de costuras 3D
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

        const boundaryEdges = allHalfEdges.filter(e => !uvHalfEdges.has(e.uvTwinKey));
        const seamGroups = new Map();
        for (const b of boundaryEdges) {
            if (!seamGroups.has(b.pos3dKey)) seamGroups.set(b.pos3dKey, []);
            seamGroups.get(b.pos3dKey).push(b);
        }

        const tabEdges = new Map();
        const targetEdges = new Map();
        let seamCounter = 1;

        for (const [key, pair] of seamGroups.entries()) {
            if (pair.length === 2) {
                tabEdges.set(pair[0].uvEdgeKey, { seamNumber: seamCounter, edge: pair[0] });
                targetEdges.set(pair[1].uvEdgeKey, seamCounter);
                seamCounter++;
            }
        }

        // 5. Construir objetos completos para cada pieza independiente (Part)
        const tabHeightMm = this.tabHeightMm;
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
            const islandTabs = [];

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
                        const isTarget = targetEdges.has(edgeKey);
                        const seamNum = isTarget ? targetEdges.get(edgeKey) : null;
                        const dx = p2.x - p1.x;
                        const dy = p2.y - p1.y;
                        const len = Math.hypot(dx, dy);
                        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                        let nx = len > 0.0001 ? -dy / len : 0;
                        let ny = len > 0.0001 ? dx / len : 0;
                        if (nx * (pOpp.x - mid.x) + ny * (pOpp.y - mid.y) > 0) {
                            nx = -nx; ny = -ny;
                        }

                        islandBoundaryEdges.push({
                            p1, p2, isTarget, seamNumber: seamNum,
                            len, mid, nx, ny
                        });

                        if (tabEdges.has(edgeKey)) {
                            const tabInfo = tabEdges.get(edgeKey);
                            if (len > 0.5) {
                                const tabH = Math.min(len * 0.8, tabHeightMm);
                                const inset = Math.min(len * 0.35, tabH * Math.tan((this.tabAngleDeg * Math.PI) / 180));
                                const ux = dx / len;
                                const uy = dy / len;
                                const tabP1 = { x: p1.x + ux * inset + nx * tabH, y: p1.y + uy * inset + ny * tabH };
                                const tabP2 = { x: p2.x - ux * inset + nx * tabH, y: p2.y - uy * inset + ny * tabH };
                                const tabCenter = { x: mid.x + nx * (tabH * 0.55), y: mid.y + ny * (tabH * 0.55) };

                                islandTabs.push({
                                    baseP1: p1,
                                    baseP2: p2,
                                    tabP1,
                                    tabP2,
                                    tabCenter,
                                    baseLen: len,
                                    seamNumber: tabInfo.seamNumber
                                });
                            }
                        }
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

            // Bounding box en mm incluyendo solapas
            let bMinX = Infinity, bMaxX = -Infinity;
            let bMinY = Infinity, bMaxY = -Infinity;
            localTriangles.forEach(tri => {
                tri.forEach(p => {
                    bMinX = Math.min(bMinX, p.x); bMaxX = Math.max(bMaxX, p.x);
                    bMinY = Math.min(bMinY, p.y); bMaxY = Math.max(bMaxY, p.y);
                });
            });
            islandTabs.forEach(tab => {
                [tab.tabP1, tab.tabP2].forEach(p => {
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
                tabs: islandTabs,
                bounds: { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY },
                wMm,
                hMm,
                layout: { pageIndex: 0, x: 105, y: 148, rotation: 0 }
            };
        });

        // 6. Auto-acomodar automáticamente en hojas A4 respetando márgenes
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
     * Rota la pieza actualmente seleccionada por deltaDeg grados (ej. 45° o 15°)
     */
    rotateSelectedPart(deltaDeg = 45) {
        if (!this.selectedPart) return;
        this.selectedPart.layout.rotation = (this.selectedPart.layout.rotation + deltaDeg) % 360;
        this.notifyChange();
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
            const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
            const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

            // Comprobar bounding box con holgura para seleccionar fácilmente
            const b = part.bounds;
            if (lx >= b.minX - 3 && lx <= b.maxX + 3 && ly >= b.minY - 3 && ly <= b.maxY + 3) {
                return { part, pageIndex: p, localX: lx, localY: ly };
            }
        }
        return null;
    }

    /**
     * Dibuja una previsualización de las piezas y solapas sobre el lienzo UV estándar si es requerido
     */
    renderOverlay(ctx, w, h) {
        ctx.clearRect(0, 0, w, h);
        if (!this.parts || this.parts.length === 0) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 1;
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

        // PASADA 1: Dibujar los fondos, marcos y reglas de TODAS las hojas A4
        for (let p = 0; p < this.pagesCount; p++) {
            const pageX_px = p * (this.A4_W + sheetGapMm) * mmToPx;
            const pageY_px = 0;
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
            ctx.fillText(`📄 HOJA ${p + 1} DE ${this.pagesCount} (A4 1:1) • ${this.currentScale} (${this.modelLengthMm} mm)`, pageX_px + margin_px + 4, pageY_px + 16);

            // 4. Margen de seguridad de impresión de 5 mm
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(pageX_px + margin_px, pageY_px + margin_px, pageW_px - margin_px * 2, pageH_px - margin_px * 2);
            ctx.setLineDash([]);

            // 5. Regla de calibración de 50 mm en cada hoja
            this.drawRulerOnCanvas(ctx, pageX_px + margin_px + 4, pageY_px + 32, mmToPx);
        }

        // PASADA 2: Dibujar todas las piezas (la pieza seleccionada o arrastrada va al final para estar siempre encima)
        const partsToDraw = this.parts.filter(pt => pt !== this.selectedPart);
        if (this.selectedPart) {
            partsToDraw.push(this.selectedPart);
        }

        for (const part of partsToDraw) {
            const pageX_px = part.layout.pageIndex * (this.A4_W + sheetGapMm) * mmToPx;
            const pageY_px = 0;
            const originPxX = pageX_px + part.layout.x * mmToPx;
            const originPxY = pageY_px + part.layout.y * mmToPx;
            const rotRad = (part.layout.rotation * Math.PI) / 180;

            ctx.save();
            ctx.translate(originPxX, originPxY);
            ctx.rotate(rotRad);

            // A) Recorte y pintura de la textura
            if (canvas2d) {
                ctx.save();
                ctx.beginPath();
                for (const tri of part.localTriangles) {
                    ctx.moveTo(tri[0].x * mmToPx, tri[0].y * mmToPx);
                    ctx.lineTo(tri[1].x * mmToPx, tri[1].y * mmToPx);
                    ctx.lineTo(tri[2].x * mmToPx, tri[2].y * mmToPx);
                }
                ctx.clip();

                // Mapear textura centrada
                const ratio = mmToPx / this.pixelsPerMm;
                ctx.drawImage(
                    canvas2d,
                    -part.centerU * this.texSize * ratio,
                    -(1 - part.centerV) * this.texSize * ratio,
                    this.texSize * ratio,
                    this.texSize * ratio
                );
                ctx.restore();
            }

            // B) Líneas de pliegue interiores vivas (línea continua)
            if (part.internalEdges && part.internalEdges.length > 0) {
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

            // C) Solapas de pegado (Flaps)
            if (this.showFlaps && part.tabs && part.tabs.length > 0) {
                for (const tab of part.tabs) {
                    // Relleno suave de la pestaña
                    ctx.fillStyle = 'rgba(235, 235, 235, 0.7)';
                    ctx.beginPath();
                    ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                    ctx.lineTo(tab.tabP1.x * mmToPx, tab.tabP1.y * mmToPx);
                    ctx.lineTo(tab.tabP2.x * mmToPx, tab.tabP2.y * mmToPx);
                    ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                    ctx.closePath();
                    ctx.fill();

                    // Línea exterior de corte de solapa
                    ctx.strokeStyle = this.cutLineColor || '#666666';
                    ctx.lineWidth = 0.7;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                    ctx.lineTo(tab.tabP1.x * mmToPx, tab.tabP1.y * mmToPx);
                    ctx.lineTo(tab.tabP2.x * mmToPx, tab.tabP2.y * mmToPx);
                    ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                    ctx.stroke();

                    // Línea de base (doblez - continua)
                    ctx.strokeStyle = this.foldLineColor || 'rgba(120, 120, 120, 0.7)';
                    ctx.lineWidth = 0.6;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                    ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                    ctx.stroke();

                    // Número verde en la solapa (solo si mide al menos 4mm para no desbordar)
                    if (this.showTabNumbers && this.numberPlacement !== 'none' && tab.seamNumber && (tab.baseLen || 10) >= 4.0) {
                        ctx.font = 'bold 9px sans-serif';
                        ctx.fillStyle = '#1b5e20';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(`${tab.seamNumber}`, tab.tabCenter.x * mmToPx, tab.tabCenter.y * mmToPx);
                    }
                }
            }

            // D) Líneas de corte perimetrales (Línea fina y tono tenue profesional)
            ctx.strokeStyle = this.cutLineColor || '#666666';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            for (const cut of part.boundaryEdges) {
                ctx.moveTo(cut.p1.x * mmToPx, cut.p1.y * mmToPx);
                ctx.lineTo(cut.p2.x * mmToPx, cut.p2.y * mmToPx);
            }
            ctx.stroke();

            // Números rojos en bordes receptores (SOLO si se elije 'outside' y colocado FUERA de la pieza)
            if (this.showTabNumbers && this.numberPlacement === 'outside') {
                ctx.font = 'bold 8px sans-serif';
                ctx.fillStyle = '#b71c1c';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (const cut of part.boundaryEdges) {
                    if (cut.isTarget && cut.seamNumber && (cut.len || 10) >= 5.0) {
                        const distMm = 2.5;
                        const midX = cut.mid ? cut.mid.x : (cut.p1.x + cut.p2.x) * 0.5;
                        const midY = cut.mid ? cut.mid.y : (cut.p1.y + cut.p2.y) * 0.5;
                        const nx = cut.nx || 0;
                        const ny = cut.ny || 0;
                        const ox = (midX + nx * distMm) * mmToPx;
                        const oy = (midY + ny * distMm) * mmToPx;
                        ctx.fillText(`[${cut.seamNumber}]`, ox, oy);
                    }
                }
            }

            // E) Indicador de pieza seleccionada y Cotas de Medición (CAD)
            if (this.selectedPart === part) {
                const b = part.bounds;
                const bx = b.minX * mmToPx - 4;
                const by = b.minY * mmToPx - 4;
                const bw = part.wMm * mmToPx + 8;
                const bh = part.hMm * mmToPx + 8;

                // 1. Recuadro cian punteado de selección
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 2]);
                ctx.strokeRect(bx, by, bw, bh);
                ctx.setLineDash([]);

                // 2. Cota horizontal (Ancho en mm) en la parte inferior
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

                // 3. Cota vertical (Alto en mm) en el lateral derecho
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

                // 4. Cartela / Badge superior informativa de la pieza
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
            }

            ctx.restore();
        }

        // PASADA 3: Dibujar medición interactiva de la Regla (si está activa)
        if (this.activeMeasurement) {
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
        this.modelLengthMm = Math.max(20, Math.min(1000, Number(lengthMm) || 200));
        if (this.mesh) {
            this.analyzeMesh(this.mesh, this.texSize);
        }
    }

    /**
     * Exporta el PDF Multi-página en A4 1:1 con todas las hojas organizadas
     */
    exportA4PDF(canvas2d, filename = 'Neo_Papercraft_A4_1-1.pdf') {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
            alert('Error: Librería jsPDF no disponible.');
            return;
        }

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const margin = this.A4_MARGIN;

        for (let p = 0; p < this.pagesCount; p++) {
            if (p > 0) doc.addPage('a4', 'portrait');

            // Cartela técnica y regla en cada página
            doc.saveGraphicsState();
            doc.setDrawColor(0, 120, 215);
            doc.setLineWidth(0.3);
            doc.rect(margin, margin, this.A4_W - margin * 2, this.A4_H - margin * 2);

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(0, 120, 215);
            doc.text(`NEO SUBSTANCE PAINTER • HOJA ${p + 1} DE ${this.pagesCount}`, margin + 60, margin + 6);

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

            // Renderizar cada pieza de esta página
            for (const part of this.parts) {
                if (part.layout.pageIndex !== p) continue;

                const originX = part.layout.x;
                const originY = part.layout.y;
                const rotDeg = part.layout.rotation;
                const rotRad = (rotDeg * Math.PI) / 180;

                const toPageMm = (pt) => {
                    const rx = pt.x * Math.cos(rotRad) - pt.y * Math.sin(rotRad);
                    const ry = pt.x * Math.sin(rotRad) + pt.y * Math.cos(rotRad);
                    return { x: originX + rx, y: originY + ry };
                };
                const toPageDir = (dir) => {
                    const rx = dir.x * Math.cos(rotRad) - dir.y * Math.sin(rotRad);
                    const ry = dir.x * Math.sin(rotRad) + dir.y * Math.cos(rotRad);
                    return { x: rx, y: ry };
                };

                // A) Textura raster de la pieza
                if (canvas2d) {
                    const tempCanvas = document.createElement('canvas');
                    const padPx = 4;
                    const cosR = Math.cos(rotRad);
                    const sinR = Math.sin(rotRad);

                    // Bounding box rotado exacto de los triángulos de la pieza
                    let minRx = Infinity, maxRx = -Infinity;
                    let minRy = Infinity, maxRy = -Infinity;
                    for (const tri of part.localTriangles) {
                        for (const p of tri) {
                            const rx = p.x * cosR - p.y * sinR;
                            const ry = p.x * sinR + p.y * cosR;
                            minRx = Math.min(minRx, rx); maxRx = Math.max(maxRx, rx);
                            minRy = Math.min(minRy, ry); maxRy = Math.max(maxRy, ry);
                        }
                    }

                    const bW_px = Math.max(8, Math.ceil((maxRx - minRx) * this.pixelsPerMm) + padPx * 2);
                    const bH_px = Math.max(8, Math.ceil((maxRy - minRy) * this.pixelsPerMm) + padPx * 2);
                    tempCanvas.width = bW_px;
                    tempCanvas.height = bH_px;
                    const tCtx = tempCanvas.getContext('2d');
                    tCtx.imageSmoothingEnabled = true;
                    tCtx.imageSmoothingQuality = 'high';

                    // Situar origen y rotar directamente dentro del canvas antes de dibujar
                    tCtx.translate(-minRx * this.pixelsPerMm + padPx, -minRy * this.pixelsPerMm + padPx);
                    tCtx.rotate(rotRad);

                    // Recorte vectorial de triángulos
                    tCtx.beginPath();
                    for (const tri of part.localTriangles) {
                        tCtx.moveTo(tri[0].x * this.pixelsPerMm, tri[0].y * this.pixelsPerMm);
                        tCtx.lineTo(tri[1].x * this.pixelsPerMm, tri[1].y * this.pixelsPerMm);
                        tCtx.lineTo(tri[2].x * this.pixelsPerMm, tri[2].y * this.pixelsPerMm);
                    }
                    tCtx.clip();

                    const texScale = (part.islandMmPerUV ? (part.islandMmPerUV / this.uvSheetSizeMm) : 1.0);
                    const drawTexSize = this.texSize * texScale;

                    tCtx.drawImage(
                        canvas2d,
                        -part.centerU * drawTexSize,
                        -(1 - part.centerV) * drawTexSize,
                        drawTexSize,
                        drawTexSize
                    );

                    const partImgData = tempCanvas.toDataURL('image/png', 1.0);
                    const drawW_mm = bW_px / this.pixelsPerMm;
                    const drawH_mm = bH_px / this.pixelsPerMm;
                    const drawX_mm = originX + minRx - padPx / this.pixelsPerMm;
                    const drawY_mm = originY + minRy - padPx / this.pixelsPerMm;

                    // Insertar en jsPDF ya rotado (rotación 0), asegurando alineación perfecta sin bugs de jsPDF
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

                // B) Pliegues vivos (línea continua)
                if (part.internalEdges && part.internalEdges.length > 0) {
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
                        doc.setLineWidth(this.cutLineWidthMm || 0.10);
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
                doc.setLineWidth(this.cutLineWidthMm || 0.10);
                doc.setLineDash([], 0);
                for (const cut of part.boundaryEdges) {
                    const pA = toPageMm(cut.p1);
                    const pB = toPageMm(cut.p2);
                    doc.line(pA.x, pA.y, pB.x, pB.y);

                    if (this.showTabNumbers && this.numberPlacement === 'outside' && cut.isTarget && cut.seamNumber && (cut.len || 10) >= 5.0) {
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
            }

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(100, 100, 100);
            doc.text(
                `NEO SUBSTANCE PAINTER • PLANTILLA 1:1 (A4) • HOJA ${p + 1} DE ${this.pagesCount} • MARGEN: 5mm • NO REESCALAR (100%)`,
                this.A4_W / 2,
                this.A4_H - 4,
                { align: 'center' }
            );
        }

        this.showPdfPreviewModal(doc, filename);
    }

    showPdfPreviewModal(doc, filename) {
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

        document.getElementById('pdf-preview-filename').textContent = `Archivo: ${filename} • ${this.pagesCount} Hojas A4 (1:1) • Modelo: ${this.modelLengthMm} mm`;
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
