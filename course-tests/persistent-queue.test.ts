import {
  InMemoryQueueStore,
  PersistentOperationQueue,
} from '../src/infrastructure/storage/PersistentOperationQueue';

describe('PersistentOperationQueue (Semana 08)', () => {
  let store: InMemoryQueueStore;
  let queue: PersistentOperationQueue;

  beforeEach(() => {
    store = new InMemoryQueueStore();
    queue = new PersistentOperationQueue(store);
  });

  test('encola una operacion con identidad estable, autor, incidencia y version base', async () => {
    const op = await queue.enqueue({
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      action: 'start_progress',
      payload: { status: 'in_progress', note: 'Iniciando revision de luminaria' },
      baseVersion: 1,
      operationId: 'op-lum-001',
    });

    expect(op.operationId).toBe('op-lum-001');
    expect(op.incidentId).toBe('campus-inc-001');
    expect(op.author).toBe('technician-1');
    expect(op.baseVersion).toBe(1);
    expect(op.status).toBe('pending');

    const pending = await queue.getPending();
    expect(pending.length).toBe(1);
    expect(pending[0]?.operationId).toBe('op-lum-001');
  });

  test('conserva las operaciones encoladas al reiniciar la app (recuperacion de almacenamiento)', async () => {
    await queue.enqueue({
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      action: 'start_progress',
      payload: { status: 'in_progress' },
      baseVersion: 1,
      operationId: 'op-lum-001',
    });

    // Simular reinicio de la aplicacion instanciando una nueva cola sobre el mismo store
    const restartedQueue = new PersistentOperationQueue(store);
    const recovered = await restartedQueue.getPending();

    expect(recovered.length).toBe(1);
    expect(recovered[0]?.operationId).toBe('op-lum-001');
    expect(recovered[0]?.payload).toEqual({ status: 'in_progress' });
  });

  test('deduplica operaciones al repetir operationId sin mutar la cola previa', async () => {
    const first = await queue.enqueue({
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      action: 'start_progress',
      payload: { status: 'in_progress', attempt: 1 },
      baseVersion: 1,
      operationId: 'op-stable-001',
    });

    // Reintentar encolar con el mismo operationId pero diferente payload
    const second = await queue.enqueue({
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      action: 'start_progress',
      payload: { status: 'in_progress', attempt: 2 },
      baseVersion: 1,
      operationId: 'op-stable-001',
    });

    const all = await queue.getAll();
    expect(all.length).toBe(1);
    expect(second.operationId).toBe('op-stable-001');
    expect(first.payload).toEqual({ status: 'in_progress', attempt: 1 });
  });

  test('elimina una operacion solo cuando es confirmada por el servidor', async () => {
    await queue.enqueue({
      incidentId: 'campus-inc-001',
      author: 'technician-1',
      action: 'resolve',
      payload: { status: 'resolved' },
      baseVersion: 2,
      operationId: 'op-resolve-001',
    });

    expect((await queue.getPending()).length).toBe(1);

    const removed = await queue.remove('op-resolve-001');
    expect(removed).toBe(true);

    const remaining = await queue.getPending();
    expect(remaining.length).toBe(0);
  });
});
