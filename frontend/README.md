npx protoc --plugin=protoc-gen-ts_proto=node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./src/generated --ts_proto_opt=esModuleInterop=true,forceLong=string -I ./../shared/ messages.proto

npm install

npm run dev
