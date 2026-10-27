export function compactPolicyServerRuntimeOptions(controllerKind, options) {
  if (controllerKind !== 'policy-server') return options;
  return {
    ...options,
    observation: {
      ...(options.observation ?? {}),
      output: 'vector',
      includeSchema: false,
      vectorType: 'array',
    },
    result: {
      ...(options.result ?? {}),
      stateOutput: 'none',
    },
  };
}
