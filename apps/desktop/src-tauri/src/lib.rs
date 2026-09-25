// Native shell: hosts the same web build. All modelling/rendering already runs locally (WebGL2 +
// WASM), so the app is fully functional offline; cloud features use the configured API origin.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running CadSandbox");
}
