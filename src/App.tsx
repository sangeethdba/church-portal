import { Routes, Route, Navigate } from "react-router-dom";
import RequireAuth from "@/components/RequireAuth";
import { ToastContainer } from "@/components/ui";
import AppShell from "@/components/Layout";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import MyOverview from "@/pages/MyOverview";
import Donors from "@/pages/Donors";
import Donations from "@/pages/Donations";
import Expenses from "@/pages/Expenses";
import TaxReport from "@/pages/TaxReport";
import Offerings from "@/pages/Offerings";
import Reports from "@/pages/Reports";
import ImportStatements from "@/pages/ImportStatements";
import AnnualReport from "@/pages/AnnualReport";
import Reconciliation from "@/pages/Reconciliation";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/my" element={<MyOverview />} />
          <Route path="/donors" element={<Donors />} />
          <Route path="/donations" element={<Donations />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/tax-report" element={<TaxReport />} />
          <Route path="/offerings" element={<Offerings />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/import" element={<ImportStatements />} />
          <Route path="/annual-report" element={<AnnualReport />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
