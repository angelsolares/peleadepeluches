"""
Baja animaciones de Mixamo por su API de exportación (sin pasar por la descarga de Chrome,
que se crashea en el perfil automatizado del MCP).

    python tools/mixamo-download.py OUT_DIR "ID=nombre=búsqueda" [...]

    ID        id numérico del clip (el "model-id" que muestra la lista del MCP / mixamo_runner)
    nombre    nombre del archivo de salida (sin .fbx)
    búsqueda  texto con el que aparece en el buscador de Mixamo (opcional: por defecto el nombre
              con espacios en vez de guiones bajos)

Ejemplo:
    python tools/mixamo-download.py assets/mixamo "118110903=jump_up=jumping up" "103100901=dizzy_idle=dizzy"

Requisitos: el MCP de Mixamo (C:\\Users\\angel\\mcp\\mixamo-mcp, o la ruta en MIXAMO_MCP_DIR) con su
venv de Playwright y una sesión iniciada en su perfil de Chrome. Solo se usa el navegador para leer
el token y el personaje actual; la exportación, el sondeo y la descarga son peticiones HTTPS.
Formato de salida: FBX 2019 binario, sin piel, 30 fps (igual que las descargas manuales).
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

MCP_DIR = os.environ.get("MIXAMO_MCP_DIR", r"C:\Users\angel\mcp\mixamo-mcp")
sys.path.insert(0, MCP_DIR)
import browser  # noqa: E402  (módulo del MCP: abre el perfil con la sesión)

API = "https://www.mixamo.com/api/v1"
EXPORT_PREFERENCES = {"format": "fbx7_2019", "skin": "false", "fps": "30", "reducekf": "0"}


def log(*a):
    print(*a, flush=True)


def api(method, path, token, body=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "X-Api-Key": "mixamo2",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "Origin": "https://www.mixamo.com",
            "Referer": "https://www.mixamo.com/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def parse_job(arg):
    parts = arg.split("=", 2)
    if len(parts) < 2:
        raise SystemExit(f"Argumento inválido: {arg!r} (esperaba ID=nombre[=búsqueda])")
    anim_id, name = parts[0], parts[1]
    query = parts[2] if len(parts) == 3 else name.replace("_", " ")
    return anim_id, name, query


def find_product(anim_id, query, token, character_id):
    """La lista no trae el model-id: se consultan los detalles de cada resultado hasta dar con él."""
    listing = api("GET", f"/products?page=1&limit=48&order=&type=Motion%2CMotionPack&query={urllib.parse.quote(query)}", token)
    for item in listing.get("results", []):
        if item.get("type") != "Motion":
            continue
        detail = api("GET", f"/products/{item['id']}?similar=0&character_id={character_id}", token)
        if str(detail.get("details", {}).get("gms_hash", {}).get("model-id")) == str(anim_id):
            return detail
    return None


def export(product, token, character_id):
    gms = product["details"]["gms_hash"]
    body = {
        "character_id": character_id,
        "product_name": product["description"],
        "type": "Motion",
        "preferences": EXPORT_PREFERENCES,
        "gms_hash": [{
            "model-id": gms["model-id"],
            "mirror": False,
            "trim": [0, 100],
            "overdrive": 0,
            "params": ",".join(str(p[1]) for p in gms["params"]),
            "arm-space": 0,
            "inplace": False,
        }],
    }
    api("POST", "/animations/export", token, body)
    for _ in range(60):
        time.sleep(2)
        mon = api("GET", f"/characters/{character_id}/monitor", token)
        if mon.get("status") == "completed":
            return mon["job_result"]
        if mon.get("status") == "failed":
            raise RuntimeError(f"la exportación falló: {mon}")
    raise RuntimeError("la exportación no terminó en 2 minutos")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    out_dir = Path(sys.argv[1])
    jobs = [parse_job(a) for a in sys.argv[2:]]

    page = browser.start()
    page.goto("https://www.mixamo.com")
    page.wait_for_load_state("networkidle")
    token = page.evaluate("() => localStorage.getItem('access_token')")
    if not token:
        browser._close()
        raise SystemExit("No hay sesión de Mixamo en el perfil: inicia sesión con main.py del MCP y vuelve a intentar")
    primary = api("GET", "/characters/primary", token)
    character_id = primary.get("primary_character_id") or primary.get("id")
    log("Sesión OK, personaje:", primary.get("primary_character_name", character_id))
    browser._close()

    out_dir.mkdir(parents=True, exist_ok=True)
    failed = 0
    for anim_id, name, query in jobs:
        try:
            product = find_product(anim_id, query, token, character_id)
            if not product:
                raise RuntimeError(f"el model-id {anim_id} no aparece buscando '{query}'")
            url = export(product, token, character_id)
            out = out_dir / f"{name}.fbx"
            with urllib.request.urlopen(url, timeout=120) as r:
                out.write_bytes(r.read())
            log(f"OK  {name}.fbx  ({product['description']}, {out.stat().st_size // 1024} KB)")
        except Exception as e:  # seguir con los demás clips
            failed += 1
            log(f"ERROR  {name} ({anim_id}): {e!r}"[:300])
    log(f"\n{len(jobs) - failed}/{len(jobs)} clips descargados")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
