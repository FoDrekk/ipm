// Tests run against the compiled main-process output (dist-electron), so
// what is exercised here is exactly what ships. `npm test` builds first.
//
// No test framework: node:test and node:assert are part of Node, and the
// state machine under test is deliberately free of Electron imports so it
// can be driven directly. Time is mocked, and the network probe is
// replaced with a scripted one — every scenario below is therefore exact,
// not timing-dependent.
const { test, describe, mock } = require('node:test')
const assert = require('node:assert/strict')

const { MonitorService } = require('../dist-electron/services/monitor.service.js')
const { RETRY_STRATEGY_PRESETS } = require('../dist-electron/shared/types.js')

const PROFILE = RETRY_STRATEGY_PRESETS.normal // 3 failures to confirm, 2 successes to recover
const INTERVAL = 10_000

/** A monitor whose probe is scripted instead of networked. */
function createHarness(options = {}) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })

  const updates = []
  const probedUrls = []
  let outcome = { ok: true, latencyMs: 10 }

  const service = new MonitorService({
    intervalMs: INTERVAL,
    profile: PROFILE,
    endpoints: ['https://probe.test/a', 'https://probe.test/b'],
    onUpdate: (state, statusChanged) => updates.push({ state, statusChanged }),
    ...options,
  })

  service.probe = (url, done) => {
    probedUrls.push(url)
    if (outcome.latencyMs > 0) mock.timers.tick(outcome.latencyMs)
    done(outcome.ok)
  }

  return {
    service,
    updates,
    probedUrls,
    set: (ok, latencyMs = 10) => {
      outcome = { ok, latencyMs }
    },
    /** Advances time far enough for `count` more probes to run. */
    runProbes: (count) => {
      for (let i = 0; i < count; i++) mock.timers.tick(INTERVAL + 1)
    },
    statuses: () => updates.map((u) => u.state.status),
    changes: () => updates.filter((u) => u.statusChanged).map((u) => u.state.status),
    cleanup: () => {
      service.dispose()
      mock.timers.reset()
    },
  }
}

