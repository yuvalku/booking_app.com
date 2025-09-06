import { Routes, Route, Link } from "react-router-dom";
import BookingPage from "./pages/Booking.jsx";
import AdminPage from "./pages/Admin.jsx";
import { AdminProvider } from "./admin/AdminContext";

export default function App() {
  return (
    <AdminProvider>
      <div style={{ maxWidth: 980, margin: "20px auto", padding: "0 16px" }}>
        <header style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Eilat Apartment Booking</h2>
          <Link to="/">Book</Link>
          <Link to="/admin">Admin</Link>
        </header>
        <Routes>
          <Route path="/" element={<BookingPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </div>
    </AdminProvider>
  );
}
