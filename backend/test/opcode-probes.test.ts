import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { probeSingleOpcode, probeOpcodes } from "../../scripts/p2/probe-qie-evm.mjs";

describe("P2 Opcode Probes & Error Classification (scripts/p2/probe-qie-evm.mjs)", () => {
  let mockServer: Server | null = null;
  let mockPort = 0;
  let mockHandler: (reqBody: any) => { status?: number; body: any } = () => ({ status: 200, body: {} });

  beforeAll(async () => {
    mockServer = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          const response = mockHandler(parsed);
          res.writeHead(response.status ?? 200, { "Content-Type": "application/json" });
          res.end(typeof response.body === "string" ? response.body : JSON.stringify(response.body));
        } catch {
          const response = mockHandler({});
          res.writeHead(response.status ?? 200, { "Content-Type": "application/json" });
          res.end(typeof response.body === "string" ? response.body : JSON.stringify(response.body));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        mockPort = (mockServer!.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
    }
  });

  it("classifies transport error (connection refused / dead endpoint) as TRANSPORT_ERROR (never UNSUPPORTED)", async () => {
    const deadEndpoint = "http://127.0.0.1:1";
    const res = await probeSingleOpcode(deadEndpoint, "tstore", "0x604260005d", "0x42");

    expect(res.classification).toBe("TRANSPORT_ERROR");
    expect(res.status).not.toBe("UNSUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(false);
    expect(res.errorDetail).toContain("fetch failed");
  });

  it("classifies HTTP 500 error as TRANSPORT_ERROR (never UNSUPPORTED)", async () => {
    mockHandler = () => ({ status: 500, body: "Internal Server Error" });

    const res = await probeSingleOpcode(`http://127.0.0.1:${mockPort}`, "tstore", "0x604260005d", "0x42");

    expect(res.classification).toBe("TRANSPORT_ERROR");
    expect(res.status).not.toBe("UNSUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(false);
  });

  it("classifies malformed JSON response as MALFORMED_RESPONSE (never UNSUPPORTED)", async () => {
    mockHandler = () => ({ status: 200, body: "<html>Not JSON</html>" });

    const res = await probeSingleOpcode(`http://127.0.0.1:${mockPort}`, "tstore", "0x604260005d", "0x42");

    expect(res.classification).toBe("MALFORMED_RESPONSE");
    expect(res.status).not.toBe("UNSUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(false);
  });

  it("classifies RPC method not found (-32601) as METHOD_NOT_SUPPORTED (never UNSUPPORTED)", async () => {
    mockHandler = (body) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method eth_call not found" },
      },
    });

    const res = await probeSingleOpcode(`http://127.0.0.1:${mockPort}`, "tstore", "0x604260005d", "0x42");

    expect(res.classification).toBe("METHOD_NOT_SUPPORTED");
    expect(res.status).not.toBe("UNSUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(false);
  });

  it("classifies generic execution revert without opcode error as EXECUTION_REVERT (never UNSUPPORTED)", async () => {
    mockHandler = (body) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: 3, message: "execution reverted: custom business logic error" },
      },
    });

    const res = await probeSingleOpcode(`http://127.0.0.1:${mockPort}`, "tstore", "0x604260005d", "0x42");

    expect(res.classification).toBe("EXECUTION_REVERT");
    expect(res.status).not.toBe("UNSUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(false);
  });

  it("classifies explicit invalid opcode error as INVALID_OPCODE and reports UNSUPPORTED", async () => {
    mockHandler = (body) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message: "invalid opcode: opcode 0x5d not defined" },
      },
    });

    const res = await probeSingleOpcode(`http://127.0.0.1:${mockPort}`, "tstore", "0x604260005d", "0x42");

    expect(res.classification).toBe("INVALID_OPCODE");
    expect(res.status).toBe("UNSUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(true);
    expect(res.errorDetail).toContain("invalid opcode: opcode 0x5d not defined");
  });

  it("classifies successful execution matching return value as SUPPORTED", async () => {
    mockHandler = (body) => ({
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: body.id,
        result: "0x42",
      },
    });

    const res = await probeSingleOpcode(`http://127.0.0.1:${mockPort}`, "push0", "0x60425f5360015ff3", "0x42");

    expect(res.classification).toBe("SUPPORTED");
    expect(res.status).toBe("SUPPORTED");
    expect(res.isOpcodeUnsupported).toBe(false);
  });

  it("probeOpcodes does NOT claim full Shanghai hardfork compatibility from opcode probes alone", async () => {
    // push0 returns 0x42, tstore returns invalid opcode
    mockHandler = (body) => {
      if (body.params?.[0]?.data?.includes("5f53")) {
        return { status: 200, body: { jsonrpc: "2.0", id: body.id, result: "0x42" } };
      }
      return {
        status: 200,
        body: { jsonrpc: "2.0", id: body.id, error: { message: "invalid opcode: opcode 0x5d not defined" } },
      };
    };

    const res = await probeOpcodes(`http://127.0.0.1:${mockPort}`);

    expect(res.push0.classification).toBe("SUPPORTED");
    expect(res.tstore.classification).toBe("INVALID_OPCODE");
    expect(res.tstore.status).toBe("UNSUPPORTED");
    // Verify it does not claim full Shanghai compatibility
    expect(res.fullHardforkClaim).toBe("UNVERIFIED");
    expect(res.opcodeObservation).toContain("Opcode-level observation only");
  });
});
