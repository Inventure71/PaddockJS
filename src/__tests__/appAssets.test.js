import { Assets, Texture } from 'pixi.js';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadAppTextures } from '../app/rendering/appAssets.js';

const assets = { car: 'car.png', safetyCar: 'safety.png', trackTextures: { asphalt: 'asphalt.png' } };

afterEach(() => vi.restoreAllMocks());

describe('app texture loading', () => {
  test('starts independent sprite and track loads together without serial network waits', async () => {
    const pending = new Map();
    const load = vi.spyOn(Assets, 'load').mockImplementation((url) => new Promise((resolve) => pending.set(url, resolve)));
    const result = loadAppTextures(assets);
    expect(load.mock.calls.map(([url]) => url)).toEqual(['car.png', 'safety.png', 'asphalt.png']);
    const textures = Object.fromEntries([...pending.keys()].map((url) => [url, { source: {} }]));
    for (const [url, resolve] of pending) resolve(textures[url]);
    expect(await result).toEqual({ car: textures['car.png'], safetyCar: textures['safety.png'], asphalt: textures['asphalt.png'] });
  });

  test('configures sprites and track textures for their rendering roles', async () => {
    const loaded = new Map(['car.png', 'safety.png', 'asphalt.png']
      .map((url) => [url, { source: {} }]));
    vi.spyOn(Assets, 'load').mockImplementation(async (url) => loaded.get(url));

    const textures = await loadAppTextures(assets);

    expect(textures.car).toBe(loaded.get('car.png'));
    expect(textures.safetyCar).toBe(loaded.get('safety.png'));
    expect(textures.asphalt).toBe(loaded.get('asphalt.png'));
    expect(textures.car.source).toEqual({ scaleMode: 'linear', autoGenerateMipmaps: true });
    expect(textures.safetyCar.source).toEqual({ scaleMode: 'linear', autoGenerateMipmaps: true });
    expect(textures.asphalt.source).toEqual({ scaleMode: 'linear' });
  });

  test.each(['load', 'configure'])('keeps the fallback isolated to a texture whose %s phase fails', async (phase) => {
    const safetyCar = { source: {} };
    const asphalt = { source: {} };
    vi.spyOn(Assets, 'load').mockImplementation(async (url) => {
      if (url === 'safety.png') return safetyCar;
      if (url === 'asphalt.png') return asphalt;
      if (phase === 'load') throw new Error('Image unavailable');
      return { get source() { throw new Error('Texture source unavailable'); } };
    });

    const textures = await loadAppTextures(assets);

    expect(textures).toEqual({ car: Texture.WHITE, safetyCar, asphalt });
    expect(safetyCar.source.autoGenerateMipmaps).toBe(true);
    expect(asphalt.source.scaleMode).toBe('linear');
  });
});
