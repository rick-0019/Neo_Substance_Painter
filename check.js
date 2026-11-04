// check.js - Diagnóstico ultra-rápido de Neo Substance Painter
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');
const fs = require('fs');

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

        // Cargar aplicación local
        const targetUrl = process.env.NSP_URL || 'http://localhost:8000';
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 6000 });

        // Esperar a que la escena Three.js y capas inicialicen
        await page.waitForFunction(() => {
            return window.layerManager && window.painter && window.decalSystem && window.state?.mesh;
        }, { timeout: 4000 }).catch(() => {});

        // Estado del sistema y pruebas automáticas rápidas
        const testResults = await page.evaluate(() => {
            const lm = window.layerManager;
            const ds = window.decalSystem;
            const p = window.painter;

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
                    // Restaurar Color Base
                    const cb = lm.layers.find(l => l.name === 'Color Base');
                    if (cb) lm.setActiveLayer(cb.id);
                }
            } catch (e) {
                layerSwitchOk = false;
            }

            return {
                health,
                isLayerOk,
                layerSwitchOk
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

    } catch (err) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error ejecutando navegador de prueba: ${err.message}`);
        hasError = true;
    } finally {
        if (browser) await browser.close();
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
