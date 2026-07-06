const fs = require('fs').promises;
const path = require('path');
const { createLogger } = require('./StructuredLogger');

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
    this.logger = createLogger('librarian');
  }

  async analyzeFile(filePath) {
    this.logger.action('librarian.analyzeFile.start', { filePath });
    try {
      const resolved = this.resolveReadablePath(filePath);
      const stats = await fs.stat(resolved);

      if (!stats.isFile()) {
        this.logger.warn('librarian.analyzeFile.not_file', { filePath: resolved });
        return `Not a file: ${resolved}`;
      }

      const content = await fs.readFile(resolved, 'utf8');
      const preview = content.slice(0, 2000);

      const analysis = await this.provider.generate({
        system: 'You are the Librarian. Summarize files and suggest practical organization metadata.',
        user: `Analyze this file:\nPath: ${resolved}\nSize: ${stats.size} bytes\nModified: ${stats.mtime.toISOString()}\n\nPreview:\n${preview}`,
        maxTokens: 256
      });

      const result = {
        path: resolved,
        size: stats.size,
        modified: stats.mtime,
        analysis
      };
      this.logger.action('librarian.analyzeFile.complete', { filePath: resolved, size: stats.size });
      return result;
    } catch (error) {
      this.logger.error('librarian.analyzeFile.error', error, { filePath });
      return `Error analyzing file: ${error.message}`;
    }
  }

  async searchFiles(searchTerm, directory = this.rootDir, limit = 20) {
    const term = String(searchTerm || '').trim();
    if (!term) {
      return [];
    }

    this.logger.action('librarian.searchFiles.start', { searchTerm: term, directory, limit });
    const startDir = this.resolveReadablePath(directory);
    const results = [];
    const matcher = this.createMatcher(term);
    await this.walkAndSearch(startDir, matcher, results, limit);
    this.logger.action('librarian.searchFiles.complete', { searchTerm: term, directory: startDir, results: results.length });
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
    this.logger.action('librarian.organizeDirectory.start', { dirPath: resolved });
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const sample = entries.slice(0, 80).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file'
    }));

    try {
      const output = await this.provider.generate({
      system: 'You are the Librarian. Suggest a practical, low-risk file organization plan. Do not move files.',
      user: `Suggest organization for directory: ${resolved}\n\nEntries:\n${JSON.stringify(sample, null, 2)}`,
      maxTokens: 300
      });
      this.logger.action('librarian.organizeDirectory.complete', { dirPath: resolved, outputChars: output.length });
      return output;
    } catch (error) {
      this.logger.error('librarian.organizeDirectory.error', error, { dirPath: resolved });
      throw error;
    }
  }

  resolveReadablePath(targetPath) {
    const candidate = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.rootDir, targetPath);

    return candidate;
  }
}

module.exports = { LibrarianAgent };
