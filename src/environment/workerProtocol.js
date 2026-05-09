export function createEnvironmentWorkerProtocol(env) {
  return {
    handle(message = {}) {
      try {
        return handleEnvironmentMessage(env, message);
      } catch (error) {
        return createErrorResponse(message, error);
      }
    },
  };
}

export function handleEnvironmentMessage(env, message = {}) {
  const id = message.id ?? null;
  switch (message.type) {
    case 'reset':
      return createSuccessResponse(id, 'reset:result', env.reset(message.options ?? {}));
    case 'step':
      return createSuccessResponse(id, 'step:result', env.step(message.actions ?? {}));
    case 'getActionSpec':
      return createSuccessResponse(id, 'getActionSpec:result', env.getActionSpec());
    case 'getObservationSpec':
      return createSuccessResponse(id, 'getObservationSpec:result', env.getObservationSpec());
    case 'getObservation':
      return createSuccessResponse(id, 'getObservation:result', env.getObservation());
    case 'getState':
      return createSuccessResponse(id, 'getState:result', env.getState());
    case 'destroy':
      env.destroy();
      return createSuccessResponse(id, 'destroy:result', null);
    default:
      throw new Error(`Unsupported PaddockJS environment worker message type: ${message.type}`);
  }
}

function createSuccessResponse(id, type, result) {
  return {
    id,
    ok: true,
    type,
    result,
  };
}

function createErrorResponse(message, error) {
  return {
    id: message?.id ?? null,
    ok: false,
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
  };
}
