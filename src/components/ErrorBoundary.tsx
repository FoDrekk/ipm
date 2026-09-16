import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Name of the screen being guarded, shown in the fallback and the log. */
  label: string
  /** Lets the caller send the user somewhere known-good (e.g. the
   *  dashboard) instead of just re-rendering the screen that just threw. */
  onRecover: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * The last line of defence against a blank window. React unmounts the
 * whole tree on an uncaught render/commit error, and this app has no
 * other boundary anywhere — without one, any exception in a screen (a
 * hook, a bad value, a native API behaving unexpectedly) takes the
 * entire UI down to an empty, unrecoverable white page.
 *
 * Deliberately placed around one screen at a time rather than the whole
 * app: the alarm, the offline overlay and the tray all live above this
 * boundary in App.tsx, so a screen crashing here can never silence the
 * alarm or hide the offline alert.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary] ${this.props.label} crashed:`, error, info.componentStack)
  }

  private recover = (): void => {
    this.setState({ error: null })
    this.props.onRecover()
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-slate-950 px-8 text-center text-slate-100">
        <p className="text-sm font-semibold text-red-400">{this.props.label} hit an error</p>
        <p className="max-w-xs text-xs text-slate-500">{this.state.error.message}</p>
        <button
          type="button"
          onClick={this.recover}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors duration-150 hover:bg-slate-700 active:scale-95"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }
}
