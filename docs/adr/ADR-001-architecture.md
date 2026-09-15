# ADR-001 — Arquitectura por capas y dependencias dirigidas hacia el dominio

## Contexto
CampusOps crecerá para incluir sesión, incidencias, asignación, atención offline, persistencia, sincronización, ubicación y permisos. Actualmente la interfaz App.tsx llama directamente a getBackendHealth, que pertenece a infraestructura.
Si la UI continúa dependiendo directamente de backend, almacenamiento o proveedores externos, será difícil probar reglas de negocio, reemplazar servicios, controlar errores y manejar trabajo sin conexión. Además, la práctica requiere distinguir los límites entre UI, aplicación, dominio e infraestructura.

## Alternativa A
Usar una arquitectura simple donde los componentes de React Native llamen directamente a funciones de API, almacenamiento local y proveedores externos.
Ventajas:
- Menos archivos y menor complejidad inicial.
- Implementación rápida para pantallas pequeñas.
Desventajas:
- La UI conoce detalles de HTTP, almacenamiento y proveedores.
- Las reglas de negocio quedan mezcladas con componentes.
- Las pruebas dependen más de red, mocks y detalles de implementación.
- La sincronización offline y los conflictos serían difíciles de mantener.

## Alternativa B
Usar arquitectura por capas con dependencias dirigidas hacia el dominio:
UI → Aplicación → Dominio ← Infraestructura
- UI: pantallas, componentes, navegación y representación de estados.
- Aplicación: casos de uso como crear incidencia, asignar técnico, iniciar atención y sincronizar cambios.
- Dominio: entidades, reglas, transiciones de estado y contratos del negocio.
- Infraestructura: backend HTTP, almacenamiento local, geocodificación, permisos y adaptadores externos.
La UI invoca casos de uso; los casos de uso dependen de interfaces definidas por el dominio o aplicación; infraestructura implementa dichas interfaces.

## Decisión
Se adopta la Alternativa B: arquitectura por capas con dependencias hacia el dominio.
App.tsx y demás componentes no harán llamadas directas a fetch, courseBackend, almacenamiento local, geocodificación ni permisos. En su lugar, consumirán casos de uso de la capa de aplicación.
Los adaptadores de infraestructura implementarán contratos para que puedan sustituirse por mocks o implementaciones reales sin modificar la UI ni las reglas del dominio.

## Consecuencias
Beneficios:
- Las reglas de CampusOps serán independientes de React Native y del backend.
- Será más sencillo probar casos de uso y transiciones de incidencias.
- La persistencia offline y la resolución de conflictos podrán evolucionar sin acoplarse a pantallas.
- Se podrán usar adaptadores falsos para pruebas reproducibles.
- Se cumple la separación requerida entre UI, aplicación, dominio e infraestructura.
Costos y riesgos aceptados:
- Habrá más archivos, interfaces y pasos para implementar funcionalidades simples.
- El equipo deberá mantener claras las responsabilidades de cada capa.
- La primera refactorización será mover la consulta de salud del backend fuera de App.tsx hacia un caso de uso de aplicación.
