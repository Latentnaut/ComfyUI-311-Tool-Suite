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
* **Preservación del Nombre al Renombrar el Slot Seleccionado:** Al destacar el slot seleccionado (dibujado con fondo coloreado), se limpia su propiedad `inp.label = " "` para evitar que LiteGraph/ComfyUI duplique el texto renderizado en pantalla (evitando el texto gris superpuesto).
  - *Problema:* Al intentar renombrar el slot activo, la caja de texto del diálogo aparecía en blanco (con un único espacio `" "`). Si se restauraba el texto de forma síncrona en `onDrawForeground`, ComfyUI seguía dibujando la etiqueta gris por defecto después de este hook.
  - *Solución:* Mantener `inp.label = " "` permanentemente durante todo el renderizado (tanto en `onDrawBackground` como en `onDrawForeground`). Para que LiteGraph tenga el texto correcto en el menú contextual de renombrado, sobreescribimos `getContextMenuOptions` en el nodo para restaurar sincrónicamente las etiquetas reales justo al abrir el menú. Al iniciar el siguiente ciclo de dibujo, `onDrawBackground` detecta cualquier cambio/renombrado (si ocurrió) y vuelve a establecer `inp.label = " "`.



