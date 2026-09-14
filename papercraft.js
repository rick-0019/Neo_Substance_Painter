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
        
        // Dimensiones físicas del modelo armado
        this.modelLengthMm = 200.0;
        this.wingspanMm = 134.0;
        this.heightMm = 38.0;
        this.currentScale = '1:33';

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
            if (child.isMesh && child.geometry && child.geometry.attributes.position && child.geometry.attributes.uv) {
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

        this.wingspanMm = Math.round(this.modelLengthMm * (sizeX / ref3dLen) * 10) / 10;
        this.heightMm = Math.round(this.modelLengthMm * (sizeY / ref3dLen) * 10) / 10;
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
            faceIndices.forEach(fIdx => {
                for (let v of faces[fIdx]) {
                    const u = uvs[v][0];
                    const vCoord = uvs[v][1];
                    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
                    minV = Math.min(minV, vCoord); maxV = Math.max(maxV, vCoord);
                }
            });

            const centerU = (minU + maxU) / 2;
            const centerV = (minV + maxV) / 2;

            const toLocalMm = (uv) => ({
                x: (uv[0] - centerU) * this.uvSheetSizeMm,
                y: (centerV - uv[1]) * this.uvSheetSizeMm
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
        const totalW_mm = this.pagesCount * this.A4_W + (this.pagesCount - 1) * sheetGapMm;

        // Convertir de coordenadas del canvas a mm del banco de trabajo
        const mouseMmX = (canvasX - this.panX) / (this.zoom * viewScale);
        const mouseMmY = (canvasY - this.panY) / (this.zoom * viewScale);

        // Detectar en qué página está el ratón
        for (let p = 0; p < this.pagesCount; p++) {
            const pageOffsetMmX = p * (this.A4_W + sheetGapMm);
            const pageOffsetMmY = 0;

            if (mouseMmX >= pageOffsetMmX && mouseMmX <= pageOffsetMmX + this.A4_W &&
                mouseMmY >= pageOffsetMmY && mouseMmY <= pageOffsetMmY + this.A4_H) {
                
                const pageMmX = mouseMmX - pageOffsetMmX;
                const pageMmY = mouseMmY - pageOffsetMmY;

                // Buscar piezas en esta página (de arriba a abajo en orden visual inverso)
                for (let i = this.parts.length - 1; i >= 0; i--) {
                    const part = this.parts[i];
                    if (part.layout.pageIndex !== p) continue;

                    // Proyectar el punto al espacio local rotado de la pieza
                    const dx = pageMmX - part.layout.x;
                    const dy = pageMmY - part.layout.y;
                    const rad = (-part.layout.rotation * Math.PI) / 180;
                    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
                    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);

                    // Comprobar bounding box con holgura
                    const b = part.bounds;
                    if (lx >= b.minX - 2 && lx <= b.maxX + 2 && ly >= b.minY - 2 && ly <= b.maxY + 2) {
                        return { part, pageIndex: p, localX: lx, localY: ly };
                    }
                }
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

            // 6. Dibujar las piezas asignadas a esta página
            for (const part of this.parts) {
                if (part.layout.pageIndex !== p) continue;

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

                // B) Líneas de pliegue interiores vivas
                if (part.internalEdges && part.internalEdges.length > 0) {
                    ctx.strokeStyle = 'rgba(80, 80, 80, 0.8)';
                    ctx.lineWidth = 1.0;
                    ctx.setLineDash([3, 2]);
                    ctx.beginPath();
                    for (const edge of part.internalEdges) {
                        ctx.moveTo(edge.p1.x * mmToPx, edge.p1.y * mmToPx);
                        ctx.lineTo(edge.p2.x * mmToPx, edge.p2.y * mmToPx);
                    }
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // C) Solapas de pegado (Flaps)
                if (this.showFlaps && part.tabs && part.tabs.length > 0) {
                    for (const tab of part.tabs) {
                        // Relleno suave de la pestaña
                        ctx.fillStyle = 'rgba(230, 230, 230, 0.6)';
                        ctx.beginPath();
                        ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                        ctx.lineTo(tab.tabP1.x * mmToPx, tab.tabP1.y * mmToPx);
                        ctx.lineTo(tab.tabP2.x * mmToPx, tab.tabP2.y * mmToPx);
                        ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                        ctx.closePath();
                        ctx.fill();

                        // Línea exterior de corte
                        ctx.strokeStyle = '#000000';
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                        ctx.lineTo(tab.tabP1.x * mmToPx, tab.tabP1.y * mmToPx);
                        ctx.lineTo(tab.tabP2.x * mmToPx, tab.tabP2.y * mmToPx);
                        ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                        ctx.stroke();

                        // Línea de base (doblez)
                        ctx.strokeStyle = 'rgba(100, 100, 100, 0.8)';
                        ctx.lineWidth = 0.8;
                        ctx.setLineDash([2, 2]);
                        ctx.beginPath();
                        ctx.moveTo(tab.baseP1.x * mmToPx, tab.baseP1.y * mmToPx);
                        ctx.lineTo(tab.baseP2.x * mmToPx, tab.baseP2.y * mmToPx);
                        ctx.stroke();
                        ctx.setLineDash([]);

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

                // D) Líneas de corte perimetrales
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1.6;
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

                // E) Indicador de pieza seleccionada (Caja cian de selección)
                if (this.selectedPart === part) {
                    const b = part.bounds;
                    ctx.strokeStyle = '#00e5ff';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 2]);
                    ctx.strokeRect(b.minX * mmToPx - 4, b.minY * mmToPx - 4, part.wMm * mmToPx + 8, part.hMm * mmToPx + 8);
                    ctx.setLineDash([]);
                }

                ctx.restore();
            }
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
                    const bW_px = Math.ceil(part.wMm * this.pixelsPerMm) + padPx * 2;
                    const bH_px = Math.ceil(part.hMm * this.pixelsPerMm) + padPx * 2;
                    tempCanvas.width = bW_px;
                    tempCanvas.height = bH_px;
                    const tCtx = tempCanvas.getContext('2d');

                    tCtx.translate(bW_px / 2, bH_px / 2);
                    tCtx.beginPath();
                    for (const tri of part.localTriangles) {
                        tCtx.moveTo(tri[0].x * this.pixelsPerMm, tri[0].y * this.pixelsPerMm);
                        tCtx.lineTo(tri[1].x * this.pixelsPerMm, tri[1].y * this.pixelsPerMm);
                        tCtx.lineTo(tri[2].x * this.pixelsPerMm, tri[2].y * this.pixelsPerMm);
                    }
                    tCtx.clip();

                    tCtx.drawImage(
                        canvas2d,
                        -part.centerU * this.texSize,
                        -(1 - part.centerV) * this.texSize,
                        this.texSize,
                        this.texSize
                    );

                    const partImgData = tempCanvas.toDataURL('image/png', 1.0);
                    const drawW_mm = bW_px / this.pixelsPerMm;
                    const drawH_mm = bH_px / this.pixelsPerMm;

                    doc.addImage(
                        partImgData,
                        'PNG',
                        originX - drawW_mm / 2,
                        originY - drawH_mm / 2,
                        drawW_mm,
                        drawH_mm,
                        undefined,
                        'FAST',
                        rotDeg
                    );
                }

                // B) Pliegues vivos
                if (part.internalEdges && part.internalEdges.length > 0) {
                    doc.setDrawColor(80, 80, 80);
                    doc.setLineWidth(0.12);
                    doc.setLineDash([1.5, 1], 0);
                    for (const edge of part.internalEdges) {
                        const pA = toPageMm(edge.p1);
                        const pB = toPageMm(edge.p2);
                        doc.line(pA.x, pA.y, pB.x, pB.y);
                    }
                }

                // C) Solapas vectoriales
                if (this.showFlaps && part.tabs && part.tabs.length > 0) {
                    for (const tab of part.tabs) {
                        const b1 = toPageMm(tab.baseP1);
                        const t1 = toPageMm(tab.tabP1);
                        const t2 = toPageMm(tab.tabP2);
                        const b2 = toPageMm(tab.baseP2);
                        const tc = toPageMm(tab.tabCenter);

                        doc.setDrawColor(0, 0, 0);
                        doc.setLineWidth(0.18);
                        doc.setLineDash([], 0);
                        doc.line(b1.x, b1.y, t1.x, t1.y);
                        doc.line(t1.x, t1.y, t2.x, t2.y);
                        doc.line(t2.x, t2.y, b2.x, b2.y);

                        doc.setDrawColor(100, 100, 100);
                        doc.setLineWidth(0.10);
                        doc.setLineDash([1.5, 1], 0);
                        doc.line(b1.x, b1.y, b2.x, b2.y);

                        if (this.showTabNumbers && this.numberPlacement !== 'none' && tab.seamNumber && (tab.baseLen || 10) >= 4.0) {
                            doc.setFont('helvetica', 'bold');
                            doc.setFontSize(6);
                            doc.setTextColor(27, 94, 32);
                            doc.text(`${tab.seamNumber}`, tc.x, tc.y, { align: 'center', baseline: 'middle' });
                        }
                    }
                }

                // D) Cortes exteriores
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.22);
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
}
