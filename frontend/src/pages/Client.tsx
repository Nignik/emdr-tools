import React, { useEffect, useState } from "react";
import MovingCircle from "../components/MovingCircle";
import { WebSocketMessage, Params } from "../generated/params";
import { socket } from "../socket";

const Client: React.FC = () => {
    const [params, setParams] = useState<Params>({
        size: 40,
        speed: 200,
        color: "#00ff00"
    });

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            try {
                const buffer = new Uint8Array(event.data);
                const decoded: WebSocketMessage = WebSocketMessage.decode(buffer);
                const { params } = decoded;
                if (params) {
                    setParams({
                        size: params.size,
                        speed: params.speed,
                        color: params.color,
                    });
                }
            } catch (err) {
                console.error("Protobuf decode error:", err);
            }
        };

        socket.addEventListener("message", handler);

        return () => {
            socket.removeEventListener("message", handler);
        };
    }, []);

    return (
        <div>
            <MovingCircle size={params.size} speed={params.speed} color={params.color} />
        </div>
    );
};

export default Client;
