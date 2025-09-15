const WebSocket = require("ws");
const protobuf = require("protobufjs");

const wss = new WebSocket.Server({ port: 4000 });

protobuf.load("params.proto", (err, root) => {
    if (err) {
        console.error("Proto load error:", err);
        process.exit(1);
    }

    // Typy w pełni kwalifikowane (z nazwą paczki!)
    const WebSocketMessage = root.lookupType("emdr_messages.WebSocketMessage");
    const WelcomeResponse  = root.lookupType("emdr_messages.WelcomeResponse");
    const Params           = root.lookupType("emdr_messages.Params");

    wss.on("connection", (ws) => {
        console.log("Client connected");

        ws.on("message", (message) => {
            try {
                const buffer = Buffer.isBuffer(message) ? message : Buffer.from(message);

                const incoming = WebSocketMessage.decode(buffer);

                const verifyErr = WebSocketMessage.verify(incoming);
                if (verifyErr) throw new Error(verifyErr);

                if (incoming.welcome_response) {
                    const wr = incoming.welcome_response; // { user_id: "..." }
                    console.log("[IN] WelcomeResponse:", wr);

                    const respMsg = WebSocketMessage.create({
                        welcome_response: WelcomeResponse.create({ user_id: wr.user_id }),
                    });
                    const respBuf = WebSocketMessage.encode(respMsg).finish();

                    broadcast(respBuf);
                } else if (incoming.params) {
                    const p = incoming.params; // { size, speed, color }
                    console.log("[IN] Params:", p);

                    const respMsg = WebSocketMessage.create({
                        params: Params.create({
                            size: p.size ?? 0,
                            speed: p.speed ?? 0,
                            color: p.color ?? "",
                        }),
                    });
                    const respBuf = WebSocketMessage.encode(respMsg).finish();

                    broadcast(respBuf);
                } else {
                    console.warn("[WARN] WebSocketMessage bez ustawionego pola oneof");
                }
            } catch (e) {
                console.error("Decode/handle error:", e);
            }
        });

        ws.on("close", () => {
            console.log("Client disconnected");
        });
    });

    function broadcast(buffer) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(buffer);
            }
        });
    }
});
