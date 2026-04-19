import { Layout } from "./components/Layout";
import { RepoProvider } from "./state/RepoStore";
import { SessionProvider } from "./state/SessionStore";

export function App() {
  return (
    <SessionProvider>
      <RepoProvider>
        <Layout />
      </RepoProvider>
    </SessionProvider>
  );
}
