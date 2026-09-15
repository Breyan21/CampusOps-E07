import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { GetIncidentDetail } from '../src/application/incidents/GetIncidentDetail';
import { ListIncidents } from '../src/application/incidents/ListIncidents';
import {
  DEFAULT_SYNTHETIC_INCIDENTS,
  InMemoryIncidentRepository,
} from '../src/infrastructure/incidents/InMemoryIncidentRepository';

describe('Incidents Application & Domain Core (Member 2)', () => {
  let repository: InMemoryIncidentRepository;

  beforeEach(() => {
    repository = new InMemoryIncidentRepository();
  });

  describe('ListIncidents use case', () => {
    test('returns all seeded synthetic incidents deterministically', async () => {
      const useCase = new ListIncidents(repository);
      const incidents = await useCase.execute();

      expect(incidents).toHaveLength(DEFAULT_SYNTHETIC_INCIDENTS.length);
      expect(incidents[0]?.id).toBe('inc-001');
      expect(incidents[0]?.title).toBe('Fuga de agua en sanitarios de Biblioteca Central');
      expect(incidents[0]?.status).toBe('open');
      expect(incidents[1]?.id).toBe('inc-002');
      expect(incidents[1]?.category).toBe('electrical');
    });

    test('supports dependency injection with custom repository instances', async () => {
      const customRepo = new InMemoryIncidentRepository([
        {
          id: 'test-custom-1',
          title: 'Incidencia de prueba personalizada',
          category: 'maintenance',
          description: 'Descripción de prueba para aislamiento de tests',
          status: 'open',
          priority: 'low',
          createdAt: '2026-09-14T00:00:00.000Z',
          updatedAt: '2026-09-14T00:00:00.000Z',
        },
      ]);
      const useCase = new ListIncidents(customRepo);
      const incidents = await useCase.execute();

      expect(incidents).toHaveLength(1);
      expect(incidents[0]?.id).toBe('test-custom-1');
    });
  });

  describe('GetIncidentDetail use case', () => {
    test('returns the incident matching the requested id', async () => {
      const useCase = new GetIncidentDetail(repository);
      const incident = await useCase.execute('inc-002');

      expect(incident).not.toBeNull();
      expect(incident?.id).toBe('inc-002');
      expect(incident?.title).toContain('Laboratorio L4');
      expect(incident?.priority).toBe('urgent');
      expect(incident?.assignedTechnicianId).toBe('tech-042');
    });

    test('returns null when querying a non-existent id', async () => {
      const useCase = new GetIncidentDetail(repository);
      const incident = await useCase.execute('non-existent-id');

      expect(incident).toBeNull();
    });

    test('returns null when querying empty or whitespace id', async () => {
      const useCase = new GetIncidentDetail(repository);
      expect(await useCase.execute('')).toBeNull();
      expect(await useCase.execute('   ')).toBeNull();
    });
  });

  describe('Architectural Boundaries of Domain and Application layers', () => {
    function getSourceFiles(dir: string): string[] {
      const results: string[] = [];
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        if (statSync(fullPath).isDirectory()) {
          results.push(...getSourceFiles(fullPath));
        } else if (fullPath.endsWith('.ts') && !fullPath.endsWith('.test.ts')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    test('domain layer does not import UI, React Native, Expo, nor Infrastructure', () => {
      const domainFiles = getSourceFiles(join(process.cwd(), 'src/domain'));
      expect(domainFiles.length).toBeGreaterThan(0);

      for (const file of domainFiles) {
        const content = readFileSync(file, 'utf8');
        expect(content).not.toMatch(/from\s+['"]react['"]/);
        expect(content).not.toMatch(/from\s+['"]react-native['"]/);
        expect(content).not.toMatch(/from\s+['"]expo/);
        expect(content).not.toMatch(/from\s+['"].*infrastructure/);
        expect(content).not.toMatch(/from\s+['"].*application/);
        expect(content).not.toMatch(/from\s+['"].*ui/);
      }
    });

    test('application layer does not import UI, React Native, Expo, nor Infrastructure', () => {
      const appFiles = getSourceFiles(join(process.cwd(), 'src/application'));
      expect(appFiles.length).toBeGreaterThan(0);

      for (const file of appFiles) {
        const content = readFileSync(file, 'utf8');
        expect(content).not.toMatch(/from\s+['"]react['"]/);
        expect(content).not.toMatch(/from\s+['"]react-native['"]/);
        expect(content).not.toMatch(/from\s+['"]expo/);
        expect(content).not.toMatch(/from\s+['"].*infrastructure/);
        expect(content).not.toMatch(/from\s+['"].*ui/);
      }
    });
  });
});
