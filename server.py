import http.server
import socketserver
import os
import json
import base64
import re
import urllib.parse

PORT = 8000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CALCAS_DIR = os.path.join(BASE_DIR, 'calcas')

FRIENDLY_NAMES = {
    'UN_Spacy': 'U.N. Spacy (Cometa)',
    'Calabera chica': 'Calavera Skull Squadron',
    'Logo_Robotech': 'Robotech Defense Force',
    'Mars_Base': 'Mars Base (Base Marte)',
    'logo_zentran': 'Emblema Zentradi',
    'logo_Raidar-x': 'Destroid Raidar-X',
    'cruz_balkenkreuz_ww2': 'Balkenkreuz Militar',
    'cruz_hierro_militar_borde_blanco': 'Cruz de Hierro (Borde Blanco)',
    'cruz_hierro_silueta': 'Cruz de Hierro (Silueta)',
    'Danger': 'Danger (Peligro Turbina)',
    'Warning': 'Warning (Advertencia)',
    'Caution-2k': 'Caution (Precaución)',
    'Ejection Seat': 'Ejection Seat (Triángulo Cabina)',
    'Rescue': 'Rescue (Flecha Rescate)',
    'No Step': 'No Step (No Pisar)',
    'jet fuel only': 'Jet Fuel Only (Combustible)',
    'Beware of blast': 'Beware of Blast (Chorro Escape)',
    'Beware of blastBLANCO': 'Beware of Blast (Blanco)',
    'push-open.close': 'Push / Open / Close (Pestillo)',
    'regilla circular': 'Rejilla Circular (Ventilación)',
    'valvula-circulo': 'Válvula / Tapa Presión',
    'Armament': 'Armament (Bahía de Armas)'
}