describe('MonitorService', () => {
  test('reports VERIFYING, not OFFLINE, before the first probe lands', () => {
    const h = createHarness()
    try {
      assert.equal(h.service.getState().status, 'VERIFYING')
      assert.equal(h.service.getState().isMonitoring, false)
      assert.equal(h.service.getState().offlineSince, null)
      // Nothing has changed yet, so nothing claims to have.
      assert.equal(h.service.getState().statusChangedAt, null)
    } finally {
      h.cleanup()
    }
  })

  test('a second start() creates no second loop', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.service.start()
      h.service.start()
      assert.equal(h.probedUrls.length, 1)

      h.runProbes(3)
      assert.equal(h.probedUrls.length, 4) // one per interval, not three
    } finally {
      h.cleanup()
    }
  })

  test('rotates across endpoints so one bad host cannot fake an outage', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.runProbes(3)
      assert.deepEqual(h.probedUrls.slice(0, 4), [
        'https://probe.test/a',
        'https://probe.test/b',
        'https://probe.test/a',
        'https://probe.test/b',
      ])
    } finally {
      h.cleanup()
    }
  })

  test('a brief failure never reaches OFFLINE', () => {
    const h = createHarness()
    try {
      h.service.start() // ONLINE
      assert.equal(h.service.getState().status, 'ONLINE')

      h.set(false) // one failed probe: not a verdict
      h.runProbes(1)
      assert.equal(h.service.getState().status, 'VERIFYING')

      h.set(true) // recovered before the threshold
      h.runProbes(1)
      assert.equal(h.service.getState().status, 'DEGRADED')

      assert.ok(!h.statuses().includes('OFFLINE'), 'must never have reported OFFLINE')
      assert.equal(h.service.getState().offlineSince, null)
    } finally {
      h.cleanup()
    }
  })

  test('a genuine outage confirms OFFLINE and dates it from the first failure', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(false)
      h.runProbes(PROFILE.failureThreshold)

      // The moment of the first failed probe: the update that first
      // reported VERIFYING is the one that observed it.
      const firstFailure = h.updates.find((u) => u.state.status === 'VERIFYING' && u.state.lastChecked)

      const state = h.service.getState()
      assert.equal(state.status, 'OFFLINE')
      // The connection stopped working at that first failure, not when
      // the third probe finally confirmed it.
      assert.equal(state.offlineSince, firstFailure.state.lastChecked)
      assert.ok(state.statusChangedAt !== null)
    } finally {
      h.cleanup()
    }
  })

  test('a long outage stays one OFFLINE, announced once', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(false)
      h.runProbes(PROFILE.failureThreshold)
      const offlineSince = h.service.getState().offlineSince

      h.runProbes(50)

      assert.equal(h.service.getState().status, 'OFFLINE')
      assert.equal(h.service.getState().offlineSince, offlineSince, 'offline clock must not restart')
      assert.equal(h.changes().filter((s) => s === 'OFFLINE').length, 1)
    } finally {
      h.cleanup()
    }
  })

  test('recovery is verified before ONLINE is declared, and clears the offline clock', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(false)
      h.runProbes(PROFILE.failureThreshold)
      assert.equal(h.service.getState().status, 'OFFLINE')

      // A single success mid-outage is not a recovery: it must not
      // silence the alarm or hide the overlay.
      h.set(true)
      h.runProbes(PROFILE.recoveryThreshold - 1)
      assert.equal(h.service.getState().status, 'OFFLINE')

      h.runProbes(1)
      const state = h.service.getState()
      assert.equal(state.status, 'ONLINE')
      assert.equal(state.offlineSince, null)
      assert.deepEqual(h.changes(), ['ONLINE', 'VERIFYING', 'OFFLINE', 'ONLINE'])
    } finally {
      h.cleanup()
    }
  })

  test('stop() ends all monitoring activity', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(false)
      h.runProbes(PROFILE.failureThreshold)
      assert.equal(h.service.getState().status, 'OFFLINE')

      const probesBefore = h.probedUrls.length
      h.service.stop()

      assert.equal(h.service.getState().isMonitoring, false)
      h.runProbes(20)
      assert.equal(h.probedUrls.length, probesBefore, 'no probe may run after stop()')
    } finally {
      h.cleanup()
    }
  })

  test('restarting begins a clean cycle rather than resuming a stale verdict', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(false)
      h.runProbes(PROFILE.failureThreshold)
      assert.equal(h.service.getState().status, 'OFFLINE')

      h.service.stop()
      h.set(true)
      h.service.start()

      // The first probe of the new cycle settles it immediately: there is
      // no previous verdict for it to have to overturn.
      const state = h.service.getState()
      assert.equal(state.status, 'ONLINE')
      assert.equal(state.offlineSince, null)
      assert.equal(state.isMonitoring, true)
    } finally {
      h.cleanup()
    }
  })

  test('a probe answering after stop() cannot mutate state', () => {
    const h = createHarness()
    try {
      let deferred = null
      h.service.probe = (_url, done) => {
        deferred = done
      }

      h.service.start()
      assert.ok(deferred, 'a probe should be in flight')

      h.service.stop()
      deferred(false) // the orphaned reply finally arrives

      assert.equal(h.service.getState().lastChecked, null, 'a stale reply must be ignored')
      assert.equal(h.service.getState().status, 'VERIFYING')
    } finally {
      h.cleanup()
    }
  })

  test('a slow but successful probe reads as DEGRADED, not OFFLINE', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(true, PROFILE.slowResponseMs + 100)
      h.runProbes(1)
      assert.equal(h.service.getState().status, 'DEGRADED')
    } finally {
      h.cleanup()
    }
  })

  test('DEGRADED clears once the connection has been clean for the grace window', () => {
    const h = createHarness()
    try {
      h.service.start()
      h.set(false)
      h.runProbes(1)
      h.set(true)
      h.runProbes(1)
      assert.equal(h.service.getState().status, 'DEGRADED')

      h.runProbes(Math.ceil(PROFILE.degradedGraceMs / INTERVAL) + 1)
      assert.equal(h.service.getState().status, 'ONLINE')
    } finally {
      h.cleanup()
    }
  })

  test('lastChecked advances on every probe, not only on a status change', () => {
    const h = createHarness()
    try {
      h.service.start()
      const first = h.service.getState().lastChecked
      h.runProbes(1)
      const second = h.service.getState().lastChecked
      assert.ok(first && second && second > first, 'lastChecked must keep moving')
    } finally {
      h.cleanup()
    }
  })

  test('a changed interval takes effect without waiting out the old one', () => {
    const h = createHarness()
    try {
      h.service.start()
      const probesAtStart = h.probedUrls.length

      h.service.updateConfig({ intervalMs: 2_000 })
      mock.timers.tick(2_001)
      assert.equal(h.probedUrls.length, probesAtStart + 1)
    } finally {
      h.cleanup()
    }
  })
})
