import { describe, expect, test, spyOn } from "bun:test";
import { main } from "./index.ts";
import { SSEParser, formatData, type SSEEvent } from "./sse.ts";

describe("SSE parsing", () => {
  test("handles chunk boundaries, line endings, named events, IDs, and multiline data", () => {
    const events: SSEEvent[] = [];
    const ids: string[] = [];
    const retries: number[] = [];
    const parser = new SSEParser(
      (e) => events.push(e),
      (id) => ids.push(id),
      (ms) => retries.push(ms),
    );
    const stream =
      '\uFEFF: heartbeat\r\nid: 42\r\nevent: update\r\ndata: {"a":\r\ndata: 1}\r\nretry: 25\r\n\r\ndata:\r\rdata: plain\n\nid:\n\nid: bad\0id\nretry: nope\nretry: 999999999999999\n\ndata: unfinished';
    for (const char of stream) parser.feed(char);
    expect(events).toEqual([
      { event: "update", id: "42", data: '{"a":\n1}' },
      { event: "message", id: "42", data: "" },
      { event: "message", id: "42", data: "plain" },
    ]);
    expect(ids).toEqual(["42", ""]);
    expect(retries).toEqual([25]);
  });
});

test("pretty prints JSON without changing numeric precision or string contents", () => {
  expect(
    formatData('{"n":9007199254740993,"s":"a,{}\\\"","a":[true,null,{}]}'),
  ).toBe(
    '{\n  "n": 9007199254740993,\n  "s": "a,{}\\\"",\n  "a": [\n    true,\n    null,\n    {}\n  ]\n}',
  );
  expect(formatData("hello\nworld", true)).toBe("hello\nworld");
  const colored = formatData('{"a":1}', true);
  expect(colored).toContain('\x1b[36m"a"\x1b[0m');
  expect(colored.replace(/\x1b\[[0-9;]*m/g, "")).toBe(formatData('{"a":1}'));
});

test("CLI streams UTF-8, reconnects with Last-Event-ID, and exits on Ctrl-C", async () => {
  let connections = 0;
  const resumeIds: (string | null)[] = [];
  let output = "";
  const write = spyOn(process.stdout, "write").mockImplementation(
    (chunk: any) => {
      output += String(chunk);
      if (output.includes("second"))
        queueMicrotask(() => process.emit("SIGINT"));
      return true;
    },
  );
  const log = spyOn(console, "error").mockImplementation(() => {});
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        _url: Parameters<typeof fetch>[0],
        options?: Parameters<typeof fetch>[1],
      ) => {
        connections++;
        resumeIds.push(new Headers(options?.headers).get("Last-Event-ID"));
        const text =
          connections === 1
            ? 'id: 7\nretry: 10\nevent: update\ndata: {"text":"héllo"}\n\n'
            : "data: second\n\n";
        const bytes = new TextEncoder().encode(text);
        return new Response(
          new ReadableStream({
            start(controller) {
              // Split every UTF-8 byte, including inside the accented character.
              for (const byte of bytes)
                controller.enqueue(new Uint8Array([byte]));
              if (connections === 1) controller.close();
              else
                options?.signal?.addEventListener(
                  "abort",
                  () => controller.error(new Error("Aborted")),
                  { once: true },
                );
            },
          }),
          { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
        );
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    expect(await main(["--no-color", "http://example.test/events"])).toBe(0);
    expect(output).toContain('event: update\nid: 7\n{\n  "text": "héllo"\n}');
    expect(output).toContain("event: message\nid: 7\nsecond");
    expect(resumeIds).toEqual([null, "7"]);
  } finally {
    fetchMock.mockRestore();
    write.mockRestore();
    log.mockRestore();
  }
});

test("help and invalid arguments", async () => {
  for (const [args, code, text] of [
    [["--help"], 0, "Usage: sse"],
    [[], 1, "Provide an http://"],
    [["--wat"], 1, "Unknown option"],
  ] as const) {
    const child = Bun.spawn([process.execPath, "index.ts", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(code);
    expect(stdout + stderr).toContain(text);
  }
});
