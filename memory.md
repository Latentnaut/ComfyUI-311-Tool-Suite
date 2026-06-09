# ComfyUI-311-Tool-Suite - Local Memory (memory.md)

Este documento registra los aprendizajes específicos de este repositorio de nodos custom de ComfyUI para evitar la regresión de errores y documentar las particularidades técnicas de la suite.

---

## 1. Detección de Objetos en SAM3 (SAM3 Images 311)
* **Límite de Objetos de Detección en SAM3:** El codificador de prompts de SAM3 en ComfyUI limita por defecto la detección a `1` objeto por categoría si no se especifica el sufijo `:N` (ej. `product:6`) en el texto del prompt.
  - *Solución:* En los nodos que tengan un slider de `max_objects` (como `SAM3 Images 311`), interceptamos el límite por defecto `1` y usamos en su lugar `max_objects`. Además, se ordena el conjunto final de detecciones de todas las categorías combinadas por confianza de forma descendente y se recorta a `max_objects` para respetar el límite de forma global en el fotograma.
