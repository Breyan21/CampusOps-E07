# Definición del problema — CampusOps

## Problema

En el campus ficticio, estudiantes y personal reportan fallas como daños eléctricos, fugas de agua, equipos descompuestos y problemas de conectividad, pero no hay una vía única para registrarlas ni para seguirlas hasta su cierre. Esto provoca que los reportes se pierdan, que no se sepa quién atiende cada uno y que no exista un historial confiable. CampusOps centraliza el ciclo completo de una incidencia —reportar, clasificar, asignar, atender y cerrar— en una sola aplicación móvil para que cada reporte sea trazable y tenga un responsable claro.

## Alcance

### Incluye

- Reportar una incidencia con categoría, descripción, ubicación y evidencia fotográfica o notas.
- Clasificar, priorizar, asignar y reasignar incidencias entre técnicos por un coordinador.
- Atender la incidencia por el técnico con registro de diagnóstico y cambios de estado hasta su resolución.
- Cerrar o reabrir una incidencia por el coordinador y conservar un historial de cada cambio.
- Consultar estados de carga, éxito, vacío, error y sin conexión, con recuperación accesible.

### No incluye

- Pagos ni cobros por el servicio.
- Chat en tiempo real entre actores.
- Reconocimiento de imágenes ni inteligencia artificial.
- Datos reales de personas, planos sensibles o integración con sistemas institucionales reales.
- Panel administrativo web completo ni distribución obligatoria en tiendas.

## Actores y responsabilidades

- **Reportante:** crear una incidencia eligiendo categoría, descripción, ubicación y fotografía o notas; consultar sus reportes y agregar información posterior.
- **Técnico:** consultar las incidencias asignadas, iniciar su atención, registrar diagnóstico, notas y evidencias, marcar resolución y trabajar sin conexión para sincronizar después.
- **Coordinador:** consultar el conjunto de incidencias, priorizar, asignar o reasignar técnicos, revisar historial y evidencias, y cerrar una resolución o reabrir un caso.

## Flujo principal

1. Reportar: el reportante crea una incidencia con categoría, descripción, ubicación y evidencia; queda en estado `open`.
2. Asignar: el coordinador prioriza y asigna la incidencia a un técnico; pasa a `assigned`.
3. Atender: el técnico inicia la atención, registra su diagnóstico y notas; pasa a `in_progress` y luego a `resolved` al terminar.
4. Cerrar: el coordinador revisa la resolución y cierra la incidencia (`closed`); puede reabrirla hacia `assigned` si hace falta.

## Criterios de aceptación verificables

1. Dado un reportante que crea una incidencia con categoría válida, cuando la guarda, entonces la incidencia queda visible para el coordinador con estado `open` y su categoría, descripción y ubicación se conservan sin cambios.
2. Dado un coordinador, cuando asigna una incidencia a un técnico, entonces la incidencia cambia a `assigned`, aparece en la lista del técnico y el cambio queda registrado en su historial.
3. Dado un técnico que resuelve una incidencia, cuando el coordinador la revisa y la cierra, entonces la incidencia queda en `closed` y ninguna operación repetida duplica eventos, evidencias ni notificaciones.
