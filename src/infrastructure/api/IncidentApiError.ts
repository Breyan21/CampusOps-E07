// Re-export del dominio: los clientes e infraestructura siguen importando desde
// esta ruta, mientras la UI puede depender directamente del dominio.
export * from '../../domain/errors/IncidentApiError';