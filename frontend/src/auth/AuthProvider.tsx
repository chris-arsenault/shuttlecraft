import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getAuthRuntimeConfig } from "./config";
import {
  getSessionSnapshot,
  isAuthConfigured,
  signIn,
  signOut,
  type SessionSnapshot,
} from "./cognito";
import "./AuthProvider.css";

type AuthState =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "anonymous"; error: string | null }
  | { kind: "authenticated"; session: SessionSnapshot };

interface AuthContextValue {
  state: AuthState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (!isAuthConfigured()) {
      setState({ kind: "disabled" });
      return;
    }
    void (async () => {
      try {
        const session = await getSessionSnapshot();
        if (cancelled) return;
        if (session) setState({ kind: "authenticated", session });
        else setState({ kind: "anonymous", error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "anonymous",
          error: err instanceof Error ? err.message : "authentication failed",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      async login(username: string, password: string) {
        setState({ kind: "loading" });
        try {
          const session = await signIn(username, password);
          setState({ kind: "authenticated", session });
        } catch (err) {
          setState({
            kind: "anonymous",
            error: err instanceof Error ? err.message : "login failed",
          });
        }
      },
      logout() {
        signOut();
        setState({ kind: "anonymous", error: null });
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { state, login, logout } = useAuth();
  const runtime = getAuthRuntimeConfig();

  if (state.kind === "loading") {
    return <div className="auth-shell auth-shell--loading">checking session…</div>;
  }

  if (state.kind === "disabled") {
    return <>{children}</>;
  }

  if (state.kind === "authenticated") {
    return (
      <div className="auth-app">
        <div className="auth-app__status">
          <span className="auth-app__user">
            {state.session.username ?? state.session.email ?? "signed in"}
          </span>
          <button type="button" className="auth-app__logout" onClick={logout}>
            sign out
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <LoginScreen
      configured={runtime != null}
      error={state.error}
      onLogin={login}
    />
  );
}

function LoginScreen({
  configured,
  error,
  onLogin,
}: {
  configured: boolean;
  error: string | null;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(username, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-card__eyebrow">sulion</div>
        <h1 className="auth-card__title">Authenticate to continue</h1>
        <p className="auth-card__copy">
          The UI stays LAN-only, but the frontend, REST API, and PTY websocket now require a
          shared Ahara Cognito session.
        </p>
        {!configured && (
          <div className="auth-card__error">
            Cognito runtime config is missing. Set `cognitoUserPoolId` and `cognitoClientId`.
          </div>
        )}
        {error && <div className="auth-card__error">{error}</div>}
        <label className="auth-card__field">
          <span>Username or email</span>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(ev) => setUsername(ev.target.value)}
            disabled={!configured || submitting}
          />
        </label>
        <label className="auth-card__field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            disabled={!configured || submitting}
          />
        </label>
        <button
          type="submit"
          className="auth-card__submit"
          disabled={!configured || submitting || username.trim() === "" || password === ""}
        >
          {submitting ? "signing in…" : "sign in"}
        </button>
      </form>
    </div>
  );
}
