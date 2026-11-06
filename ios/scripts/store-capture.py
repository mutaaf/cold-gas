#!/usr/bin/env python3
# Real frames for the store art (0164): a Debug build flies a recorded run through the real UI on a slowed clock, on a 6.9"
# simulator, and every screenshot is kept, labelled with the car's position. A person picks the frames; Lobby frames them.
# Nothing is drawn over the app and nothing posts to the board.
#   scripts/store-capture.py <udid> <outdir> <name> <timescale> <app args…>   (SHOT_DISPLAY=primary-1: an open Duo's inner screen)
import os, re, subprocess, sys, time
BID = 'com.mutaafaziz.coldgas'
udid, out, name, ts, *args = sys.argv[1:]
d = os.path.join(out, name); os.makedirs(d, exist_ok=True)
subprocess.run(['xcrun', 'simctl', 'terminate', udid, BID], capture_output=True)
subprocess.run(['xcrun', 'simctl', 'status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100'], capture_output=True)
lp = os.path.join(out, name + '.log'); log = open(lp, 'w')
p = subprocess.Popen(['xcrun', 'simctl', 'launch', '--console-pty', udid, BID, '-cam-log', '-timescale', ts] + args, stdout=log, stderr=log)
t0, i, after = time.time(), 0, 0
index = open(os.path.join(out, name + '.txt'), 'w')
AFTER = int(os.environ.get('AFTER', '6'))
while time.time() - t0 < float(os.environ.get('MAXT', '240')) and after < AFTER:
    f = os.path.join(d, f'{i:03}.png')
    subprocess.run(['xcrun', 'simctl', 'io', udid, 'screenshot', '--display=' + os.environ.get('SHOT_DISPLAY', 'primary'), f], capture_output=True)
    txt = open(lp, errors='ignore').read()
    cams = re.findall(r'CAM phase (\d) car \((\S+) (\S+) (\S+)\)', txt)
    index.write(f"{i:03} {' '.join(cams[-1]) if cams else '-'}\n"); index.flush()
    i += 1
    if 'RUN ' in txt:
        after += 1
        time.sleep(float(os.environ.get('AFTER_WAIT', '1')))
p.terminate()
print(name, i, 'shots', ''.join(l for l in open(lp, errors='ignore') if l.startswith(('RUN', 'SIM')))[:300])
