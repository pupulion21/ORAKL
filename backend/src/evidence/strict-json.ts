// ORAKL P1 — strict JSON parser with duplicate-key rejection.
// JSON.parse silently accepts duplicate keys (last wins). The evidence
// profile explicitly forbids them, so parsing is done by this small,
// eval-free recursive-descent parser that rejects any repeated object key
// and any JSON number (the v1 profile disallows numeric types outright).
export type StrictJsonValue = string | boolean | null | StrictJsonValue[] | { [k: string]: StrictJsonValue };

class StrictJsonError extends Error {}

export function parseStrictJson(input: string): StrictJsonValue {
  let pos = 0;
  const text = input;

  const fail = (msg: string): never => {
    throw new StrictJsonError(`${msg} at position ${pos}`);
  };
  const failIf = (cond: unknown, msg: string): void => {
    if (cond) throw new StrictJsonError(`${msg} at position ${pos}`);
  };

  const skipWs = (): void => {
    while (pos < text.length) {
      const c = text[pos];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") pos++;
      else break;
    }
  };

  const parseString = (): string => {
    if (text[pos] !== '"') fail("expected string");
    pos++;
    let out = "";
    for (;;) {
      if (pos >= text.length) fail("unterminated string");
      const c = text[pos];
      if (c === undefined) throw new StrictJsonError("unterminated string");
      if (c === '"') {
        pos++;
        return out;
      }
      if (c === "\\") {
        pos++;
        const esc = text[pos];
        switch (esc) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = text.slice(pos + 1, pos + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("bad \\u escape");
            out += String.fromCharCode(parseInt(hex, 16));
            pos += 4;
            break;
          }
          default: fail("invalid escape");
        }
        pos++;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) fail("raw control character in string");
      out += c;
      pos++;
    }
  };

  const parseValue = (): StrictJsonValue => {
    skipWs();
    if (pos >= text.length) fail("unexpected end of input");
    const c = text[pos];
    if (c === undefined) throw new StrictJsonError("unexpected end of input");
    if (c === '"') return parseString();
    if (c === "{" || c === "[") {
      if (c === "{") {
        pos++;
        const obj: { [k: string]: StrictJsonValue } = Object.create(null);
        skipWs();
        if (text[pos] === "}") { pos++; return { ...obj }; }
        for (;;) {
          skipWs();
          const key = parseString();
          if (key in obj) fail(`duplicate object key: ${key}`);
          skipWs();
          if (text[pos] !== ":") fail("expected ':'");
          pos++;
          obj[key] = parseValue();
          skipWs();
          if (text[pos] === ",") { pos++; continue; }
          if (text[pos] === "}") { pos++; return { ...obj }; }
          fail("expected ',' or '}'");
        }
      }
      pos++;
      const arr: StrictJsonValue[] = [];
      skipWs();
      if (text[pos] === "]") { pos++; return arr; }
      for (;;) {
        arr.push(parseValue());
        skipWs();
        if (text[pos] === ",") { pos++; continue; }
        if (text[pos] === "]") { pos++; return arr; }
        fail("expected ',' or ']'");
      }
    }
    if (c === "-" || (c >= "0" && c <= "9")) fail("JSON numbers are not allowed in the evidence profile v1");    if (text.startsWith("true", pos)) { pos += 4; return true; }
    if (text.startsWith("false", pos)) { pos += 5; return false; }
    if (text.startsWith("null", pos)) { pos += 4; return null; }
    return fail("unexpected token");
  };

  const value = parseValue();
  skipWs();
  if (pos !== text.length) fail("trailing content after JSON value");
  return value;
}
