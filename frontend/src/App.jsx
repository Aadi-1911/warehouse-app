// Root React component — owns the route table for the whole app.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import ReceiveStock from './pages/ReceiveStock';
import LiveStock from './pages/LiveStock';
import LowStockList from './pages/LowStockList';
import Transfer from './pages/Transfer';
import ManageUsers from './pages/ManageUsers';
import SetPin from './pages/SetPin';
import FactoryPayables from './pages/FactoryPayables';
import ArticlePricing from './pages/ArticlePricing';
import Parties from './pages/Parties';
import NewOrder from './pages/NewOrder';
import PackOrderList from './pages/PackOrderList';
import PackOrderDetail from './pages/PackOrderDetail';
import History from './pages/History';
import BillOrderList from './pages/BillOrderList';
import BillOrderDetail from './pages/BillOrderDetail';
import ShipOrderList from './pages/ShipOrderList';
import ShipOrderDetail from './pages/ShipOrderDetail';
import GoodReturns from './pages/GoodReturns';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import Overview from './pages/dashboard/Overview';
import Orders from './pages/dashboard/Orders';
import DashboardHistory from './pages/dashboard/History';
import DashboardLowStock from './pages/dashboard/LowStock';
import DashboardParties from './pages/dashboard/Parties';
import DashboardLocations from './pages/dashboard/Locations';
import DashboardArticlePricing from './pages/dashboard/ArticlePricing';
import DashboardBills from './pages/dashboard/Bills';
import DashboardFactories from './pages/dashboard/Factories';
import DashboardLiveStock from './pages/dashboard/LiveStock';

export default function App() {
  return (
    // AuthProvider sits *inside* BrowserRouter so anything it renders can still use router
    // hooks, and *outside* Routes so the session survives navigation between pages rather
    // than being torn down and re-fetched on every route change.
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />
          <Route
            path="/receive"
            element={
              <ProtectedRoute>
                <ReceiveStock />
              </ProtectedRoute>
            }
          />
          <Route
            path="/live-stock"
            element={
              <ProtectedRoute>
                <LiveStock />
              </ProtectedRoute>
            }
          />
          <Route
            path="/low-stock"
            element={
              // No requireRole — 07_UI_DESIGN_BRIEF.md §5.7: a stock-visibility screen, same
              // category as Live Stock itself, not owner-only.
              <ProtectedRoute>
                <LowStockList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/transfer"
            element={
              <ProtectedRoute>
                <Transfer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute requireRole="OWNER">
                <ManageUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/set-pin"
            element={
              <ProtectedRoute requireRole="OWNER">
                <SetPin />
              </ProtectedRoute>
            }
          />
          <Route
            path="/factory-payables"
            element={
              <ProtectedRoute requireRole="OWNER">
                <FactoryPayables />
              </ProtectedRoute>
            }
          />
          <Route
            path="/article-pricing"
            element={
              <ProtectedRoute requireRole="OWNER">
                <ArticlePricing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/parties"
            element={
              // Any-role as of 2026-08-18. The old owner-only gate was justified by "this screen
              // has no staff-facing purpose today (not wired into New Order, which doesn't exist
              // yet)" — New Order exists now and picks a Party on every order, so staff have a
              // real reason to look one up and to add a new customer. Archive/reactivate stays
              // owner-only inside the screen itself (Parties.jsx) and at the API.
              <ProtectedRoute>
                <Parties />
              </ProtectedRoute>
            }
          />
          <Route
            path="/new-order"
            element={
              // No requireRole — rule 25: staff creating orders during a sample visit is the
              // primary real-world use case, same reasoning as POST /api/orders itself.
              <ProtectedRoute>
                <NewOrder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pack-orders"
            element={
              // No requireRole — rule 63: staff is the primary user for Placed → Packed, same
              // reasoning as New Order's own any-role gating above.
              <ProtectedRoute>
                <PackOrderList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/pack-orders/:id"
            element={
              <ProtectedRoute>
                <PackOrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              // No requireRole — both roles see the identical feed, no role-based filtering of
              // content (GET /api/history is any-authenticated-role for the same reason).
              <ProtectedRoute>
                <History />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bill-orders"
            element={
              // OWNER-only, matching PATCH /api/orders/:id/bill's own requireRole('OWNER') gate.
              // Rule 63: "... → Billed" is owner-only and must never be offered to STAFF.
              <ProtectedRoute requireRole="OWNER">
                <BillOrderList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bill-orders/:id"
            element={
              <ProtectedRoute requireRole="OWNER">
                <BillOrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ship-orders"
            element={
              // No requireRole — rule 63 names Billed → Shipped as staff-reachable, same
              // reasoning as Pack Order's own any-role gating.
              <ProtectedRoute>
                <ShipOrderList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ship-orders/:id"
            element={
              <ProtectedRoute>
                <ShipOrderDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/good-returns"
            element={
              // No requireRole — taking returned goods at the counter is a staff job, the same
              // staff-primary reasoning behind Receive Stock and New Order. POST /api/returns is
              // any-role for the same reason.
              <ProtectedRoute>
                <GoodReturns />
              </ProtectedRoute>
            }
          />
          {/* Owner Desktop Dashboard (07_UI_DESIGN_BRIEF.md §8). A NESTED route: the layout shell
              renders the rail and header once and swaps only the content pane through <Outlet>,
              which is what makes the rail persist across nav clicks instead of remounting. The
              OWNER gate sits on the parent, so it covers every child route by construction — a new
              dashboard page can't accidentally ship ungated. Matches the requireRole="OWNER"
              pattern already used for Manage Users, Factory Payables and Article Pricing.
              GET /api/dashboard/overview enforces the same restriction server-side. */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requireRole="OWNER">
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Overview />} />
            <Route path="orders" element={<Orders />} />
            <Route path="low-stock" element={<DashboardLowStock />} />
            <Route path="parties" element={<DashboardParties />} />
            <Route path="history" element={<DashboardHistory />} />
            <Route path="locations" element={<DashboardLocations />} />
            <Route path="article-pricing" element={<DashboardArticlePricing />} />
            {/* Same FactoryPayables component the mobile /factory-payables route renders, with
                `inDashboard` swapping its mobile .page/ScreenHeader wrapper for the dashboard
                shell's own chrome — not a separate dashboard copy (see that file's header
                comment for why). Needs no requireRole of its own: the OWNER gate on the parent
                /dashboard route covers it, and the endpoints it calls are independently
                OWNER+PIN gated server-side. */}
            <Route path="factory-payables" element={<FactoryPayables inDashboard />} />
            {/* Added 2026-08-30. Read-only — GET /api/orders and GET /api/parties are the only
                calls this page makes, both any-role at the API, safe here for the same reason
                Parties/History already are: the OWNER gate on the parent route covers it, and
                there is no write path on this screen at all. */}
            <Route path="bills" element={<DashboardBills />} />
            {/* Added 2026-09-02. Needs no requireRole of its own: the OWNER gate on the parent
                /dashboard route covers it, and PATCH /api/factories/:id is independently
                OWNER-gated server-side (no PIN — see that endpoint's own comment). */}
            <Route path="factories" element={<DashboardFactories />} />
            {/* Added 2026-09-02, same "append at the end, never renumber" precedent as every
                addition above. Needs no requireRole of its own: the OWNER gate on the parent
                /dashboard route covers it, and GET /api/stock is independently any-role at the
                API (safe here for the same reason History/Parties are — read-only, no write
                path on this screen at all). */}
            <Route path="live-stock" element={<DashboardLiveStock />} />
          </Route>
          {/* Unknown URLs fall back home rather than rendering a blank screen. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
