const { execFile: execFileCallback } = require('child_process');
const { promisify } = require('util');

const execFile = promisify(execFileCallback);

function canonicalizeFontFamilies(values) {
  const families = [];
  const seen = new Set();
  for (const rawValue of values || []) {
    for (const rawName of String(rawValue || '').split(',')) {
      const name = rawName.trim();
      if (!name || name.startsWith('.') || name.length > 100
        || /[\u0000-\u001f\u007f]/.test(name)) continue;
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      families.push(name);
    }
  }
  return families.sort((left, right) => left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base'
  }));
}

function macFontFamilies(output) {
  const parsed = JSON.parse(output);
  const values = [];
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && ['family', 'family_name', 'familyname'].includes(key.toLowerCase())) {
        values.push(child);
      } else {
        visit(child);
      }
    }
  }
  visit(parsed.SPFontsDataType || parsed);
  return canonicalizeFontFamilies(values);
}

function linuxFontFamilies(output) {
  return canonicalizeFontFamilies(String(output || '').split(/\r?\n/));
}

function createFontService({ platform = process.platform, run = execFile } = {}) {
  let cached = null;
  return {
    async listFontFamilies() {
      if (cached) return [...cached];
      let families = [];
      if (platform === 'darwin') {
        const { stdout } = await run('/usr/sbin/system_profiler', ['SPFontsDataType', '-json'], {
          maxBuffer: 32 * 1024 * 1024
        });
        families = macFontFamilies(stdout);
      } else if (platform === 'linux') {
        const { stdout } = await run('fc-list', ['--format=%{family}\n'], {
          maxBuffer: 16 * 1024 * 1024
        });
        families = linuxFontFamilies(stdout);
      }
      cached = families;
      return [...cached];
    }
  };
}

module.exports = {
  canonicalizeFontFamilies,
  createFontService,
  linuxFontFamilies,
  macFontFamilies
};
