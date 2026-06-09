# ComfyUI-311-Tool-Suite - Local Memory (memory.md)

Este documento registra los aprendizajes específicos de este repositorio de nodos custom de ComfyUI para evitar la regresión de errores y documentar las particularidades técnicas de la suite.

---

## 1. Detección de Objetos en SAM3 (SAM3 Images 311)
* **Límite de Objetos de Detección en SAM3:** El codificador de prompts de SAM3 en ComfyUI limita por defecto la detección a `1` objeto por categoría si no se especifica el sufijo `:N` (ej. `product:6`) en el texto del prompt.
  - *Solución:* En los nodos que tengan un slider de `max_objects` (como `SAM3 Images 311`), interceptamos el límite por defecto `1` y usamos en su lugar `max_objects`. Además, se ordena el conjunto final de detecciones de todas las categorías combinadas por confianza de forma descendente y se recorta a `max_objects` para respetar el límite de forma global en el fotograma.

## 2. Gestión de Conexiones y Autogrow en Nodos Dinámicos (AnySwitch311, ImageBatch311, JoinString311)
* **Carrera en la Desconexión de LiteGraph (Race Condition):** Al arrastrar un cable fuera de un slot de entrada conectado, LiteGraph llama a `disconnectInput` de forma síncrona *antes* de establecer `canvas.connecting_node`.
  - *Problema:* Las rutinas de limpieza síncronas detectaban que los slots finales estaban desconectados y los eliminaban del nodo inmediatamente, lo que hacía desaparecer el slot de destino mientras el usuario intentaba mover el cable hacia él.
  - *Solución:* Enlazar el manejador `onConnectionsChange` a un `setTimeout(..., 50)` para dar tiempo a que finalice la ejecución síncrona del evento de ratón y el canvas tenga el estado `connecting_node` configurado. Si se detecta un arrastre activo, se marca el nodo como sucio (`_dirty_slots = true`) y se delega la limpieza al método `onDrawForeground` una vez finalizado el arrastre (`connecting_node === null`).
* **Regla de Autogrow Independiente:** El crecimiento de slots debe validarse únicamente sobre el estado de conexión del **último** slot de datos disponible (ej. `value14`), en lugar de comprobar si todos los slots intermedios están conectados. Esto permite que el nodo crezca de forma limpia y mantenga slots intermedios vacíos/desconectados pero con sus etiquetas intactas si el usuario reubica conexiones.
* **Preservación del Nombre al Renombrar el Slot Seleccionado:** Al destacar el slot seleccionado (dibujado con fondo coloreado), se limpiaba su propiedad `inp.label = " "` para evitar que LiteGraph duplicara el texto renderizado en pantalla.
  - *Problema:* Al intentar renombrar el slot activo, la caja de texto del diálogo aparecía en blanco (con un único espacio `" "`).
  - *Solución:* Dividir la gestión de la etiqueta en dos fases de renderizado: guardar y limpiar la etiqueta en el hook `onDrawBackground` (ejecutado antes del render de LiteGraph) y restaurar inmediatamente el valor real en `onDrawForeground` (ejecutado después). De este modo, la propiedad `inp.label` retiene su valor real entre frames y está disponible al abrir el menú de edición de etiquetas.

