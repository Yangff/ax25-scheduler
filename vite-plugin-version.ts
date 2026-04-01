import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

function getAllFiles(dir: string, base = ''): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...getAllFiles(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

function hashContent(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export default function versionPlugin(): Plugin {
  let outDir: string;
  let basePath: string;

  return {
    name: 'vite-plugin-version',
    enforce: 'post',

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      basePath = config.base || '/';
    },

    // Build: write version.json after all files are on disk
    writeBundle() {
      const files: Record<string, string> = {};
      const allFiles = getAllFiles(outDir);
      for (const file of allFiles) {
        if (file === 'version.json') continue;
        const content = fs.readFileSync(path.join(outDir, file));
        files[file] = hashContent(content);
      }
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify({ files }, null, 2)
      );
    },

    // Dev: serve version.json dynamically
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req as { url?: string }).url || '';

        let cleanUrl = url;
        if (basePath !== '/' && cleanUrl.startsWith(basePath)) {
          cleanUrl = cleanUrl.slice(basePath.length - 1);
        }

        if (cleanUrl === '/version.json') {
          // In dev, return empty files so SW installs cleanly (dev serves via HMR, not cache)
          const data = {
            files: {},
            _devTimestamp: Date.now(),
          };
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
          return;
        }

        next();
      });
    },
  };
}
