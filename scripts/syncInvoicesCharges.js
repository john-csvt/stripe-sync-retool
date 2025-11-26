import Stripe from 'stripe';
import pkg from 'pg';
import dotenv from 'dotenv';
import { getLastSyncTimestamp, updateLastSyncTimestamp } from '../lib/syncState.js';

dotenv.config();

console.log("🔍 Loaded PGHOST:", process.env.PGHOST);

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


async function syncInvoicesAndCharges() {
  await db.connect();

  // 🔌 Quick connectivity check
  const testInvoice = await stripe.invoices.list({ limit: 1 });
  console.log(`🔌 Stripe connected: Found ${testInvoice.data.length} invoices`);

  // 📅 Get last sync time
  const lastSync = await getLastSyncTimestamp('invoices');
  console.log(`📅 Last invoice sync timestamp: ${lastSync}`);

  let newestTimestamp = lastSync;
  let invoiceCount = 0;
  let chargeCount = 0;

  // ---------------------------------------------------------------
  // 🧾 1️⃣ Sync NEW or UPDATED invoices + their linked charges
  // ---------------------------------------------------------------
  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;

    const response = await stripe.invoices.list(params);

    for (const invoice of response.data) {

      // ⏩ Skip invoices older than last sync
      if (invoice.created <= lastSync) continue;

      invoiceCount++;
      newestTimestamp = Math.max(newestTimestamp, invoice.created);

      let charge = null;

      // Fetch linked charge if exists
      if (invoice.latest_charge) {
        try {
          console.log(`🔗 Fetching charge for invoice ${invoice.id} → ${invoice.latest_charge}`);
          charge = await stripe.charges.retrieve(invoice.latest_charge);
        } catch (err) {
          console.error(`❌ Failed to fetch charge ${invoice.latest_charge}`, err);
        }
      }

      // Insert / update invoice
      try {
        console.log(`🧾 Inserting invoice ${invoice.id}...`);

        await db.query(`
          INSERT INTO stripe_invoices (
            id, customer_id, customer_email, invoice_number,
            status, amount_due, amount_paid, amount_remaining, paid,
            due_date, created, latest_charge_id, payment_intent, subscription
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            amount_due = EXCLUDED.amount_due,
            amount_paid = EXCLUDED.amount_paid,
            amount_remaining = EXCLUDED.amount_remaining,
            paid = EXCLUDED.paid,
            due_date = EXCLUDED.due_date
        `, [
          invoice.id,
          invoice.customer,
          invoice.customer_email,
          invoice.number,
          invoice.status,
          invoice.amount_due,
          invoice.amount_paid,
          invoice.amount_remaining,
          invoice.paid,
          invoice.due_date ? new Date(invoice.due_date * 1000) : null,
          new Date(invoice.created * 1000),
          invoice.latest_charge || null,
          invoice.payment_intent || null,
          invoice.subscription || null
        ]);

        console.log(`✅ Inserted invoice ${invoice.id}`);
      } catch (err) {
        console.error(`❌ Failed to insert invoice ${invoice.id}`, err);
      }

      // Insert linked charge
      if (charge) {
        try {
          console.log(`💳 Inserting charge ${charge.id}...`);
          await insertCharge(charge);
          chargeCount++;
          console.log(`✅ Inserted charge ${charge.id}`);
        } catch (err) {
          console.error(`❌ Failed to insert linked charge ${charge.id}`, err);
        }
      }
    }

    hasMore = response.has_more;
    startingAfter = hasMore ? response.data[response.data.length - 1].id : undefined;
  }

  // ---------------------------------------------------------------
  // 💳 2️⃣ Sync orphan charges (manual or non-invoice charges)
  // ---------------------------------------------------------------
  console.log(`🔍 Syncing orphan charges...`);

  hasMore = true;
  startingAfter = undefined;

  while (hasMore) {
    const chargeResponse = await stripe.charges.list({
      limit: 100,
      starting_after: startingAfter
    });

    for (const charge of chargeResponse.data) {

      // Skip old charges (only-new logic)
      if (charge.created <= lastSync) continue;

      newestTimestamp = Math.max(newestTimestamp, charge.created);

      // Skip if charge already synced
      const exists = await db.query(
        'SELECT 1 FROM stripe_charges WHERE id = $1',
        [charge.id]
      );

      if (exists.rowCount === 0) {
        try {
          console.log(`💳 Inserting orphan charge ${charge.id}...`);
          await insertCharge(charge);
          chargeCount++;
          console.log(`✅ Inserted orphan charge ${charge.id}`);
        } catch (err) {
          console.error(`❌ Failed to insert orphan charge ${charge.id}`, err);
        }
      }
    }

    hasMore = chargeResponse.has_more;
    startingAfter = hasMore
      ? chargeResponse.data[chargeResponse.data.length - 1].id
      : undefined;
  }

  // ---------------------------------------------------------------
  // 📅 Save new last-sync timestamp
  // ---------------------------------------------------------------
  await updateLastSyncTimestamp('invoices', newestTimestamp);
  console.log(`📌 Updated last sync timestamp → ${newestTimestamp}`);

  await db.end();
  console.log(`✅ Sync complete: ${invoiceCount} invoices, ${chargeCount} charges.`);
}



// ----------------------------------------------------------------
// 💳 reusable charge insert helper
// ----------------------------------------------------------------
async function insertCharge(charge) {
  await db.query(`
    INSERT INTO stripe_charges (
      id, invoice_id, customer_id, status,
      failure_message, card_brand, card_last4,
      exp_month, exp_year, created
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      failure_message = EXCLUDED.failure_message
  `, [
    charge.id,
    charge.invoice || null,
    charge.customer,
    charge.status,
    charge.failure_message || null,
    charge.payment_method_details?.card?.brand || null,
    charge.payment_method_details?.card?.last4 || null,
    charge.payment_method_details?.card?.exp_month || null,
    charge.payment_method_details?.card?.exp_year || null,
    new Date(charge.created * 1000)
  ]);
}



// ----------------------------------------------------------------
// 🚀 Run the sync
// ----------------------------------------------------------------
syncInvoicesAndCharges()
  .catch(err => {
    console.error("❌ Sync failed", err);
    process.exit(1);
  });
