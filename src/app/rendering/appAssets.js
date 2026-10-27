import { Assets, Texture } from 'pixi.js';

async function loadTexture(url, { configure = null } = {}) {
  try {
    const texture = await Assets.load(url);
    configure?.(texture);
    return texture;
  } catch {
    // Unavailable images and incompatible texture sources both use the visible fallback.
    return Texture.WHITE;
  }
}

export async function loadAppTextures(assets) {
  const [car, safetyCar, trackTextures] = await Promise.all([
    loadTexture(assets.car, {
      configure(texture) {
        texture.source.scaleMode = 'linear';
        texture.source.autoGenerateMipmaps = true;
      },
    }),
    loadTexture(assets.safetyCar, {
      configure(texture) {
        texture.source.scaleMode = 'linear';
        texture.source.autoGenerateMipmaps = true;
      },
    }),
    Promise.all(Object.entries(assets.trackTextures).map(async ([key, url]) => [key, await loadTexture(url, {
      configure(texture) {
        texture.source.scaleMode = 'linear';
      },
    })])),
  ]);

  return { car, safetyCar, ...Object.fromEntries(trackTextures) };
}
