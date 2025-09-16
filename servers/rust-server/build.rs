fn main() {
  prost_build::compile_protos(&["../../shared/messages.proto"], &["../../"]).unwrap();
}
