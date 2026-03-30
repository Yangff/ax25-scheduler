import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';

interface ConventionMeta {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface ConventionFile {
  name: string;
  startDate: string;
  endDate: string;
  fake?: boolean;
  events: unknown[];
}

function readConventions(conventionsDir: string, includeFakes: boolean) {
  if (!fs.existsSync(conventionsDir)) return { index: [] as ConventionMeta[], files: new Map<string, string>() };

  const files = fs.readdirSync(conventionsDir).filter((f: string) => f.endsWith('.json'));
  const index: ConventionMeta[] = [];
  const conventionFiles = new Map<string, string>();

  for (const file of files) {
    const id = file.replace('.json', '');
    const raw = fs.readFileSync(path.join(conventionsDir, file), 'utf8');
    const data: ConventionFile = JSON.parse(raw);

    if (data.fake && !includeFakes) continue;

    // Strip the "fake" field from the served data
    const { fake: _, ...cleanData } = data;
    conventionFiles.set(id, JSON.stringify(cleanData));
    index.push({ id, name: data.name, startDate: data.startDate, endDate: data.endDate });
  }

  return { index, files: conventionFiles };
}

export default function conventionsPlugin(): Plugin {
  let conventionsDir: string;
  let basePath: string;

  return {
    name: 'vite-plugin-conventions',

    configResolved(config) {
      conventionsDir = path.resolve(config.root, 'conventions');
      basePath = config.base || '/';
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req as { url?: string }).url || '';

        // Strip basePath prefix for matching
        let cleanUrl = url;
        if (basePath !== '/' && cleanUrl.startsWith(basePath)) {
          cleanUrl = cleanUrl.slice(basePath.length - 1);
        }

        // Serve conventions index (dev includes fakes)
        if (cleanUrl === '/conventions.json') {
          const { index } = readConventions(conventionsDir, true);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(index));
          return;
        }

        // Serve individual convention file
        const match = cleanUrl.match(/^\/convention\/([^/]+)\.json$/);
        if (match) {
          const id = match[1];
          const { files } = readConventions(conventionsDir, true);
          const data = files.get(id);
          if (data) {
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
            return;
          }
          res.statusCode = 404;
          res.end('Convention not found');
          return;
        }

        next();
      });
    },

    generateBundle() {
      // Build: only include non-fake conventions
      const { index, files } = readConventions(conventionsDir, false);

      // Emit conventions.json index
      this.emitFile({
        type: 'asset',
        fileName: 'conventions.json',
        source: JSON.stringify(index),
      });

      // Emit individual convention files
      for (const [id, data] of files) {
        this.emitFile({
          type: 'asset',
          fileName: `convention/${id}.json`,
          source: data,
        });
      }
    },
  };
}
