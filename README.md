# sse

A Bun CLI that streams all SSE event types until Ctrl-C. JSON payloads are
pretty-printed with syntax colors in terminals; other payloads stay plain text.
Event types and IDs appear above each payload. Connection messages go to stderr.

## Quick start

Run the published package directly without a global install:

```sh
npx @tsiry/sse https://sse.rocksky.app/events/scrobbles

# Or with Bun
bunx @tsiry/sse https://sse.rocksky.app/events/scrobbles
```

[Bun](https://bun.com) is required for both commands because the CLI uses the Bun runtime.
Press Ctrl-C to stop streaming.

```sh
npx @tsiry/sse --help
bunx @tsiry/sse --no-color https://sse.rocksky.app/events/scrobbles
```

You can also install the CLI globally:

```sh
npm install -g @tsiry/sse
sse https://sse.rocksky.app/events/scrobbles
```

## Build

```sh
# Bundled CLI (requires Bun)
npm run build
bun dist/sse.js https://sse.rocksky.app/events/scrobbles

# Standalone binary for the current platform (no runtime required)
npm run build:binary
./dist/sse https://sse.rocksky.app/events/scrobbles
```

Bun must be installed to run either build script. The binary includes the Bun runtime.

## Options

```text
sse [--color | --no-color] <url>

--color      Force JSON syntax colors, including when piped
--no-color   Disable colors
-h, --help   Show usage and examples
```

Colors default to off when stdout is redirected or `NO_COLOR` is set.
Explicit color flags override that default; the last flag wins.

The client reconnects after network failures or a closed stream, using a 3-second
initial delay and honoring SSE `retry` and `id` fields for resumption. HTTP 204
ends the stream successfully. Other non-200 responses and invalid content types
exit with an error. SSE comments and control fields do not print as events.

## Development

```sh
bun install
bun run start https://sse.rocksky.app/events/scrobbles
bun test
bun run typecheck
```
