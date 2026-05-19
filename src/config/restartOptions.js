export function mergeRestartOptions(previousOptions, nextOptions = {}) {
  const resetFromPreset = Object.hasOwn(nextOptions, 'preset');
  const previousUi = resetFromPreset ? {} : (previousOptions.ui ?? {});
  const previousTheme = resetFromPreset ? {} : (previousOptions.theme ?? {});
  const previousAssets = previousOptions.assets ?? {};
  const nextAssets = nextOptions.assets ?? {};

  return {
    ...previousOptions,
    ...nextOptions,
    ui: {
      ...previousUi,
      ...(nextOptions.ui ?? {}),
      raceDataBanners: {
        ...(previousUi.raceDataBanners ?? {}),
        ...(nextOptions.ui?.raceDataBanners ?? {}),
      },
    },
    theme: {
      ...previousTheme,
      ...(nextOptions.theme ?? {}),
    },
    assets: {
      ...previousAssets,
      ...nextAssets,
      trackTextures: {
        ...(previousAssets.trackTextures ?? {}),
        ...(nextAssets.trackTextures ?? {}),
      },
    },
    drivers: nextOptions.drivers ?? previousOptions.drivers,
    entries: nextOptions.entries ?? previousOptions.entries,
  };
}
