const { Server } = require("socket.io");
const protobuf = require("protobufjs");

const io = new Server(4000, {
    cors: { origin: "*" }
});

protobuf.load("params.proto", (err, root) => {
    if (err) throw err;

    const Params = root.lookupType("Params");

    io.on("connection", (socket) => {
        console.log("Client connected");

        socket.on("updateParams", (data) => {
            // data przychodzi jako Uint8Array (binarnie)
            const params = Params.decode(data); // deserializacja Protobuf
            console.log("New params:", params);

            // Wyślij z powrotem do wszystkich klientów (serializacja)
            const buffer = Params.encode(params).finish();
            io.emit("updateParams", buffer);
        });
    });
});
