import React, { useEffect, useMemo, useState } from "react";
import MovingCircle from "../components/MovingCircle";
import { WebSocketMessage, Params } from "../generated/messages";
import { socket } from "../socket";

const Client: React.FC = () => {
    const [params, setParams] = useState<Params>({
        size: 40,
        speed: 200,
        color: "#00ff00",
        sid: ""
    });
    const [sid, setSid] = useState<string | null>(null);
    const [resetToken, setResetToken] = useState(0);

    // Wyciągnij sid z URL (np. /client?sid=GUID)
    const { href, foundSid } = useMemo(() => {
        const url = new URL(window.location.href);
        const s = url.searchParams.get("sid");
        return { href: url.toString(), foundSid: s };
    }, []);

    useEffect(() => {
        setSid(foundSid ?? null);
    }, [foundSid]);

    // Pomocnicza konwersja event.data -> Uint8Array
    const toUint8Array = async (data: unknown): Promise<Uint8Array> => {
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
        if (typeof data === "string") return new TextEncoder().encode(data);
        throw new Error("Nieznany typ danych z WebSocket");
    };

    // Ustal preferencję binarki (jeśli to możliwe)
    useEffect(() => {
        if (socket) socket.binaryType = "arraybuffer";
    }, []);

    // Nasłuch wiadomości z serwera (Params itp.)
    useEffect(() => {
        const onMessage = async (event: MessageEvent) => {
            try {
                const buffer = await toUint8Array(event.data);
                const decoded = WebSocketMessage.decode(buffer);
                console.log(decoded);
                if (decoded.params) {
                    const p = decoded.params;
                    setParams({
                        size: p.size,
                        speed: p.speed,
                        color: p.color,
                        sid: p.sid
                    });
                    setResetToken((t) => t + 1); // 🔁 restart po nowych parametrach
                }
            } catch (err) {
                console.error("[Client] Protobuf decode error:", err);
            }
        };

        socket.addEventListener("message", onMessage);
        return () => {
            socket.removeEventListener("message", onMessage);
        };
    }, []);

    // Po połączeniu z WS wyślij joinSessionRequest z URL (zawiera sid)
    useEffect(() => {
        if (!sid) {
            console.warn("[Client] Brak `sid` w URL. Oczekuję adresu typu /client?sid=...");
            return;
        }

        const sendJoin = () => {
            try {
                const msg = WebSocketMessage.create({
                    // ts-proto: camelCase
                    joinSessionRequest: {
                        // .proto ma `string session_url = 1;`
                        // w ts-proto to jest `sessionUrl` — wyślemy pełny link (z sid)
                        sid: sid,
                    },
                });
                console.log(msg);
                const buf = WebSocketMessage.encode(msg).finish();
                socket.send(buf);
                console.log("[Client] Sent JoinSessionRequest with sid:", sid);
            } catch (e) {
                console.error("[Client] Send JoinSessionRequest error:", e);
            }
        };

        if (socket.readyState === WebSocket.OPEN) {
            sendJoin();
        } else {
            const onOpen = () => {
                sendJoin();
            };
            socket.addEventListener("open", onOpen, { once: true });
            return () => socket.removeEventListener("open", onOpen);
        }
    }, [sid, href]);

    return (
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
            <MovingCircle size={params.size} speed={params.speed} color={params.color} resetToken={resetToken} />
        </div>
    );
};

export default Client;
