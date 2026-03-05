import json
import os
import sqlite3
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse


DB_PATH = os.path.join(os.path.dirname(__file__), "flowcharts.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS flowcharts (
                name TEXT PRIMARY KEY,
                nodes TEXT NOT NULL,
                connections TEXT NOT NULL
            )
            """
        )


def send_json(handler, status, data):
    body = json.dumps(data).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default logging

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        # GET /api/flowcharts  → list all
        if path == "/api/flowcharts":
            db = get_db()
            rows = db.execute("SELECT name FROM flowcharts ORDER BY name").fetchall()
            db.close()
            send_json(self, 200, [{"name": r["name"]} for r in rows])
            return

        # GET /api/flowcharts/<name>  → load one
        if path.startswith("/api/flowcharts/"):
            name = path[len("/api/flowcharts/"):]
            if not name:
                send_json(self, 404, {"error": "Not found"})
                return
            db = get_db()
            row = db.execute(
                "SELECT * FROM flowcharts WHERE name = ?", (name,)
            ).fetchone()
            db.close()
            if not row:
                send_json(self, 404, {"error": "Not found"})
                return
            send_json(
                self,
                200,
                {
                    "name": row["name"],
                    "nodes": json.loads(row["nodes"]),
                    "connections": json.loads(row["connections"]),
                },
            )
            return

        send_json(self, 404, {"error": "Not found"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/flowcharts":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw)
            except Exception:
                send_json(self, 400, {"error": "Invalid JSON"})
                return

            name = (data.get("name") or "").strip()
            if not name:
                send_json(self, 400, {"error": "Name is required"})
                return

            nodes = data.get("nodes", [])
            connections = data.get("connections", [])

            db = get_db()
            db.execute(
                "INSERT OR REPLACE INTO flowcharts (name, nodes, connections) VALUES (?, ?, ?)",
                (name, json.dumps(nodes), json.dumps(connections)),
            )
            db.commit()
            db.close()

            send_json(
                self,
                201,
                {"name": name, "nodes": nodes, "connections": connections},
            )
            return

        send_json(self, 404, {"error": "Not found"})


if __name__ == "__main__":
    init_db()
    server = HTTPServer(("0.0.0.0", 3001), Handler)
    print("Backend running on http://0.0.0.0:3001")
    server.serve_forever()
