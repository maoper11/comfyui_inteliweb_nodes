# comfyui_inteliweb_nodes

<p align="left">
  <img src="https://img.shields.io/badge/version-0.18.3-blue" alt="version 0.18.3" />
  <a href="http://www.apache.org/licenses/LICENSE-2.0">
    <img src="https://img.shields.io/badge/license-Apache--2.0-brightgreen" alt="Apache-2.0" />
  </a>
  <a href="https://github.com/comfyanonymous/ComfyUI">
    <img src="https://img.shields.io/badge/ComfyUI-custom%20node-0A84FF" alt="ComfyUI custom node" />
  </a>
</p>

> Utilidades de Inteliweb AI para revisar el sistema, monitorear recursos, liberar memoria y enrutar entradas dentro de ComfyUI.

## Cambios en v0.18.3

- Eliminado el selector `sel_mode` de **Input Switch (Inteliweb)**.
- El nodo funciona permanentemente mediante lazy evaluation durante la ejecución.
- Solo se solicita y ejecuta la entrada seleccionada.
- Eliminado el handler legacy que modificaba el prompt antes de ejecutar.

## Cambios en v0.18.2

- Añadido **Input Switch (Inteliweb)** como alternativa independiente y ligera al nodo Switch (Any).
- Acepta entradas dinámicas de cualquier tipo y agrega automáticamente un nuevo socket al conectar el último.
- Devuelve el valor seleccionado, la etiqueta del socket y su índice.
- Utiliza un ID propio y puede coexistir con ComfyUI-Impact-Pack sin conflictos.
- No añade dependencias Python ni ejecuta comandos externos.

## Cambios en v0.18.1

Esta versión reemplazó las llamadas a ejecutables externos por APIs Python para facilitar la revisión de seguridad del Comfy Registry.

- Eliminado el uso de `subprocess`, `nvidia-smi`, `amd-smi` y `rocm-smi` en la rama principal.
- NVIDIA se monitorea mediante `pynvml`, provisto por `nvidia-ml-py`.
- PyTorch actúa como fallback para nombre del acelerador y memoria VRAM. En instalaciones ROCm puede mostrar la GPU AMD y su memoria, aunque no siempre utilización o temperatura.
- SageAttention se detecta mediante metadatos del paquete instalado, sin importar dinámicamente su código.
- System Check utiliza un único botón **Free Memory**, con la misma limpieza compartida por el nodo conectable **Free Memory (Inteliweb)**.
- Se añadieron `requirements.txt` y dependencias declaradas en `pyproject.toml`.

## Instalación de v0.18.3 — rama principal `main`

### ComfyUI Manager

Busca e instala:

```text
ComfyUI_Inteliweb_nodes
```

ComfyUI Manager debe instalar automáticamente las dependencias declaradas por el paquete.

### Instalación manual con Git — Linux, macOS o entorno Python

Ejecuta desde la carpeta `ComfyUI/custom_nodes`:

```bash
git clone https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd comfyui_inteliweb_nodes
python -m pip install -r requirements.txt
```

### Instalación manual — ComfyUI Windows Portable

Ejecuta desde la carpeta raíz de `ComfyUI_windows_portable`:

```powershell
cd .\ComfyUI\custom_nodes
git clone https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd ..\..
.\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\comfyui_inteliweb_nodes\requirements.txt
```

Es importante utilizar el mismo intérprete de Python con el que se ejecuta ComfyUI. Después de instalar el paquete y sus dependencias, reinicia ComfyUI.

## Variante legacy v0.18.0 con telemetría ampliada

La implementación completa de v0.18.0, con fallbacks mediante comandos externos y telemetría AMD ampliada, permanece disponible en:

```text
legacy/v0.18.0-full-gpu-monitor
```

Instalación manual de esa variante desde `ComfyUI/custom_nodes`:

```bash
git clone --branch legacy/v0.18.0-full-gpu-monitor --single-branch \
  https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd comfyui_inteliweb_nodes
python -m pip install -r requirements.txt
```

En ComfyUI Windows Portable, desde la carpeta raíz:

```powershell
cd .\ComfyUI\custom_nodes
git clone --branch legacy/v0.18.0-full-gpu-monitor --single-branch https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd ..\..
.\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\comfyui_inteliweb_nodes\requirements.txt
```

## Input Switch (Inteliweb)

Selector dinámico que permite escoger una entrada entre varias sin instalar el paquete completo de Impact Pack.

Características:

- Acepta `IMAGE`, `STRING`, `MODEL`, `CLIP`, `VAE`, `LATENT` y otros tipos compatibles.
- Los sockets comienzan como tipo `*` y adoptan el tipo de la primera conexión concreta.
- Al conectar el último socket aparece automáticamente uno nuevo.
- `select` utiliza numeración desde 1.
- `selected_value` devuelve la entrada elegida.
- `selected_label` devuelve la etiqueta personalizada del socket o su nombre, por ejemplo `input3`.
- `selected_index` devuelve el índice seleccionado.
- Funciona permanentemente mediante `select_on_execution` con lazy evaluation.
- Solo la entrada seleccionada se evalúa durante la ejecución.
- ID interno exclusivo: `InteliwebInputSwitch`.
- Nombre visible: **Input Switch (Inteliweb)**.

