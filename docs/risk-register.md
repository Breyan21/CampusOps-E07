# Registro de riesgos — CampusOps

> Registren exactamente tres riesgos y ordénenlos del más al menos prioritario.

| Prioridad | Riesgo | Probabilidad | Impacto | Mitigación | Cómo comprobar la mitigación |
|---:|---|---|---|---|---|
| 1 | Pérdida o duplicación de operaciones offline | alta, porque se podrían perder cambios, duplicar evidencias o alterar el estado de una incidencia | alto, porque se podrían perder cambios, duplicar evidencias o alterar el estado de una incidencia | usar una cola persistente con operationId, baseVersion e Idempotency-Key | apagar la conexión, registrar una operación, reiniciar la app, reconectar y comprobar que la operación continúa pendiente o se sincroniza una sola vez |
| 2 | Conflicto por reasignación de una incidencia | media, porque puede ocurrir con trabajo concurrente | alto, porque el sistema podría sobrescribir la asignación nueva o aplicar una acción de una persona que ya no está autorizada | usar control de versión, validar baseVersion y reportar el conflicto sin borrar la operación pendiente | ejecutar el escenario de reasignación concurrente del backend y verificar que se recibe un conflicto, se conserva la nueva asignación y no se duplica el historial |
| 3 | Exposición de información sensible en logs | media, porque los errores y solicitudes pueden registrarse automáticamente | alto, porque se expondrían datos privados o credenciales | sanitizar los datos antes de escribir logs y conservar sólo información técnica como incidentId, estado, intento y duración | ejecutar una prueba con datos sensibles y verificar que aparecen como REDACTED, mientras se conservan los campos técnicos permitidos |

## Riesgo que atenderíamos primero

Se atendería primero el riesgo de pérdida o duplicación de operaciones offline porque afecta directamente la integridad de las incidencias y puede provocar cambios irreversibles o inconsistentes. Además, el funcionamiento sin conexión forma parte del alcance mínimo de CampusOps.
