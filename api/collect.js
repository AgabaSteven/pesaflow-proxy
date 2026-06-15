// POST /api/collect — starts a D Gateway mobile money collection.
// The secret API key lives in the DGATEWAY_API_KEY environment variable on
// Vercel — it is never exposed to the browser. The Framer CartDrawer sends
// { amount, currency, phone_number, provider, description } and gets back
// D Gateway's response ({ data: { reference, status, ... } }).

const API_BASE = "https://dgatewayapi.desispay.com"
const MIN_AMOUNT = 500 // UGX — reject junk/zero charges before they hit the API

// strip BOM/whitespace that can sneak in when the env var is set from a file
const apiKey = () => (process.env.DGATEWAY_API_KEY || "").replace(/^\uFEFF/, "").trim()

const { saveOrder } = require("../lib/store")

function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

module.exports = async (req, res) => {
    cors(res)
    if (req.method === "OPTIONS") return res.status(204).end()
    if (req.method !== "POST")
        return res.status(405).json({ error: "Method not allowed" })
    if (!apiKey())
        return res.status(500).json({ error: "DGATEWAY_API_KEY is not configured" })

    const { amount, currency, phone_number, provider, description, metadata } =
        req.body || {}

    const amt = Math.round(Number(amount))
    if (!Number.isFinite(amt) || amt < MIN_AMOUNT)
        return res.status(400).json({ error: `Invalid amount (minimum ${MIN_AMOUNT})` })

    const phone = String(phone_number || "").replace(/\D/g, "")
    if (!/^(256\d{9}|0\d{9})$/.test(phone))
        return res.status(400).json({ error: "Invalid phone number" })

    try {
        const r = await fetch(`${API_BASE}/v1/payments/collect`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": apiKey(),
            },
            body: JSON.stringify({
                amount: amt,
                currency: currency || "UGX",
                phone_number: phone,
                provider: provider === "relworx" ? "relworx" : "iotec",
                description: String(description || "Store order").slice(0, 200),
                metadata: metadata || undefined,
            }),
        })
        const data = await r.json().catch(() => ({}))
        const txRef = data?.data?.reference

        // Record a pending order so the webhook can flip it to paid/failed and
        // OrderTracker can look it up later (by order ref or phone, any device).
        if (r.ok && txRef) {
            try {
                const m = metadata || {}
                await saveOrder({
                    order_ref: m.order_ref || txRef,
                    txn_reference: txRef,
                    status: "pending",
                    amount: amt,
                    currency: currency || "UGX",
                    phone,
                    provider: provider === "relworx" ? "relworx" : "iotec",
                    description: String(description || "").slice(0, 200),
                    customer: {
                        name: m.name || "",
                        email: m.email || "",
                        address: m.address || "",
                        zone: m.zone || "",
                        coupon: m.coupon || "",
                    },
                    source: "cart",
                })
            } catch (e) {
                console.error("collect store error:", e)
            }
        }

        return res.status(r.status).json(data)
    } catch (err) {
        console.error("collect error:", err)
        return res.status(502).json({ error: "Payment gateway unreachable" })
    }
}
