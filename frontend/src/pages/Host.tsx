import React, { useState } from "react";
import { WebSocketMessage, Params } from "../generated/params";
import { socket } from "../socket";

const Host: React.FC = () => {
    const [size, setSize] = useState(40);
    const [speed, setSpeed] = useState(200);
    const [color, setColor] = useState("#00ff00");

    const updateParams = () => {
        if (socket.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket nie jest połączony");
            return;
        }
        
        const params: Params = {
            size: size,
            speed: speed,
            color: color
        }
        const message: WebSocketMessage = {
            params: params
        }

        const buffer = WebSocketMessage.encode(message).finish();
        socket.send(buffer);
        console.log("Sending message")
    };

    return (
        <div style={{ padding: 20 }}>
            <h2>Host Panel</h2>
            <div style={{ marginBottom: 10 }}>
                <label>Size: {size}</label>
                <input type="range" min={10} max={200} value={size} onChange={(e) => setSize(+e.target.value)} />
            </div>
            <div style={{ marginBottom: 10 }}>
                <label>Speed: {speed}</label>
                <input type="range" min={50} max={1000} step={10} value={speed} onChange={(e) => setSpeed(+e.target.value)} />
            </div>
            <div style={{ marginBottom: 10 }}>
                <label>Color: </label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <button onClick={updateParams}>Update</button>
        </div>
    );
};

export default Host;
