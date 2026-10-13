# Anti-Spoofing on Jetson Nano

## Folder layout
```
antispoof/
  app.py
  templates/index.html
  known_faces/          <- put one clear photo per person: Lalith.jpg, Nayeem.jpg ...
```

## 1. Install (on the Jetson Nano)
```bash
sudo apt update
sudo apt install -y python3-pip python3-opencv cmake build-essential libopenblas-dev liblapack-dev
pip3 install flask numpy pyserial
pip3 install dlib            # takes 20-40 min to compile on the Nano, be patient
pip3 install face_recognition
```
Tip: add swap space (2-4 GB) before building dlib, otherwise the build may run out of memory.

## 2. Run
```bash
cd antispoof
python3 app.py
```
Open `http://<jetson-ip>:5000` from any device on the same network
(find the IP with `hostname -I`).

## 3. Send results to the DE10 board (optional)
```bash
DE10_SERIAL=/dev/ttyUSB0 DE10_BAUD=115200 python3 app.py
```
The Jetson sends one character plus newline on every decision change:

| Char | Meaning                                   |
|------|-------------------------------------------|
| `G`  | Access granted (known face and live)      |
| `D`  | Denied (unknown face)                     |
| `S`  | Spoof suspected (known face, no blink)    |

Adjust the port and baud rate to match how your DE10 is wired (USB-UART, GPIO UART, etc.).

## 4. Test it
1. Stand in front of the camera: status shows **SPOOF** (known, but no blink yet).
2. Blink: status turns **GRANTED**.
3. Hold up a photo of the enrolled person: it stays **SPOOF** because a photo cannot blink.

## Tunables (top of app.py)
`MATCH_TOLERANCE`, `EAR_THRESHOLD`, `LIVE_WINDOW_SEC`, `ENCODE_EVERY_N`.
