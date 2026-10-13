# Claret Stats

Dashboard personal de estadísticas (U.E. Claret A · Segona Categoria Femenina) a partir de los datos públicos de basquetcatala.cat.

- `index.html` · la dashboard (GitHub Pages, un solo archivo).
- `claret-sync.user.js` · userscript de Tampermonkey que descarga los datos y los sube a este repo.
- `data/` · JSON tal cual los devuelve la federación (`team.json`, `matches/<uuid>.json`, `index.json`).

## Puesta en marcha (una sola vez)

1. **Repo**: crea un repositorio público en GitHub (p. ej. `claret-stats`) marcando *Add a README*, para que exista la rama `main`.
2. **Sube** `index.html`, `.nojekyll` y la carpeta `data/` (Add file → Upload files).
3. **Pages**: Settings → Pages → *Deploy from a branch* → `main` / `(root)`. La web quedará en `https://<usuario>.github.io/claret-stats/`.
4. **Token**: github.com → Settings → Developer settings → Personal access tokens → *Fine-grained tokens* → Generate.
   - Repository access: *Only select repositories* → `claret-stats`.
   - Permissions → Repository → **Contents: Read and write**.
5. **Tampermonkey**: instala la extensión, *Crear nuevo script*, pega el contenido de `claret-sync.user.js` y guarda.
   En Chrome, activa además *Permitir scripts de usuario* en los detalles de la extensión (requisito de Chrome para Tampermonkey).

## Uso semanal

1. Abre la página de estadísticas del equipo en basquetcatala.cat.
2. Pulsa el botón **Sincronizar** (abajo a la izquierda). La primera vez pedirá `usuario/repo`, rama y token.
3. En ~1 minuto GitHub Pages publica los datos nuevos.

Mayús + clic en el botón vuelve a descargar todos los partidos (por si la federación corrige un acta).
Solo se hace commit si algo ha cambiado.

## Notas sobre los datos

El acta electrónica solo registra canastas anotadas, tiros libres (anotados e intentados), faltas y cambios.
No hay tiros de campo fallados, rebotes ni asistencias, así que no se calcula % de tiro de campo.
El +/- en el banquillo usa el tiempo real jugado por el equipo (incluidas prórrogas).
