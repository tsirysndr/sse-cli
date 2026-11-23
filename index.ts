#!/usr/bin/env bun
import { setTimeout as delay } from "node:timers/promises";
import { SSEParser, formatEvent } from "./sse.ts";

const help = `Usage: sse [--color | --no-color] <url>

Stream all SSE events until Ctrl-C. JSON data is pretty-printed.
Reconnects automatically using the server's retry and last event ID.

  --color      Always use JSON syntax colors
  --no-color   Disable colors (also honors NO_COLOR)
  -h, --help   Show this help

Examples:
  sse https://sse.rocksky.app/events/scrobbles
  sse --no-color http://localhost:3000/events
`;

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help);
    return 0;
  }
  let colors =
    Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
  let url: URL | undefined;
  try {
    for (const arg of args) {
      if (arg === "--color") colors = true;
      else if (arg === "--no-color") colors = false;
      else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
      else if (url) throw new Error("Expected exactly one SSE URL");
      else url = new URL(arg);
    }
    if (!url || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("Provide an http:// or https:// SSE URL");
    }
  } catch (error) {
    console.error(`${message(error)}\n\n${help}`);
    return 1;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  const pipeError = (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") stop();
    else throw error;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdout.on("error", pipeError);
  let lastEventId = "";
  let retry = 3000;
  try {
    while (!controller.signal.aborted) {
      try {
        const headers = new Headers({
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
        });
        if (lastEventId) headers.set("Last-Event-ID", lastEventId);
        const response = await fetch(url, {
          headers,
          signal: controller.signal,
        });
        if (response.status === 204) return 0;
        const contentType = response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        if (
          response.status !== 200 ||
          contentType !== "text/event-stream" ||
          !response.body
        ) {
          await response.body?.cancel();
          console.error(
            `SSE connection rejected: HTTP ${response.status}, Content-Type: ${contentType ?? "missing"}`,
          );
          return 1;
        }
        console.error("Connected. Press Ctrl-C to stop.");
        const parser = new SSEParser(
          (event) => {
            process.stdout.write(formatEvent(event, colors));
          },
          (id) => {
            lastEventId = id;
          },
          (ms) => {
            retry = ms;
          },
          lastEventId,
        );
        const decoder = new TextDecoder();
        for await (const chunk of response.body)
          parser.feed(decoder.decode(chunk, { stream: true }));
        parser.feed(decoder.decode());
      } catch (error) {
        if (controller.signal.aborted) break;
        console.error(`Connection lost: ${message(error)}`);
      }
      if (controller.signal.aborted) break;
      console.error(`Reconnecting in ${retry}ms…`);
      await delay(retry, undefined, { signal: controller.signal });
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.off("error", pipeError);
  }
  return 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) process.exitCode = await main();
