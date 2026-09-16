// Regression test for the Settings blank-screen failure mode: React 18
// unmounts the whole tree on an uncaught render error, and this app had
// no boundary anywhere to stop that. ErrorBoundary is what prevents a
// screen crash from taking the window down to a blank white page.
//
// Error boundaries only activate during real client rendering (React
// does not invoke them for react-dom/server), and this project has no
// DOM test environment to render into — so this exercises the class's
// own logic directly (its static derive-state hook and its render
// method as plain functions) rather than pulling in a new browser-DOM
// dependency for one component.
const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const fs = require('node:fs')
const esbuild = require('esbuild')

// The component is TSX; transpile it on the fly with esbuild (already a
// transitive dependency via vite) rather than adding a new test-only
// toolchain for one file.
function loadTsx(relativePath) {
  const file = path.join(__dirname, '..', relativePath)
  const { code } = esbuild.transformSync(fs.readFileSync(file, 'utf-8'), {
    loader: 'tsx',
    format: 'cjs',
    jsx: 'automatic',
  })
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = Module._nodeModulePaths(path.dirname(file))
  mod._compile(code, file)
  return mod.exports
}

const React = require('react')
const { ErrorBoundary } = loadTsx('src/components/ErrorBoundary.tsx')

describe('ErrorBoundary', () => {
  test('getDerivedStateFromError captures the thrown error', () => {
    const error = new Error('boom from a screen')
    assert.deepEqual(ErrorBoundary.getDerivedStateFromError(error), { error })
  })

  test('renders a labelled fallback instead of nothing once it has caught', () => {
    const instance = new ErrorBoundary({ label: 'Settings', onRecover: () => undefined, children: null })
    instance.state = { error: new Error('boom from a screen') }

    const output = instance.render()

    const html = renderElementToText(output)
    assert.match(html, /Settings\s+hit an error/)
    assert.match(html, /boom from a screen/)
  })

  test('passes children through untouched when nothing has been caught', () => {
    const children = React.createElement('div', null, 'all good')
    const instance = new ErrorBoundary({ label: 'Settings', onRecover: () => undefined, children })
    instance.state = { error: null }

    assert.equal(instance.render(), children)
  })

  test('recovering clears the caught error and calls onRecover', () => {
    let recovered = false
    const instance = new ErrorBoundary({
      label: 'Settings',
      onRecover: () => {
        recovered = true
      },
      children: null,
    })
    instance.state = { error: new Error('boom') }
    instance.setState = (patch) => Object.assign(instance.state, patch)

    instance.recover()

    assert.equal(instance.state.error, null)
    assert.equal(recovered, true)
  })
})

// Minimal recursive text extraction from a React element tree — enough
// to assert on visible copy without needing a DOM or a server renderer.
function renderElementToText(element) {
  if (element === null || element === undefined || typeof element === 'boolean') return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(renderElementToText).join(' ')
  if (React.isValidElement(element)) {
    const children = element.props && element.props.children
    return renderElementToText(children)
  }
  return ''
}
