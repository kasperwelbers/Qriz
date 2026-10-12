import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import { NameGate } from "./components/NameForm";
import Dashboard from "./pages/Dashboard";
import Join from "./pages/Join";
import Login from "./pages/Login";
import Play from "./pages/Play";
import Present from "./pages/Present";
import Results from "./pages/Results";
import TaskEditor from "./pages/TaskEditor";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/tasks/:id" element={<TaskEditor />} />
        <Route path="/present/:runId" element={<Present />} />
        <Route path="/results/:runId" element={<Results />} />
        <Route path="/j/:token" element={<Join />} />
        <Route path="/join/resume" element={<Join resume />} />
        <Route
          path="/play/:runId"
          element={
            <NameGate>
              <Play />
            </NameGate>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
