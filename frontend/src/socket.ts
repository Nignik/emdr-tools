export const socket = new WebSocket("ws://localhost:4000");
socket.binaryType = "arraybuffer";

socket.onopen = () => {
    console.log("Połączono z serwerem WebSocket");
};

socket.onerror = (err) => {
    console.error("WebSocket error:", err);
};

socket.onclose = () => {
    console.log("Połączenie zamknięte");
};
