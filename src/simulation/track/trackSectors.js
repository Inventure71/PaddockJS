export function createTrackSectors(totalLength) {
  return Array.from({ length: 3 }, (_, index) => {
    const startRatio = index / 3;
    const endRatio = (index + 1) / 3;
    const start = totalLength * startRatio;
    const end = totalLength * endRatio;

    return {
      index: index + 1,
      id: `s${index + 1}`,
      label: `S${index + 1}`,
      start,
      end,
      startRatio,
      endRatio,
      length: end - start,
    };
  });
}
