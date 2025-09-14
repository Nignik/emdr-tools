import React, { useEffect, useState } from "react";
import MovingCircle from "../components/MovingCircle";
import socket from "../socket";
import { Params } from "../generated/params"; // import wygenerowanego pliku TS

interface ParamsType {
    size: number;
    speed: number;
    color: string;
}

const Client: React.FC = () => {
    const [params, setParams] = useState<ParamsType>({
        size: 40,
        speed: 200,
        color: "#00ff00"
    });

    useEffect(() => {
        const handler = (data: Uint8Array | ArrayBuffer) => {
            try {
                // jeśli to ArrayBuffer, zamieniamy na Uint8Array
                const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

                // deserializacja z wygenerowanej klasy
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

        socket.on("updateParams", handler);

        return () => {
            socket.off("updateParams", handler);
        };
    }, []);

    return (
        <div>
            <MovingCircle size={params.size} speed={params.speed} color={params.color} />
        </div>
    );
};

export default Client;
