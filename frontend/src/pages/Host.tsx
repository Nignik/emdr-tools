import React, { useState } from "react";
import { WebSocketMessage, Params } from "../generated/params";
import { socket } from "../socket";
import MovingCircle from "../components/MovingCircle";
import "./Host.css";

const Host: React.FC = () => {
    const [size, setSize] = useState(40);
    const [speed, setSpeed] = useState(200);
    const [color, setColor] = useState("#00ff00");
    const [isUpdated, setIsUpdated] = useState(false);

    const updateParams = () => {
        if (socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }

        const params: Params = { size, speed, color };
        const message: WebSocketMessage = { params };

        const buffer = WebSocketMessage.encode(message).finish();
        socket.send(buffer);
        console.log("Sending message");

        // feedback po kliknięciu
        setIsUpdated(true);
        setTimeout(() => setIsUpdated(false), 1500); // powrót do normalnego stanu
    };

    return (
        <div className="host-root">
            {/* GÓRA: ~40% wysokości okna, pełna szerokość */}
            <section className="preview-surface">
                <MovingCircle size={size} speed={speed} color={color} boundToParent />
            </section>

            {/* DÓŁ: pozostała wysokość, pełna szerokość */}
            <section className="controls-surface">
                <h2 className="host-title">Host Panel</h2>

                <form
                    className="controls-vertical"
                    onSubmit={(e) => { e.preventDefault(); updateParams(); }}
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
                        <button type="button" className={`update-btn ${isUpdated ? "clicked" : ""}`} onClick={updateParams}>
                            {isUpdated ? "✔ Updated!" : "Update"}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
};

export default Host;
