import Stripe from 'stripe';
import pkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_API_KEY);
const { Client } = pkg;

const db = new Client({
  connectionString: `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}?sslmode=require`
});

async function syncInvoices() {
  await db.connect();

  let hasMore = true;
  let startingAfter = undefined;
  let invoiceCount = 0;
  let chargeCount = 0;

  while (hasMore) {
    const params = {
      limit: 100,
      status: 'open',
    };

    if (startingAfter && typeof startingAfter === 'string' && startingAfter.trim().length > 0) {
      params.starting_after = startingAfter;
    }

    const response = await stripe.invoices.list(params);

    for (const invoice of response.data) {
      invoiceCount++;

      let charge = null;
      if (invoice.latest_charge) {
        try {
          console.log(`Fetching charge for invoice ${invoice.id} → charge ${invoice.latest_charge}`);
          charge = await stripe.charges.retrieve(invoice.latest_charge);
        } catch (err) {
          console.error(`❌ Failed to fetch charge ${invoice.latest_charge}`, err);
        }
      }

      await db.query(`
        INSERT INTO stripe_invoices (
          id, customer_id, customer_email, invoice_number,
          status, amount_due, due_date, created, latest_charge_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          amount_due = EXCLUDED.amount_due,
          due_date = EXCLUDED.due_date
      `, [
        invoice.id,
        invoice.customer,
        invoice.customer_email,
        invoice.number,
        invoice.status,
        invoice.amount_due,
        invoice.due_date ? new Date(invoice.due_date * 1000) : null,
        new Date(invoice.created * 1000),
        invoice.latest_charge || null
      ]);

      if (charge) {
        try {
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
            charge.invoice,
            charge.customer,
            charge.status,
            charge.failure_message || null,
            charge.payment_method_details?.card?.brand || null,
            charge.payment_method_details?.card?.last4 || null,
            charge.payment_method_details?.card?.exp_month || null,
            charge.payment_method_details?.card?.exp_year || null,
            new Date(charge.created * 1000)
          ]);

          chargeCount++;
          console.log(`✅ Inserted charge ${charge.id}`);
        } catch (err) {
          console.error(`❌ Failed to insert charge ${charge.id}`, err);
        }
      }
    }

    hasMore = response.has_more;
    startingAfter = hasMore && response.data.length > 0
      ? response.data[response.data.length - 1].id
      : undefined;
  }

  await db.end();
  console.log(`Sync complete ✅ ${invoiceCount} invoices processed, ${chargeCount} charges inserted.`);
}

syncInvoices()
  .catch(err => {
    console.error("Sync failed ❌", err);
    process.exit(1);
  });
