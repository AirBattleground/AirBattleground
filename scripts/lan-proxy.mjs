// Temporary LAN forwarder: <wifi-ip>:LAN_PORT → 127.0.0.1:TARGET_PORT (the Docker web container).
// Only needed while net.ipv4.ip_forward=0 stops other devices reaching Docker's published ports.
// Permanent fix: sudo sysctl -w net.ipv4.ip_forward=1 (see README "LAN access").
import net from "node:net";

const LISTEN = Number(process.env.LAN_PORT ?? 8088);
const TARGET = Number(process.env.TARGET_PORT ?? 8080);

net
  .createServer((client) => {
    const upstream = net.connect(TARGET, "127.0.0.1");
    client.pipe(upstream).pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
  })
  .listen(LISTEN, "0.0.0.0", () => console.log(`LAN proxy :${LISTEN} -> 127.0.0.1:${TARGET}`));
