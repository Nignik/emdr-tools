Generate message.ts
`npx protoc --plugin=protoc-gen-ts_proto=node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./src/generated --ts_proto_opt=esModuleInterop=true,forceLong=string -I ./../shared/ messages.proto`

If there is no [.env.production](.env.production) it will get data from the server in [socket.ts](src/socket.ts)

npm install

npm run dev
