import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import SimpleSebtPage from "@/pages/SimpleSebtPage/SimpleSebtPage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SimpleSebtPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
