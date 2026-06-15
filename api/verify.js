// POST /api/verify — checks the status of a payment by reference.
// The Framer CartDrawer polls this every few seconds after starting a
// collection, until the status becomes "completed" or "failed".

const API_BASE = "https://dgatewayapi.desispay.com"

// strip BOM/whitespace that can sneak in when the env var is set from a file
const apiKey = () => (process.env.DGATEWAY_API_KEY || "").replace(/^\uFEFF/, "").trim()

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

    const reference = String((req.body || {}).reference || "").trim()
    if (!reference || reference.length > 100)
        return res.status(400).json({ error: "Invalid reference" })

    try {
        const r = await fetch(`${API_BASE}/v1/webhooks/verify`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Api-Key": apiKey(),
            },
            body: JSON.stringify({ reference }),
        })
        const data = await r.json().catch(() => ({}))
        return res.status(r.status).json(data)
    } catch (err) {
        console.error("verify error:", err)
        return res.status(502).json({ error: "Payment gateway unreachable" })
    }
}
