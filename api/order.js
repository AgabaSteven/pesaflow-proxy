// GET /api/order?ref=ORD-XXXX   → one order's status
// GET /api/order?phone=07XXXXXXXX → recent orders for that phone (any device)
//
// Backed by the order store the webhook keeps up to date. If a record looks
// pending, we refresh it once from D Gateway's /verify so the answer is current
// even before a webhook arrives.

const { getOrder, findByPhone } = require("../lib/store")
const { verifyStatus, normalizeStatus } = require("../lib/dgateway")

function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

async function refreshIfPending(o) {
    if (o && o.status === "pending" && o.txn_reference) {
        const v = await verifyStatus(o.txn_reference)
        if (v.data?.status) o.status = normalizeStatus(v.data.status)
    }
    return o
}

module.exports = async (req, res) => {
    cors(res)
    if (req.method === "OPTIONS") return res.status(204).end()
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

    const ref = (req.query.ref || "").toString().trim()
    const phone = (req.query.phone || "").toString().trim()

    try {
        if (ref) {
            const order = await refreshIfPending(await getOrder(ref))
            return res.status(200).json({ data: order || null })
        }
        if (phone) {
            const orders = await findByPhone(phone)
            await Promise.all(orders.map(refreshIfPending))
            return res.status(200).json({ data: orders })
        }
        return res.status(400).json({ error: "Provide ?ref= or ?phone=" })
    } catch (err) {
        console.error("[order] lookup error", err)
        return res.status(500).json({ error: "Lookup failed" })
    }
}
