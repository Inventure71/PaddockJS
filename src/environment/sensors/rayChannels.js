const RAY_CHANNEL_FLAGS = Symbol('rayChannelFlags');

export const RAY_CHANNELS = Object.freeze([
  'roadEdge',
  'kerb',
  'illegalSurface',
  'car',
]);

export function createRayChannelFlags() {
  const flags = {
    hasRoadEdge: false,
    hasKerb: false,
    hasIllegalSurface: false,
    hasCar: false,
    surfaceChannels: [],
    has: channelFlagsHas,
  };
  Object.defineProperty(flags, RAY_CHANNEL_FLAGS, {
    value: true,
    enumerable: false,
  });
  return flags;
}

export function writeRayChannelFlags(target = createRayChannelFlags(), channels = []) {
  ensureRayChannelFlags(target);
  target.hasRoadEdge = false;
  target.hasKerb = false;
  target.hasIllegalSurface = false;
  target.hasCar = false;
  target.surfaceChannels.length = 0;

  if (isRayChannelFlags(channels)) {
    if (channels.hasRoadEdge) target.hasRoadEdge = true;
    if (channels.hasKerb) {
      target.hasKerb = true;
      target.surfaceChannels.push('kerb');
    }
    if (channels.hasIllegalSurface) {
      target.hasIllegalSurface = true;
      target.surfaceChannels.push('illegalSurface');
    }
    if (channels.hasCar) target.hasCar = true;
    return target;
  }

  if (Array.isArray(channels)) {
    for (let index = 0; index < channels.length; index += 1) {
      enableRayChannel(target, channels[index]);
    }
    return target;
  }

  if (channels && typeof channels.has === 'function') {
    for (let index = 0; index < RAY_CHANNELS.length; index += 1) {
      const channel = RAY_CHANNELS[index];
      if (channels.has(channel)) enableRayChannel(target, channel);
    }
  }
  return target;
}

export function isLegalRaySurface(surface) {
  return surface === 'track' ||
    surface === 'kerb' ||
    surface === 'pit-entry' ||
    surface === 'pit-lane' ||
    surface === 'pit-exit' ||
    surface === 'pit-box';
}

function ensureRayChannelFlags(target) {
  if (!target.surfaceChannels) target.surfaceChannels = [];
  target.has = channelFlagsHas;
  if (!isRayChannelFlags(target)) {
    Object.defineProperty(target, RAY_CHANNEL_FLAGS, {
      value: true,
      enumerable: false,
    });
  }
}

function isRayChannelFlags(value) {
  return Boolean(value?.[RAY_CHANNEL_FLAGS]);
}

function enableRayChannel(target, channel) {
  if (channel === 'roadEdge') {
    target.hasRoadEdge = true;
  } else if (channel === 'kerb') {
    if (!target.hasKerb) target.surfaceChannels.push('kerb');
    target.hasKerb = true;
  } else if (channel === 'illegalSurface') {
    if (!target.hasIllegalSurface) target.surfaceChannels.push('illegalSurface');
    target.hasIllegalSurface = true;
  } else if (channel === 'car') {
    target.hasCar = true;
  }
}

function channelFlagsHas(channel) {
  if (channel === 'roadEdge') return this.hasRoadEdge;
  if (channel === 'kerb') return this.hasKerb;
  if (channel === 'illegalSurface') return this.hasIllegalSurface;
  if (channel === 'car') return this.hasCar;
  return false;
}
