#!/usr/bin/env python3
"""
Flask dev server for the LED controller mockup.

Usage:
    pip install flask
    python serve.py          # default port 5000
    python serve.py 8080     # custom port
"""
import os
import sys
import json
from flask import Flask, send_from_directory, jsonify

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
ROOT = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder=ROOT)

@app.route("/")
def index():
    return send_from_directory(os.path.join(ROOT, "web"), "controller.html")

@app.route("/api/effects")
def list_effects():
    """Return list of effect folder names that have a meta.json."""
    effects_dir = os.path.join(ROOT, "web", "effects")
    effects = []
    if os.path.isdir(effects_dir):
        for name in sorted(os.listdir(effects_dir)):
            meta_path = os.path.join(effects_dir, name, "meta.json")
            if os.path.isfile(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
                effects.append(meta)
    return jsonify(effects)

@app.route("/api/animations")
def list_animations():
    """Return list of animations that have an animation.json."""
    anims_dir = os.path.join(ROOT, "web", "animations")
    anims = []
    if os.path.isdir(anims_dir):
        for name in sorted(os.listdir(anims_dir)):
            meta_path = os.path.join(anims_dir, name, "animation.json")
            if os.path.isfile(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
                anims.append(meta)
    return jsonify(anims)

# Serve everything under web/ at /
@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(os.path.join(ROOT, "web"), path)

if __name__ == "__main__":
    print(f"Serving at http://localhost:{PORT}/")
    app.run(host="0.0.0.0", port=PORT, debug=True)
