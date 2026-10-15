import type { Config, Context } from "@netlify/functions";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { projects } from "../../db/schema.js";

// Shared project store.
//
//   GET    /api/projects               list (metadata only)
//   POST   /api/projects               create        { name, snap, password? }
//   GET    /api/projects/:id           read (anyone can view)
//   PUT    /api/projects/:id           save changes  { snap, name? }      — edit token if locked
//   DELETE /api/projects/:id           delete                              — edit token if locked
//   POST   /api/projects/:id/unlock    { password } → { token }
//   POST   /api/projects/:id/password  { password } set / change / ("" removes) — edit token if locked
//
// An edit token is `<expiry>.<hmac>` signed with the project's own password
// hash, so changing or removing the password invalidates every issued token.

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD = 4;

type Row = typeof projects.$inferSelect;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (error: string, status: number) => json({ error }, status);

async function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

async function checkPassword(row: Row, password: string) {
  if (!row.passwordHash || !row.passwordSalt) return true;
  const { hash } = await hashPassword(password, row.passwordSalt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.passwordHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(passwordHash: string, id: string, exp: number) {
  return createHmac("sha256", passwordHash).update(`${id}.${exp}`).digest("hex");
}

function issueToken(row: { id: string; passwordHash: string | null }) {
  if (!row.passwordHash) return null;
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${sign(row.passwordHash, row.id, exp)}`;
}

function canEdit(row: Row, req: Request) {
  if (!row.passwordHash) return true;
  const token = req.headers.get("x-edit-token") || "";
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(row.passwordHash, row.id, exp), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function counts(snap: any) {
  return {
    periodCount: Array.isArray(snap?.periods) ? snap.periods.length : 0,
    systemCount: Array.isArray(snap?.systems) ? snap.systems.length : 0,
  };
}

function meta(row: Row) {
  return {
    id: row.id,
    name: row.name,
    savedAt: row.savedAt,
    createdAt: row.createdAt,
    periodCount: row.periodCount,
    systemCount: row.systemCount,
    locked: !!row.passwordHash,
  };
}

async function readBody(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}

async function findRow(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row;
}

export default async (req: Request, context: Context) => {
  const { id, action } = context.params;

  try {
    // ── Collection ──────────────────────────────────────────────────────────
    if (!id) {
      if (req.method === "GET") {
        const rows = await db
          .select({
            id: projects.id,
            name: projects.name,
            savedAt: projects.savedAt,
            createdAt: projects.createdAt,
            periodCount: projects.periodCount,
            systemCount: projects.systemCount,
            passwordHash: projects.passwordHash,
          })
          .from(projects)
          .orderBy(desc(projects.savedAt));
        return json(rows.map(({ passwordHash, ...r }) => ({ ...r, locked: !!passwordHash })));
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        const name = String(body?.name || "").trim().slice(0, 200);
        if (!name || !body?.snap || typeof body.snap !== "object") return fail("A name and project data are required.", 400);
        const password = typeof body.password === "string" ? body.password : "";
        if (password && password.length < MIN_PASSWORD) return fail(`Password must be at least ${MIN_PASSWORD} characters.`, 400);

        const pw = password ? await hashPassword(password) : null;
        const [row] = await db
          .insert(projects)
          .values({
            id: "proj_" + Date.now().toString(36) + randomBytes(3).toString("hex"),
            name,
            snap: body.snap,
            ...counts(body.snap),
            passwordHash: pw?.hash ?? null,
            passwordSalt: pw?.salt ?? null,
          })
          .returning();
        return json({ ...meta(row), token: issueToken(row) }, 201);
      }

      return fail("Method not allowed", 405);
    }

    // ── Single project ──────────────────────────────────────────────────────
    const row = await findRow(id);
    if (!row) return fail("Project not found.", 404);

    if (action === "unlock") {
      if (req.method !== "POST") return fail("Method not allowed", 405);
      const body = await readBody(req);
      if (!(await checkPassword(row, String(body?.password ?? "")))) {
        await new Promise((r) => setTimeout(r, 600));   // slow down guessing
        return fail("Incorrect password.", 401);
      }
      return json({ token: issueToken(row) });
    }

    if (action === "password") {
      if (req.method !== "POST") return fail("Method not allowed", 405);
      if (!canEdit(row, req)) return fail("This project is locked. Enter the current password first.", 403);
      const body = await readBody(req);
      const password = typeof body?.password === "string" ? body.password : "";
      if (password && password.length < MIN_PASSWORD) return fail(`Password must be at least ${MIN_PASSWORD} characters.`, 400);
      const pw = password ? await hashPassword(password) : null;
      const [updated] = await db
        .update(projects)
        .set({ passwordHash: pw?.hash ?? null, passwordSalt: pw?.salt ?? null })
        .where(eq(projects.id, id))
        .returning();
      return json({ ...meta(updated), token: issueToken(updated) });
    }

    if (action) return fail("Not found", 404);

    if (req.method === "GET") return json({ ...meta(row), snap: row.snap });

    if (req.method === "PUT") {
      if (!canEdit(row, req)) return fail("This project is locked for editing. Enter the password in Settings to save changes.", 403);
      const body = await readBody(req);
      if (!body?.snap || typeof body.snap !== "object") return fail("Project data is required.", 400);
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : row.name;
      const [updated] = await db
        .update(projects)
        .set({ name, snap: body.snap, ...counts(body.snap), savedAt: new Date() })
        .where(eq(projects.id, id))
        .returning();
      return json(meta(updated));
    }

    if (req.method === "DELETE") {
      if (!canEdit(row, req)) return fail("This project is locked. Enter the password in Settings before deleting it.", 403);
      await db.delete(projects).where(eq(projects.id, id));
      return json({ ok: true });
    }

    return fail("Method not allowed", 405);
  } catch (err) {
    console.error("projects API error", err);
    return fail("Something went wrong on the server. Please try again.", 500);
  }
};

export const config: Config = {
  path: ["/api/projects", "/api/projects/:id", "/api/projects/:id/:action"],
};
