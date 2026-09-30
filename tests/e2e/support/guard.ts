/**
 * Loaded into every Digga process the end-to-end harness starts (NODE_OPTIONS=--import), before
 * the app's first line. It refuses every outgoing TCP connection except to loopback at the port
 * DIGGA_E2E_ALLOWED_PORT names, where the fake services listen, so a request the harness did not
 * plan fails instead of leaving the machine. fetch (undici), http, https, tls and net all connect
 * through net.Socket; a native addon or another transport would not. Imports only Node builtins.
 */
import net from "node:net";

type ConnectTarget =
  | { kind: "pipe" }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "unknown" };

const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const allowedPort = Number(process.env.DIGGA_E2E_ALLOWED_PORT);
// oxlint-disable-next-line typescript/unbound-method -- called through Reflect.apply with the socket.
const connect = net.Socket.prototype.connect;

const socketPrototype = net.Socket.prototype as { connect: (...args: unknown[]) => net.Socket };
socketPrototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  const target = connectTarget(args);
  if (isAllowed(target)) return Reflect.apply(connect, this, args) as net.Socket;
  const message = `digga-e2e guard: refused a connection to ${describe(target)}`;
  process.stderr.write(`${message}\n`);
  // Asynchronously, as a failed connection would: callers listen for "error", not for a throw.
  process.nextTick(() => this.destroy(new Error(message)));
  return this;
};

/**
 * Reads the call forms of socket.connect(): (options), (path), (port, host), and the array of
 * normalised arguments that net.connect() passes on.
 */
function connectTarget(args: unknown[]): ConnectTarget {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first)))
    return {
      kind: "tcp",
      host: typeof args[1] === "string" ? args[1] : "localhost",
      port: Number(first),
    };
  if (typeof first === "string") return { kind: "pipe" };
  if (typeof first !== "object" || first === null) return { kind: "unknown" };
  const options = first as { path?: unknown; host?: unknown; port?: unknown };
  // http and https pass `path: null` for TCP, so only a real path means a pipe.
  if (options.path) return { kind: "pipe" };
  const host = typeof options.host === "string" ? options.host : "localhost";
  return { kind: "tcp", host, port: Number(options.port) };
}

function isAllowed(target: ConnectTarget): boolean {
  if (target.kind === "pipe") return true;
  if (target.kind === "unknown") return false;
  return LOOPBACK.has(target.host) && target.port === allowedPort;
}

function describe(target: ConnectTarget): string {
  return target.kind === "tcp" ? `${target.host}:${target.port}` : "an unrecognised address";
}
