# Modelo de datos local — Semana 08

## Almacenamiento y entidades

La app usa **SQLite local** mediante `expo-sqlite`, en el archivo `campusops.db`. A diferencia de un estado en memoria, el archivo conserva la información tras cerrar o reiniciar el proceso. Los datos son locales al dispositivo; no sustituyen el estado autoritativo del servidor.

| Tabla | Campos | Propósito |
|---|---|---|
| `incident_snapshots` | `incident_id` (PK), `server_version`, `snapshot_json`, `updated_at` | Última base remota conocida para comparar cambios fuera de línea. El JSON contiene el snapshot de la incidencia. |
| `operation_queue` | `operation_id` (PK), `incident_id`, `author`, `payload_json`, `base_version`, `created_at` | Operaciones pendientes que deben sobrevivir al cierre de la app. Cada identidad de operación es estable y única. |

`operation_queue.incident_id` identifica la incidencia afectada; `base_version` es la versión remota sobre la que se preparó el cambio; `author` identifica al actor local; `payload_json` conserva el contenido de la operación. La clave primaria de `operation_id` impide insertar dos operaciones con la misma identidad. Una repetición mantiene la primera operación guardada. El orden de lectura es cronológico y usa `rowid` como desempate estable.

El snapshot no se borra al encolar una operación. Así, la capa de sincronización puede comparar la versión base, el cambio local de la cola y la versión remota que reciba. Los estados de conflicto y el despacho de red pertenecen a las otras capas del equipo.

## Versión del esquema

La versión activa es **2**, almacenada en `PRAGMA user_version`.

- **v1:** creó `incident_snapshots` y `operation_queue`, con identidad, versión base y contenido JSON.
- **v2:** añadió `updated_at` a snapshots y `created_at` a operaciones, completó esos valores en los registros preexistentes y creó un índice por incidencia y fecha.

La app deja el detalle de incidencias en JSON para preservar el snapshot recibido sin perder campos que no sean editables por el cliente. Los identificadores y las versiones se mantienen en columnas tipadas para indexar y validar.

## Migración y rollback

`migrateLocalDatabase` lee `user_version` y aplica los pasos pendientes dentro de `withExclusiveTransactionAsync`:

1. Para una base nueva (versión 0), crea el esquema v1 y marca la versión dentro de la misma transacción.
2. De v1 a v2, agrega las fechas, rellena los registros antiguos con la hora de migración, crea el índice y finalmente actualiza `user_version`.
3. Si cualquier sentencia falla, Expo SQLite revierte la transacción completa. El esquema y `user_version` permanecen en la versión anterior; el error se propaga al inicio, no se oculta.
4. Después de corregir la causa, el inicio vuelve a ejecutar la migración desde la versión que se conservó. Una base con versión superior a la soportada se rechaza sin modificarla.

La suite `course-tests/storage/operation-queue.test.ts` cubre una migración v1 válida con datos existentes, una falla inyectada después de modificar la primera tabla (incluida la comprobación de rollback y reintento) y una reapertura de la base física para verificar la supervivencia de la cola. Esta prueba automatizada usa SQLite de Node para ejercitar las sentencias y el límite transaccional; la comprobación en dispositivo Android/iOS debe realizarse como parte de la integración del equipo.

## Límites de responsabilidad

Esta capa crea y lee snapshots, y persiste operaciones pendientes. No envía operaciones ni las elimina después de una respuesta HTTP; la capa de red debe mantenerlas ante errores y conflictos, y retirar sólo las confirmadas según el protocolo acordado por el equipo.
