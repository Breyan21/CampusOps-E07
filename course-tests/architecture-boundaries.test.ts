import * as fs from 'fs';
import * as path from 'path';

function findFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findFiles(filePath, fileList);
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

describe('Architecture Boundaries', () => {
  it('UI should not import infrastructure directly', () => {
    const uiPath = path.join(__dirname, '../src/ui');
    const uiFiles = findFiles(uiPath);
    
    uiFiles.forEach(filePath => {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Busca un import que contenga la cadena "infrastructure"
      const importRegex = /import\s+.*from\s+['"].*infrastructure.*['"]/g;
      
      const hasForbiddenImport = importRegex.test(content);
      
      if (hasForbiddenImport) {
        console.error(`Error de Arquitectura: Archivo UI no debe importar desde infrastructure (${filePath})`);
      }
      
      expect(hasForbiddenImport).toBeFalsy();
    });
  });
});
