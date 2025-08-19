#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');

async function fixImports(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      await fixImports(fullPath);
    } else if (entry.name.endsWith('.js')) {
      const content = await readFile(fullPath, 'utf-8');
      const fixedContent = content.replace(
        /from\s+['"](\.[^'"]*)['"]/g,
        (match, path) => {
          if (path.endsWith('.js')) return match;
          return match.replace(path, path + '.js');
        }
      ).replace(
        /import\s+['"](\.[^'"]*)['"]/g,
        (match, path) => {
          if (path.endsWith('.js')) return match;
          return match.replace(path, path + '.js');
        }
      );
      
      if (content !== fixedContent) {
        await writeFile(fullPath, fixedContent);
        console.log(`Fixed imports in ${fullPath}`);
      }
    }
  }
}

fixImports(distDir).catch(console.error);
