import { Assets, Texture } from 'pixi.js';

async function loadTexture(url, { configure = null } = {}) {
  try {
    const texture = await Assets.load(url);
    configure?.(texture);
    return texture;
  } catch {
    return Texture.WHITE;
  }
}

export async function loadAppTextures(assets) {
  const textures = {
    car: await loadTexture(assets.car, {
      configure(texture) {
        texture.source.scaleMode = 'linear';
        texture.source.autoGenerateMipmaps = true;
      },
    }),
    safetyCar: await loadTexture(assets.safetyCar, {
      configure(texture) {
        texture.source.scaleMode = 'linear';
        texture.source.autoGenerateMipmaps = true;
      },
    }),
  };

  await Promise.all(Object.entries(assets.trackTextures).map(async ([key, url]) => {
    textures[key] = await loadTexture(url, {
      configure(texture) {
        texture.source.scaleMode = 'linear';
      },
    });
  }));

  return textures;
}
