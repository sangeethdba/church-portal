import { Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/Layout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import Donors from "@/pages/Donors";
import Donations from "@/pages/Donations";
import Expenses from "@/pages/Expenses";
import TaxReport from "@/pages/TaxReport";
import Offerings from "@/pages/Offerings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/donors" element={<Donors />} />
          <Route path="/donations" element={<Donations />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/tax-report" element={<TaxReport />} />
          <Route path="/offerings" element={<Offerings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
