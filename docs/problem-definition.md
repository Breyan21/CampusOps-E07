# Definición del problema — CampusOps

## Problema

En el campus ficticio, estudiantes y personal necesitan reportar y dar seguimiento a incidencias de mantenimiento, como fallas eléctricas, daños en laboratorios, fugas de agua, problemas de conectividad o riesgos de seguridad. CampusOps centralizará el registro, priorización, asignación y seguimiento de estas incidencias para evitar que se pierdan reportes o que su atención no sea trazable.

## Alcance

### Incluye

- Registro de incidencias con categoría, descripción y ubicación sintética.
- Consulta, priorización, asignación, atención, resolución y cierre de incidencias según el perfil autorizado.

### No incluye

- Atención de emergencias reales, uso de datos personales reales ni operación institucional real.
- Chat en tiempo real, panel web administrativo completo, publicación en tiendas o integración con sistemas reales del campus.

## Actores y responsabilidades

- **Reportante:** crea incidencias, proporciona categoría, descripción y ubicación; consulta sus reportes y agrega información posterior.
- **Técnico:** consulta las incidencias asignadas, inicia su atención, registra diagnóstico, notas y evidencias, y marca la resolución.
- **Coordinador:** prioriza y asigna incidencias, revisa el historial y las evidencias, cierra una resolución o reabre un caso cuando sea necesario.

## Flujo principal

1. Reportar: el reportante registra una incidencia con categoría, descripción y ubicación sintética.
2. Asignar: el coordinador consulta la incidencia, define su prioridad y asigna un técnico.
3. Atender: el técnico inicia la atención, registra diagnóstico o evidencias y marca la incidencia como resuelta.
4. Cerrar: el coordinador revisa la resolución, cierra la incidencia o la reabre y reasigna si requiere atención adicional.

## Criterios de aceptación verificables

1. Un reportante puede registrar una incidencia con categoría, descripción y ubicación, y posteriormente consultar su estado.
2. Un coordinador puede asignar una incidencia abierta a un técnico y establecer su prioridad.
3. Un técnico asignado puede cambiar una incidencia de asignada a en proceso y después a resuelta; solo el coordinador puede cerrarla o reabrirla.