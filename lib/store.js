// store.js — order persistence on Upstash Redis (Vercel KV / Marketplace).
// Reads connection details from the env vars Vercel injects when you attach a
// KV / Upstash Redis store (KV_REST_API_URL/TOKEN) or a plain Upstash database
// (UPSTASH_REDIS_REST_URL/TOKEN). Orders are keyed by order_ref, with a
// txn-reference index and a per-phone list so they can be looked up later.

const { Redis } = require("@upstash/redis")

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

const redis = url && token ? new Redis({ url, token }) : null
const ORDER_TTL = 60 * 60 * 24 * 90 // keep orders 90 days

function hasStore() {
    return !!redis
}

// Canonical Ugandan phone: digits only, normalised to 2567XXXXXXXX.
function canonPhone(p) {
    let d = String(p || "").replace(/\D/g, "")
    if (d.length === 10 && d.startsWith("0")) d = "256" + d.slice(1)
    else if (d.length === 9) d = "256" + d
    return d
}

async function saveOrder(o) {
    if (!redis) return
    const ref = o.order_ref || o.txn_reference
    if (!ref) return
    o.order_ref = ref
    o.updated_at = new Date().toISOString()
    if (!o.created_at) o.created_at = o.updated_at

    await redis.set(`order:${ref}`, o, { ex: ORDER_TTL })
    if (o.txn_reference && o.txn_reference !== ref) {
        await redis.set(`txn:${o.txn_reference}`, ref, { ex: ORDER_TTL })
    }
    if (o.phone) {
        const key = `phone:${canonPhone(o.phone)}`
        // de-dupe then push newest to front, cap at 50
        await redis.lrem(key, 0, ref)
        await redis.lpush(key, ref)
        await redis.ltrim(key, 0, 49)
        await redis.expire(key, ORDER_TTL)
    }
}

async function getOrder(ref) {
    if (!redis || !ref) return null
    let o = await redis.get(`order:${ref}`)
    if (!o) {
        const mapped = await redis.get(`txn:${ref}`)
        if (mapped) o = await redis.get(`order:${mapped}`)
    }
    return o || null
}

async function findByPhone(phone) {
    if (!redis) return []
    const refs = await redis.lrange(`phone:${canonPhone(phone)}`, 0, 9)
    if (!refs || refs.length === 0) return []
    const orders = await Promise.all(refs.map((r) => redis.get(`order:${r}`)))
    return orders.filter(Boolean)
}

module.exports = { hasStore, saveOrder, getOrder, findByPhone, canonPhone }
