// Own one external-renderer subscription and its transport. Late packets and
// callbacks from an earlier connection cannot affect a replacement connection.
export function createLiveNodeConnection({ getExpert, onStatus, onChange = () => {}, onFrame = () => {},
  fetchPacket = globalThis.fetch, createSocket = (url) => new WebSocket(url),
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  let generation = 0;
  let active = null;

  function disconnect() {
    generation += 1;
    const previous = active;
    active = null;
    let failure = null;
    if (previous) {
      previous.abort.abort();
      if (previous.timer !== null) clearTimer(previous.timer);
      previous.subscribers.clear();
      try { previous.expert?.detachExternalRenderer?.(); } catch (error) { failure = error; }
      try { previous.socket?.close(); } catch (error) { failure ??= error; }
    }
    onStatus({ connected: false, detail: null, error: failure?.message ?? null });
    onChange();
  }

  function connect(url) {
    disconnect();
    if (!/^(https?|wss?):\/\//.test(url)) {
      onStatus({ connected: false, detail: null, error: 'URL must use ws://, wss://, http://, or https://' });
      return;
    }
    const connection = { generation, abort: new AbortController(), subscribers: new Set(), timer: null,
      socket: null, expert: getExpert() };
    active = connection;
    const current = () => active === connection && connection.generation === generation;
    const status = (value) => { if (current()) onStatus(value); };
    const source = { subscribe(callback) { connection.subscribers.add(callback); return () => connection.subscribers.delete(callback); } };
    function packet(payload) {
      if (!current() || !payload || typeof payload !== 'object') return;
      if (payload.type === 'preview:status') { status({ connected: true, detail: payload.status ?? null, error: null }); return; }
      const frame = payload.type === 'preview:snapshot'
        ? { snapshot: payload.snapshot, observation: payload.observation, meta: payload.meta ?? null } : payload;
      if (!frame.snapshot) return;
      connection.subscribers.forEach((callback) => callback(frame));
      const rendererState = connection.expert?.getExternalRendererState?.();
      if (rendererState?.lastError) {
        status({ connected: true, detail: 'render failed', error: rendererState.lastError });
        return;
      }
      status({ connected: true, detail: frame.meta?.step == null ? `frame ${new Date().toLocaleTimeString()}` : `step ${frame.meta.step}`, error: null });
      onFrame(frame, rendererState);
    }
    function attach() {
      if (!current()) return;
      try {
        connection.expert.attachExternalRenderer(source);
        onChange();
        onFrame();
      } catch (error) { disconnect(); onStatus({ connected: false, detail: 'attach failed', error: error.message }); }
    }
    if (/^https?:/.test(url)) {
      attach();
      if (!current()) return;
      status({ connected: true, detail: 'polling', error: null });
      async function poll() {
        try {
          const response = await fetchPacket(url, { cache: 'no-store', signal: connection.abort.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          packet(await response.json());
        } catch (error) { status({ connected: true, detail: 'polling', error: error.message }); }
        finally { if (current()) connection.timer = setTimer(poll, 200); }
      }
      void poll();
    } else {
      try { connection.socket = createSocket(url); }
      catch (error) { disconnect(); onStatus({ connected: false, detail: null, error: error.message }); return; }
      status({ connected: false, detail: 'connecting', error: null });
      const options = { signal: connection.abort.signal };
      connection.socket.addEventListener('open', () => { if (current()) { status({ connected: true, detail: 'connected', error: null }); attach(); } }, options);
      connection.socket.addEventListener('message', (event) => {
        if (!current()) return;
        try { packet(JSON.parse(event.data)); }
        catch (error) { status({ connected: true, detail: 'Malformed packet', error: error.message }); }
      }, options);
      connection.socket.addEventListener('error', () => status({ connected: false, detail: null, error: 'WebSocket error' }), options);
      connection.socket.addEventListener('close', () => { if (current()) disconnect(); }, options);
    }
    onChange();
  }
  return { connect, disconnect, get active() { return Boolean(active); }, get socketConnected() { return Boolean(active?.socket); } };
}
