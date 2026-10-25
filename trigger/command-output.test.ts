import assert from "node:assert/strict"
import test from "node:test"

import { shownCommandOutput } from "./command-output"

test("a command that prints nothing still returns text", () => {
  assert.equal(shownCommandOutput(""), "(no output)")
  assert.equal(shownCommandOutput(" \n\t"), "(no output)")
  assert.equal(shownCommandOutput("0"), "0")
})
