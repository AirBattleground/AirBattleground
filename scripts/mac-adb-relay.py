#!/usr/bin/env python3
"""Run on the Mac next to the Android emulator: lets the 7XEN Station PC reach the emulator over Wi-Fi.

The emulator's adb port (5555) only listens on the Mac itself. This relays <Mac IP>:5556 -> 127.0.0.1:5555,
accepting connections ONLY from the station PC.

    python3 mac-adb-relay.py                 # station PC 192.168.0.199, listen on 5556
    python3 mac-adb-relay.py 192.168.0.199 5556 5555
Then on the station PC: REMOTE_DEVICE=<Mac IP>:5556 in services/station/.env
"""
import socket
import sys
import threading

ALLOW = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.199"
LISTEN = int(sys.argv[2]) if len(sys.argv) > 2 else 5556
TARGET = int(sys.argv[3]) if len(sys.argv) > 3 else 5555


def pipe(src, dst):
    try:
        while data := src.recv(65536):
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def handle(client, addr):
    if addr[0] != ALLOW:
        print(f"refused {addr[0]} (only {ALLOW} is allowed)", flush=True)
        client.close()
        return
    try:
        upstream = socket.create_connection(("127.0.0.1", TARGET), timeout=5)
        upstream.settimeout(None)
    except OSError as e:
        print(f"emulator not reachable on 127.0.0.1:{TARGET} ({e}) - is it running?", flush=True)
        client.close()
        return
    print(f"connected {addr[0]} -> emulator", flush=True)
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()


srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", LISTEN))
srv.listen(8)
print(f"7XEN relay: 0.0.0.0:{LISTEN} -> 127.0.0.1:{TARGET}, allowing only {ALLOW}. Keep this window open.", flush=True)
while True:
    c, a = srv.accept()
    threading.Thread(target=handle, args=(c, a), daemon=True).start()
