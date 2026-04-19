import { Layout } from "./components/Layout";
import { RepoProvider } from "./state/RepoStore";
import { SessionProvider } from "./state/SessionStore";
import { TabProvider } from "./state/TabStore";

export function App() {
  return (
    <SessionProvider>
      <RepoProvider>
        <TabProvider>
          <Layout />
        </TabProvider>
      </RepoProvider>
    </SessionProvider>
  );
}
