const fs = require('fs').promises;
const path = require('path');

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  '.venv',
  '__pycache__',
  'AppData',
  'Windows',
  'Program Files',
  'Program Files (x86)'
]);

class LibrarianAgent {
  constructor(provider, { rootDir = process.env.LIBRARIAN_ROOT || process.cwd() } = {}) {
    this.provider = provider;
    this.rootDir = path.resolve(rootDir);
  }

  async analyzeFile(filePath) {
    try {
      const resolved = this.resolveReadablePath(filePath);
      const stats = await fs.stat(resolved);

      if (!stats.isFile()) {
        return `Not a file: ${resolved}`;
      }

      const content = await fs.readFile(resolved, 'utf8');
      const preview = content.slice(0, 2000);

      const analysis = await this.provider.generate({
        system: 'You are the Librarian. Summarize files and suggest practical organization metadata.',
        user: `Analyze this file:\nPath: ${resolved}\nSize: ${stats.size} bytes\nModified: ${stats.mtime.toISOString()}\n\nPreview:\n${preview}`,
        maxTokens: 256
      });

      return {
        path: resolved,
        size: stats.size,
        modified: stats.mtime,
        analysis
      };
    } catch (error) {
      return `Error analyzing file: ${error.message}`;
    }
  }

  async searchFiles(searchTerm, directory = this.rootDir, limit = 20) {
    const term = String(searchTerm || '').trim();
    if (!term) {
      return [];
    }

    const startDir = this.resolveReadablePath(directory);
    const results = [];
    const matcher = this.createMatcher(term);
    await this.walkAndSearch(startDir, matcher, results, limit);
    return results;
  }

  async walkAndSearch(dir, matcher, results, limit) {
    if (results.length >= limit) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (DEFAULT_IGNORES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walkAndSearch(fullPath, matcher, results, limit);
        continue;
      }

      if (entry.isFile() && matcher(entry.name)) {
        try {
          const stats = await fs.stat(fullPath);
          results.push({
            path: fullPath,
            size: stats.size,
            modified: stats.mtime
          });
        } catch {
          // Ignore files that disappear or cannot be read.
        }
      }
    }
  }

  createMatcher(term) {
    const lowerTerm = term.toLowerCase();
    if (!lowerTerm.includes('*') && !lowerTerm.includes('?')) {
      return (name) => name.toLowerCase().includes(lowerTerm);
    }

    const escaped = lowerTerm
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return (name) => regex.test(name);
  }

  async organizeDirectory(dirPath = this.rootDir) {
    const resolved = this.resolveReadablePath(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const sample = entries.slice(0, 80).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file'
    }));

    return this.provider.generate({
      system: 'You are the Librarian. Suggest a practical, low-risk file organization plan. Do not move files.',
      user: `Suggest organization for directory: ${resolved}\n\nEntries:\n${JSON.stringify(sample, null, 2)}`,
      maxTokens: 300
    });
  }

  resolveReadablePath(targetPath) {
    const candidate = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.rootDir, targetPath);

    return candidate;
  }
}

module.exports = { LibrarianAgent };
