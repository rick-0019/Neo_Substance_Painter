# Neo Substance Painter (Papercraft & 3D Texture Painter)

**Neo Substance Painter** es una suite de texturizado y pintura 3D/2D en tiempo real optimizada para modelos de **Papercraft (modelismo en papel)**, prototipado rápido y modelos 3D con desenrollado UV.

Permite pintar de forma simultánea en la superficie tridimensional (amoldándose a la geometría y curvatura) y sobre la plantilla plana 2D desenrollada, garantizando fidelidad milimétrica para impresión.

---

## 🚀 Características Principales

- **Viewport 3D en Tiempo Real (Three.js):**
  - Carga de modelos `.OBJ` con materiales `.MTL`.
  - Pintura directa sobre la superficie 3D mediante trazado de rayos (raycasting) e interpolación continua.
  - Órbita, paneo y zoom intuitivos (clic derecho para rotar, rueda para zoom).

- **Lienzo 2D Desplegado (UV Canvas 2048x2048):**
  - Visualización y edición directa de las islas UV del modelo.
  - Paneo y zoom infinito para pintar con precisión en zonas pequeñas o solapas.

- **Sistema de Capas Estilo Photoshop / Substance (Acelerado por GPU):**
  - Gestión completa de capas: Crear, ocultar/mostrar (👁️), renombrar (doble clic o ✏️), regular opacidad (0-100%), reordenar (▲/▼) y eliminar.
  - Borrador con canal alfa real no destructivo (`destination-out`).
  - Recomposición instantánea por hardware (WebGL / 2D Canvas).

- **Sistema Dual de Pegatinas / Calcomanías (Decals):**
  - **Modo 3D:** Proyección adaptativa con `DecalGeometry` que abraza curvaturas (fuselajes de aviones, cilindros) y descarta caras traseras y perpendiculares a 90° mediante shaders GPU.
  - **Modo 2D:** Posicionamiento interactivo 1:1 directamente sobre la plantilla de papel con tiradores de escala proporcional, ajuste de bordes y giro. Cero deformación UV para garantizar impresiones perfectas.

- **Herramientas de Dibujo:**
  - Pincel libre con tamaño regulable y persistencia de configuración.
  - Formas geométricas: Rectángulos, Círculos, Estrellas y Líneas con control de aspecto 1:1 y nodos de transformación.
  - Bote de pintura (Flood fill) para caras y áreas de textura.
  - Soporte completo de Deshacer (`Ctrl + Z`).

- **Exportación:**
  - Exportación de texturas en alta resolución (PNG).
  - Exportación a PDF lista para imprimir y recortar.

---

## 📦 Instalación y Uso

1. Clona el repositorio:
   ```bash
   git clone https://github.com/rick-0019/Neo_Substance_Painter.git
   cd Neo_Substance_Painter
   ```

2. Ejecuta el servidor local:
   - En Windows, simplemente ejecuta:
     ```cmd
     run.bat
     ```
   - O usando Python:
     ```bash
     python server.py
     ```

3. Abre en tu navegador preferido:
   ```
   http://localhost:8000
   ```

---

## 📁 Estructura del Proyecto

- `index.html`: Interfaz de usuario estilo Ribbon con barras de herramientas y paneles de capas.
- `style.css`: Estilos visuales modernos (tema oscuro / industrial).
- `main.js`: Inicialización de Three.js, eventos de viewport, carga de archivos y sincronización.
- `painter.js`: Motor de pintura 2D/3D, formas geométricas, flood fill e historial undo.
- `layers.js`: Gestor de capas no destructivas con aceleración por GPU.
- `decals.js`: Sistema dual de proyección de calcomanías (3D y 2D).
- `server.py`: Servidor HTTP local con encabezados anti-caché.
- `models/`: Modelos 3D de prueba (`cubo.obj`, `trompa.obj`, `cilindro.obj`).
- `texturas/`: Texturas y calcas de muestra.
