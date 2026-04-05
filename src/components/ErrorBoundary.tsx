/**
 * ErrorBoundary.tsx — Global error boundary for graceful crash handling
 * 
 * Catches unhandled React errors and displays a user-friendly recovery screen.
 * Prevents the entire app from crashing when errors occur.
 */

import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload(); // Fresh start
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen">
          <div className="glass-panel-strong p-8 max-w-2xl mx-auto rounded-2xl">
            <div className="flex flex-col items-center text-center">
              <span 
                className="material-symbols-outlined text-6xl mb-4" 
                style={{ color: 'var(--ax-error)', fontVariationSettings: "'FILL' 1" }}
              >
                error
              </span>
              <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                Application Error
              </h1>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
                {this.state.error?.message || 'An unexpected error occurred in the application'}
              </p>
              
              {this.state.errorInfo && import.meta.env.DEV && (
                <details className="mt-4 text-xs font-mono w-full text-left">
                  <summary 
                    className="cursor-pointer px-4 py-2 rounded-lg mb-2" 
                    style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}
                  >
                    Technical Details (Dev Mode)
                  </summary>
                  <pre 
                    className="mt-2 p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap" 
                    style={{ background: 'var(--glass-bg-strong)', color: 'var(--text-secondary)' }}
                  >
                    {this.state.error?.stack}
                    {'\n\n'}
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}
              
              <button 
                className="btn-primary mt-6 px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-widest"
                onClick={this.handleReset}
              >
                Restart Application
              </button>
              
              <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
                Your data is safe. Restarting will reload the app with a fresh state.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
