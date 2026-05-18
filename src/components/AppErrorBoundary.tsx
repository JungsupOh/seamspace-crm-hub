// 전역 ErrorBoundary — React 렌더/이벤트 핸들러 외부 에러 catch.
// 흰 화면(WSOD) 대신 사용자 친화적 안내 + 콘솔로 원본 에러 노출.
// 새 페이지/컴포넌트 도입 시 user is not defined 같은 미잡힌 ReferenceError 보호막.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary] uncaught error:', error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleClear = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <div className="max-w-lg w-full bg-card border border-border rounded-xl shadow-sm p-8 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-7 w-7 text-amber-500 shrink-0" />
            <div>
              <h1 className="text-lg font-semibold">화면 표시 중 오류가 발생했습니다</h1>
              <p className="text-xs text-muted-foreground mt-0.5">잠시 후 다시 시도하거나 새로고침해 주세요.</p>
            </div>
          </div>
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-mono text-rose-800 break-all">
            {error.message || String(error)}
          </div>
          <p className="text-xs text-muted-foreground">
            반복 발생 시 아래 메시지를 캡처해서 관리자에게 전달해 주세요.
          </p>
          <div className="flex gap-2 pt-1">
            <button onClick={this.handleClear}
              className="flex-1 h-10 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors">
              계속 시도
            </button>
            <button onClick={this.handleReload}
              className="flex-1 h-10 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors inline-flex items-center justify-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              새로고침
            </button>
          </div>
        </div>
      </div>
    );
  }
}
