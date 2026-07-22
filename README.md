# comfyui_inteliweb_nodes

<p align="left">
  <img src="https://img.shields.io/badge/version-0.19.0-blue" alt="version 0.19.0" />
  <a href="http://www.apache.org/licenses/LICENSE-2.0">
    <img src="https://img.shields.io/badge/license-Apache--2.0-brightgreen" alt="Apache-2.0" />
  </a>
  <a href="https://github.com/comfyanonymous/ComfyUI">
    <img src="https://img.shields.io/badge/ComfyUI-custom%20node-0A84FF" alt="ComfyUI custom node" />
  </a>
</p>

> Utilidades de Inteliweb AI para revisar el sistema, monitorear recursos, liberar memoria, enrutar entradas y construir prompts dentro de ComfyUI.

## Cambios en v0.19.0

- Añadido **Replace Text Multi (Inteliweb)** con 10 pares `find/replace` secuenciales.
- Todos los campos `STRING`, incluidos `find` y `replace`, pueden convertirse en sockets.
- Añadido **Prompt List (Inteliweb)** con cinco prompts multilinea y salidas `prompt_list` y `prompt_strings`.
- Añadido **String Index Selector (Inteliweb)** con 10 textos multilinea e índice basado en 1.
- Los nuevos nodos son compatibles con Nodes 1.0, Nodes 2.0 y subgraphs.
- Los scripts de los nodos fueron organizados dentro de la carpeta `nodes/`.
- `resource_monitor.py` permanece como servicio backend independiente para el monitor superior y System Check.

## Cambios en v0.18.4

- Resource Monitor mide CPU y RAM del contenedor en Linux mediante cgroup v1 o cgroup v2.
- En Windows y máquinas Linux locales se mantiene `psutil` como fuente de CPU y RAM del sistema.
- La RAM de contenedores se muestra como working set, descontando caché inactiva.
- System Check comparte la misma fuente de RAM y VRAM que Resource Monitor.
- Validado en RunPod, Vast AI y Windows Pinokio.

## Instalación de v0.19.0 — rama principal `main`

### ComfyUI Manager

Busca e instala:

```text
ComfyUI_Inteliweb_nodes
```

### Instalación manual con Git

Desde `ComfyUI/custom_nodes`:

```bash
git clone https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd comfyui_inteliweb_nodes
python -m pip install -r requirements.txt
```

### ComfyUI Windows Portable

Desde la carpeta raíz de `ComfyUI_windows_portable`:

```powershell
cd .\ComfyUI\custom_nodes
git clone https://github.com/maoper11/comfyui_inteliweb_nodes.git
cd ..\..
.\python_embeded\python.exe -m pip install -r .\ComfyUI\custom_nodes\comfyui_inteliweb_nodes\requirements.txt
```

Después de instalar, reinicia ComfyUI.

## Nodos incluidos

### Replace Text Multi (Inteliweb)

Aplica hasta 10 reemplazos secuenciales sobre un texto.

- Un campo principal `string` multilinea.
- Pares `find_1/replace_1` hasta `find_10/replace_10`.
- Los campos `find` vacíos se ignoran.
- Todos los widgets `STRING` pueden convertirse en sockets.
- Los reemplazos posteriores pueden actuar sobre texto generado por reemplazos anteriores.
- ID interno: `InteliwebReplaceTextMulti`.

### Prompt List (Inteliweb)

Crea una lista de prompts a partir de cinco campos multilinea.

- Ignora prompts vacíos.
- `prompt_list` devuelve la colección como un único valor `LIST`.
- `prompt_strings` expone una secuencia iterable de `STRING`, útil para ejecutar la generación una vez por prompt.
- Entrada opcional `optional_prompt_list` para concatenar una lista existente.
- ID interno: `InteliwebPromptList`.

### String Index Selector (Inteliweb)

Selecciona uno de 10 textos mediante un índice.

- Campos `string_1` a `string_10`.
- Índice basado en 1: `1 → string_1`, `10 → string_10`.
- El índice puede convertirse en socket.
- Devuelve `string` y `selected_index`.
- ID interno: `InteliwebStringIndexSelector`.

### Input Switch (Inteliweb)

Selector dinámico y lazy para cualquier tipo de entrada.

