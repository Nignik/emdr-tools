// server/index.js
const WebSocket = require("ws");
const protobuf = require("protobufjs");
const crypto = require("crypto");

const wss = new WebSocket.Server({ port: 4000 });

// Map: sessionId -> Set<ws>
const sessions = new Map();

protobuf.load("../../shared/messages.proto", (err, root) => {
    if (err) {
        console.error("Proto load error:", err);
        process.exit(1);
    }

    const WebSocketMessage      = root.lookupType("emdr_messages.WebSocketMessage");
    const CreateSessionResponse = root.lookupType("emdr_messages.CreateSessionResponse");
    const JoinSessionResponse   = root.lookupType("emdr_messages.JoinSessionResponse");
    const Params                = root.lookupType("emdr_messages.Params");

    // ===== Helpers =====
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
        const plain = WebSocketMessage.toObject(msg); // verify oczekuje plain object
        const err = WebSocketMessage.verify(plain);
        if (err) throw new Error(err);
        return msg;
    }

    // Zwraca nazwę ustawionego wariantu oneof (camelCase), np. "createSessionRequest"
    function getOneofCase(msg) {
        const withOneof = WebSocketMessage.toObject(msg, { oneofs: true });
        return withOneof.message || null;
    }

    // ===== Handlery =====
    function handleCreateSessionRequest(ws) {
        console.log("[IN] CreateSessionRequest");

        const sessionId = crypto.randomUUID?.() || crypto.randomBytes(8).toString("hex");
        const sessionUrl = `http://localhost:5173/client?sid=${sessionId}`;

        sessions.set(sessionId, new Set([ws]));

        const respBuf = createMsg({
            createSessionResponse: CreateSessionResponse.create({
                accepted: true,
                sessionUrl, // camelCase nazwy pól w ts-proto/Twoim hoście
            }),
        });
        send(ws, respBuf);
    }

    function handleJoinSessionRequest(ws, joinReq) {
        const sessionUrl = joinReq?.sessionUrl ?? joinReq?.session_url ?? "";
        console.log("[IN] JoinSessionRequest:", sessionUrl);

        // Wyciągnij sid z query stringu
        let sessionId = "";
        try {
            const u = new URL(String(sessionUrl));
            sessionId = u.searchParams.get("sid") || "";
        } catch {
            const parts = String(sessionUrl || "").split("sid=");
            sessionId = parts[1] ? parts[1].split("&")[0] : "";
        }

        const exists = sessionId && sessions.has(sessionId);
        if (exists) sessions.get(sessionId).add(ws);

        const respBuf = createMsg({
            joinSessionResponse: JoinSessionResponse.create({ accepted: !!exists }),
        });
        send(ws, respBuf);
    }

    function handleParams(p) {
        console.log("[IN] Params:", p);
        const respBuf = createMsg({
            params: Params.create({
                size: p.size ?? 0,
                speed: p.speed ?? 0,
                color: p.color ?? "",
            }),
        });
        broadcast(respBuf);
    }

    // ===== Serwer WS =====
    wss.on("connection", (ws) => {
        console.log("Client connected");

        ws.on("message", (raw) => {
            try {
                const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                const incoming = decodeAndVerify(buffer);

                const oneofCase = getOneofCase(incoming);
                // Podgląd co przyszło (plain object + discriminator)
                const dump = WebSocketMessage.toObject(incoming, { oneofs: true });
                console.log("[IN] WebSocketMessage", JSON.stringify(dump, null, 2));
                console.log("[IN] oneof =", oneofCase);

                switch (oneofCase) {
                    case "createSessionRequest":
                        handleCreateSessionRequest(ws);
                        break;

                    case "joinSessionRequest":
                        handleJoinSessionRequest(ws, incoming.joinSessionRequest);
                        break;

                    case "params":
                        handleParams(incoming.params);
                        break;

                    default:
                        console.warn("[WARN] Nieobsługiwane/nieustawione pole oneof:", oneofCase);
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
