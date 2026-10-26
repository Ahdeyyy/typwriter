"""Validate Linux desktop metadata, then exercise GIO in an isolated XDG home.

Run with Python 3 on Linux with shared-mime-info, desktop-file-utils and
libglib2.0-bin installed. --metadata-only also works on other platforms.
No installed applications or user defaults are changed.
"""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET


TAURI = Path(__file__).resolve().parents[2] / "src-tauri"
config = json.loads((TAURI / "tauri.conf.json").read_text(encoding="utf-8"))
bundle = config["bundle"]
mime_type = next(a["mimeType"] for a in bundle["fileAssociations"] if "typ" in a["ext"])
destination = "/usr/share/mime/packages/com.ahdey.typwriter.xml"
namespace = {"mime": "http://www.freedesktop.org/standards/shared-mime-info"}


def render_template(path):
    # Tauri 2.11.4's desktop template parameters; no escaping is applied by Tauri.
    values = dict(categories="Office;", comment="Typst editor", exec="typwriter",
                  icon="typwriter", name=config["productName"], mime_type=mime_type)
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"{{#if (\w+)}}(.*?){{/if}}",
                  lambda m: m[2] if values[m[1]] else "", text, flags=re.S)
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    assert "{{" not in text, "Unrecognized desktop template variable"
    return text


for target in ("deb", "rpm", "appimage"):
    options = bundle["linux"][target]
    source = TAURI / options["files"][destination]
    mime = ET.parse(source).find("mime:mime-type", namespace)
    assert mime is not None and mime.attrib["type"] == mime_type
    assert mime.find("mime:glob", namespace).attrib["pattern"] == "*.typ"
    assert mime.find("mime:alias", namespace).attrib["type"] == "text/x-typst"
    assert mime.find("mime:sub-class-of", namespace).attrib["type"] == "text/plain"
    if target != "appimage":
        assert {"shared-mime-info", "desktop-file-utils"} <= set(options["depends"])
        for hook in ("postInstallScript", "postRemoveScript"):
            script = (TAURI / options[hook]).read_bytes()
            assert script.startswith(b"#!/bin/sh\n") and b"\r" not in script
            assert b"update-mime-database /usr/share/mime" in script
            assert b"update-desktop-database /usr/share/applications" in script
        desktop = render_template(TAURI / options["desktopTemplate"])
        assert "Exec=typwriter %F\n" in desktop
        assert f"MimeType={mime_type};text/x-typst;" in desktop

print("Linux packaging metadata: deb, rpm and AppImage passed")
if "--metadata-only" in sys.argv:
    sys.exit(0)
if not sys.platform.startswith("linux"):
    sys.exit("GIO checks require Linux; use --metadata-only elsewhere")

with tempfile.TemporaryDirectory(prefix="typwriter-integration-") as temporary:
    root = Path(temporary)
    data = root / "share"
    applications = data / "applications"
    packages = data / "mime/packages"
    applications.mkdir(parents=True)
    packages.mkdir(parents=True)
    (root / "config").mkdir()
    (root / "bin").mkdir()
    desktop_path = applications / "Typwriter.desktop"
    desktop_path.write_text(desktop, encoding="utf-8")
    shutil.copyfile(source, packages / "com.ahdey.typwriter.xml")
    capture = root / "args.json"
    executable = root / "bin/typwriter"
    executable.write_text(
        "#!/usr/bin/env python3\nimport json, os, sys\n"
        "from pathlib import Path\n"
        "Path(os.environ['TYPWRITER_TEST_ARGS']).write_text(json.dumps(sys.argv[1:]))\n",
        encoding="utf-8",
    )
    executable.chmod(0o755)
    env = dict(os.environ, XDG_DATA_HOME=str(data), XDG_DATA_DIRS=str(data),
               XDG_CONFIG_HOME=str(root / "config"), XDG_CONFIG_DIRS=str(root / "config"),
               PATH=str(root / "bin") + os.pathsep + os.environ["PATH"],
               TYPWRITER_TEST_ARGS=str(capture), LC_ALL="C.UTF-8")

    def run(*args):
        return subprocess.check_output(args, env=env, text=True, stderr=subprocess.STDOUT)

    run("desktop-file-validate", str(desktop_path))
    run("update-mime-database", str(data / "mime"))
    run("update-desktop-database", str(applications))
    for extension in ("typ", "TYP"):
        document = root / f"hello world ü.{extension}"
        document.write_text("= Hello\n", encoding="utf-8")
        assert mime_type in run("gio", "info", "-a", "standard::content-type", str(document))
    assert "Typwriter.desktop" in run("gio", "mime", mime_type)
    assert "Typwriter.desktop" in run("gio", "mime", "text/x-typst")

    # GIO expands %F as separate arguments, including spaces and Unicode.
    documents = [root / "hello world ü.typ", root / "second document.typ"]
    documents[1].write_text("= Second\n", encoding="utf-8")
    run("gio", "launch", str(desktop_path), *map(str, documents))
    for _ in range(50):
        if capture.exists() and capture.stat().st_size:
            break
        time.sleep(0.1)
    assert json.loads(capture.read_text()) == list(map(str, documents))
    print("GIO: MIME recognition, handler discovery and multi-file launch passed")
