import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const BROWSEROS_BUNDLED = path.join(
  ROOT,
  '..',
  'browseros',
  'chromium_patches',
  'chrome',
  'browser',
  'browseros',
  'bundled_extensions',
);

describe('Bundle integration', () => {
  it('manifest.json is valid MV2', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf-8'),
    );
    expect(manifest.manifest_version).toBe(2);
    expect(manifest.permissions).toContain('webRequest');
    expect(manifest.permissions).toContain('webRequestBlocking');
    expect(manifest.background).toBeDefined();
    expect(manifest.content_scripts).toBeDefined();
    expect(manifest.content_scripts[0].run_at).toBe('document_start');
  });

  it('dist/ contains built files', () => {
    expect(
      fs.existsSync(path.join(ROOT, 'dist', 'background.iife.js')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(ROOT, 'dist', 'content-script.iife.js')),
    ).toBe(true);
  });

  it('background.iife.js is non-trivial (> 100KB)', () => {
    const stat = fs.statSync(path.join(ROOT, 'dist', 'background.iife.js'));
    expect(stat.size).toBeGreaterThan(100_000);
  });

  it('content-script.iife.js is non-trivial (> 10KB)', () => {
    const stat = fs.statSync(
      path.join(ROOT, 'dist', 'content-script.iife.js'),
    );
    expect(stat.size).toBeGreaterThan(10_000);
  });

  it('BUILD.gn references adblocker CRX', () => {
    const buildGn = fs.readFileSync(
      path.join(BROWSEROS_BUNDLED, 'BUILD.gn'),
      'utf-8',
    );
    expect(buildGn).toContain('browseros-adblocker.crx');
  });

  it('bundled_extensions.json includes adblocker entry', () => {
    const json = JSON.parse(
      fs.readFileSync(
        path.join(BROWSEROS_BUNDLED, 'bundled_extensions.json'),
        'utf-8',
      ),
    );
    const adblocker = json.find((e: any) => e.name === 'Ad Blocker');
    expect(adblocker).toBeDefined();
    expect(adblocker.filename).toBe('browseros-adblocker.crx');
  });
});
