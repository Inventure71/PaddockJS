if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    enumerable: true,
    value: {
      userAgent: `Node.js/${process.versions.node}`,
    },
  });
}
