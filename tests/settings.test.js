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

  test('carries the startup category like any other', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { startup: { startMinimized: true } })
    assert.equal(merged.startup.startMinimized, true)
    // A category added after the first release must not drop the
    // sibling field it was merged onto.
    assert.equal(merged.startup.startMonitoring, DEFAULT_SETTINGS.startup.startMonitoring)
  })

  test('alarm mode merges without disturbing the rest of the alarm', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { alarm: { mode: 'once' } })
    assert.equal(merged.alarm.mode, 'once')
    assert.equal(merged.alarm.volume, DEFAULT_SETTINGS.alarm.volume)
    assert.equal(merged.alarm.sound, DEFAULT_SETTINGS.alarm.sound)
  })

  test('the last write wins when patches are applied in order', () => {
    let settings = DEFAULT_SETTINGS
    for (const volume of [10, 40, 90, 55]) {
      settings = mergeSettings(settings, { alarm: { volume } })
    }
    assert.equal(settings.alarm.volume, 55)
  })
})