- Acepta `IMAGE`, `STRING`, `MODEL`, `CLIP`, `VAE`, `LATENT` y otros tipos compatibles.
- Agrega automáticamente un nuevo socket al conectar el último.
- `select` utiliza numeración desde 1.
- Solo evalúa la entrada seleccionada.
- Devuelve el valor, la etiqueta y el índice seleccionado.
- ID interno: `InteliwebInputSwitch`.

Nota: ComfyUI todavía tiene limitaciones generales con entradas autogrow y tipos dinámicos en los límites de los subgraphs. Cuando sea posible, usa tipos estables en las entradas expuestas del subgraph.

### Free Memory (Inteliweb)

Nodo pass-through para liberar recursos entre etapas pesadas.

- Acepta cualquier tipo de entrada y la devuelve sin modificar.
- Mide VRAM y RAM antes y después.
- Puede descargar modelos administrados por ComfyUI.
- Ejecuta garbage collection de Python.
- Limpia la caché con `comfy.model_management.soft_empty_cache()`.
- ID interno: `InteliwebPurgeVRAM`.

Configuración habitual:

```text
purge_cache = true
purge_models = false
gc_collect = true
show_report = true
```

### System Check (Inteliweb)

Muestra:

- Python, sistema operativo y CPU.
- RAM disponible y utilizada.
- PyTorch, runtime CUDA/ROCm y GPU detectada.
- Versiones instaladas de librerías habituales de IA.
- VRAM y fuente de telemetría.

Incluye botones para ejecutar el diagnóstico, liberar memoria y copiar la información.

### Resource Monitor (Inteliweb)

Monitor compacto integrado en la barra superior de ComfyUI.

Muestra en tiempo real:

- Disco.
- CPU.
- RAM.
- Utilización de GPU cuando NVML está disponible.
- VRAM.
- Temperatura de GPU cuando NVML está disponible.

Fuentes de telemetría:

1. `pynvml` para métricas NVIDIA completas.
2. PyTorch como fallback para nombre del acelerador y VRAM.
3. cgroup v1/v2 para CPU y RAM dentro de contenedores Linux.
4. `psutil` para Windows y sistemas locales.

No ejecuta shells ni procesos externos y no inicia hilos de fondo.

## Estructura del paquete

```text
comfyui_inteliweb_nodes/
├── __init__.py
├── resource_monitor.py
├── nodes/
│   ├── __init__.py
│   ├── input_switch.py
│   ├── prompt_list.py
│   ├── purge_vram.py
│   ├── replace_text_multi.py
│   ├── string_index_selector.py
│   └── system_check.py
├── web/
└── assets/
```

## Compatibilidad

- Windows y Linux.
- Nodes 1.0 y Nodes 2.0.
- Compatible con subgraphs, sujeto a las limitaciones generales de ComfyUI para sockets dinámicos.
- NVIDIA: métricas completas mediante `pynvml`.
- AMD/ROCm: nombre y VRAM mediante PyTorch cuando el entorno lo permite.
- Diseñado alrededor de funciones oficiales de ComfyUI.

## Créditos

- **Input Switch (Inteliweb):** implementación independiente inspirada conceptualmente por `Switch (Any)` de [`ltdrdata/ComfyUI-Impact-Pack`](https://github.com/ltdrdata/ComfyUI-Impact-Pack).
- **Resource Monitor (Inteliweb):** inspirado en [`crystian/ComfyUI-Crystools`](https://github.com/crystian/ComfyUI-Crystools), licencia MIT.
- **Free Memory (Inteliweb):** adaptación del concepto `PurgeVRAM` de [`chflame163/ComfyUI_LayerStyle`](https://github.com/chflame163/ComfyUI_LayerStyle), licencia MIT.
- Se estudiaron ideas de diagnóstico de `VRAM Debug` de [`kijai/ComfyUI-KJNodes`](https://github.com/kijai/ComfyUI-KJNodes) y nodos de limpieza de [`yolain/ComfyUI-Easy-Use`](https://github.com/yolain/ComfyUI-Easy-Use).

Consulta `THIRD_PARTY_NOTICES.md` para los avisos de terceros.

## Licencia

Apache License 2.0. Consulta `LICENSE`.

## Autor

**Mauricio Perdomo — Inteliweb AI**

- YouTube: **https://www.youtube.com/@InteliwebAI**
- Mentorías personalizadas 1:1 sobre ComfyUI, instalación optimizada y flujos avanzados.
