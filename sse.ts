export interface SSEEvent {
  event: string;
  id: string;
  data: string;
}

/** Incremental SSE parser accepting LF, CRLF, and CR across chunks. */
export class SSEParser {
  private line = "";
  private skipLF = false;
  private first = true;
  private data: string[] = [];
  private event = "";

  constructor(
    private emit: (event: SSEEvent) => void,
    private onId: (id: string) => void = () => {},
    private onRetry: (ms: number) => void = () => {},
    private id = "",
  ) {}

  feed(chunk: string): void {
    for (const char of chunk) {
      if (this.first) {
        this.first = false;
        if (char === "\uFEFF") continue;
      }
      if (this.skipLF) {
        this.skipLF = false;
        if (char === "\n") continue;
      }
      if (char === "\r" || char === "\n") {
        this.processLine();
        this.line = "";
        this.skipLF = char === "\r";
      } else this.line += char;
    }
  }

  private processLine(): void {
    if (this.line === "") {
      if (this.data.length) {
        this.emit({
          event: this.event || "message",
          id: this.id,
          data: this.data.join("\n"),
        });
      }
      this.data = [];
      this.event = "";
      return;
    }
    if (this.line.startsWith(":")) return;
    const colon = this.line.indexOf(":");
    const field = colon < 0 ? this.line : this.line.slice(0, colon);
    let value = colon < 0 ? "" : this.line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
    else if (field === "id" && !value.includes("\0")) {
      this.id = value;
      this.onId(value);
    } else if (field === "retry" && /^\d+$/.test(value)) {
      const ms = Number(value);
      if (Number.isSafeInteger(ms) && ms <= 2_147_483_647) this.onRetry(ms);
    }
  }
}

export function formatData(data: string, colors = false): string {
  let json: string;
  try {
    // Validate, then format tokens to preserve numeric precision and key order.
    JSON.parse(data);
    json = prettyJSON(data);
  } catch {
    return data;
  }
  if (!colors) return json;
  return json.replace(
    /"(?:\\.|[^"\\])*"\s*(?=:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g,
    (token, offset: number) => {
      let color = "90";
      if (token.startsWith('"'))
        color = /^\s*:/.test(json.slice(offset + token.length)) ? "36" : "32";
      else if (token === "null") color = "35";
      else if (/^(?:true|false)$/.test(token) || /^-?\d/.test(token))
        color = "33";
      return `\x1b[${color}m${token}\x1b[0m`;
    },
  );
}

function prettyJSON(data: string): string {
  const tokens = data.match(
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g,
  )!;
  let depth = 0;
  let result = "";
  const newline = () => "\n" + "  ".repeat(depth);
  tokens.forEach((token, i) => {
    if (token === "{" || token === "[") {
      result += token;
      if (tokens[i + 1] !== (token === "{" ? "}" : "]")) {
        depth++;
        result += newline();
      }
    } else if (token === "}" || token === "]") {
      if (tokens[i - 1] !== (token === "}" ? "{" : "[")) {
        depth--;
        result += newline();
      }
      result += token;
    } else if (token === ",") result += token + newline();
    else if (token === ":") result += ": ";
    else result += token;
  });
  return result;
}

export function formatEvent(event: SSEEvent, colors = false): string {
  const label = `event: ${event.event}${event.id ? `\nid: ${event.id}` : ""}`;
  return `${colors ? `\x1b[2m${label}\x1b[0m` : label}\n${formatData(event.data, colors)}\n\n`;
}
