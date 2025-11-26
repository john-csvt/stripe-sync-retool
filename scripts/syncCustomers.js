import Stripe from 'stripe';
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const stripe = new Stripe(process.env.STRIPE_API_KEY);
const { Client } = pkg;

const db = new Client({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false }
});

async function syncCustomers() {
  await db.connect();
  console.log('🧑‍🤝‍🧑 Syncing Stripe customers...');

  let hasMore = true;
  let startingAfter = undefined;
  let count = 0;

  while (hasMore) {
    const response = await stripe.customers.list({
      limit: 100,
      ...(startingAfter && { starting_after: startingAfter })
    });

    for (const customer of response.data) {
      await db.query(`
        INSERT INTO stripe_customers (
          id, email, name, phone, created, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          metadata = EXCLUDED.metadata
      `, [
        customer.id,
        customer.email,
        customer.name,
        customer.phone,
        new Date(customer.created * 1000),
        customer.metadata || {}
      ]);

      count++;
    }

    hasMore = response.has_more;
    startingAfter = response.data.length > 0
      ? response.data[response.data.length - 1].id
      : undefined;
  }

  await db.end();
  console.log(`✅ Synced ${count} customers.`);
}

syncCustomers().catch(err => {
  console.error("❌ Customer sync failed:", err);
  process.exit(1);
});