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
* **Mapeo por Nombre de Input (Evitar Shift de Slots)**: Las etiquetas personalizadas deben guardarse y cargarse mapeándolas al nombre del input (`labels[inp.name]`) en lugar de por índice de array (`labels[i]`). Como las entradas convertidas a widgets (como `index`) no existen en `node.inputs` del frontend, indexar por posición crea un desfase (shift) de 1 slot al cargar el JSON del grafo.
* **Limpieza de Prefijos Numéricos**: La función `isDefaultName()` debe validar y descartar nombres por defecto decorados por extensiones del canvas (ej. `"2. value2"`, `"2. "`), previniendo bucles de auto-captura de nombres en cada recarga de página.
* **Limpieza Post-Carga Diferida**: Programar `cleanupTrailingEmptySlots` en el hook `loadedGraphNode` con un delay de `100ms` asegura que la limpieza de slots vacíos se complete con éxito incluso cuando la carga y enlace de cables en el cliente (como en Mac/Chrome) se demore.
* **Desconexión al Cargar Workflow (Uso de is_loading_graph)**:
  - *Problema:* Al abrir el workflow, `setup311` se ejecutaba inmediatamente en `nodeCreated` antes de que se configurara/cargara la estructura y conexiones. Al ver todos los slots vacíos, la limpieza síncrona eliminaba los inputs de datos extra (ej. de `value1` en adelante), provocando que LiteGraph no pudiera restaurar los cables al cargar el JSON y rompiendo las conexiones de múltiples FileReaders hacia AnySwitch311. Esto hacía que los MDs cacheados de los FileReaders desconectados no se propagaran.
  - *Solución:* Introducir una variable de estado global `is_loading_graph = true` en `any_switch_311_v30.js`. Se activa con los hooks `beforeConfigureGraph` y se desactiva con retardo en `setup()` y `afterConfigureGraph`. La limpieza inmediata se omite si `is_loading_graph` es verdadero, permitiendo que LiteGraph reconstruya y conecte los cables en paz, tras lo cual la limpieza diferida (150ms) retira los slots sobrantes.

## 3. Caché de Contenido y Sincronización en File Reader (FileReader311)
* **Sincronización de Widgets Ocultos en Fallback:**
  - *Problema:* Si el archivo a leer no se encuentra en el disco (ej. al compartir el workflow o renombrar el archivo), el nodo recurre al caché persistido en `node.properties` de LiteGraph y muestra el contenido correctamente en el visor HTML del frontend. Sin embargo, los widgets ocultos (`_cached_content`, `_cached_file_name`, `_editor_content`) no se actualizaban con este caché de fallback, lo que hacía que al ejecutar el prompt de ComfyUI se enviasen valores vacíos al backend python, resultando en un error de ejecución de "File not found" sin prompt cargado.
  - *Solución:* Invocar `syncHiddenWidgets(node)` de forma automática cada vez que se actualiza el contenido mostrado en el visor en `showContent()` (cuando no es error) y dentro del event listener debounced de entrada del editor (`input`). Esto garantiza que los widgets internos viajen siempre con los valores correctos en el prompt de ejecución y en la serialización del workflow JSON de ComfyUI.
* **Persistencia Multi-Máquina (Widgets como Fuente de Verdad):**
  - *Problema:* Al abrir el workflow en un ordenador diferente (o tras borrar las cookies del navegador), el objeto `node.properties` de LiteGraph puede llegar vacío o incompleto. Si esto ocurre y el archivo `.md` original no existe localmente, el nodo mostraba "File not found" y el caché se perdía por completo debido a que `properties.fr_cache_content` estaba vacío.
  - *Solución:* Modificar las funciones `getCache()`, `setCache()`, `getEditor()` y `setEditor()` para escribir y leer de manera redundante tanto en `node.properties` como directamente de los valores de los widgets `_cached_content`, `_cached_file_name` y `_editor_content`. Dado que ComfyUI siempre serializa y restaura `widgets_values` de manera nativa en el JSON del workflow, el contenido queda 100% preservado al transferir el workflow a otros ordenadores y se recupera con éxito en la carga inicial aunque el archivo no exista.





