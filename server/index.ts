import { Hono } from "hono";
import { serveStatic, upgradeWebSocket, websocket } from "hono/bun";
import { getCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { type AppEnv, authRoutes, loadUser, userForSessionToken } from "./auth.ts";
import { config } from "./config.ts";
import { type Conn, getLiveRun, isCheckedIn } from "./live.ts";
import { joinRoutes, teacherRoutes } from "./routes.ts";

const app = new Hono<AppEnv>();

app.use(secureHeaders());
app.use("/api/*", loadUser);
app.route("/api/auth", authRoutes);
app.route("/api", joinRoutes);
app.route("/api/teacher", teacherRoutes);

app.get(
  "/ws/runs/:id",
  upgradeWebSocket((c) => {
    const user = userForSessionToken(getCookie(c, "sid"));
    const lr = getLiveRun(c.req.param("id")!);
    let conn: Conn | null = null;
    return {
      onOpen(_evt, ws) {
        const origin = c.req.header("origin");
        if (origin && origin !== config.publicUrl) return ws.close(4403, "bad origin");
        if (!user || !lr) return ws.close(4401, "unauthorized");
        const wantsPresenter = c.req.query("as") === "presenter";
        if (wantsPresenter && lr.task.ownerId !== user.id) return ws.close(4403, "forbidden");
        if (!wantsPresenter && !isCheckedIn(lr.runId, user.id)) return ws.close(4403, "not checked in");
        conn = { ws, user, role: wantsPresenter ? "presenter" : "student" };
        lr.join(conn);
      },
      onMessage(evt) {
        if (conn && lr && typeof evt.data === "string") lr.handleMessage(conn, evt.data);
      },
      onClose() {
        if (conn && lr) lr.leave(conn);
      },
    };
  }),
);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

if (config.isProd) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

console.log(`ClassQuiz listening on :${config.port} (public URL ${config.publicUrl})`);

export default { port: config.port, fetch: app.fetch, websocket };