Nota sobre subgrafos: ComfyUI todavía tiene limitaciones generales con entradas autogrow y tipos dinámicos en los límites de los subgrafos. Dentro de un subgrafo el nodo puede funcionar, pero es más fiable exponer entradas con tipos estables o mantener el switch fuera del límite del subgrafo.

## System Check (Inteliweb)

Muestra información como:

- Python, sistema operativo y CPU.
- RAM disponible y utilizada.
- PyTorch, runtime CUDA/ROCm y GPU detectada.
- Versiones instaladas de librerías habituales de IA.
- SageAttention, detectado solamente mediante metadata del paquete.

La barra de acciones incluye:

- **Free Memory:** descarga los modelos administrados por ComfyUI, ejecuta garbage collection y limpia la caché del acelerador usando la misma función compartida por el nodo Free Memory.
- **Copy:** copia el diagnóstico generado.

<div align="center">

**Colapsado**  
<img src="assets/system_check_collapsed.png" alt="System Check collapsed" width="700"/>

**Expandido**  
<img src="assets/system_check_expanded.png" alt="System Check expanded" width="700"/>
<img src="assets/system_check_expanded_2.png" alt="System Check expanded 2" width="700"/>
<img src="assets/system_check_expanded_3.png" alt="System Check expanded 3" width="700"/>

</div>

## Resource Monitor (Inteliweb)

Monitor compacto integrado en la barra superior de ComfyUI.

Muestra en tiempo real:

- Uso de disco.
- Uso de CPU.
- Uso de RAM.
- Utilización de GPU cuando NVML está disponible.
- Uso de VRAM.
- Temperatura de GPU cuando NVML está disponible.

Fuentes de telemetría:

1. `pynvml` para métricas NVIDIA completas.
2. PyTorch como fallback para nombre del acelerador y VRAM.

El fallback de PyTorch también puede funcionar en entornos ROCm. En ese caso, utilización y temperatura pueden mostrarse como `--`.

Características:

- Intervalo configurable: 0.5, 1, 2 o 5 segundos.
- Cada indicador puede ocultarse individualmente.
- Tooltip con valores detallados y nombre de GPU.
- No ejecuta shells ni procesos externos.
- No inicia hilos de fondo: el navegador solicita snapshots mediante `/inteliweb/resource_monitor`.

Pulsa el botón `⋮` del monitor para cambiar su configuración.

## Free Memory (Inteliweb)

Nodo pass-through para liberar recursos entre etapas pesadas de un workflow. El ID interno es `InteliwebPurgeVRAM`.

Funciones:

- Acepta cualquier tipo de entrada y la devuelve sin modificar.
- Mide VRAM y RAM antes y después.
- Puede descargar modelos administrados por ComfyUI.
- Ejecuta garbage collection de Python.
- Limpia la caché mediante `comfy.model_management.soft_empty_cache()`.
- No ejecuta comandos externos ni llamadas nativas del sistema operativo.

Configuración recomendada entre etapas:

```text
purge_cache = true
purge_models = false
gc_collect = true
show_report = true
```

Para liberar la mayor cantidad de VRAM antes de cargar otro modelo:

```text
purge_cache = true
purge_models = true
gc_collect = true
show_report = true
```

El nodo no incluye `trim_ram`, porque la rama principal no realiza llamadas nativas para forzar la devolución de RAM al sistema operativo. La liberación de memoria se basa en garbage collection, descarga de modelos y administración oficial de caché de ComfyUI.

## Compatibilidad

- Windows y Linux.
- Nodes 1.0 y Nodes 2.0.
- NVIDIA: métricas completas mediante `pynvml`.
- AMD/ROCm: nombre y VRAM mediante PyTorch cuando el entorno lo permite.
- Otros aceleradores: CPU, RAM y disco; la disponibilidad de VRAM depende de PyTorch.
- Diseñado alrededor de funciones oficiales de ComfyUI.

## Créditos

- **Input Switch (Inteliweb):** implementación independiente inspirada conceptualmente por `Switch (Any)` de [`ltdrdata/ComfyUI-Impact-Pack`](https://github.com/ltdrdata/ComfyUI-Impact-Pack). No importa ni incorpora el paquete Impact Pack.
- **Resource Monitor (Inteliweb):** inspirado en [`crystian/ComfyUI-Crystools`](https://github.com/crystian/ComfyUI-Crystools), licencia MIT.
- **Free Memory (Inteliweb):** adaptación del concepto `PurgeVRAM` de [`chflame163/ComfyUI_LayerStyle`](https://github.com/chflame163/ComfyUI_LayerStyle), licencia MIT.
- Ideas de diagnóstico estudiadas en `VRAM Debug` de [`kijai/ComfyUI-KJNodes`](https://github.com/kijai/ComfyUI-KJNodes) y nodos de limpieza de [`yolain/ComfyUI-Easy-Use`](https://github.com/yolain/ComfyUI-Easy-Use).

Consulta `THIRD_PARTY_NOTICES.md` para los avisos de terceros.

## Licencia

Apache License 2.0. Consulta `LICENSE`.

## Autor

**Mauricio Perdomo — Inteliweb AI**

- YouTube: **https://www.youtube.com/@InteliwebAI**
- Mentorías personalizadas 1:1 sobre ComfyUI, instalación optimizada y flujos avanzados.
