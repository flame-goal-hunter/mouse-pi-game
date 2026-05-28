// Browser shim — colyseus.js wants 'ws' but in browsers we use the native WebSocket.
// Export the global WebSocket as default so `new ws(url)` works.
const WS = (typeof window !== 'undefined' && window.WebSocket) ? window.WebSocket : globalThis.WebSocket;
export default WS;
export { WS as WebSocket };
