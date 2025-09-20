// server/index.js
const WebSocket = require("ws");
const protobuf = require("protobufjs");
const crypto = require("crypto");

const wss = new WebSocket.Server({ port: 4000 });

/**
 * sessions: Map<sessionId, { host: WebSocket|null, clients: Set<WebSocket> }>
 * wsMeta:   Map<WebSocket, { role: 'host'|'client', sessionId: string }>
 */
const sessions = new Map();
const wsMeta = new Map();

protobuf.load("../../shared/messages.proto", (err, root) => {
    if (err) {
        console.error("Proto load error:", err);
        process.exit(1);
    }

    const WebSocketMessage      = root.lookupType("emdr_messages.WebSocketMessage");
    const CreateSessionResponse = root.lookupType("emdr_messages.CreateSessionResponse");
    const JoinSessionResponse   = root.lookupType("emdr_messages.JoinSessionResponse");
    const Params                = root.lookupType("emdr_messages.Params");
    const JoinSessionRequest    = root.lookupType("emdr_messages.JoinSessionRequest");

    // ===== Helpers =====
    const encodeMsg = (fields) =>
        WebSocketMessage.encode(WebSocketMessage.create(fields)).finish();

    const send = (ws, buffer) => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(buffer);
    };

    const decodeAndVerify = (buffer) => {
        const msg = WebSocketMessage.decode(buffer);
        const plain = WebSocketMessage.toObject(msg);
        const verifyErr = WebSocketMessage.verify(plain);
        if (verifyErr) throw new Error(verifyErr);
        return msg;
    };

    const getOneofCase = (msg) => {
        const withOneof = WebSocketMessage.toObject(msg, { oneofs: true });
        return withOneof.message || null;
    };

    const removeSocketFromSession = (ws) => {
        const meta = wsMeta.get(ws);
        if (!meta) return;
        wsMeta.delete(ws);

        const ses = sessions.get(meta.sessionId);
        if (!ses) return;

        if (meta.role === "host") {
            // jeśli host wychodzi – zamknij sesję i rozłącz klientów
            ses.clients.forEach((c) => {
                try { c.close(1000, "Host disconnected"); } catch {}
                wsMeta.delete(c);
            });
            sessions.delete(meta.sessionId);
        } else {
            ses.clients.delete(ws);
            if (!ses.host && ses.clients.size === 0) {
                sessions.delete(meta.sessionId);
            }
        }
    };

    // ===== Handlery =====
    function handleCreateSessionRequest(ws) {
        console.log("[IN] CreateSessionRequest");

        const sessionId = crypto.randomUUID?.() || crypto.randomBytes(8).toString("hex");
        const sessionUrl = `http://localhost:5173/client?sid=${sessionId}`;

        // zarejestruj sesję i oznacz tego ws jako hosta
        sessions.set(sessionId, { host: ws, clients: new Set() });
        wsMeta.set(ws, { role: "host", sessionId });

        const respBuf = encodeMsg({
            createSessionResponse: CreateSessionResponse.create({
                accepted: true,
                sessionUrl, // camelCase
            }),
        });
        send(ws, respBuf);
    }

    function handleJoinSessionRequest(ws, joinReq) {
        // >>> WAŻNE: zakładamy JoinSessionRequest{ sid:string }
        const sid = (joinReq && joinReq.sid) ? String(joinReq.sid) : "";
        console.log("[IN] JoinSessionRequest:", { sid });

        const ses = sid && sessions.get(sid);
        const accepted = !!(ses && ses.host);

        // oznacz klienta i dopisz do sesji
        if (accepted) {
            ses.clients.add(ws);
            wsMeta.set(ws, { role: "client", sessionId: sid });
        }

        // 1) odpowiedź do KLIENTA
        const respToClient = encodeMsg({
            joinSessionResponse: JoinSessionResponse.create({ accepted })
        });
        send(ws, respToClient);

        // 2) DODATKOWO: powiadom HOSTA (OPCJA A)
        if (accepted && ses.host) {
            const respToHost = encodeMsg({
                joinSessionResponse: JoinSessionResponse.create({ accepted: true })
            });
            send(ses.host, respToHost);
        }
    }

    function handleParams(ws, p) {
        // wymagamy sid, żeby wysłać we właściwą sesję
        const sid = p?.sid ? String(p.sid) : "";
        if (!sid) {
            console.warn("[WARN] Params bez sid – ignoruję.");
            return;
        }
        const ses = sessions.get(sid);
        if (!ses) {
            console.warn("[WARN] Params dla nieistniejącej sesji:", sid);
            return;
        }

        // Możesz chcieć zwalidować pola (size/speed/color)
        const outBuf = encodeMsg({
            params: Params.create({
                size:  p.size  ?? 0,
                speed: p.speed ?? 0,
                color: p.color ?? "",
                sid   : sid, // zachowujemy sid
            }),
        });

        // wyślij do hosta i wszystkich klientów tej sesji
        send(ses.host, outBuf);
        ses.clients.forEach((c) => send(c, outBuf));
    }

    // ===== Serwer WS =====
    wss.on("connection", (ws) => {
        console.log("Client connected");

        ws.on("message", (raw) => {
            try {
                const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
                const incoming = decodeAndVerify(buffer);

                const oneofCase = getOneofCase(incoming);
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
                        handleParams(ws, incoming.params);
                        break;

                    default:
                        console.warn("[WARN] Nieobsługiwane/nieustawione pole oneof:", oneofCase);
                }
            } catch (e) {
                console.error("Decode/handle error:", e);
            }
        });

        ws.on("close", () => {
            removeSocketFromSession(ws);
            console.log("Client disconnected");
        });

        ws.on("error", (e) => {
            console.warn("WS error:", e?.message || e);
        });
    });

    console.log("WS server listening on ws://localhost:4000");
});
