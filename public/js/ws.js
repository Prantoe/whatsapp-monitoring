export function createWs() {
    const ws = new WebSocket(
      (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws"
    );
  
    const sendCmd = (action, payload = {}) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify({ type: "cmd", data: { action, ...payload } }));
      return true;
    };
  
    return { ws, sendCmd };
  }
  