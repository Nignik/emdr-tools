import React, { useEffect, useState } from "react";
import { WebSocketMessage, Params } from "../generated/messages";
import { socket } from "../socket";
import MovingCircle from "../components/MovingCircle";
import "./Host.css";

const Host: React.FC = () => {
    const [size, setSize] = useState(40);
    const [speed, setSpeed] = useState(200);
    const [color, setColor] = useState("#00ff00");
    const [isUpdated, setIsUpdated] = useState(false);
    const [resetToken, setResetToken] = useState(0);

    const [sessionUrl, setSessionUrl] = useState<string | null>(null);

    // zamiana ev.data → Uint8Array
    const toUint8Array = async (data: unknown): Promise<Uint8Array> => {
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
        if (typeof data === "string") return new TextEncoder().encode(data);
        throw new Error("Nieznany typ danych z WebSocket");
    };

    useEffect(() => {
        if (!socket) return;
        socket.binaryType = "arraybuffer";

        const onMessage = async (ev: MessageEvent) => {
            try {
                const buffer = await toUint8Array(ev.data);
                const msg = WebSocketMessage.decode(buffer);

                if (msg.createSessionResponse) {
                    const { accepted, sessionUrl } = msg.createSessionResponse;
                    console.log("[Host] CreateSessionResponse:", { accepted, sessionUrl });
                    if (accepted && sessionUrl) setSessionUrl(sessionUrl);
                } else if (msg.params) {
                    console.log("[Host] Echo Params:", msg.params);
                }
            } catch (e) {
                console.error("[Host] Decode error:", e);
            }
        };

        socket.addEventListener("message", onMessage as any);
        return () => {
            socket.removeEventListener("message", onMessage as any);
        };
    }, []);

    const updateParams = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }

        const paramsMsg = Params.create({ size, speed, color });
        const wsMsg = WebSocketMessage.create({ params: paramsMsg });
        const buffer = WebSocketMessage.encode(wsMsg).finish();
        socket.send(buffer);

        console.log("[Host] Sent Params:", { size, speed, color });
        setIsUpdated(true);
        setTimeout(() => setIsUpdated(false), 1500);
        setResetToken((t) => t + 1);   // 🔁 zainicjuj restart ruchu
    };

    const createSession = () => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }

        // ✅ camelCase dla ts-proto
        const wsMsg = WebSocketMessage.create({
            createSessionRequest: {},
        });
        const buffer = WebSocketMessage.encode(wsMsg).finish();
        socket.send(buffer);

        console.log("[Host] Sent CreateSessionRequest");
    };

    return (
        <div className="host-root">
            <section className="preview-surface">
                <MovingCircle size={size} speed={speed} color={color} boundToParent resetToken={resetToken}/>
            </section>

            <section className="controls-surface">
                <h2 className="host-title">Host Panel</h2>

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
