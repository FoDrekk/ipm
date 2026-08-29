// mergeSettings is shared between the renderer's optimistic update and
// the main process's persisted merge. If the two ever disagreed, every
// save would visibly correct the UI a moment later — so the rule itself
// is worth pinning down.
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { mergeSettings, DEFAULT_SETTINGS } = require('../dist-electron/shared/types.js')

describe('mergeSettings', () => {
  test('applies one field without disturbing its neighbours', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { alarm: { volume: 25 } })
    assert.equal(merged.alarm.volume, 25)
    assert.equal(merged.alarm.enabled, DEFAULT_SETTINGS.alarm.enabled)
    assert.equal(merged.alarm.sound, DEFAULT_SETTINGS.alarm.sound)
    assert.deepEqual(merged.monitoring, DEFAULT_SETTINGS.monitoring)
  })

  test('leaves the original untouched', () => {
    const before = JSON.stringify(DEFAULT_SETTINGS)
    mergeSettings(DEFAULT_SETTINGS, { notifications: { enabled: false } })
    assert.equal(JSON.stringify(DEFAULT_SETTINGS), before)
  })

  test('survives a malformed patch instead of throwing', () => {
    for (const patch of [null, undefined, 'nonsense', 42, [], { alarm: 'nope' }, { alarm: null }]) {
      const merged = mergeSettings(DEFAULT_SETTINGS, patch)
      assert.deepEqual(merged, DEFAULT_SETTINGS)
    }
  })

  test('the last write wins when patches are applied in order', () => {
    let settings = DEFAULT_SETTINGS
    for (const volume of [10, 40, 90, 55]) {
      settings = mergeSettings(settings, { alarm: { volume } })
    }
    assert.equal(settings.alarm.volume, 55)
  })
})
