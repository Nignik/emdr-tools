const WebSocket = require("ws");
const protobuf = require("protobufjs");
const crypto = require("crypto");

const wss = new WebSocket.Server({ port: 4000 });

// Prosty magazyn sesji: id -> Set(ws)
const sessions = new Map();

protobuf.load("../../shared/messages.proto", (err, root) => {
    if (err) {
        console.error("Proto load error:", err);
        process.exit(1);
    }

    // Typy protobuf (z pakietem)
    const WebSocketMessage      = root.lookupType("emdr_messages.WebSocketMessage");
    const CreateSessionResponse = root.lookupType("emdr_messages.CreateSessionResponse");
    const JoinSessionResponse   = root.lookupType("emdr_messages.JoinSessionResponse");
    const Params                = root.lookupType("emdr_messages.Params");

    // === Handlery ===
    function handleCreateSessionRequest(ws) {
        console.log("[IN] CreateSessionRequest");
        const sessionId = crypto.randomUUID?.() || crypto.randomBytes(8).toString("hex");
        const sessionUrl = `wss://example.com/session/${sessionId}`;
        sessions.set(sessionId, new Set([ws]));

        send(ws, createMsg({
            create_session_response: CreateSessionResponse.create({
                accepted: true,
                session_url: sessionUrl,
            })
        }));
    }

    function handleJoinSessionRequest(ws, joinReq) {
        const { session_url } = joinReq;
        console.log("[IN] JoinSessionRequest:", session_url);

        const parts = String(session_url || "").split("/");
        const sessionId = parts[parts.length - 1];
        const exists = sessions.has(sessionId);

        if (exists) sessions.get(sessionId).add(ws);

        send(ws, createMsg({
            join_session_response: JoinSessionResponse.create({ accepted: !!exists })
        }));
    }

    function handleParams(p) {
        console.log("[IN] Params:", p);
        const resp = createMsg({
            params: Params.create({
                size: p.size ?? 0,
                speed: p.speed ?? 0,
                color: p.color ?? "",
            }),
        });
        broadcast(resp);
    }

    // === Helpery transportowe ===
    function createMsg(fields) {
        return WebSocketMessage.encode(WebSocketMessage.create(fields)).finish();
    }

    function send(ws, buffer) {
        if (ws.readyState === WebSocket.OPEN) ws.send(buffer);
    }

    function broadcast(buffer) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) client.send(buffer);
        });
    }

    function removeClientFromSessions(ws) {
        for (const [id, set] of sessions) {
            if (set.delete(ws) && set.size === 0) sessions.delete(id);
        }
    }

    function decodeAndVerify(buffer) {
        const msg = WebSocketMessage.decode(buffer);
        const err = WebSocketMessage.verify(WebSocketMessage.toObject(msg));
        if (err) throw new Error(err);
        return msg;
    }

    function getOneofCase(msg) {
        // Zwróć nazwę ustawionego pola oneof (albo null)
        if (msg.create_session_request) return "create_session_request";
        if (msg.join_session_request)   return "join_session_request";
        if (msg.create_session_response) return "create_session_response"; // (gdyby klient odesłał)
        if (msg.join_session_response)   return "join_session_response";
        if (msg.params)                  return "params";
        return null;
    }

    // === Główne zdarzenia WS ===
    wss.on("connection", (ws) => {
        console.log("Client connected");

        ws.on("message", (raw) => {
            try {
                const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                const incoming = decodeAndVerify(buffer);

                switch (getOneofCase(incoming)) {
                    case "create_session_request":
                        handleCreateSessionRequest(ws);
                        break;
                    case "join_session_request":
                        handleJoinSessionRequest(ws, incoming.join_session_request);
                        break;
                    case "params":
                        handleParams(incoming.params);
                        break;
                    default:
                        console.warn("[WARN] Nieobsługiwane/nieustawione pole oneof");
                }
            } catch (e) {
                console.error("Decode/handle error:", e);
            }
        });

        ws.on("close", () => {
            removeClientFromSessions(ws);
            console.log("Client disconnected");
        });
    });
});
