// POST /api/webhook — receives D Gateway payment/subscription events.
//
// Security model (defence in depth):
//   1. Verify the HMAC-SHA256 signature in X-DGateway-Signature over the raw
//      body using DGATEWAY_WEBHOOK_SECRET.
//   2. REGARDLESS, re-confirm the payment status by calling D Gateway's
//      authenticated /verify endpoint with our secret API key. We only ever
//      mark an order "paid" if D Gateway itself says so — a forged webhook
//      cannot fake a payment, and an unexpected payload shape can't break us
//      because we only need the transaction reference from it.
//
// The exact incoming payload shape is confirmed from the logs on the first real
// event (we log the keys + whether the signature matched).

const crypto = require("crypto")
const { getOrder, saveOrder } = require("../lib/store")
const { verifyStatus, normalizeStatus } = require("../lib/dgateway")

const secret = () => (process.env.DGATEWAY_WEBHOOK_SECRET || "").replace(/^﻿/, "").trim()

async function readRawBody(req) {
    try {
        const chunks = []
        for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
        return Buffer.concat(chunks)
    } catch {
        return Buffer.from("")
    }
}

function signatureMatches(raw, header) {
    if (!header || !secret()) return false
    const provided = String(header).replace(/^sha256=/i, "").trim()
    const expected = crypto.createHmac("sha256", secret()).update(raw).digest("hex")
    try {
        const a = Buffer.from(provided, "hex")
        const b = Buffer.from(expected, "hex")
        return a.length === b.length && crypto.timingSafeEqual(a, b)
    } catch {
        return false
    }
}

// Pull the transaction reference out of whatever shape the payload uses.
function extractReference(body) {
    return (
        body?.reference ||
        body?.data?.reference ||
        body?.transaction?.reference ||
        body?.data?.transaction?.reference ||
        body?.data?.id ||
        null
    )
}
function extractOrderRef(body) {
    return (
        body?.metadata?.order_ref ||
        body?.data?.metadata?.order_ref ||
        body?.order_ref ||
        null
    )
}

module.exports = async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

    const raw = await readRawBody(req)
    let body = {}
    try { body = JSON.parse(raw.toString("utf8") || "{}") } catch {}

    const sigOk = signatureMatches(raw, req.headers["x-dgateway-signature"])
    const reference = extractReference(body)
    const orderRef = extractOrderRef(body)

    // One-time discovery aid: see the real shape in the Vercel logs.
    console.log("[webhook] received", {
        sigOk,
        event: body?.event || body?.type || null,
        reference,
        orderRef,
        keys: Object.keys(body || {}),
    })

    // Always 200 quickly so D Gateway doesn't retry forever; do the work first
    // only because it's fast.
    if (!reference) {
        return res.status(200).json({ received: true, note: "no reference in payload" })
    }

    // Authoritative status — this is the real gate.
    const v = await verifyStatus(reference)
    const status = normalizeStatus(v.data?.status)

    try {
        let order = (await getOrder(reference)) || (orderRef && (await getOrder(orderRef)))
        if (order) {
            order.status = status
            order.txn_reference = reference
            if (v.data?.amount != null) order.amount = v.data.amount
            if (v.data?.currency) order.currency = v.data.currency
            order.last_event = body?.event || body?.type || ""
            await saveOrder(order)
        } else {
            // No prior record (e.g. a payment not started via our cart) — store
            // a minimal one keyed by the reference so it's still lookupable.
            await saveOrder({
                order_ref: orderRef || reference,
                txn_reference: reference,
                status,
                amount: v.data?.amount,
                currency: v.data?.currency,
                phone: body?.phone || body?.data?.phone_number || "",
                source: "webhook",
            })
        }
    } catch (err) {
        console.error("[webhook] store error", err)
        // still ack — we don't want infinite retries; status is recoverable via /verify
    }

    return res.status(200).json({ received: true, reference, status, signatureVerified: sigOk })
}

// Read the raw body ourselves (don't let the platform pre-parse it), so the
// HMAC is computed over exactly what D Gateway signed.
module.exports.config = { api: { bodyParser: false } }
