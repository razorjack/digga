import net from "node:net";

/** A loopback listener the test owns, never Digga's port 3456; it counts who connects. */
export interface CountingListener {
  port: number;
  connections(): number;
  close(): Promise<void>;
}

/** The port a guard must refuse: any connection that reaches it is counted, then dropped. */
export async function countingListener(): Promise<CountingListener> {
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  const port = await listen(server);
  return { port, connections: () => connections, close: () => closeServer(server) };
}

export function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

export function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
