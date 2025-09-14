import React, { useEffect, useState } from "react";
import MovingCircle from "../components/MovingCircle";
import { Params } from "../generated/params";
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
                const decoded: Params = Params.decode(buffer);

                setParams({
                    size: decoded.size,
                    speed: decoded.speed,
                    color: decoded.color
                });
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
