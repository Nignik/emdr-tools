import React, { useEffect, useState } from "react";
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

    // 🔑 sid od razu z URL
    const [sid] = useState<string | null>(() => {
        const url = new URL(window.location.href);
        return url.searchParams.get("sid");
    });

    const [resetToken, setResetToken] = useState(0);

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

    // Nasłuch wiadomości z serwera
    useEffect(() => {
        const onMessage = async (event: MessageEvent) => {
            try {
                const buffer = await toUint8Array(event.data);
                const decoded = WebSocketMessage.decode(buffer);

                // ✅ Reset TYLKO przy zaakceptowanym joinie
                if (decoded.joinSessionResponse?.accepted) {
                    setResetToken((t) => t + 1);
                }

                // Aktualizacje parametrów — BEZ resetu pozycji
                if (decoded.params) {
                    const p = decoded.params;
                    setParams({
                        size: p.size,
                        speed: p.speed,
                        color: p.color,
                        sid: p.sid
                    });
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

    // Po połączeniu z WS wyślij joinSessionRequest (zawiera sid)
    useEffect(() => {
        if (!sid) {
            console.warn("[Client] Brak `sid` w URL. Oczekuję adresu typu /client?sid=...");
            return;
        }

        const sendJoin = () => {
            try {
                const msg = WebSocketMessage.create({
                    joinSessionRequest: { sid }
                });
                const buf = WebSocketMessage.encode(msg).finish();
                socket.send(buf);
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
    }, [sid]);

    return (
        <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}>
            <MovingCircle
                size={params.size}
                speed={params.speed}
                color={params.color}
                resetToken={resetToken}
            />
        </div>
    );
};

export default Client;
