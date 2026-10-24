import assert from "node:assert/strict"
import test from "node:test"

import { waitUntilDesktopActive } from "../lib/desktop"

test("waits until the desktop reports it is active", async () => {
  let time = 0
  let checks = 0
  await waitUntilDesktopActive(
    async () => {
      checks += 1
      return checks >= 3 ? "active" : "starting"
    },
    async (ms) => {
      time += ms
    },
    1_000,
    () => time
  )
  assert.equal(checks, 3)
  assert.equal(time, 400)
})

test("stops waiting when the desktop never becomes active", async () => {
  let time = 0
  await assert.rejects(
    () =>
      waitUntilDesktopActive(
        async () => "starting",
        async (ms) => {
          time += ms
        },
        300,
        () => time
      ),
    /did not become ready/
  )
  assert.ok(time >= 300)
})
