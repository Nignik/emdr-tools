// src/socket.ts
function computeDefaultWsUrl(): string {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // Jeśli backend nasłuchuje pod /ws, zmień tu ścieżkę
    const path = "";
    return `${proto}://${window.location.host}${path}`;
}

const WS_URL =
    import.meta.env.VITE_WS_URL && import.meta.env.VITE_WS_URL.trim() !== ""
        ? import.meta.env.VITE_WS_URL
        : computeDefaultWsUrl();

export const socket = new WebSocket(WS_URL);
socket.binaryType = "arraybuffer";

socket.addEventListener("open", () => {
    console.log("Połączono z WebSocket:", WS_URL);
});

socket.addEventListener("error", (event: Event) => {
    console.error("WebSocket error:", event);
});

socket.addEventListener("close", (event: CloseEvent) => {
    console.log(
        `Połączenie zamknięte (code=${event.code}, reason=${event.reason || "—"})`
    );
});
