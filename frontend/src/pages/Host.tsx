import React, { useEffect, useState } from "react";
import { WebSocketMessage, Params } from "../generated/messages"; // ts-proto
import { socket } from "../socket";
import MovingCircle from "../components/MovingCircle";
import "./Host.css";

const Host: React.FC = () => {
    const [size, setSize] = useState(40);
    const [speed, setSpeed] = useState(200);
    const [color, setColor] = useState("#00ff00");
    const [isUpdated, setIsUpdated] = useState(false);

    const [sessionUrl, setSessionUrl] = useState<string | null>(null);
    const [sid, setSid] = useState<string | null>(null);
    const [resetToken, setResetToken] = useState(0);

    // preferuj binarkę
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

    // Odbiór wiadomości z serwera
    useEffect(() => {
        const onMessage = async (ev: MessageEvent) => {
            try {
                const buffer = await toUint8Array(ev.data);
                const msg = WebSocketMessage.decode(buffer);

                if (msg.createSessionResponse) {
                    const { accepted, sessionUrl } = msg.createSessionResponse;
                    console.log("[Host] CreateSessionResponse:", { accepted, sessionUrl });
                    if (accepted && sessionUrl) {
                        setSessionUrl(sessionUrl);
                        // wyciągnij sid z URL
                        try {
                            const u = new URL(sessionUrl);
                            const s = u.searchParams.get("sid");
                            if (s) setSid(s);
                        } catch {
                            // jeśli to nie jest poprawny URL – spróbuj prymitywnie
                            const parts = String(sessionUrl).split("sid=");
                            if (parts[1]) setSid(parts[1].split("&")[0]);
                        }
                    }
                } else if (msg.params) {
                    console.log("[Host] Echo Params:", msg.params);
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

    // Wysyłka parametrów Z SID
    const updateParams = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }
        if (!sid) {
            console.warn("Brak SID — najpierw utwórz linka.");
            return;
        }

        const paramsMsg = Params.create({ size, speed, color, sid });
        const wsMsg = WebSocketMessage.create({ params: paramsMsg });
        const buffer = WebSocketMessage.encode(wsMsg).finish();
        socket.send(buffer);
        console.log("[Host] Sent Params with sid:", { size, speed, color, sid });

        // feedback i restart ruchu
        setIsUpdated(true);
        setTimeout(() => setIsUpdated(false), 1500);
        setResetToken((t) => t + 1);
    };

    // Wysyłka CreateSessionRequest (puste body w nowym .proto)
    const createSession = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }
        const wsMsg = WebSocketMessage.create({
            createSessionRequest: {}, // ts-proto camelCase
        });
        const buffer = WebSocketMessage.encode(wsMsg).finish();
        socket.send(buffer);
        console.log("[Host] Sent CreateSessionRequest");
    };

    return (
        <div className="host-root">
            {/* GÓRA: ~40% wysokości okna, pełna szerokość */}
            <section className="preview-surface">
                <MovingCircle
                    size={size}
                    speed={speed}
                    color={color}
                    boundToParent
                    resetToken={resetToken}
                />
            </section>

            {/* DÓŁ: pozostała wysokość, pełna szerokość */}
            <section className="controls-surface">
                <h2 className="host-title">Host Panel</h2>

                {/* Tworzenie sesji */}
                <div className="session-box">
                    <button type="button" className="create-link-btn" onClick={createSession}>
                        Utwórz linka
                    </button>
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
                            max={200}
                            value={size}
                            onChange={(e) => setSize(+e.target.value)}
                            aria-valuemin={10}
                            aria-valuemax={200}
                            aria-valuenow={size}
                        />
                        <div className="value-badge">{size}px</div>
                    </div>

                    <div className="control">
                        <label htmlFor="speed">Speed</label>
                        <input
                            id="speed"
                            type="range"
                            min={50}
                            max={1000}
                            step={10}
                            value={speed}
                            onChange={(e) => setSpeed(+e.target.value)}
                            aria-valuemin={50}
                            aria-valuemax={1000}
                            aria-valuenow={speed}
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
                            title={!sid ? "Najpierw utwórz linka (SID)" : "Wyślij parametry"}
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
