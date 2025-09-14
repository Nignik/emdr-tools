const WebSocket = require("ws");
const protobuf = require("protobufjs");

// Utwórz serwer WebSocket
const wss = new WebSocket.Server({ port: 4000 });

// Załaduj definicję Protobuf
protobuf.load("params.proto", (err, root) => {
    if (err) throw err;

    const Params = root.lookupType("Params");

    wss.on("connection", (ws) => {
        console.log("Client connected");

        ws.on("message", (message) => {
            try {
                // `message` to Buffer (Node.js) lub ArrayBuffer (browser)
                const buffer = Buffer.from(message);

                // Dekodowanie z protobuf
                const params = Params.decode(buffer);
                console.log("New params:", params);

                // Serializacja do protobuf
                const responseBuffer = Params.encode(params).finish();

                // Rozgłoś do wszystkich podłączonych klientów
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(responseBuffer);
                    }
                });
            } catch (e) {
                console.error("Decode error:", e);
            }
        });

        ws.on("close", () => {
            console.log("Client disconnected");
        });
    });
});
