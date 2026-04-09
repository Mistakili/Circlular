import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import ArcMarket from "@/pages/ArcMarket";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ArcMarket />
      <Toaster />
    </QueryClientProvider>
  );
}
