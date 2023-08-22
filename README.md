# Tauri

Error:

```sh
thread 'main' panicked at 'error while running tauri application: Runtime(CreateWebview(WebView2Error(WindowsError(Error { code: 0x80070002, message: The system cannot find the file specified. }))))', src\main.rs:14:10
```

# Preparation

> **Note**: Windows WebView2 runtime is automatically downloaded

```sh
npm ci
```

## Development

```sh
npm run tauri dev
```

## Production

```sh
npm run tauri build
```
