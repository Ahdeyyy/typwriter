"""Run the built picker harness in the system WebKitGTK 4.1 webview.

Requires python3-gi, gir1.2-webkit2-4.1, and a display (or xvfb-run).
Build with the adjacent vite.config.ts first. This serves static build output,
not the app's development server. No external browser driver is involved.
"""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from threading import Thread

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2


here = Path(__file__).resolve().parent
build = here.parents[1] / "dist/symbol-picker-preview"
if not (build / "index.html").exists():
    sys.exit("Build the symbol picker harness before running this check")


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(build)))
Thread(target=server.serve_forever, daemon=True).start()
window = Gtk.Window()
window.set_default_size(1200, 640)
webview = WebKit2.WebView()
window.add(webview)
window.show_all()
exit_code = 1


def finished(view, result, _data):
    global exit_code
    try:
        value = view.evaluate_javascript_finish(result)
        report = json.loads(value.to_json(0))
        if report:
            print(json.dumps(report, ensure_ascii=False))
            exit_code = 0 if not report.get("error") else 1
            Gtk.main_quit()
    except Exception as error:
        print(error, file=sys.stderr)
        Gtk.main_quit()


def poll():
    webview.evaluate_javascript("globalThis.__pickerChecks || null", -1, None, None, None, finished, None)
    return True


def start():
    script = (here / "checks.js").read_text(encoding="utf-8")
    webview.evaluate_javascript(script, -1, None, None, None, None, None)
    GLib.timeout_add(200, poll)
    return False


def loaded(_view, event):
    if event == WebKit2.LoadEvent.FINISHED:
        GLib.timeout_add(1000, start)


def timed_out():
    print("WebKitGTK regression checks timed out", file=sys.stderr)
    Gtk.main_quit()
    return False


webview.connect("load-changed", loaded)
webview.load_uri(f"http://127.0.0.1:{server.server_port}/?theme=dark")
print(f"WebKitGTK {WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}")
GLib.timeout_add_seconds(30, timed_out)
Gtk.main()
server.shutdown()
sys.exit(exit_code)
