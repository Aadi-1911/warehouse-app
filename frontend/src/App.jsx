// Root React component — owns the route table for the whole app.
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Home from './pages/Home';
import ReceiveStock from './pages/ReceiveStock';
import LiveStock from './pages/LiveStock';
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
              // Owner-only at the route level even though GET /api/parties itself is any-role
              // (04_API_SPEC.md) — this screen has no staff-facing purpose today (not wired
              // into New Order, which doesn't exist yet), so until then it's just a contact
              // directory, same category as Manage Users/Factory Payables/Article Pricing.
              <ProtectedRoute requireRole="OWNER">
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
          {/* Unknown URLs fall back home rather than rendering a blank screen. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
