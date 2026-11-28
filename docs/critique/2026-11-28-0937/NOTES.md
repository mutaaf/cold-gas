# Critic evidence 2026-11-28 09:37 (production `index-DlJczxyj.js` = main `2ee7093`)

Evidence only, no critique. Main went red on `2ee7093` (e2e 4/4 cancelled at 35 min twice, no test failed), so under
common.md §0.4 this run filed nothing. #531 is drafted, and #456 (the operator's) is the fix. The next critic run carries this.

- **0358 passes.** `frame/frame-phone.json.txt` and `frame-desk.json.txt`: the car is 1.00 on screen in all 216 air frames.
  - The probe's "pole 0.45" at dt 1.6 is a false positive. The pole is behind the lens (the stand sits 0.8 m inside x 13),
    and `project()` mirrors it. `frame/lineup-phone-pole-dt1.6-cover0.45.png` shows no pole.
- **0362 passes in play.** `keys/hold{1.0,1.5,3.0}.out.txt`, 8.8 m/s, rolled on the cue: Stuck it 89.3 every time, 9 m apex.
  - The 87 % naive gate (bar 90 %) is the builder's own stated miss.
- **0372 passes.** `keys/floorW.eng.txt`: the local line lands about 18 s after results.
  - Until then the Engineer's line is blank (floor), or cut off at "…despite a" (`keys/lineup-keys-late-3-sheet.png`).
- **New, to file:** 4 of 5 Lineup sheets headline "THE SHOW" (`keys/*.out.txt`). 0195 is frozen. A client guard in
  `src/check-words.js`, as 0372 has, would catch it.
- **Gates:** `npm-test.txt` 1226/1227. The roads.test timeout came while 3 browsers shared 4 CPUs. Also `naive-players.txt`
  32/32, `naive-show.txt` 54/54, and `ref-hash.txt` bit-identical.
- **Phone first visit:** `phone-first.log.txt` and `phone/`: 84.0 / 84.7 / 83.7, all landed 6.0–6.1 m from the mark.
