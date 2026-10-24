import assert from "node:assert/strict"
import test from "node:test"

import { SCREEN_LOOK_LIMIT, screenLookStreak } from "./screen-loop"

test("counts consecutive screen looks until the mouse or keyboard is used", () => {
  assert.equal(
    screenLookStreak(["viewScreen", "bash", "viewScreen", "showScreen"]),
    3
  )
  assert.equal(
    screenLookStreak(["viewScreen", "viewScreen", "mouseClick", "viewScreen"]),
    1
  )
  assert.equal(
    screenLookStreak(["viewScreen", "viewScreen", "keyboardType"]),
    0
  )
  assert.equal(
    screenLookStreak(["viewScreen", "viewScreen", "viewScreen"]) >=
      SCREEN_LOOK_LIMIT,
    true
  )
})
