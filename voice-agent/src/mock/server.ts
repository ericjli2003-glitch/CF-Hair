import express, { type NextFunction, type Request, type Response } from "express";
import { pathToFileURL } from "node:url";
import { InMemoryBookingApi } from "../api/mock.js";
import { ApiError, ApiUnavailableError } from "../api/types.js";
import { loadConfig } from "../config.js";
import { loadSalon } from "../salon.js";

/**
 * HTTP wrapper around InMemoryBookingApi that speaks the booking API contract.
 * Lets you run the phone server locally before the website exists:
 *   npm run mock-api   (then BOOKING_API_URL=http://localhost:3999)
 */
export function createMockApiApp(api: InMemoryBookingApi, apiKey = "") {
  const app = express();
  app.use(express.json());

  const agentOnly = (req: Request, res: Response, next: NextFunction) => {
    if (apiKey && req.header("x-api-key") !== apiKey) {
      res.status(401).json({ error: "UNAUTHORIZED" });
      return;
    }
    next();
  };

  const wrap =
    (fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof ApiError) res.status(err.status).json({ error: err.code });
        else if (err instanceof ApiUnavailableError) res.status(503).json({ error: "UNAVAILABLE" });
        else res.status(500).json({ error: "INTERNAL", detail: (err as Error).message });
      }
    };

  app.get("/api/services", wrap(async (_req, res) => res.json(await api.getServices())));
  app.get("/api/staff", wrap(async (_req, res) => res.json(await api.getStaff())));
  app.get(
    "/api/availability",
    wrap(async (req, res) =>
      res.json(
        await api.getAvailability({
          serviceId: String(req.query.serviceId ?? ""),
          date: String(req.query.date ?? ""),
          staffId: req.query.staffId ? String(req.query.staffId) : undefined,
        }),
      ),
    ),
  );
  app.post("/api/bookings", wrap(async (req, res) => res.status(201).json({ booking: await api.createBooking(req.body) })));
  app.get(
    "/api/bookings/lookup",
    agentOnly,
    wrap(async (req, res) => res.json(await api.lookupBookings(String(req.query.phone ?? "")))),
  );
  app.post(
    "/api/bookings/:id/cancel",
    agentOnly,
    wrap(async (req, res) => res.json({ booking: await api.cancelBooking(String(req.params.id)) })),
  );
  app.post(
    "/api/bookings/:id/reschedule",
    agentOnly,
    wrap(async (req, res) => res.json({ booking: await api.rescheduleBooking(String(req.params.id), req.body) })),
  );
  app.post("/api/messages", agentOnly, wrap(async (req, res) => res.status(201).json(await api.postMessage(req.body))));
  app.get("/api/callers/:phone", agentOnly, wrap(async (req, res) => res.json(await api.getCaller(String(req.params.phone)))));
  app.put(
    "/api/callers/:phone",
    agentOnly,
    wrap(async (req, res) => res.json(await api.putCaller(String(req.params.phone), req.body ?? {}))),
  );
  app.post(
    "/api/calls",
    agentOnly,
    wrap(async (req, res) => {
      const r = await api.postCall(req.body ?? {});
      res.status(r.created ? 201 : 200).json({ call: r.call });
    }),
  );
  app.post("/api/customers/consent", agentOnly, wrap(async (req, res) => res.status(201).json(await api.recordSmsConsent(req.body ?? {}))));
  return app;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const cfg = loadConfig();
  const api = new InMemoryBookingApi(loadSalon(cfg.salonJsonPath), { seedDemoData: true });
  const port = Number(process.env.MOCK_API_PORT ?? 3999);
  createMockApiApp(api, cfg.agentApiKey).listen(port, () => {
    console.log(`Mock booking API listening on http://localhost:${port} (set BOOKING_API_URL to this)`);
  });
}
