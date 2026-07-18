# comfyui_inteliweb_nodes

<p align="left">
  <img src="https://img.shields.io/badge/version-0.18.1-blue" alt="version 0.18.1" />
  <a href="http://www.apache.org/licenses/LICENSE-2.0">
    <img src="https://img.shields.io/badge/license-Apache--2.0-brightgreen" alt="Apache-2.0" />
  </a>
  <a href="https://github.com/comfyanonymous/ComfyUI">
    <img src="https://img.shields.io/badge/ComfyUI-custom%20node-0A84FF" alt="ComfyUI custom node" />
  </a>
</p>

> **System Check (Inteliweb)** — Utilidades para revisar el sistema, monitorear recursos, liberar memoria e integrar Photopea dentro de ComfyUI.

## Cambios en v0.18.1

Esta versión reemplaza las llamadas a ejecutables externos por APIs Python para facilitar la revisión de seguridad del Comfy Registry.

- Eliminado el uso de `subprocess`, `nvidia-smi`, `amd-smi` y `rocm-smi` en la rama principal.
- NVIDIA se monitorea mediante `pynvml`, provisto por `nvidia-ml-py`.
- PyTorch actúa como fallback para nombre del acelerador y memoria VRAM. En instalaciones ROCm puede mostrar la GPU AMD y su memoria, aunque no siempre utilización o temperatura.
- SageAttention se detecta mediante metadatos del paquete instalado, sin importar dinámicamente su código.
- Se añadieron `requirements.txt` y dependencias declaradas en `pyproject.toml`.

La implementación completa de v0.18.0, con fallbacks por comandos externos y telemetría AMD ampliada, permanece disponible en la rama:

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

Usa siempre el mismo Python con el que se ejecuta ComfyUI. En Windows Portable, desde la carpeta raíz de `ComfyUI_windows_portable`, instala las dependencias con:

```powershell
.\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\comfyui_inteliweb_nodes\requirements.txt
```

## System Check (Inteliweb)

Muestra información como:

- Python, sistema operativo y CPU.
- RAM disponible y utilizada.
- PyTorch, CUDA y GPU detectada.
- Flash Attention y capacidad CUDA.
- Versiones instaladas de librerías habituales de IA.
- SageAttention, detectado solamente mediante metadata del paquete.

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

## Photopea Editor (Inteliweb)

Integra Photopea dentro de ComfyUI:

- Menú contextual en nodos con salida `IMAGE` o `MASK`: **Open in Photopea Editor**.
- Edición en modal con **Fullscreen** y opción **Save / Save to node**.
- Requiere conexión a internet porque Photopea corre en el navegador.

<div align="center">
<img src="assets/photopea_editor.png" alt="Photopea Editor" width="900"/>
</div>

## Free Memory (Inteliweb)

Nodo pass-through para liberar recursos entre etapas pesadas de un workflow. El ID interno continúa siendo `InteliwebPurgeVRAM` para conservar compatibilidad.

Funciones:

- Acepta cualquier tipo de entrada y la devuelve sin modificar.
- Mide VRAM y RAM antes y después.
- Puede descargar modelos administrados por ComfyUI.
- Ejecuta garbage collection de Python.
- Limpia la caché mediante `comfy.model_management.soft_empty_cache()`.
- Puede intentar devolver RAM libre al sistema operativo.

Configuración recomendada entre etapas:

```text
purge_cache = true
purge_models = false
gc_collect = true
trim_ram = false
```

Para liberar la mayor cantidad de VRAM antes de cargar otro modelo:

```text
purge_cache = true
purge_models = true
gc_collect = true
trim_ram = false
```

## Instalación

### ComfyUI Manager

Busca:

```text
ComfyUI_Inteliweb_nodes
```

### Git clone

```bash
cd /ruta/a/ComfyUI/custom_nodes
git clone https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd comfyui_inteliweb_nodes
python -m pip install -r requirements.txt
```

Usa el mismo intérprete de Python que ejecuta ComfyUI. En Windows Portable, usa `python_embeded/python.exe` en lugar de un Python externo.

Reinicia ComfyUI.

## Compatibilidad

- Windows y Linux.
- NVIDIA: métricas completas mediante `pynvml`.
- AMD/ROCm: nombre y VRAM mediante PyTorch cuando el entorno lo permite.
- Otros aceleradores: CPU, RAM y disco; la disponibilidad de VRAM depende de PyTorch.
- Diseñado alrededor de funciones oficiales de ComfyUI.

## Créditos

- **Resource Monitor (Inteliweb):** inspirado en [`crystian/ComfyUI-Crystools`](https://github.com/crystian/ComfyUI-Crystools), licencia MIT.
- **Free Memory (Inteliweb):** adaptación del concepto `PurgeVRAM` de [`chflame163/ComfyUI_LayerStyle`](https://github.com/chflame163/ComfyUI_LayerStyle), licencia MIT.
- Ideas de diagnóstico estudiadas en `VRAM Debug` de [`kijai/ComfyUI-KJNodes`](https://github.com/kijai/ComfyUI-KJNodes) y nodos de limpieza de [`yolain/ComfyUI-Easy-Use`](https://github.com/yolain/ComfyUI-Easy-Use).
- **Photopea Editor (Inteliweb):** adaptación namespaced de [`coolzilj/ComfyUI-Photopea`](https://github.com/coolzilj/ComfyUI-Photopea), licencia MIT.

Consulta `THIRD_PARTY_NOTICES.md` para los avisos de terceros.

## Licencia

Apache License 2.0. Consulta `LICENSE`.

## Autor

**Mauricio Perdomo — Inteliweb AI**

- YouTube: **https://www.youtube.com/@InteliwebAI**
- Mentorías personalizadas 1:1 sobre ComfyUI, instalación optimizada y flujos avanzados.
