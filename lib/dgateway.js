// dgateway.js — shared helpers for talking to the D Gateway API.

const API_BASE = "https://dgatewayapi.desispay.com"

// strip BOM/whitespace that can sneak in when an env var is set from a file
const apiKey = () => (process.env.DGATEWAY_API_KEY || "").replace(/^﻿/, "").trim()

// Authoritative status lookup by transaction reference. We always trust THIS
// (authenticated with our secret key) over anything a webhook body claims.
async function verifyStatus(reference) {
    try {
        const r = await fetch(`${API_BASE}/v1/webhooks/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": apiKey() },
            body: JSON.stringify({ reference }),
        })
        const data = await r.json().catch(() => ({}))
        return { ok: r.ok, httpStatus: r.status, data: data?.data || null }
    } catch (err) {
        return { ok: false, httpStatus: 0, data: null }
    }
}

// Map D Gateway status → our stored status.
function normalizeStatus(s) {
    if (s === "completed" || s === "paid" || s === "success" || s === "successful") return "paid"
    if (s === "failed" || s === "cancelled" || s === "declined") return "failed"
    return "pending"
}

module.exports = { API_BASE, apiKey, verifyStatus, normalizeStatus }
