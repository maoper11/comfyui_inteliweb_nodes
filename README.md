# comfyui_inteliweb_nodes

<p align="left">
  <img src="https://img.shields.io/badge/version-0.20.0-blue" alt="version 0.20.0" />
  <a href="http://www.apache.org/licenses/LICENSE-2.0">
    <img src="https://img.shields.io/badge/license-Apache--2.0-brightgreen" alt="Apache-2.0" />
  </a>
  <a href="https://github.com/comfyanonymous/ComfyUI">
    <img src="https://img.shields.io/badge/ComfyUI-custom%20node-0A84FF" alt="ComfyUI custom node" />
  </a>
</p>

> Utilidades de Inteliweb AI para controlar semillas, organizar conexiones, monitorear recursos, liberar memoria, enrutar entradas y construir prompts dentro de ComfyUI.

## Cambios en v0.20.0

- Añadido **Seed (Inteliweb)** con salida `INT` y los modos **Randomize Each Time**, **New Fixed Random** y **Use Last Seed**.
- En modo aleatorio, el campo muestra `random` mientras conserva internamente el valor especial `-1`.
- Añadidos **Set (Inteliweb)** y **Get (Inteliweb)** para reutilizar conexiones por nombre y reducir cables largos.
- Set y Get adoptan automáticamente el tipo y el color de datos como `MODEL`, `CLIP`, `IMAGE`, `LATENT`, `VAE` o `CONDITIONING`.
- Cuando Get está conectado, su selector puede mostrar solamente variables Set compatibles con el tipo de entrada destino.
- Añadidos controles rápidos para grupos nativos de ComfyUI: **Run**, **Bypass** y **Mute**, con visibilidad `Always` o `Hover`.
- Compatibilidad con Classic, Nodes 2.0 y subgraphs modernos.

## Cambios en v0.19.0

- Añadido **Replace Text Multi (Inteliweb)** con 10 pares `find/replace` secuenciales.
- Todos los campos `STRING`, incluidos `find` y `replace`, pueden convertirse en sockets.
- Añadido **Prompt List (Inteliweb)** con cinco prompts multilinea y salidas `prompt_list` y `prompt_strings`.
- Añadido **String Index Selector (Inteliweb)** con 10 textos multilinea e índice basado en 1.
- Los scripts de los nodos fueron organizados dentro de la carpeta `nodes/`.

## Cambios en v0.18.4

- Resource Monitor mide CPU y RAM del contenedor en Linux mediante cgroup v1 o cgroup v2.
- En Windows y máquinas Linux locales se mantiene `psutil` como fuente de CPU y RAM del sistema.
- La RAM de contenedores se muestra como working set, descontando caché inactiva.
- System Check comparte la misma fuente de RAM y VRAM que Resource Monitor.
- Validado en RunPod, Vast AI y Windows Pinokio.

## Instalación de v0.20.0 — rama principal `main`

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

## Funciones frontend

### Group Header Controls (Inteliweb)

Añade controles rápidos a los grupos nativos de ComfyUI sin reemplazar su comportamiento estándar.

- **Run:** ejecuta los nodos de salida contenidos en el grupo.
- **Bypass:** alterna todos los nodos del grupo entre `Bypass` y `Always`.
- **Mute:** alterna todos los nodos del grupo entre `Never` y `Always`.
- Los modos disponibles para mostrar los botones son `Always` y `Hover`.
- Los botones individuales pueden activarse o desactivarse desde `Settings → Inteliweb → Groups`.
- La función queda desactivada por defecto para evitar duplicar controles cuando rgthree está instalado.

El menú contextual del grupo incluye:

```text
Group Shape (Inteliweb)
├── Default
├── Rounded
└── Card
```

El shape se guarda dentro de las flags del grupo y conserva el grupo como un `LGraphGroup` estándar.

## Nodos incluidos

### Seed (Inteliweb)

Controla la semilla utilizada para generar variaciones y entrega una salida `INT` compatible con KSampler y otros nodos con entrada `seed`.

- **🔀 Randomize Each Time:** genera una semilla diferente en cada ejecución.
- **🆕 New Fixed Random:** crea una semilla aleatoria y la conserva como valor fijo.
- **↩️ Use Last Seed:** recupera la última semilla enviada a la cola.
- El modo aleatorio se muestra como `random`, pero se guarda internamente como `-1`.
- También acepta una semilla numérica escrita manualmente.
- La última semilla utilizada se conserva durante la sesión sin modificar el workflow guardado.
- Incluye fallback en Python para ejecuciones mediante API.
- ID interno: `InteliwebSeed`.
- Categoría: `Inteliweb/Utils`.

