import { lazy, StrictMode, Suspense } from "react";
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
import Review from "./pages/Review";

// Teacher-only pages pull in the YAML/Zod tooling; keep it out of what students' phones download.
const Course = lazy(() => import("./pages/Course"));
const CourseYaml = lazy(() => import("./pages/CourseYaml"));
const TaskEditor = lazy(() => import("./pages/TaskEditor"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/courses/:id" element={<Course />} />
        <Route path="/courses/:id/yaml" element={<CourseYaml />} />
        <Route path="/courses/:courseId/tasks/new" element={<TaskEditor />} />
        <Route path="/tasks/:id" element={<TaskEditor />} />
        <Route path="/review/:runId" element={<Review />} />
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
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
