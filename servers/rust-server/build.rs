fn main() {
  prost_build::compile_protos(&["../../shared/params.proto"], &["../../"]).unwrap();
}