### Set (Inteliweb) y Get (Inteliweb)

Permiten reutilizar una conexión por nombre sin mantener cables largos atravesando el canvas.

- **Set (Inteliweb)** recibe cualquier tipo, adopta automáticamente el socket y ofrece una salida pass-through.
- **Get (Inteliweb)** selecciona uno de los Set visibles y entrega el mismo valor y tipo.
- Set y Get adoptan automáticamente un color según el tipo de dato conectado.
- Cuando Get se conecta a una entrada, puede filtrar el selector para mostrar solamente variables compatibles.
- Con Get desconectado se muestran todas las variables Set visibles dentro de su alcance.
- El nombre del Set debe ser único dentro de su alcance.
- Al renombrar un Set, sus Gets asociados se actualizan.
- Al copiar y pegar parejas Set/Get, los nombres duplicados se ajustan sin romper la pareja.
- Menú contextual para crear un Get asociado, seleccionar Gets asociados o saltar al Set.
- Las opciones **Filter Get node options by type** y **Auto-color nodes** están en `Settings → Inteliweb → Set & Get Nodes`.
- Funcionan como nodos virtuales: no agregan procesamiento al backend.
- IDs internos: `SetInteliweb` y `GetInteliweb`.
- Categoría: `Inteliweb/Logic`.

### Replace Text Multi (Inteliweb)

Aplica hasta 10 reemplazos secuenciales sobre un texto.

- Un campo principal `string` multilinea.
- Pares `find_1/replace_1` hasta `find_10/replace_10`.
- Los campos `find` vacíos se ignoran.
- Todos los widgets `STRING` pueden convertirse en sockets.
- ID interno: `InteliwebReplaceTextMulti`.

### Prompt List (Inteliweb)

Crea una lista de prompts a partir de cinco campos multilinea.

- Ignora prompts vacíos.
- `prompt_list` devuelve la colección como un único valor `LIST`.
- `prompt_strings` expone una secuencia iterable de `STRING`.
- Entrada opcional `optional_prompt_list` para concatenar una lista existente.
- ID interno: `InteliwebPromptList`.

### String Index Selector (Inteliweb)

Selecciona uno de 10 textos mediante un índice.

- Campos `string_1` a `string_10`.
- Índice basado en 1: `1 → string_1`, `10 → string_10`.
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

- Disco, CPU y RAM.
- Utilización y temperatura de GPU cuando NVML está disponible.
- VRAM.

Fuentes de telemetría:

1. `pynvml` para métricas NVIDIA completas.
2. PyTorch como fallback para nombre del acelerador y VRAM.
3. cgroup v1/v2 para CPU y RAM dentro de contenedores Linux.
4. `psutil` para Windows y sistemas locales.

No ejecuta shells ni procesos externos y no inicia hilos de fondo.

## Estructura principal del paquete

```text
comfyui_inteliweb_nodes/
├── __init__.py
├── resource_monitor.py
├── nodes/
│   ├── image_compare.py
│   ├── input_switch.py
│   ├── label.py
│   ├── lora_stack.py
│   ├── prompt_list.py
│   ├── purge_vram.py
│   ├── replace_text_multi.py
│   ├── seed.py
│   ├── set_get.py
│   ├── string_index_selector.py
│   └── system_check.py
├── web/
│   ├── GroupHeaderControls_Inteliweb.js
│   ├── Seed_Inteliweb.js
│   └── SetGet_Inteliweb.js
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

- **Seed (Inteliweb):** implementación independiente inspirada en el nodo Seed de [`rgthree/rgthree-comfy`](https://github.com/rgthree/rgthree-comfy) y en ideas de experiencia de usuario de [`pixaroma/ComfyUI-Pixaroma`](https://github.com/pixaroma/ComfyUI-Pixaroma).
- **Group Header Controls (Inteliweb):** implementación independiente inspirada en los controles rápidos de grupos nativos de [`rgthree/rgthree-comfy`](https://github.com/rgthree/rgthree-comfy) y en las opciones de presentación de [`pixaroma/ComfyUI-Pixaroma`](https://github.com/pixaroma/ComfyUI-Pixaroma).
- **Set/Get (Inteliweb):** implementación independiente inspirada en el patrón de variables virtuales de [`kijai/ComfyUI-KJNodes`](https://github.com/kijai/ComfyUI-KJNodes) y en las mejoras de compatibilidad y subgraphs de [`pixaroma/ComfyUI-Pixaroma`](https://github.com/pixaroma/ComfyUI-Pixaroma).
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
