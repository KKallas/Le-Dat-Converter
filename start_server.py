#!/usr/bin/env python3
"""
Start a local web server for the Le-Dat Converter.

Usage:
    python start_server.py          # default port 8080
    python start_server.py 3000     # custom port
"""

import http.server
import os
import sys
import webbrowser

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))

os.chdir(ROOT)

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Disable browser caching so file edits take effect on reload."""
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

server = http.server.HTTPServer(("", PORT), NoCacheHandler)

url = f"http://localhost:{PORT}/web/index.html"
print(f"Serving at {url}")
print("Press Ctrl+C to stop.\n")

webbrowser.open(url)

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nStopped.")
    server.server_close()
