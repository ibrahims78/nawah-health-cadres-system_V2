import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema.js";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;

const sslConfig = process.env.DATABASE_URL?.includes("sslmode=require") ||
  process.env.DATABASE_URL?.includes("ssl=true") ||
  process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
});

export const db = drizzle(pool, { schema });
export { pool };
