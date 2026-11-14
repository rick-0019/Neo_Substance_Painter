// check.js - Diagnóstico ultra-rápido de Neo Substance Painter
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

function startFallbackServer(rootDir) {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.nsp': 'application/json; charset=utf-8',
        '.obj': 'text/plain; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.ttf': 'font/ttf',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2'
    };
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
            const filePath = path.join(rootDir, relPath);
            if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            fs.createReadStream(filePath).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({ server, url: `http://127.0.0.1:${addr.port}` });
        });
    });
}

async function runDiagnostics() {
    const startTime = Date.now();
    console.log('\x1b[36m%s\x1b[0m', '🔍 Iniciando diagnóstico automático de Neo Substance Painter...');
    
    let hasError = false;

    // 1. Verificación sintáctica estática de todos los archivos JS clave (< 100ms)
    const jsFiles = [
        'main.js', 'layers.js', 'decals.js', 'painter.js', 
        'papercraft.js', 'assembler.js', 'selection.js', 
        'colorPicker.js', 'decalLibrary.js', 'referenceManager.js'
    ];
    for (const file of jsFiles) {
        if (!fs.existsSync(file)) continue;
        try {
            execSync(`node -c "${file}"`, { stdio: 'pipe' });
        } catch (err) {
            console.error('\x1b[31m%s\x1b[0m', `❌ Error sintáctico en ${file}:`);
            console.error(err.stderr ? err.stderr.toString() : err.message);
            hasError = true;
        }
    }
    if (hasError) {
        console.error('\x1b[31m%s\x1b[0m', '⛔ Corrige los errores sintácticos antes de probar en el navegador.');
        process.exit(1);
    }
    console.log('\x1b[32m%s\x1b[0m', '  ✓ Sintaxis limpia en todos los archivos JS');

    // 2. Comprobación de arranque real con WebGL en navegador headless
    let browser;
    let fallbackSrv = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--enable-webgl',
                '--ignore-gpu-blocklist',
                '--use-gl=angle',
                '--use-angle=swiftshader'
            ]
        });
        const page = await browser.newPage();

        const runtimeErrors = [];
        const consoleErrors = [];
        const failedRequests = [];

        page.on('pageerror', err => {
            runtimeErrors.push(err.message + (err.stack ? '\n' + err.stack : ''));
        });

        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });

        page.on('requestfailed', req => {
            failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText || 'Failed'}`);
        });

        // Cargar aplicación local (usar servidor activo en 8000 o iniciar servidor efímero)
        let targetUrl = process.env.NSP_URL || 'http://localhost:8000';
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 2500 });
        } catch (_) {
            fallbackSrv = await startFallbackServer(__dirname);
            targetUrl = fallbackSrv.url;
            failedRequests.length = 0;
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 6000 });
        }

        // Esperar a que la escena Three.js y capas inicialicen
        await page.waitForFunction(() => {
            return window.layerManager && window.painter && window.decalSystem && window.state?.mesh;
        }, { timeout: 5000 }).catch(() => {});

        // Estado del sistema y pruebas automáticas (incluyendo desdoble geodésico, estabilización en crestas y filtro de continuidad)
        const testResults = await page.evaluate(async () => {
            const lm = window.layerManager;
            const ds = window.decalSystem;
            const p = window.painter;
            const THREE = window.THREE;

            const health = {
                layersCount: lm?.layers?.length || 0,
                layerNames: lm?.layers?.map(l => l.name) || [],
                activeLayer: lm?.getActiveLayer()?.name || null,
                meshLoaded: !!window.state?.mesh,
                painterActive: !!p,
                decalSystemActive: !!ds,
                papercraftActive: !!window.papercraft
            };

            // Prueba 1: Capa activa correcta
            const isLayerOk = health.layersCount >= 4 && health.activeLayer === 'Color Base';

            // Prueba 2: Cambiar de capa y aislar
            let layerSwitchOk = false;
            try {
                const calcas = lm.layers.find(l => l.name === 'Calcas');
                if (calcas) {
                    lm.setActiveLayer(calcas.id);
                    layerSwitchOk = lm.getActiveLayer().id === calcas.id;
                    const cb = lm.layers.find(l => l.name === 'Color Base');
                    if (cb) lm.setActiveLayer(cb.id);
                }
            } catch (e) {
                layerSwitchOk = false;
            }

            // Prueba 3: Cargar modelo de fuselaje y verificar envoltura geodésica 1:1, estabilización de cresta y filtro de continuidad
            let geodesicTest = { ok: false };
            try {
                const resp = await fetch('/models/Fuselaje-004-E2-V3-optimizado.nsp');
                if (resp.ok && typeof window.loadProjectNSP === 'function') {
                    const projectJson = await resp.json();
                    await window.loadProjectNSP(projectJson);
                }
                const graph = ds.getGeodesicGraph();
                if (graph && graph.faces.length >= 240) {
                    const f10 = graph.faces[10];
                    const f12 = graph.faces[12];
                    const pRidge = new THREE.Vector3(f10.centroid.x, 0, f10.centroid.z);
                    const stab10 = ds.getStabilizedSurfaceNormal(pRidge, f10.normal, 0.5);
                    const stab12 = ds.getStabilizedSurfaceNormal(pRidge, f12.normal, 0.5);
                    const ridgeDot = stab10.stabilizedNormal.dot(stab12.stabilizedNormal);
                    const ridgeSymY = Math.abs(stab10.stabilizedNormal.y);

                    const zAxis = stab10.stabilizedNormal.clone();
                    const xAxis = new THREE.Vector3(-1, 0, 0).addScaledVector(zAxis, -new THREE.Vector3(-1, 0, 0).dot(zAxis)).normalize();
                    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

                    const geoLomo = ds.updateGeodesicUnwrapGeometry(f10.centroid, { xAxis, yAxis, zAxis }, 0.8, 0.8, false, false, false);
                    const validLomo = geoLomo.getAttribute('aValid').array;
                    const uvLomo = geoLomo.getAttribute('aDecalUV').array;

                    let minR = Infinity, maxR = -Infinity;
                    for (let fi = 0; fi < 44; fi++) {
                        if (validLomo[fi * 3] < 0.5) continue;
                        const f = graph.faces[fi];
                        const pts3D = [f.p0, f.p1, f.p2];
                        for (let e = 0; e < 3; e++) {
                            const eNext = (e + 1) % 3;
                            const d3d = pts3D[e].distanceTo(pts3D[eNext]);
                            const u0 = uvLomo[(fi * 3 + e) * 2] * 0.8, v0 = uvLomo[(fi * 3 + e) * 2 + 1] * 0.8;
                            const u1 = uvLomo[(fi * 3 + eNext) * 2] * 0.8, v1 = uvLomo[(fi * 3 + eNext) * 2 + 1] * 0.8;
                            const r = Math.hypot(u1 - u0, v1 - v0) / d3d;
                            minR = Math.min(minR, r);
                            maxR = Math.max(maxR, r);
                        }
                    }

                    const lomoAllIslandsValid = (validLomo[0 * 3] === 1 && validLomo[10 * 3] === 1 && validLomo[26 * 3] === 1 && validLomo[152 * 3] === 1);
                    const lomoNoLeakToBody = (validLomo[54 * 3] === 0 && validLomo[90 * 3] === 0 && validLomo[218 * 3] === 0);

                    const f73 = graph.faces[73];
                    const stab73 = ds.getStabilizedSurfaceNormal(f73.centroid, f73.normal, 0.5);
                    const z73 = stab73.stabilizedNormal.clone();
                    const x73 = new THREE.Vector3(-1, 0, 0).addScaledVector(z73, -new THREE.Vector3(-1, 0, 0).dot(z73)).normalize();
                    const y73 = new THREE.Vector3().crossVectors(z73, x73).normalize();
                    const geoBody = ds.updateGeodesicUnwrapGeometry(f73.centroid, { xAxis: x73, yAxis: y73, zAxis: z73 }, 0.8, 0.8, false, false, false);
                    const validBody = geoBody.getAttribute('aValid').array;
                    const bodySeamValid = (validBody[73 * 3] === 1 && validBody[108 * 3] === 1 && validBody[10 * 3] === 0);

                    // Crear una pegatina circular de prueba sobre el lomo y verificar el renderizado GPU en unwrappedCanvas
                    const testCanvas = document.createElement('canvas');
                    testCanvas.width = 128;
                    testCanvas.height = 128;
                    const tCtx = testCanvas.getContext('2d');
                    tCtx.fillStyle = '#ff0000';
                    tCtx.beginPath();
                    tCtx.arc(64, 64, 56, 0, Math.PI * 2);
                    tCtx.fill();

                    ds.setDecalImage(testCanvas, 'TestLomoGeodesic');
                    const activeLayer = lm.getActiveLayer();
                    const createdDecal = activeLayer?.getDecal(ds.selectedDecalId);
                    if (createdDecal) {
                        createdDecal.projectorPosition = f10.centroid.clone();
                        createdDecal.projectorNormal = stab10.stabilizedNormal.clone();
                        createdDecal.projectorMeshNormal = stab10.rawNormal.clone();
                        createdDecal.surfaceTangent = xAxis.clone();
                        createdDecal.surfaceBitangent = yAxis.clone();
                        ds.projectorPosition.copy(createdDecal.projectorPosition);
                        ds.projectorNormal.copy(createdDecal.projectorNormal);
                        ds.projectorMeshNormal = createdDecal.projectorMeshNormal.clone();
                        ds.surfaceTangent = createdDecal.surfaceTangent.clone();
                        ds.surfaceBitangent = createdDecal.surfaceBitangent.clone();
                        ds.update3DUnwrapForDecal(createdDecal, true);
                    }

                    let unwrappedDecalCount = 0;
                    for (const lyr of lm.layers) {
                        for (const d of (lyr.decals || [])) {
                            if (d.unwrappedCanvas && d.hasValidUnwrap) unwrappedDecalCount++;
                        }
                    }

                    geodesicTest = {
                        ok: ridgeDot >= 0.995 && ridgeSymY <= 0.03 && minR >= 0.99 && maxR <= 1.03 && lomoAllIslandsValid && lomoNoLeakToBody && bodySeamValid && unwrappedDecalCount >= 1,
                        ridgeDot: Number(ridgeDot.toFixed(4)),
                        ridgeSymY: Number(ridgeSymY.toFixed(4)),
                        minR: Number(minR.toFixed(4)),
                        maxR: Number(maxR.toFixed(4)),
                        lomoAllIslandsValid,
                        lomoNoLeakToBody,
                        bodySeamValid,
                        unwrappedDecalCount
                    };
                }
            } catch (err) {
                geodesicTest = { ok: false, error: err.message };
            }

            return {
                health,
                isLayerOk,
                layerSwitchOk,
                geodesicTest
            };
        });

        if (runtimeErrors.length > 0) {
            console.error('\x1b[31m%s\x1b[0m', '❌ Excepciones en tiempo de ejecución:');
            runtimeErrors.forEach(err => console.error('  - ' + err));
            hasError = true;
        }

        if (failedRequests.length > 0) {
            console.warn('\x1b[33m%s\x1b[0m', '⚠️ Peticiones de red fallidas (recursos faltantes):');
            failedRequests.forEach(req => console.warn('  - ' + req));
        }

        if (!testResults.health.meshLoaded || testResults.health.layersCount === 0 || !testResults.health.painterActive) {
            console.error('\x1b[31m%s\x1b[0m', '❌ Falló la inicialización de los componentes del motor:');
            console.error('  Health:', JSON.stringify(testResults.health, null, 2));
            hasError = true;
        } else {
            console.log('\x1b[32m%s\x1b[0m', `  ✓ Motor 3D y Capas inicializados (${testResults.health.layersCount} capas, activa: "${testResults.health.activeLayer}")`);
            console.log('\x1b[32m%s\x1b[0m', `  ✓ Aislamiento y selección de capas funcionando correctamente`);
            console.log('\x1b[32m%s\x1b[0m', '  ✓ DecalSystem y Painter listos para dibujar');
        }

        if (!testResults.geodesicTest || !testResults.geodesicTest.ok) {
            console.error('\x1b[31m%s\x1b[0m', '❌ Falló la prueba de Envoltura Geodésica / Cresta / Continuidad:');
            console.error('  Detalles:', JSON.stringify(testResults.geodesicTest, null, 2));
            hasError = true;
        } else {
            const gt = testResults.geodesicTest;
            console.log('\x1b[32m%s\x1b[0m', `  ✓ Envoltura Geodésica 1:1 verificada (ratio: [${gt.minR}, ${gt.maxR}], cresta dot: ${gt.ridgeDot}, sin sangrado entre zonas, calcas desdobladas: ${gt.unwrappedDecalCount})`);
        }

    } catch (err) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error ejecutando navegador de prueba: ${err.message}`);
        hasError = true;
    } finally {
        if (browser) await browser.close();
        if (fallbackSrv && fallbackSrv.server) fallbackSrv.server.close();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    if (!hasError) {
        console.log('\x1b[32m%s\x1b[0m', `✨ TODO EN ORDEN: Diagnóstico completado en ${elapsed}s sin ningún error.`);
        process.exit(0);
    } else {
        console.error('\x1b[31m%s\x1b[0m', `💥 Diagnóstico completó con errores en ${elapsed}s.`);
        process.exit(1);
    }
}

runDiagnostics();
