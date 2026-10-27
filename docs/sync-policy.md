# Política de sincronización — Semana 08

## Comparación de tres vías

`resolveSync(base, local, remote)` trata `base` como el último snapshot remoto conocido,
`local` como el estado derivado de la operación pendiente y `remote` como el snapshot
actual del servidor. La versión de cada registro sirve de contexto; la resolución se
decide por los valores de los campos, no por elegir ciegamente la versión numéricamente
más alta.

La comparación se realiza por campo de primer nivel:

| Cambio respecto de `base` | Resultado |
|---|---|
| Sólo remoto | Se conserva el valor remoto. |
| Sólo local | Se conserva el valor local. |
| Ambos cambiaron al mismo valor | Se conserva ese valor y la fusión continúa. |
| Ambos cambiaron a valores distintos | Se devuelve `conflict` con el nombre del campo. |
| Ninguno cambió | Se conserva el valor remoto (igual a la base). |

La igualdad de valores es estructural para objetos y arreglos JSON, por lo que el orden
de las claves de un objeto no crea un conflicto. La presencia de un campo también forma
parte de su valor: agregarlo, quitarlo o cambiarlo son cambios que pueden combinarse
cuando ocurren en campos distintos. Si hay uno o más conflictos, el resultado es
`{ kind: 'conflict', fields: [...] }` —con nombres ordenados de manera estable— y no se
devuelve una fusión parcial. Si no los hay, se devuelve
`{ kind: 'merged', fields: ... }`. Ninguna entrada se modifica.

Los campos compuestos se consideran atómicos a este nivel. Por ejemplo, si `work`
contiene simultáneamente la asignación y el estado, el inicio local y la reasignación
remota cambian ambos el campo `work` y deben resolverse, no mezclarse suponiendo que
una acción tiene prioridad. En cambio, cambios en `title` y `priority` son
independientes y pueden combinarse.

## Idempotencia y cola local

`deduplicateOperations` conserva, en su orden original, la primera operación para cada
`operationId`; las apariciones siguientes no se aplican de nuevo. El identificador
estable permite reconocer reenvíos por reintentos o fallas de red sin duplicar la acción.

La deduplicación en memoria no equivale a confirmar una operación. La operación
persistente se mantiene en la cola durante errores de red y conflictos. La capa de
despacho sólo debe retirarla después de que el backend confirme su recepción con HTTP
200; la respuesta de conflicto requiere conciliación y no es una confirmación exitosa.

## Autoridad y resolución

El servidor sigue siendo la autoridad de la versión remota, y esta función de dominio no
elige ganadores por autor, rol, hora local ni prioridad de red. Un conflicto conserva
las dos versiones para que la capa de aplicación/UI solicite una resolución explícita y
publique un cambio autorizado mediante el flujo del backend. Esto evita sobrescribir
una reasignación de Coordinación con un inicio fuera de línea y evita perder silenciosamente
la acción local.

## Alternativas y trade-offs

- **Última escritura gana:** sencilla y automática, pero una diferencia de reloj o el
  orden de reintentos podría descartar una reasignación o una acción del técnico.
- **Bloquear toda divergencia:** protege datos pero impide combinar cambios no
  relacionados, como título y prioridad.
- **Fusión de tres vías por campo (elegida):** combina cambios independientes y hace
  explícitas las colisiones sobre el mismo campo. El costo es que los campos compuestos
  se resuelven como unidad y los conflictos necesitan intervención, en lugar de una
  resolución completamente automática.

Las pruebas de `course-tests/public/week-08.test.ts` cubren reasignación contra inicio,
fusión de campos independientes y colisión en el mismo campo. `course-tests/sync-resolution.test.ts`
añade casos de presencia/eliminación, igualdad estructural, estabilidad de orden,
no-mutación e identidad de la primera operación retenida.
