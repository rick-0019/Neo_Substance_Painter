import http.server
import socketserver

PORT = 8000

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map['.js'] = 'application/javascript'
    extensions_map['.mjs'] = 'application/javascript'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

try:
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Servidor activo en: http://localhost:{PORT}/")
        print("Presiona Ctrl+C en esta ventana para detener el servidor.")
        httpd.serve_forever()
except OSError:
    print(f"El servidor ya esta activo en http://localhost:{PORT}/ (puerto en uso).")
except KeyboardInterrupt:
    pass