def scan_decals():
    if not os.path.exists(CALCAS_DIR):
        os.makedirs(CALCAS_DIR, exist_ok=True)
    valid_exts = {'.png', '.jpg', '.jpeg', '.svg', '.webp'}
    items = []
    category_folders = ['insignias', 'avisos', 'mecanica', 'mis_calcas']

    for cat in category_folders:
        cat_path = os.path.join(CALCAS_DIR, cat)
        if not os.path.exists(cat_path):
            os.makedirs(cat_path, exist_ok=True)
            continue
        for fname in sorted(os.listdir(cat_path)):
            ext = os.path.splitext(fname)[1].lower()
            if ext in valid_exts:
                stem = os.path.splitext(fname)[0]
                name = FRIENDLY_NAMES.get(stem, stem.replace('_', ' ').replace('-', ' ').title())
                encoded_fname = urllib.parse.quote(fname)
                rel_url = f"./calcas/{cat}/{encoded_fname}"
                items.append({
                    "id": f"{cat}_{stem}".lower().replace(' ', '_'),
                    "name": name,
                    "category": cat,
                    "src": rel_url,
                    "filename": fname,
                    "isUser": (cat == 'mis_calcas')
                })

    # Guardar manifest estático para compatibilidad sin servidor o backup
    try:
        manifest_path = os.path.join(CALCAS_DIR, 'manifest.json')
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(items, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print("Error escribiendo manifest:", e)

    return items

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map['.js'] = 'application/javascript'
    extensions_map['.mjs'] = 'application/javascript'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/decals':
            decals = scan_decals()
            payload = json.dumps(decals, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        super().do_GET()

    def do_POST(self):
        if self.path == '/api/decals/upload':
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(body)

                name = data.get('name', 'calca_' + str(int(os.times().elapsed)))
                category = data.get('category', 'mis_calcas')
                data_url = data.get('dataUrl', '')

                # Validar categoría
                if category not in ['insignias', 'avisos', 'mecanica', 'mis_calcas']:
                    category = 'mis_calcas'

                target_dir = os.path.join(CALCAS_DIR, category)
                os.makedirs(target_dir, exist_ok=True)

                # Extraer base64 y extensión
                match = re.match(r'data:image/([a-zA-Z0-9\+\-\.]+);base64,(.+)', data_url)
                if match:
                    ext = match.group(1).lower()
                    if ext == 'jpeg': ext = 'jpg'
                    if ext == 'svg+xml': ext = 'svg'
                    raw_data = base64.b64decode(match.group(2))
                    safe_name = re.sub(r'[^a-zA-Z0-9_\-\. ]', '_', name)
                    if not safe_name.lower().endswith(f".{ext}"):
                        filename = f"{safe_name}.{ext}"
                    else:
                        filename = safe_name

                    filepath = os.path.join(target_dir, filename)
                    with open(filepath, 'wb') as f:
                        f.write(raw_data)

                decals = scan_decals()
                resp = json.dumps({"success": True, "decals": decals}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return
            except Exception as e:
                err_resp = json.dumps({"error": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

        if self.path == '/api/decals/delete':
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(body)

                raw_cat = data.get('category', 'mis_calcas')
                category = 'mis_calcas' if raw_cat == 'custom' else raw_cat
                filename = urllib.parse.unquote(data.get('filename', ''))

                if filename:
                    target_file = os.path.join(CALCAS_DIR, category, filename)
                    if not os.path.exists(target_file):
                        # Buscar en todas las carpetas por si acaso
                        for c in CATEGORIES:
                            test_p = os.path.join(CALCAS_DIR, c, filename)
                            if os.path.exists(test_p):
                                target_file = test_p
                                break
                    if os.path.exists(target_file):
                        os.remove(target_file)

                decals = scan_decals()
                resp = json.dumps({"success": True, "decals": decals}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return
            except Exception as e:
                err_resp = json.dumps({"error": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

        if self.path == '/api/decals/recategorize':
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len).decode('utf-8')
                data = json.loads(body)

                def norm_cat(c):
                    c = (c or '').strip().lower()
                    if c in ('custom', 'mis_calcas', 'mis calcas'):
                        return 'mis_calcas'
                    if c in ('insignias', 'insignias & logos'):
                        return 'insignias'
                    if c in ('avisos', 'avisos técnicos', 'avisos tecnicos'):
                        return 'avisos'
                    if c in ('mecanica', 'mecánica & paneles', 'mecanica y paneles'):
                        return 'mecanica'
                    return c

                from_cat = norm_cat(data.get('fromCategory', ''))
                to_cat = norm_cat(data.get('toCategory', ''))
                filename = urllib.parse.unquote(data.get('filename', ''))

                if from_cat and to_cat and filename:
                    src_file = os.path.join(CALCAS_DIR, from_cat, filename)
                    if not os.path.exists(src_file):
                        # Buscar en todas las categorías
                        for c in CATEGORIES:
                            test_p = os.path.join(CALCAS_DIR, c, filename)
                            if os.path.exists(test_p):
                                src_file = test_p
                                break

                    dest_dir = os.path.join(CALCAS_DIR, to_cat)
                    os.makedirs(dest_dir, exist_ok=True)
                    dest_file = os.path.join(dest_dir, filename)

                    if os.path.exists(src_file):
                        if os.path.abspath(src_file) != os.path.abspath(dest_file):
                            if os.path.exists(dest_file):
                                os.remove(dest_file)
                            os.replace(src_file, dest_file)

                decals = scan_decals()
                resp = json.dumps({"success": True, "decals": decals}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                return
            except Exception as e:
                err_resp = json.dumps({"error": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                return

        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    # Generar manifest inicial
    scan_decals()
    try:
        with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
            print(f"Servidor activo en: http://localhost:{PORT}/")
            print("API de calcomanías activa en: http://localhost:{PORT}/api/decals")
            print("Presiona Ctrl+C en esta ventana para detener el servidor.")
            httpd.serve_forever()
    except OSError:
        print(f"El servidor ya esta activo en http://localhost:{PORT}/ (puerto en uso).")
    except KeyboardInterrupt:
        pass
