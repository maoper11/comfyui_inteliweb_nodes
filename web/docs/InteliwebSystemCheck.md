# System Check (Inteliweb)

Muestra información del sistema (CPU, RAM, GPU/CUDA) y versiones de librerías en forma de _badges_, con telemetría en tiempo real de **RAM** y **VRAM**. Incluye acciones para liberar memoria usando el endpoint oficial de ComfyUI.

---

## ¿Cómo usarlo?

1. Coloca el nodo en el canvas y pulsa **Run** para recolectar la información.
2. Expande o colapsa categorías con el triangulito ▸/▾.
3. Usa los botones de la parte superior del nodo:
   - **Free VRAM** — descarga todos los modelos y limpia cachés (igual al botón de la barra de ComfyUI “Free model and node cache”)
   - **Free RAM** — limpia cachés sin descargar modelos
   - **Copy** — copia un resumen de toda la info al portapapeles.

> La telemetría se actualiza automáticamente cada ~1 s, por lo que verás subir/bajar RAM y VRAM al momento.

---

## Categorías y badges

- **== System ==**: Python, OS, CPU, RAM (con barra de uso).
- **== GPU / CUDA ==**: VRAM (con barra de uso), GPU, versión de CUDA y estado de Flash Attention.
- **== Core libs / Vision / Runtime / Text / Others ==**: versiones de librerías típicas (PyTorch, torchvision, diffusers, etc.).

---

## Notas técnicas

- Este nodo es **Output Node** (no envía datos por salidas).
- La altura del nodo se ajusta automáticamente según el contenido desplegado.
- Si el badge de una librería aparece rojo con “Not installed”, no se ha encontrado el paquete en el entorno actual.
- En Windows, la lectura de RAM total/usable puede diferir ligeramente del Administrador de tareas.

## Autor

**Mauricio Perdomo — Inteliweb AI**

- YouTube (tutoriales de flujos profesionales para ComfyUI):  
  **https://www.youtube.com/@InteliwebAI**
