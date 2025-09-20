import React, { useEffect, useRef, useState } from "react";
import { WebSocketMessage, Params } from "../generated/messages";
import { socket } from "../socket";
import MovingCircle from "../components/MovingCircle";
import "./Host.css";

const THROTTLE_MS = 200;

const Host: React.FC = () => {
    const [size, setSize] = useState(40);
    const [speed, setSpeed] = useState(200);
    const [color, setColor] = useState("#00ff00");
    const [isUpdated, setIsUpdated] = useState(false);

    const [sessionUrl, setSessionUrl] = useState<string | null>(null);
    const [sid, setSid] = useState<string | null>(null);

    // resetToken – powoduje start od lewej po zmianie (używany TYLKO przy joinie)
    const [resetToken, setResetToken] = useState(0);

    // Status klienta
    const [clientConnected, setClientConnected] = useState(false);

    useEffect(() => {
        if (socket) socket.binaryType = "arraybuffer";
    }, []);

    const toUint8Array = async (data: unknown): Promise<Uint8Array> => {
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
        if (typeof data === "string") return new TextEncoder().encode(data);
        // @ts-ignore
        if (data?.byteLength && data?.buffer) return new Uint8Array(data);
        throw new Error("[Host] Nieznany typ danych z WebSocket");
    };

    useEffect(() => {
        const onMessage = async (ev: MessageEvent) => {
            try {
                const buffer = await toUint8Array(ev.data);
                const msg = WebSocketMessage.decode(buffer);

                if (msg.createSessionResponse) {
                    const { accepted, sessionUrl } = msg.createSessionResponse;
                    if (accepted && sessionUrl) {
                        setSessionUrl(sessionUrl);
                        setClientConnected(false); // nowa sesja – reset statusu klienta
                        try {
                            const u = new URL(sessionUrl);
                            const s = u.searchParams.get("sid");
                            if (s) setSid(s);
                        } catch {
                            const parts = String(sessionUrl).split("sid=");
                            if (parts[1]) setSid(parts[1].split("&")[0]);
                        }
                    }
                } else if (msg.joinSessionResponse) {
                    // 🎯 Ktoś dołączył do tej sesji – ustaw status i zresetuj kulkę po stronie hosta
                    if (msg.joinSessionResponse.accepted) {
                        setClientConnected(true);
                        setResetToken(t => t + 1); // <<< start od lewej
                    }
                } else if (msg.params) {
                    // echo/odbicia – bez resetu
                    // console.log("[Host] Echo Params:", msg.params);
                }
            } catch (e) {
                console.error("[Host] Decode error:", e);
            }
        };

        socket.addEventListener("message", onMessage);
        return () => {
            socket.removeEventListener("message", onMessage);
        };
    }, []);

    // Wspólna wysyłka parametrów (bez resetu!)
    const sendParams = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return false;
        }
        if (!sid) {
            console.warn("Brak SID — najpierw utwórz linka.");
            return false;
        }
        const paramsMsg = Params.create({ size, speed, color, sid });
        const wsMsg = WebSocketMessage.create({ params: paramsMsg });
        const buffer = WebSocketMessage.encode(wsMsg).finish();
        socket.send(buffer);
        return true;
    };

    const updateParams = () => {
        const ok = sendParams();
        if (!ok) return;
        setIsUpdated(true);
        setTimeout(() => setIsUpdated(false), 1000);
        // ❌ brak setResetToken – parametry nie resetują pozycji kulki
    };

    const createSession = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }
        const wsMsg = WebSocketMessage.create({ createSessionRequest: {} });
        const buffer = WebSocketMessage.encode(wsMsg).finish();
        socket.send(buffer);
    };

    // Live update (size + speed) – bez resetu
    const lastSentAtRef = useRef<number>(0);
    const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (!sid || !socket || socket.readyState !== WebSocket.OPEN) return;

        const now = Date.now();
        const elapsed = now - lastSentAtRef.current;

        if (elapsed >= THROTTLE_MS) {
            if (sendParams()) lastSentAtRef.current = Date.now();
            return;
        }

        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
            if (sendParams()) lastSentAtRef.current = Date.now();
            pendingTimerRef.current = null;
        }, THROTTLE_MS - elapsed);

        return () => {
            if (pendingTimerRef.current) {
                clearTimeout(pendingTimerRef.current);
                pendingTimerRef.current = null;
            }
        };
    }, [size, speed, sid]);

    return (
        <div className="host-root">
            <section className="preview-surface">
                <MovingCircle
                    size={size}
                    speed={speed}
                    color={color}
                    boundToParent
                    resetToken={resetToken} // reset tylko na join
                />
            </section>

            <section className="controls-surface">
                <h2 className="host-title">Host Panel</h2>

                <div className="session-box">
                    <div className="session-row">
                        <button type="button" className="create-link-btn" onClick={createSession}>
                            Utwórz linka
                        </button>
                        <div
                            className={`client-status-badge ${clientConnected ? "connected" : "waiting"}`}
                            aria-live="polite"
                        >
                            <span className="dot" />
                            {clientConnected ? "Klient podłączony" : "Oczekiwanie na klienta…"}
                        </div>
                    </div>

                    {sessionUrl && (
                        <div className="session-url">
                            Link do sesji:&nbsp;
                            <a href={sessionUrl} target="_blank" rel="noreferrer">
                                {sessionUrl}
                            </a>
                        </div>
                    )}
                    {sid && (
                        <div className="session-sid">
                            SID:&nbsp;<code>{sid}</code>
                        </div>
                    )}
                </div>

                <form
                    className="controls-vertical"
                    onSubmit={(e) => {
                        e.preventDefault();
                        updateParams();
                    }}
                >
                    <div className="control">
                        <label htmlFor="size">Size</label>
                        <input
                            id="size"
                            type="range"
                            min={10}
                            max={300}
                            value={size}
                            onChange={(e) => setSize(+e.target.value)}
                        />
                        <div className="value-badge">{size}px</div>
                    </div>

                    <div className="control">
                        <label htmlFor="speed">Speed</label>
                        <input
                            id="speed"
                            type="range"
                            min={50}
                            max={3000}
                            step={10}
                            value={speed}
                            onChange={(e) => setSpeed(+e.target.value)}
                        />
                        <div className="value-badge">{speed}</div>
                    </div>

                    <div className="control">
                        <label htmlFor="color">Color</label>
                        <input
                            id="color"
                            type="color"
                            value={color}
                            onChange={(e) => setColor(e.target.value)}
                        />
                        <div className="value-badge value-badge--mono">{color}</div>
                    </div>

                    <div className="actions">
                        <button
                            type="button"
                            className={`update-btn ${isUpdated ? "clicked" : ""}`}
                            onClick={updateParams}
                            disabled={!sid}
                        >
                            {isUpdated ? "✔ Updated!" : "Update"}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
};

export default Host;
